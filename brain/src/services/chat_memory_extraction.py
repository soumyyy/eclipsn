from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ..config import get_settings
from .database import get_pool

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You extract durable, long-term memories about a user from a chat transcript.
Return ONLY a JSON array of objects: [{"content": "...", "confidence": 0.0-1.0}].
Rules:
- Only include stable facts/preferences/identity/relationships/long-term projects.
- Exclude ephemeral details, one-off tasks, transient feelings, or private secrets.
- Keep each content under 200 characters.
- Do not include duplicates or near-duplicates.
- If nothing qualifies, return [].
"""


def _coerce_json(text: str) -> List[Dict[str, Any]]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
    except Exception:
        return []
    return []


async def fetch_recent_messages(
    user_id: str,
    lookback_days: int = 7,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    pool = await get_pool()
    since = datetime.now(tz=timezone.utc) - timedelta(days=lookback_days)
    query = """
        SELECT m.role, m.text, m.created_at
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = $1 AND m.created_at >= $2
        ORDER BY m.created_at ASC
        LIMIT $3
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, since, limit)
    return [
        {"role": row["role"], "text": row["text"], "created_at": row["created_at"]}
        for row in rows
    ]


def _format_transcript(messages: List[Dict[str, Any]], max_chars: int = 8000) -> str:
    lines: List[str] = []
    for msg in messages:
        role = msg.get("role") or "user"
        text = (msg.get("text") or "").strip()
        if not text:
            continue
        timestamp = msg.get("created_at")
        stamp = ""
        if isinstance(timestamp, datetime):
            stamp = timestamp.isoformat()
        lines.append(f"[{stamp}] {role}: {text}")
    transcript = "\n".join(lines).strip()
    if len(transcript) <= max_chars:
        return transcript
    return transcript[-max_chars:]


async def extract_chat_memories(
    messages: List[Dict[str, Any]],
    max_memories: int = 10,
) -> List[Dict[str, Any]]:
    settings = get_settings()
    if not settings.enable_openai or not settings.openai_api_key:
        return []
    if not messages:
        return []

    transcript = _format_transcript(messages)
    if not transcript:
        return []

    llm = ChatOpenAI(
        api_key=settings.openai_api_key,
        temperature=0.0,
        model_name="gpt-4o-mini",
        max_tokens=500,
    )
    try:
        response = await llm.ainvoke(
            [
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=transcript),
            ]
        )
        items = _coerce_json(response.content or "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Chat memory extraction failed: %s", exc)
        return []

    cleaned: List[Dict[str, Any]] = []
    for item in items:
        content = (item.get("content") or "").strip()
        if not content:
            continue
        confidence = item.get("confidence")
        try:
            confidence_val = float(confidence)
        except Exception:
            confidence_val = 0.0
        cleaned.append({"content": content, "confidence": confidence_val})
    cleaned.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    return cleaned[:max_memories]
