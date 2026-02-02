from typing import List
import itertools

from ..models import schemas
from ..services.memory_search import search_bespoke_memory
from ..services.gateway_client import semantic_gmail_search
from ..services import user_memory_store


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


async def search_memories_tool(user_id: str, query: str) -> List[schemas.Memory]:
    """Unified recall: user_memories (semantic) + bespoke (FAISS) + Gmail (semantic). Returns stable ids for forget-this."""
    query_embedding = await user_memory_store._embed_text(query)
    user_memories: List[schemas.Memory] = []
    if query_embedding:
        rows = await user_memory_store.search_user_memories(user_id, query_embedding, limit=5)
        user_memories = [
            schemas.Memory(id=r["id"], content=r["content"], source=r["source_type"])
            for r in rows
        ]
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
    groups = [g for g in [user_memories, bespoke_memories, gmail_memories] if g]
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
