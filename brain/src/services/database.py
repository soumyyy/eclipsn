from __future__ import annotations

import asyncio
from typing import Optional

import asyncpg

from ..config import get_settings

_pool: Optional[asyncpg.Pool] = None
_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    global _pool  # pylint: disable=global-statement
    if _pool is None:
        async with _lock:
            if _pool is None:
                settings = get_settings()
                _pool = await asyncpg.create_pool(dsn=settings.database_url)
    return _pool
