"""Tasks as feed_cards with type='task'; data = { description, due_date?, status?, source?, thread_id? }."""
from __future__ import annotations

import json
from typing import Optional

from .database import get_pool


async def create_task_card(
    user_id: str,
    description: str,
    *,
    due_date: Optional[str] = None,
    status: str = "open",
    source: str = "chat",
    thread_id: Optional[str] = None,
) -> str:
    """Insert a feed_card with type='task'. Returns card id."""
    pool = await get_pool()
    data = {
        "description": (description or "").strip(),
        "due_date": due_date,
        "status": status or "open",
        "source": source or "chat",
        "thread_id": thread_id,
    }
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO feed_cards (user_id, type, priority_score, data, status)
            VALUES ($1, 'task', 0, $2::jsonb, 'active')
            RETURNING id
            """,
            user_id,
            json.dumps(data),
        )
    return str(row["id"])
