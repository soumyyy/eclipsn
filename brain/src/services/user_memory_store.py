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
    """Insert a row into user_memories. If embedding is None, compute it (when OpenAI is enabled). Returns id."""
    if embedding is None:
        embedding = await _embed_text(content)
    pool = await get_pool()
    query = """
        INSERT INTO user_memories (user_id, content, source_type, source_id, scope, confidence, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
        RETURNING id
    """
    vector_literal = _to_pgvector(embedding) if embedding else None
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


async def search_user_memories_by_query(
    user_id: str,
    query_text: str,
    limit: int = 20,
) -> List[dict]:
    """Semantic search using query text (embeds then searches). Returns same shape as search_user_memories."""
    embedding = await _embed_text(query_text.strip())
    if not embedding:
        return []
    return await search_user_memories(user_id, embedding, limit=limit)


async def list_user_memories(
    user_id: str,
    limit: int = 20,
    offset: int = 0,
) -> List[dict]:
    """List user_memories by created_at desc. Same shape as search_user_memories rows."""
    pool = await get_pool()
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
