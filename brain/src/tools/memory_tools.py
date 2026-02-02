from typing import List
import itertools
import re

from ..models import schemas
from ..services.memory_search import search_bespoke_memory
from ..services.gateway_client import semantic_gmail_search
from ..services import user_memory_store
from ..services.internal_client import get_internal_client


def _rrf_merge(groups: List[List[schemas.Memory]], k: int = 10, constant: int = 60) -> List[schemas.Memory]:
    """RRF merge; preserve each item's id for 'forget this' (user_memories id, gmail:threadId, bespoke:index)."""
    scores: dict[tuple[str, str], float] = {}
    id_for_key: dict[tuple[str, str], str] = {}
    for _source_idx, group in enumerate(groups):
        for rank, item in enumerate(group, start=1):
            key = (item.source, item.content)
            score = 1.0 / (constant + rank)
            scores[key] = scores.get(key, 0.0) + score
            if key not in id_for_key:
                id_for_key[key] = item.id
    sorted_keys = sorted(scores.keys(), key=lambda key: scores[key], reverse=True)
    return [
        schemas.Memory(id=id_for_key[(source, content)], content=content, source=source)
        for source, content in itertools.islice(sorted_keys, k)
    ]


async def _gmail_semantic_results(user_id: str, query: str, limit: int = 5) -> List[schemas.Memory]:
    threads = await semantic_gmail_search(user_id, query, limit)
    memories: List[schemas.Memory] = []
    for idx, entry in enumerate(threads):
        subject = entry.get("subject") or "(no subject)"
        snippet = entry.get("summary") or entry.get("snippet") or ""
        sender = entry.get("sender") or ""
        text = f"[thread:{entry.get('threadId')}] {subject}\n{snippet}".strip()
        if not text:
            continue
        memories.append(
            schemas.Memory(
                id=entry.get("threadId") or str(idx),
                content=text,
                source="gmail"
            )
        )
    return memories


async def _profile_notes_as_memories(user_id: str, query: str) -> List[schemas.Memory]:
    """Fetch profile notes that match the query; return as Memory with id profile:0, profile:1, ... so forget works."""
    try:
        client = await get_internal_client()
        profile = await client.get_profile(user_id)
    except Exception:  # noqa: BLE001
        return []
    notes = (profile or {}).get("customData") or {}
    notes_list = notes.get("notes") if isinstance(notes, dict) else []
    if not isinstance(notes_list, list):
        return []
    q = (query or "").strip().lower()
    out: List[schemas.Memory] = []
    for i, entry in enumerate(notes_list):
        text = entry.get("text") if isinstance(entry, dict) else (str(entry) if entry else "")
        if not text or (q and q not in text.lower()):
            continue
        out.append(schemas.Memory(id=f"profile:{i}", content=text, source="profile"))
    return out


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English."""
    return max(1, (len(text) + 3) // 4)


async def get_context_with_budget(
    user_id: str,
    query: str,
    max_tokens: int = 2000,
    top_memories: int = 15,
) -> str:
    """
    Phase 5: Return a single context string (user_memories + profile + bespoke + Gmail)
    merged by relevance and truncated to fit max_tokens. Use for broad questions.
    """
    # Fetch more items so we have room to trim
    query_embedding = await user_memory_store._embed_text(query)
    user_memories: List[schemas.Memory] = []
    if query_embedding:
        rows = await user_memory_store.search_user_memories(user_id, query_embedding, limit=top_memories)
        user_memories = [
            schemas.Memory(id=r["id"], content=r["content"], source=r["source_type"])
            for r in rows
        ]
    profile_memories = await _profile_notes_as_memories(user_id, query or "")
    bespoke = await search_bespoke_memory(user_id=user_id, query=query, k=top_memories)
    bespoke_memories = [
        schemas.Memory(id=f"bespoke:{i}", content=s.content, source=s.source)
        for i, s in enumerate(bespoke)
    ]
    gmail_raw = await _gmail_semantic_results(user_id, query, limit=top_memories)
    gmail_memories = [
        schemas.Memory(id=f"gmail:{m.id}", content=m.content, source=m.source)
        for m in gmail_raw
    ]
    groups = [g for g in [user_memories, profile_memories, bespoke_memories, gmail_memories] if g]
    if not groups:
        return "No stored context found for that query."
    merged = _rrf_merge(groups, k=top_memories * 2, constant=60)
    sections: List[str] = []
    total_chars = 0
    max_chars = max_tokens * 4
    for m in merged:
        line = f"- [{m.source}] [id: {m.id}] {m.content}"
        if total_chars + len(line) + 1 > max_chars:
            break
        sections.append(line)
        total_chars += len(line) + 1
    if not sections:
        return "No stored context found."
    return "Relevant context (id for forget):\n" + "\n".join(sections)


async def search_memories_tool(user_id: str, query: str) -> List[schemas.Memory]:
    """Unified recall: user_memories + profile notes + bespoke + Gmail. All returned ids (UUID or profile:N) can be forgotten."""
    query_embedding = await user_memory_store._embed_text(query)
    user_memories: List[schemas.Memory] = []
    if query_embedding:
        rows = await user_memory_store.search_user_memories(user_id, query_embedding, limit=5)
        user_memories = [
            schemas.Memory(id=r["id"], content=r["content"], source=r["source_type"])
            for r in rows
        ]
    profile_memories = await _profile_notes_as_memories(user_id, query)
    bespoke = await search_bespoke_memory(user_id=user_id, query=query, k=5)
    bespoke_memories = [
        schemas.Memory(id=f"bespoke:{index}", content=snippet.content, source=snippet.source)
        for index, snippet in enumerate(bespoke)
    ]
    gmail_raw = await _gmail_semantic_results(user_id, query, limit=5)
    gmail_memories = [
        schemas.Memory(id=f"gmail:{m.id}", content=m.content, source=m.source)
        for m in gmail_raw
    ]
    groups = [g for g in [user_memories, profile_memories, bespoke_memories, gmail_memories] if g]
    if not groups:
        return []
    return _rrf_merge(groups, k=10)


async def create_memory_tool(user_id: str, content: str, source: str = "chat") -> schemas.Memory:
    memory_id = await user_memory_store.insert_user_memory(
        user_id=user_id,
        content=content,
        source_type=source,
        source_id=None,
        scope=None,
        confidence=None,
        embedding=None,
    )
    return schemas.Memory(id=memory_id, content=content, source=source)


def _is_user_memory_id(memory_id: str) -> bool:
    """True if id is a UUID (user_memories row)."""
    return bool(re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", memory_id.strip().lower()))


def _is_profile_memory_id(memory_id: str) -> bool:
    """True if id is profile:N (profile note index)."""
    s = memory_id.strip()
    if not s.startswith("profile:"):
        return False
    try:
        idx = int(s.split(":")[1])
        return idx >= 0
    except (IndexError, ValueError):
        return False


async def forget_memory_tool(user_id: str, memory_id: str) -> str:
    """Forget by id: UUID = user_memories (soft-delete); profile:N = remove that profile note. gmail/bespoke cannot be forgotten."""
    memory_id = memory_id.strip()
    if _is_profile_memory_id(memory_id):
        try:
            idx = int(memory_id.split(":")[1])
            client = await get_internal_client()
            profile = await client.get_profile(user_id)
            notes = ((profile or {}).get("customData") or {}).get("notes") or []
            if not isinstance(notes, list) or idx < 0 or idx >= len(notes):
                return "No such profile note found, or it was already removed."
            entry = notes[idx]
            note_text = entry.get("text") if isinstance(entry, dict) else str(entry)
            if not note_text:
                return "That profile note could not be removed."
            await client.update_profile(user_id, remove_note=note_text)
            return "That information has been removed from your profile."
        except Exception:  # noqa: BLE001
            return "Could not remove that profile note. Please try again."
    if memory_id.startswith("gmail:"):
        thread_id = memory_id.split(":", 1)[1].strip()
        if not thread_id:
            return "Please provide a valid Gmail thread id."
        deleted = await user_memory_store.delete_user_memories_by_source(
            user_id=user_id,
            source_type="gmail",
            source_id=thread_id,
            scope="extraction",
        )
        if deleted:
            return "That Gmail memory has been forgotten."
        return "No stored Gmail memory matched that id."
    if memory_id.startswith("service:"):
        source_id = memory_id.split(":", 1)[1].strip()
        if not source_id:
            return "Please provide a valid service account memory id."
        deleted = await user_memory_store.delete_user_memories_by_source(
            user_id=user_id,
            source_type="service_account",
            source_id=source_id,
            scope="extraction",
        )
        if deleted:
            return "That service account memory has been forgotten."
        return "No stored service account memory matched that id."
    if not _is_user_memory_id(memory_id):
        return (
            "Only stored memories (UUID) or profile notes (profile:0, profile:1, ...) can be forgotten. "
            "Use the id from a previous memory_lookup result."
        )
    deleted = await user_memory_store.delete_user_memory(memory_id, user_id)
    if deleted:
        return "That memory has been forgotten (removed from your stored memories)."
    return "No stored memory with that id was found, or it was already removed."
