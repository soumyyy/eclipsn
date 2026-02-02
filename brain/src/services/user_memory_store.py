"""Unified user_memories table: insert, semantic search, list, soft-delete."""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional, Sequence

from ..config import get_settings
from .database import get_pool

logger = logging.getLogger(__name__)


def _to_pgvector(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(v)) for v in values) + "]"


async def _embed_text(text: str) -> Optional[List[float]]:
    """Embed a single query/text with OpenAI text-embedding-3-small. Returns None if disabled or missing key."""
    settings = get_settings()
    if not getattr(settings, "enable_openai", False) or not getattr(settings, "openai_api_key", ""):
        return None
    try:
        from langchain_openai import OpenAIEmbeddings
        embeddings = OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model="text-embedding-3-small",
            show_progress_bar=False,
        )
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, embeddings.embed_query, text)
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("Embedding failed: %s", e)
        return None


async def insert_user_memory(
    user_id: str,
    content: str,
    source_type: str,
    source_id: Optional[str] = None,
    scope: Optional[str] = None,
    confidence: Optional[float] = None,
    embedding: Optional[List[float]] = None,
) -> str:
    """Insert a row into user_memories. If embedding is None, compute it (when OpenAI is enabled). Returns id.
    Raises ValueError if content is empty or if embedding cannot be computed (so the memory would be stored but invisible in search)."""
    content = (content or "").strip()
    if not content:
        raise ValueError("Content cannot be empty.")
    if embedding is None:
        embedding = await _embed_text(content)
    if embedding is None:
        raise ValueError(
            "Embedding unavailable (OpenAI disabled or failed); cannot store searchable memory. "
            "Memories without embeddings do not appear in memory_lookup or memory_context."
        )
    pool = await get_pool()
    query = """
        INSERT INTO user_memories (user_id, content, source_type, source_id, scope, confidence, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
        RETURNING id
    """
    vector_literal = _to_pgvector(embedding)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            query,
            user_id,
            content,
            source_type,
            source_id,
            scope,
            confidence,
            vector_literal,
        )
    return str(row["id"])


async def search_user_memories(
    user_id: str,
    query_embedding: List[float],
    limit: int = 10,
) -> List[dict]:
    """Semantic search over user_memories (cosine similarity). Returns list of {id, content, source_type, source_id, scope, confidence}."""
    pool = await get_pool()
    vector_literal = _to_pgvector(query_embedding)
    query = """
        SELECT id, content, source_type, source_id, scope, confidence
        FROM user_memories
        WHERE user_id = $1 AND deleted_at IS NULL AND embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $3
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, vector_literal, limit)
    return [
        {
            "id": str(r["id"]),
            "content": r["content"],
            "source_type": r["source_type"] or "chat",
            "source_id": r["source_id"],
            "scope": r["scope"],
            "confidence": r["confidence"],
        }
        for r in rows
    ]


async def list_user_memories_filtered(
    user_id: str,
    query_text: str,
    limit: int = 20,
    exclude_source_types: Optional[List[str]] = None,
) -> List[dict]:
    """List user_memories filtered by content containing query_text (ILIKE). Used when embedding is unavailable.
    When exclude_source_types is set (e.g. ['gmail']), those source_type rows are excluded (used for Settings UI)."""
    if not (query_text or "").strip():
        return await list_user_memories(user_id, limit=limit, offset=0, exclude_source_types=exclude_source_types)
    pool = await get_pool()
    pattern = f"%{(query_text or '').strip()}%"
    if exclude_source_types:
        sql = """
            SELECT id, content, source_type, source_id, scope, confidence
            FROM user_memories
            WHERE user_id = $1 AND deleted_at IS NULL AND content ILIKE $2
              AND (source_type IS NULL OR source_type != ALL($4::text[]))
            ORDER BY created_at DESC
            LIMIT $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, user_id, pattern, limit, exclude_source_types)
    else:
        sql = """
            SELECT id, content, source_type, source_id, scope, confidence
            FROM user_memories
            WHERE user_id = $1 AND deleted_at IS NULL AND content ILIKE $2
            ORDER BY created_at DESC
            LIMIT $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, user_id, pattern, limit)
    return [
        {
            "id": str(r["id"]),
            "content": r["content"],
            "source_type": r["source_type"] or "chat",
            "source_id": r["source_id"],
            "scope": r["scope"],
            "confidence": r["confidence"],
        }
        for r in rows
    ]


async def search_user_memories_by_query(
    user_id: str,
    query_text: str,
    limit: int = 20,
    exclude_source_types: Optional[List[str]] = None,
) -> List[dict]:
    """Semantic search using query text (embeds then searches). Returns same shape as search_user_memories.
    When embedding is unavailable, falls back to list_user_memories_filtered (ILIKE on content).
    When exclude_source_types is set (e.g. ['gmail']), those rows are excluded (used for Settings UI)."""
    embedding = await _embed_text((query_text or "").strip())
    if embedding:
        rows = await search_user_memories(user_id, embedding, limit=limit)
        if exclude_source_types:
            rows = [
                r for r in rows
                if (r.get("source_type") or "chat") not in exclude_source_types
            ]
        return rows
    return await list_user_memories_filtered(
        user_id, (query_text or "").strip(), limit=limit, exclude_source_types=exclude_source_types
    )


async def list_user_memories(
    user_id: str,
    limit: int = 20,
    offset: int = 0,
    exclude_source_types: Optional[List[str]] = None,
) -> List[dict]:
    """List user_memories by created_at desc. Same shape as search_user_memories rows.
    When exclude_source_types is set (e.g. ['gmail']), those source_type rows are excluded (used for Settings UI)."""
    pool = await get_pool()
    if exclude_source_types:
        query = """
            SELECT id, content, source_type, source_id, scope, confidence
            FROM user_memories
            WHERE user_id = $1 AND deleted_at IS NULL
              AND (source_type IS NULL OR source_type != ALL($4::text[]))
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_id, limit, offset, exclude_source_types)
    else:
        query = """
            SELECT id, content, source_type, source_id, scope, confidence
            FROM user_memories
            WHERE user_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, user_id, limit, offset)
    return [
        {
            "id": str(r["id"]),
            "content": r["content"],
            "source_type": r["source_type"] or "chat",
            "source_id": r["source_id"],
            "scope": r["scope"],
            "confidence": r["confidence"],
        }
        for r in rows
    ]


async def exists_user_memory_for_source(
    user_id: str,
    source_type: str,
    source_id: Optional[str],
) -> bool:
    """True if at least one non-deleted user_memory exists for this (user_id, source_type, source_id)."""
    if source_id is None:
        return False
    pool = await get_pool()
    query = """
        SELECT 1 FROM user_memories
        WHERE user_id = $1 AND source_type = $2 AND source_id = $3 AND deleted_at IS NULL
        LIMIT 1
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, user_id, source_type, source_id)
    return row is not None


async def get_user_memory_by_source(
    user_id: str,
    source_type: str,
    source_id: Optional[str],
    scope: Optional[str] = None,
) -> Optional[dict]:
    if source_id is None:
        return None
    pool = await get_pool()
    query = """
        SELECT id, content
        FROM user_memories
        WHERE user_id = $1
          AND source_type = $2
          AND source_id = $3
          AND deleted_at IS NULL
          AND scope IS NOT DISTINCT FROM $4
        LIMIT 1
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, user_id, source_type, source_id, scope)
    if not row:
        return None
    return {"id": str(row["id"]), "content": row["content"]}


async def find_user_memory_by_content(
    user_id: str,
    content: str,
    source_type: str,
    scope: Optional[str] = None,
) -> Optional[str]:
    pool = await get_pool()
    query = """
        SELECT id
        FROM user_memories
        WHERE user_id = $1
          AND source_type = $2
          AND content = $3
          AND deleted_at IS NULL
          AND scope IS NOT DISTINCT FROM $4
        LIMIT 1
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, user_id, source_type, content, scope)
    return str(row["id"]) if row else None


async def update_user_memory(
    memory_id: str,
    content: str,
    confidence: Optional[float],
    embedding: Optional[List[float]] = None,
) -> None:
    if embedding is None:
        embedding = await _embed_text(content)
    if embedding is None:
        raise ValueError(
            "Embedding unavailable (OpenAI disabled or failed); cannot update searchable memory."
        )
    pool = await get_pool()
    vector_literal = _to_pgvector(embedding)
    query = """
        UPDATE user_memories
        SET content = $2,
            confidence = $3,
            embedding = $4::vector
        WHERE id = $1
    """
    async with pool.acquire() as conn:
        await conn.execute(query, memory_id, content, confidence, vector_literal)


async def upsert_user_memory_from_source(
    user_id: str,
    content: str,
    source_type: str,
    source_id: Optional[str],
    scope: Optional[str],
    confidence: Optional[float],
) -> str:
    existing = await get_user_memory_by_source(user_id, source_type, source_id, scope)
    if existing:
        if existing["content"] == content:
            return "skipped"
        await update_user_memory(existing["id"], content, confidence)
        return "updated"
    await insert_user_memory(
        user_id=user_id,
        content=content,
        source_type=source_type,
        source_id=source_id,
        scope=scope,
        confidence=confidence,
        embedding=None,
    )
    return "inserted"


async def delete_user_memories_by_source(
    user_id: str,
    source_type: str,
    source_id: str,
    scope: Optional[str] = None,
) -> int:
    pool = await get_pool()
    query = """
        UPDATE user_memories
        SET deleted_at = NOW()
        WHERE user_id = $1
          AND source_type = $2
          AND source_id = $3
          AND deleted_at IS NULL
          AND scope IS NOT DISTINCT FROM $4
    """
    async with pool.acquire() as conn:
        result = await conn.execute(query, user_id, source_type, source_id, scope)
    return int(result.split()[-1]) if result else 0


async def delete_user_memories_not_in_sources(
    user_id: str,
    source_type: str,
    source_ids: List[str],
    scope: Optional[str] = None,
) -> int:
    if not source_ids:
        return 0
    pool = await get_pool()
    query = """
        UPDATE user_memories
        SET deleted_at = NOW()
        WHERE user_id = $1
          AND source_type = $2
          AND deleted_at IS NULL
          AND scope IS NOT DISTINCT FROM $3
          AND source_id IS NOT NULL
          AND NOT (source_id = ANY($4::text[]))
    """
    async with pool.acquire() as conn:
        result = await conn.execute(query, user_id, source_type, scope, source_ids)
    return int(result.split()[-1]) if result else 0


async def delete_user_memory(memory_id: str, user_id: str) -> bool:
    """Soft-delete: set deleted_at. Returns True if a row was updated."""
    pool = await get_pool()
    query = """
        UPDATE user_memories
        SET deleted_at = NOW()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    """
    async with pool.acquire() as conn:
        result = await conn.execute(query, memory_id, user_id)
    return result and "UPDATE 1" in result


async def delete_user_memories_by_ids(user_id: str, memory_ids: List[str]) -> int:
    if not memory_ids:
        return 0
    pool = await get_pool()
    query = """
        UPDATE user_memories
        SET deleted_at = NOW()
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND id = ANY($2::uuid[])
    """
    async with pool.acquire() as conn:
        result = await conn.execute(query, user_id, memory_ids)
    return int(result.split()[-1]) if result else 0
