from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np

logger = logging.getLogger(__name__)

try:
    import faiss  # type: ignore
except ImportError:  # pragma: no cover - dependency optional in this environment
    faiss = None


BASE_INDEX_DIR = Path(__file__).resolve().parents[2] / "faiss" / "bespoke_memory"


@dataclass
class EmbeddingRecord:
    chunk_id: str
    user_id: str
    source: str
    file_path: str
    content: str
    vector: list[float]


def ensure_index_dir(user_id: str) -> Path:
    path = BASE_INDEX_DIR / user_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_faiss_index(user_id: str, records: Iterable[EmbeddingRecord]) -> None:
    if faiss is None:
        logger.warning("faiss is not installed; skipping index creation for %s", user_id)
        return

    records = list(records)
    if not records:
        logger.info("No embeddings for user %s; removing stale index if any", user_id)
        _cleanup_index(user_id)
        _invalidate_index_cache(user_id)
        return

    vectors = np.array([rec.vector for rec in records], dtype="float32")
    faiss.normalize_L2(vectors)
    dimension = vectors.shape[1]

    index = faiss.IndexFlatIP(dimension)
    index.add(vectors)

    index_dir = ensure_index_dir(user_id)
    index_path = index_dir / "index.faiss"
    meta_path = index_dir / "meta.json"

    faiss.write_index(index, str(index_path))

    metadata = [
        {
            "chunk_id": rec.chunk_id,
            "source": rec.source,
            "file_path": rec.file_path,
            "content": rec.content,
        }
        for rec in records
    ]
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False)

    _invalidate_index_cache(user_id)
    logger.info("Updated FAISS index for user %s with %d vectors", user_id, len(records))


def _cleanup_index(user_id: str) -> None:
    index_dir = ensure_index_dir(user_id)
    index_path = index_dir / "index.faiss"
    meta_path = index_dir / "meta.json"
    for path in (index_path, meta_path):
        if path.exists():
            os.remove(path)
    # remove directory if empty
    if index_dir.exists() and not any(index_dir.iterdir()):
        index_dir.rmdir()


def _invalidate_index_cache(user_id: str) -> None:
    try:
        from .memory_search import _load_index  # pylint: disable=import-outside-toplevel
        _load_index.cache_clear()  # type: ignore[attr-defined]
    except Exception:
        pass
