from typing import List, Tuple
import itertools

from ..models import schemas
from ..models import db
from ..services.memory_search import search_bespoke_memory
from ..services.gateway_client import semantic_gmail_search


def _rrf_merge(groups: List[List[schemas.Memory]], k: int = 5, constant: int = 60) -> List[schemas.Memory]:
    scores = {}
    order = {}
    for source_idx, group in enumerate(groups):
        for rank, item in enumerate(group, start=1):
            key = (item.source, item.content)
            score = 1.0 / (constant + rank)
            scores[key] = scores.get(key, 0.0) + score
            order.setdefault(key, []).append((source_idx, rank))
    sorted_keys = sorted(scores.keys(), key=lambda k: scores[k], reverse=True)
    merged = []
    for key in itertools.islice(sorted_keys, k):
        source, content = key
        merged.append(schemas.Memory(id=f"{source}:{len(merged)}", content=content, source=source))
    return merged


async def _gmail_semantic_results(user_id: str, query: str, limit: int = 5) -> List[schemas.Memory]:
    threads = await semantic_gmail_search(query, limit)
    memories: List[schemas.Memory] = []
    for idx, entry in enumerate(threads):
        subject = entry.get("subject") or "(no subject)"
        snippet = entry.get("summary") or entry.get("snippet") or ""
        sender = entry.get("sender") or ""
        text = f"{subject}\n{snippet}".strip()
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
    bespoke = await search_bespoke_memory(user_id=user_id, query=query, k=5)
    bespoke_memories = [
        schemas.Memory(id=f"bespoke:{index}", content=snippet.content, source=snippet.source)
        for index, snippet in enumerate(bespoke)
    ]
    gmail_memories = await _gmail_semantic_results(user_id, query, limit=5)
    fallback_memories = []
    if not bespoke_memories and not gmail_memories:
        rows = await db.search_memories(query=query, user_id=user_id)
        fallback_memories = [
            schemas.Memory(id=row.get("id", ""), content=row.get("content", ""), source=row.get("source", "chat"))
            for row in rows
        ]
    groups = [group for group in [bespoke_memories, gmail_memories, fallback_memories] if group]
    if not groups:
        return []
    return _rrf_merge(groups, k=5)


async def create_memory_tool(user_id: str, content: str, source: str = "chat") -> schemas.Memory:
    memory_id = await db.save_memory(user_id=user_id, content=content, source=source)
    return schemas.Memory(id=memory_id, content=content, source=source)
