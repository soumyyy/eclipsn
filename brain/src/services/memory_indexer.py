from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from langchain_openai import OpenAIEmbeddings

from ..config import get_settings
from .database import get_pool
from .faiss_store import EmbeddingRecord, write_faiss_index

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
        LEFT JOIN memory_chunk_embeddings me ON me.chunk_id = mc.id
        WHERE me.chunk_id IS NULL
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
        INSERT INTO memory_chunk_embeddings (chunk_id, user_id, source, embedding)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (chunk_id) DO NOTHING
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            for row, vector in zip(rows, vectors):
                await conn.execute(query, row.id, row.user_id, row.source, vector)


async def fetch_all_embeddings_for_user(user_id: str) -> List[EmbeddingRecord]:
    pool = await get_pool()
    query = """
        SELECT mc.id as chunk_id,
               mc.user_id,
               mc.source,
               mc.file_path,
               mc.content,
               mce.embedding
        FROM memory_chunk_embeddings mce
        JOIN memory_chunks mc ON mc.id = mce.chunk_id
        WHERE mc.user_id = $1
        ORDER BY mc.created_at
        """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id)
    records: list[EmbeddingRecord] = []
    for row in rows:
        chunk_id = row["chunk_id"]
        user_id = row["user_id"]
        vector = row["embedding"]
        records.append(
            EmbeddingRecord(
                chunk_id=str(chunk_id),
                user_id=str(user_id),
                source=row["source"],
                file_path=row["file_path"],
                content=row["content"],
                vector=[float(x) for x in vector],
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
        vectors = await _embed_documents(embeddings, texts)
        await store_embeddings(rows, vectors)
        counts: dict[str, int] = {}
        for row in rows:
            counts[row.ingestion_id] = counts.get(row.ingestion_id, 0) + 1
        await update_index_counts(counts)
        await rebuild_indices_for_users(row.user_id for row in rows)
        processed_total += len(rows)
        logger.info("Indexed %d bespoke memory chunks (total=%d)", len(rows), processed_total)
    return processed_total


async def _embed_documents(embedding_client: OpenAIEmbeddings, texts: Sequence[str]) -> List[List[float]]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, embedding_client.embed_documents, list(texts))


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


async def update_index_counts(counts: dict[str, int]) -> None:
    if not counts:
        return
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
                FROM memory_chunks mc
                LEFT JOIN memory_chunk_embeddings me ON me.chunk_id = mc.id
                WHERE mc.ingestion_id = $1 AND me.chunk_id IS NULL
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
