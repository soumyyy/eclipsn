from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from langchain_openai import OpenAIEmbeddings

from ..config import get_settings
from .database import get_pool
from .faiss_store import EmbeddingRecord, write_faiss_index
from .graph_sync import sync_ingestions_to_graph


def _to_pgvector(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"

logger = logging.getLogger(__name__)


@dataclass
class MemoryChunkRow:
    id: str
    user_id: str
    source: str
    file_path: str
    content: str
    ingestion_id: str


async def fetch_pending_chunks(limit: int = 50) -> List[MemoryChunkRow]:
    pool = await get_pool()
    query = """
        SELECT mc.id, mc.user_id, mc.source, mc.file_path, mc.content, mc.ingestion_id
        FROM memory_chunks mc
        WHERE mc.embedding IS NULL
        ORDER BY mc.created_at
        LIMIT $1
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, limit)
    return [
        MemoryChunkRow(
            id=row["id"],
            user_id=str(row["user_id"]),
            source=row["source"],
            file_path=row["file_path"],
            content=row["content"],
            ingestion_id=str(row["ingestion_id"])
        )
        for row in rows
    ]


async def store_embeddings(rows: Sequence[MemoryChunkRow], vectors: Sequence[List[float]]) -> None:
    if len(rows) != len(vectors):
        raise ValueError("Rows and vectors length mismatch")
    pool = await get_pool()
    query = """
        UPDATE memory_chunks
        SET embedding = $2
        WHERE id = $1
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            for row, vector in zip(rows, vectors):
                vector_literal = _to_pgvector(vector)
                await conn.execute(query, row.id, vector_literal)


async def fetch_all_embeddings_for_user(user_id: str) -> List[EmbeddingRecord]:
    pool = await get_pool()
    query = """
        SELECT mc.id as chunk_id,
               mc.user_id,
               mc.source,
               mc.file_path,
               mc.content,
               mc.embedding
        FROM memory_chunks mc
        WHERE mc.user_id = $1
          AND mc.embedding IS NOT NULL
        ORDER BY mc.created_at
        """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id)
    records: list[EmbeddingRecord] = []
    for row in rows:
        chunk_id = row["chunk_id"]
        user_id = row["user_id"]
        raw_vector = row["embedding"]
        if raw_vector is None:
            continue
        if isinstance(raw_vector, str):
            vector_values = [float(val) for val in raw_vector.strip("[]").split(",") if val]
        else:
            vector_values = [float(val) for val in raw_vector]
        records.append(
            EmbeddingRecord(
                chunk_id=str(chunk_id),
                user_id=str(user_id),
                source=row["source"],
                file_path=row["file_path"],
                content=row["content"],
                vector=vector_values,
            )
        )
    return records


async def rebuild_indices_for_users(user_ids: Iterable[str]) -> None:
    seen = set()
    for user_id in user_ids:
        if user_id in seen:
            continue
        seen.add(user_id)
        records = await fetch_all_embeddings_for_user(user_id)
        write_faiss_index(user_id, records)


async def process_pending_chunks(batch_size: int = 50) -> int:
    """
    Embed pending bespoke memory chunks, store vectors, and update FAISS indexes.
    Returns number of chunks processed.
    """
    settings = get_settings()
    if not settings.enable_openai or not settings.openai_api_key:
        logger.warning("OpenAI is not configured; skipping memory indexing.")
        return 0

    embeddings = OpenAIEmbeddings(
        api_key=settings.openai_api_key,
        model="text-embedding-3-small",
        show_progress_bar=False
    )

    processed_total = 0
    while True:
        try:
            rows = await fetch_pending_chunks(limit=batch_size)
        except Exception as exc:  # pragma: no cover
            logger.exception("Failed to load pending memory chunks: %s", exc)
            break
        if not rows:
            break
        ingestion_ids = {row.ingestion_id for row in rows}
        await mark_ingestions_indexing(ingestion_ids)
        texts = [row.content for row in rows]
        try:
            vectors = await _embed_documents_resilient(embeddings, texts)
            await store_embeddings(rows, vectors)
        except Exception as exc:  # pragma: no cover
            logger.exception("Embedding failed for %d memory chunks", len(rows))
            await mark_ingestions_failed(ingestion_ids, str(exc))
            break
        counts: dict[str, int] = {}
        for row in rows:
            counts[row.ingestion_id] = counts.get(row.ingestion_id, 0) + 1
        completed_ingestions = await update_index_counts(counts)
        if completed_ingestions:
            await sync_ingestions_to_graph(completed_ingestions)
        await rebuild_indices_for_users(row.user_id for row in rows)
        processed_total += len(rows)
        logger.info("Indexed %d bespoke memory chunks (total=%d)", len(rows), processed_total)
    return processed_total


async def _embed_documents(embedding_client: OpenAIEmbeddings, texts: Sequence[str]) -> List[List[float]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, embedding_client.embed_documents, list(texts))


async def _embed_documents_resilient(
    embedding_client: OpenAIEmbeddings,
    texts: Sequence[str],
    max_retries: int = 3,
    backoff_base: float = 0.5,
) -> List[List[float]]:
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            return await _embed_documents(embedding_client, texts)
        except Exception as exc:  # pragma: no cover - guarded with retries
            last_exc = exc
            if attempt < max_retries - 1:
                await asyncio.sleep(backoff_base * (2 ** attempt))
                continue
            break
    if len(texts) <= 1:
        raise last_exc or RuntimeError("Embedding failed")
    mid = max(1, len(texts) // 2)
    left = await _embed_documents_resilient(
        embedding_client, texts[:mid], max_retries=max_retries, backoff_base=backoff_base
    )
    right = await _embed_documents_resilient(
        embedding_client, texts[mid:], max_retries=max_retries, backoff_base=backoff_base
    )
    return left + right


async def mark_ingestions_indexing(ingestion_ids: Iterable[str]) -> None:
    ids = list({ingestion_id for ingestion_id in ingestion_ids if ingestion_id})
    if not ids:
        return
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for ingestion_id in ids:
                await conn.execute(
                    """
                    UPDATE memory_ingestions
                    SET status = CASE
                        WHEN status IN ('uploaded', 'failed') THEN status
                        ELSE 'indexing'
                    END
                    WHERE id = $1
                    """,
                    ingestion_id
                )


async def mark_ingestions_failed(ingestion_ids: Iterable[str], error_message: str | None) -> None:
    ids = list({ingestion_id for ingestion_id in ingestion_ids if ingestion_id})
    if not ids:
        return
    message = (error_message or "Embedding failed").strip()
    if len(message) > 400:
        message = message[:400]
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for ingestion_id in ids:
                await conn.execute(
                    """
                    UPDATE memory_ingestions
                    SET status = 'failed',
                        error = $2,
                        completed_at = NOW()
                    WHERE id = $1
                    """,
                    ingestion_id,
                    message
                )


async def update_index_counts(counts: dict[str, int]) -> list[str]:
    if not counts:
        return []
    completed: list[str] = []
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for ingestion_id, increment in counts.items():
                await conn.execute(
                    """
                    UPDATE memory_ingestions
                    SET indexed_chunks = COALESCE(indexed_chunks, 0) + $2,
                        status = CASE
                            WHEN status IN ('uploaded', 'failed') THEN status
                            ELSE 'indexing'
                        END,
                        last_indexed_at = NOW()
                    WHERE id = $1
                    """,
                    ingestion_id,
                    increment
                )
                remaining = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM memory_chunks
                    WHERE ingestion_id = $1 AND embedding IS NULL
                    """,
                    ingestion_id
                )
                if remaining == 0:
                    await conn.execute(
                        """
                        UPDATE memory_ingestions
                        SET status = 'uploaded',
                            completed_at = NOW()
                        WHERE id = $1
                        """,
                        ingestion_id
                    )
                    completed.append(ingestion_id)
    return completed
