"""
Phase 4: Extract memory candidates from Gmail + bespoke, score, and insert into user_memories.
Run as a batch job (e.g. backfill) or on-demand.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Optional

from .database import get_pool
from .internal_client import get_internal_client
from . import user_memory_store

logger = logging.getLogger(__name__)

# Only insert if confidence >= this (plan: e.g. 0.7)
CONFIDENCE_THRESHOLD = 0.7
# Default confidence for Gmail thread summaries (heuristic; can replace with scorer later)
GMAIL_DEFAULT_CONFIDENCE = 0.7
# Default confidence for bespoke chunks (user uploaded)
BESPOKE_DEFAULT_CONFIDENCE = 0.75
# Max content length to store (avoid huge rows)
MAX_CONTENT_LENGTH = 2000


@dataclass
class MemoryCandidate:
    content: str
    source_type: str
    source_id: str
    confidence: float


async def _fetch_gmail_candidates(user_id: str, limit: int = 500) -> List[MemoryCandidate]:
    """Fetch Gmail thread summaries from gateway and build candidates."""
    try:
        client = await get_internal_client()
        threads = await client.get_gmail_thread_summaries(user_id, limit=limit)
    except Exception as e:  # noqa: BLE001
        logger.warning("Failed to fetch Gmail threads for extraction: %s", e)
        return []
    candidates: List[MemoryCandidate] = []
    for t in threads:
        thread_id = t.get("threadId") or t.get("id") or ""
        subject = (t.get("subject") or "").strip()
        summary = (t.get("summary") or "").strip()
        sender = (t.get("sender") or "").strip()
        content = f"{subject}\n{summary}\nFrom: {sender}".strip()
        if not content or not thread_id:
            continue
        if len(content) > MAX_CONTENT_LENGTH:
            content = content[:MAX_CONTENT_LENGTH] + "..."
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="gmail",
                source_id=thread_id,
                confidence=GMAIL_DEFAULT_CONFIDENCE,
            )
        )
    return candidates


async def _fetch_bespoke_candidates(user_id: str, limit: int = 200) -> List[MemoryCandidate]:
    """Fetch bespoke chunks from memory_chunks and build candidates."""
    pool = await get_pool()
    query = """
        SELECT id, source, file_path, content, summary
        FROM memory_chunks
        WHERE user_id = $1 AND content IS NOT NULL AND content != ''
        ORDER BY created_at DESC
        LIMIT $2
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, limit)
    candidates: List[MemoryCandidate] = []
    for r in rows:
        chunk_id = str(r["id"])
        content = ((r["summary"] or r["content"]) or "").strip()
        if not content:
            continue
        if len(content) > MAX_CONTENT_LENGTH:
            content = content[:MAX_CONTENT_LENGTH] + "..."
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="bespoke",
                source_id=chunk_id,
                confidence=BESPOKE_DEFAULT_CONFIDENCE,
            )
        )
    return candidates


async def run_extraction_for_user(
    user_id: str,
    *,
    gmail_limit: int = 500,
    bespoke_limit: int = 200,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
) -> dict:
    """
    Extract candidates from Gmail + bespoke, filter by confidence, insert into user_memories.
    Skips (user_id, source_type, source_id) that already exist.
    Returns counts: { gmail_candidates, bespoke_candidates, inserted, skipped }.
    """
    gmail_candidates = await _fetch_gmail_candidates(user_id, limit=gmail_limit)
    bespoke_candidates = await _fetch_bespoke_candidates(user_id, limit=bespoke_limit)
    inserted = 0
    skipped = 0
    for candidate in gmail_candidates + bespoke_candidates:
        if candidate.confidence < confidence_threshold:
            skipped += 1
            continue
        exists = await user_memory_store.exists_user_memory_for_source(
            user_id, candidate.source_type, candidate.source_id
        )
        if exists:
            skipped += 1
            continue
        try:
            await user_memory_store.insert_user_memory(
                user_id=user_id,
                content=candidate.content,
                source_type=candidate.source_type,
                source_id=candidate.source_id,
                scope="extraction",
                confidence=candidate.confidence,
                embedding=None,
            )
            inserted += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to insert extracted memory: %s", e)
            skipped += 1
    return {
        "gmail_candidates": len(gmail_candidates),
        "bespoke_candidates": len(bespoke_candidates),
        "inserted": inserted,
        "skipped": skipped,
    }
