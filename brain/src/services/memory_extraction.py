"""
Nightly memory ingestion entrypoint. Wrapper for the modular pipeline.
"""
from __future__ import annotations

from .memory_ingestion import run_memory_ingestion_for_user


async def run_extraction_for_user(
    user_id: str,
    *,
    gmail_limit: int = 500,
    bespoke_limit: int = 200,
    confidence_threshold: float | None = None,
) -> dict:
    _ = confidence_threshold
    return await run_memory_ingestion_for_user(
        user_id,
        gmail_limit=gmail_limit,
        bespoke_limit=bespoke_limit,
    )
