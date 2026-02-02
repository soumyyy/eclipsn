"""
Nightly memory ingestion pipeline: Gmail + service accounts + bespoke + chat.
Ensures memories are inserted/updated and stale source-derived memories are cleaned up.
"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Iterable, List, Optional, Tuple

from . import user_memory_store
from .database import get_pool
from .internal_client import get_internal_client
from .chat_memory_extraction import fetch_recent_messages, extract_chat_memories

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7
GMAIL_DEFAULT_CONFIDENCE = 0.7
GMAIL_PROMO_CONFIDENCE = 0.55
SERVICE_DEFAULT_CONFIDENCE = 0.7
BESPOKE_DEFAULT_CONFIDENCE = 0.75
MAX_CONTENT_LENGTH = 2000
RETENTION_DAYS_PRIMARY = 365
RETENTION_DAYS_PROMO = 30
CONDENSE_AFTER_DAYS = 90
CONDENSE_BATCH_SIZE = 30
CONDENSE_MIN_ITEMS = 8
CONDENSE_MAX_SUMMARIES = 5


@dataclass
class MemoryCandidate:
    content: str
    source_type: str
    source_id: str
    confidence: float
    scope: Optional[str] = "extraction"


def _truncate(text: str) -> str:
    if len(text) <= MAX_CONTENT_LENGTH:
        return text
    return text[:MAX_CONTENT_LENGTH] + "..."


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _classify_sender(sender: str) -> str:
    lowered = (sender or "").lower()
    if not lowered:
        return "unknown"
    auto_keywords = [
        "noreply", "no-reply", "do-not-reply", "donotreply", "mailer-daemon",
        "notification", "notifications", "news", "newsletter", "updates",
        "support", "billing", "info@", "help@", "alerts", "digest", "system"
    ]
    if any(k in lowered for k in auto_keywords):
        return "automated"
    email_match = None
    for token in lowered.split():
        if "@" in token and "." in token:
            email_match = token.strip("<>\"'()[]")
            break
    if email_match:
        local = email_match.split("@")[0]
        if any(k in local for k in auto_keywords):
            return "automated"
        domain = email_match.split("@")[-1]
        human_domains = {
            "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
            "icloud.com", "proton.me", "protonmail.com"
        }
        if domain in human_domains:
            return "human"
    if any(ch.isalpha() for ch in lowered) and " " in lowered:
        return "human"
    return "unknown"


def _within_retention(category: Optional[str], last_message_at: Optional[datetime]) -> bool:
    if last_message_at is None:
        return True
    now = datetime.now(tz=timezone.utc)
    category_key = (category or "").lower()
    days = RETENTION_DAYS_PROMO if category_key == "promotions" else RETENTION_DAYS_PRIMARY
    return last_message_at >= now - timedelta(days=days)


async def _fetch_gmail_candidates(user_id: str, limit: int = 500) -> Tuple[List[MemoryCandidate], bool]:
    try:
        client = await get_internal_client()
        threads = await client.get_gmail_thread_summaries(user_id, limit=limit)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch Gmail threads for ingestion: %s", exc)
        return [], False

    candidates: List[MemoryCandidate] = []
    for t in threads:
        thread_id = t.get("threadId") or t.get("thread_id") or ""
        subject = (t.get("subject") or "").strip()
        summary = (t.get("summary") or "").strip()
        sender = (t.get("sender") or "").strip()
        category = t.get("category")
        mailbox = t.get("mailbox")
        last_message_at = _parse_datetime(t.get("lastMessageAt") or t.get("last_message_at"))

        if not thread_id or not (subject or summary):
            continue
        if not _within_retention(category, last_message_at):
            continue
        sender_type = _classify_sender(sender)
        is_promotions = (category or "").lower() == "promotions"
        if not is_promotions and (mailbox or "").lower() != "sent" and sender_type == "automated":
            continue

        content = _truncate(f"{subject}\n{summary}\nFrom: {sender}".strip())
        confidence = GMAIL_PROMO_CONFIDENCE if is_promotions else GMAIL_DEFAULT_CONFIDENCE
        if sender_type == "automated":
            confidence -= 0.15
        elif sender_type == "unknown":
            confidence -= 0.05
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="gmail",
                source_id=thread_id,
                confidence=confidence,
                scope="extraction",
            )
        )
    return candidates, True


async def _fetch_service_account_candidates(
    user_id: str, limit: int = 200, lookback_days: int = 365
) -> Tuple[List[MemoryCandidate], bool]:
    try:
        client = await get_internal_client()
        threads = await client.get_service_account_thread_summaries(
            user_id, limit=limit, lookback_days=lookback_days
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch service account threads: %s", exc)
        return [], False

    candidates: List[MemoryCandidate] = []
    for t in threads:
        thread_id = t.get("threadId") or t.get("thread_id") or ""
        account_id = t.get("accountId") or t.get("account_id") or ""
        subject = (t.get("subject") or "").strip()
        summary = (t.get("summary") or "").strip()
        sender = (t.get("sender") or "").strip()
        category = t.get("category")
        mailbox = t.get("mailbox")
        last_message_at = _parse_datetime(t.get("lastMessageAt") or t.get("last_message_at"))
        if not thread_id or not account_id or not (subject or summary):
            continue
        if not _within_retention(category, last_message_at):
            continue
        sender_type = _classify_sender(sender)
        is_promotions = (category or "").lower() == "promotions"
        if not is_promotions and (mailbox or "").lower() != "sent" and sender_type == "automated":
            continue
        content = _truncate(f"{subject}\n{summary}\nFrom: {sender}".strip())
        source_id = f"{account_id}|{thread_id}"
        confidence = SERVICE_DEFAULT_CONFIDENCE
        if sender_type == "automated":
            confidence -= 0.15
        elif sender_type == "unknown":
            confidence -= 0.05
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="service_account",
                source_id=source_id,
                confidence=confidence,
                scope="extraction",
            )
        )
    return candidates, True


async def _fetch_bespoke_candidates(user_id: str, limit: int = 200) -> List[MemoryCandidate]:
    pool = await get_pool()
    query = """
        SELECT id, content, summary
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
        content = _truncate(content)
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="bespoke",
                source_id=chunk_id,
                confidence=BESPOKE_DEFAULT_CONFIDENCE,
                scope="extraction",
            )
        )
    return candidates


def _chat_source_id(content: str) -> str:
    digest = hashlib.sha1(content.encode("utf-8")).hexdigest()
    return digest


async def _fetch_chat_candidates(user_id: str) -> List[MemoryCandidate]:
    messages = await fetch_recent_messages(user_id)
    extracted = await extract_chat_memories(messages)
    candidates: List[MemoryCandidate] = []
    for item in extracted:
        content = (item.get("content") or "").strip()
        if not content:
            continue
        confidence = float(item.get("confidence", 0))
        if confidence < CONFIDENCE_THRESHOLD:
            continue
        content = _truncate(content)
        candidates.append(
            MemoryCandidate(
                content=content,
                source_type="chat",
                source_id=_chat_source_id(content),
                confidence=confidence,
                scope="extraction",
            )
        )
    return candidates


async def _fetch_condense_candidates(
    user_id: str,
    source_type: str,
    older_than_days: int,
    limit: int,
) -> List[dict]:
    pool = await get_pool()
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=older_than_days)
    query = """
        SELECT id, content
        FROM user_memories
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND source_type = $2
          AND scope = 'extraction'
          AND created_at < $3
        ORDER BY created_at ASC
        LIMIT $4
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, user_id, source_type, cutoff, limit)
    return [{"id": str(r["id"]), "content": r["content"]} for r in rows]


async def _summarize_memories(items: List[dict]) -> List[str]:
    if not items:
        return []
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage, SystemMessage
    from ..config import get_settings
    settings = get_settings()
    if not settings.enable_openai or not settings.openai_api_key:
        return []
    llm = ChatOpenAI(
        api_key=settings.openai_api_key,
        temperature=0.1,
        model_name="gpt-4o-mini",
        max_tokens=400,
    )
    content_lines = [f"- {item['content']}" for item in items if item.get("content")]
    prompt = (
        "Summarize these memories into 3-5 durable, long-term facts. "
        "Return ONLY a JSON array of strings. Each string < 200 chars. "
        "No tasks, no transient states, no duplicates.\n\n"
        + "\n".join(content_lines)
    )
    try:
        response = await llm.ainvoke(
            [SystemMessage(content="You are a memory condensing assistant."), HumanMessage(content=prompt)]
        )
        text = (response.content or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        data = json.loads(text)
        if isinstance(data, list):
            return [str(item).strip() for item in data if str(item).strip()]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Memory condense failed: %s", exc)
        return []
    return []


async def _condense_memories_for_source(user_id: str, source_type: str) -> dict:
    items = await _fetch_condense_candidates(
        user_id,
        source_type,
        older_than_days=CONDENSE_AFTER_DAYS,
        limit=CONDENSE_BATCH_SIZE,
    )
    if len(items) < CONDENSE_MIN_ITEMS:
        return {"condensed": 0, "deleted": 0}
    summaries = await _summarize_memories(items)
    if not summaries:
        return {"condensed": 0, "deleted": 0}
    inserted = 0
    for summary in summaries[:CONDENSE_MAX_SUMMARIES]:
        existing = await user_memory_store.find_user_memory_by_content(
            user_id=user_id,
            content=summary,
            source_type=source_type,
            scope="condensed",
        )
        if existing:
            continue
        source_id = f"condensed:{hashlib.sha1(summary.encode('utf-8')).hexdigest()}"
        try:
            await user_memory_store.insert_user_memory(
                user_id=user_id,
                content=summary,
                source_type=source_type,
                source_id=source_id,
                scope="condensed",
                confidence=0.85,
                embedding=None,
            )
            inserted += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to insert condensed memory: %s", exc)
    if inserted == 0:
        return {"condensed": 0, "deleted": 0}
    deleted = await user_memory_store.delete_user_memories_by_ids(
        user_id=user_id, memory_ids=[item["id"] for item in items]
    )
    return {"condensed": inserted, "deleted": deleted}


async def _upsert_candidates(user_id: str, candidates: Iterable[MemoryCandidate]) -> Tuple[int, int, int]:
    inserted = 0
    updated = 0
    skipped = 0
    for candidate in candidates:
        try:
            status = await user_memory_store.upsert_user_memory_from_source(
                user_id=user_id,
                content=candidate.content,
                source_type=candidate.source_type,
                source_id=candidate.source_id,
                scope=candidate.scope,
                confidence=candidate.confidence,
            )
            if status == "inserted":
                inserted += 1
            elif status == "updated":
                updated += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to upsert memory (%s/%s): %s", candidate.source_type, candidate.source_id, exc)
            skipped += 1
    return inserted, updated, skipped


async def _cleanup_stale_sources(
    user_id: str,
    source_type: str,
    source_ids: List[str],
    enabled: bool,
) -> int:
    if not enabled:
        return 0
    try:
        return await user_memory_store.delete_user_memories_not_in_sources(
            user_id=user_id,
            source_type=source_type,
            source_ids=source_ids,
            scope="extraction",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to cleanup stale memories (%s): %s", source_type, exc)
        return 0


async def run_memory_ingestion_for_user(
    user_id: str,
    *,
    gmail_limit: int = 500,
    bespoke_limit: int = 200,
    service_limit: int = 200,
    service_lookback_days: int = 365,
) -> dict:
    gmail_candidates, gmail_ok = await _fetch_gmail_candidates(user_id, limit=gmail_limit)
    service_candidates, service_ok = await _fetch_service_account_candidates(
        user_id, limit=service_limit, lookback_days=service_lookback_days
    )
    bespoke_candidates = await _fetch_bespoke_candidates(user_id, limit=bespoke_limit)
    chat_candidates = await _fetch_chat_candidates(user_id)

    inserted = updated = skipped = 0

    for group in [gmail_candidates, service_candidates, bespoke_candidates, chat_candidates]:
        i, u, s = await _upsert_candidates(user_id, group)
        inserted += i
        updated += u
        skipped += s

    gmail_deleted = await _cleanup_stale_sources(
        user_id, "gmail", [c.source_id for c in gmail_candidates], gmail_ok
    )
    service_deleted = await _cleanup_stale_sources(
        user_id, "service_account", [c.source_id for c in service_candidates], service_ok
    )

    condensed = await _condense_memories_for_source(user_id, "gmail")
    condensed_chat = await _condense_memories_for_source(user_id, "chat")

    return {
        "gmail_candidates": len(gmail_candidates),
        "service_candidates": len(service_candidates),
        "bespoke_candidates": len(bespoke_candidates),
        "chat_candidates": len(chat_candidates),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "deleted": gmail_deleted + service_deleted,
        "condensed": condensed.get("condensed", 0) + condensed_chat.get("condensed", 0),
        "condensed_deleted": condensed.get("deleted", 0) + condensed_chat.get("deleted", 0),
    }
