"""Lightweight DB stubs. Replace with SQLAlchemy models in future iterations."""

from typing import List


async def get_user(user_id: str) -> dict | None:
    # TODO: connect to Postgres and fetch real user records.
    if user_id:
        return {"id": user_id, "email": "user@example.com"}
    return None


async def save_message(conversation_id: str, role: str, text: str) -> None:
    # TODO: persist into messages table via SQLAlchemy or asyncpg.
    _ = (conversation_id, role, text)


async def save_memory(user_id: str, content: str, source: str = "chat") -> str:
    # TODO: insert into memories table and return id.
    _ = (user_id, content, source)
    return "memory-id"


async def search_memories(query: str, user_id: str) -> List[dict]:
    # TODO: leverage pgvector for semantic retrieval.
    _ = (query, user_id)
    return []
