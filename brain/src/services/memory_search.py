from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import List

import numpy as np

from ..config import get_settings
from .faiss_store import BASE_INDEX_DIR

logger = logging.getLogger(__name__)

try:
    import faiss  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    faiss = None


@dataclass
class MemorySnippet:
    content: str
    file_path: str
    source: str


@lru_cache(maxsize=32)
def _load_index(user_id: str):
    if faiss is None:
        return None, []
    index_path = BASE_INDEX_DIR / user_id / "index.faiss"
    meta_path = BASE_INDEX_DIR / user_id / "meta.json"
    if not index_path.exists() or not meta_path.exists():
        return None, []
    index = faiss.read_index(str(index_path))
    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    return index, metadata


def _invalidate_index_cache(user_id: str) -> None:
    try:
        _load_index.cache_clear()  # type: ignore[attr-defined]
    except AttributeError:  # pragma: no cover - python <3.9 fallback
        pass


async def search_bespoke_memory(user_id: str, query: str, k: int = 5) -> List[MemorySnippet]:
    settings = get_settings()
    if not settings.enable_openai or not settings.openai_api_key:
        return []
    if faiss is None:
        logger.warning("faiss not installed; skipping bespoke memory search")
        return []

    index, metadata = _load_index(user_id)
    if index is None or not metadata:
        return []

    query_vec = await _embed_query(query)
    if query_vec is None:
        return []

    vec = np.array([query_vec], dtype="float32")
    faiss.normalize_L2(vec)
    D, I = index.search(vec, k)
    hits = []
    for idx in I[0]:
        if idx < 0 or idx >= len(metadata):
            continue
        entry = metadata[idx]
        hits.append(
            MemorySnippet(
                content=entry.get("content", ""),
                file_path=entry.get("file_path", ""),
                source=entry.get("source", "bespoke_memory"),
            )
        )
    return hits


async def _embed_query(text: str):
    from langchain_openai import OpenAIEmbeddings

    settings = get_settings()
    embeddings = OpenAIEmbeddings(
        api_key=settings.openai_api_key,
        model="text-embedding-3-small",
        encoding_name="cl100k_base"
    )
    try:
        return await embeddings.aembed_query(text)
    except AttributeError:  # pragma: no cover - fallback for sync-only impls
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, embeddings.embed_query, text)
