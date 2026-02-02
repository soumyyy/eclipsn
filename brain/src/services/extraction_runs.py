"""Track last memory extraction run for scheduled extraction (24h check + nightly)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .database import get_pool


async def get_last_extraction_run() -> Optional[datetime]:
    """Return the most recent ran_at from memory_extraction_runs, or None."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT ran_at FROM memory_extraction_runs ORDER BY ran_at DESC LIMIT 1"
        )
    if row and row["ran_at"]:
        t = row["ran_at"]
        if getattr(t, "tzinfo", None) is not None:
            return t
        return t.replace(tzinfo=timezone.utc)
    return None


async def record_extraction_run() -> None:
    """Insert a row into memory_extraction_runs (called after a successful extraction run)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO memory_extraction_runs (ran_at) VALUES (NOW())")
