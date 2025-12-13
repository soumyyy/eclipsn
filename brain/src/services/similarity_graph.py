from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from typing import Iterable, Sequence

from .database import get_pool

logger = logging.getLogger(__name__)


def _to_pgvector(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


async def fetch_chunk_nodes(ingestion_id: str) -> list[dict]:
    pool = await get_pool()
    query = """
        SELECT id,
               graph_metadata,
               embedding
        FROM memory_chunks
        WHERE ingestion_id = $1
          AND embedding IS NOT NULL
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_id)
    nodes: list[dict] = []
    for row in rows:
        metadata = _normalize_metadata(row["graph_metadata"])
        raw_embedding = row["embedding"]
        if not raw_embedding:
            continue
        embedding = _parse_pgvector(raw_embedding)
        if not embedding:
            continue
        chunk_node_id = metadata.get("chunkNodeId") or f"CHUNK::{row['id']}"
        nodes.append(
            {
                "chunk_id": str(row["id"]),
                "chunk_node_id": chunk_node_id,
                "embedding": embedding,
            }
        )
    return nodes


def _normalize_metadata(value) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:  # pragma: no cover
        return {}


def _parse_pgvector(value) -> list[float]:
    if isinstance(value, (list, tuple)):
        return [float(val) for val in value]
    text = str(value).strip()
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [float(part) for part in inner.split(",")]
    matches = re.findall(r"-?\d+\.?\d*", text)
    return [float(match) for match in matches]


async def query_neighbors(
    ingestion_id: str,
    chunk_id: str,
    vector: Sequence[float],
    limit: int,
) -> list[tuple[str, float, str]]:
    pool = await get_pool()
    query = """
        SELECT id,
               1 - (embedding <=> $2::vector) AS score,
               graph_metadata->>'chunkNodeId' AS chunk_node_id
        FROM memory_chunks
        WHERE ingestion_id = $1
          AND id <> $3
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $4
    """
    vector_literal = _to_pgvector(vector)
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_id, vector_literal, chunk_id, limit)
    results: list[tuple[str, float, str]] = []
    for row in rows:
        score = row["score"]
        if score is None:
            continue
        node_id = row["chunk_node_id"] or f"CHUNK::{row['id']}"
        results.append((str(row["id"]), float(score), node_id))
    return results


async def update_similarity_metadata(neighbor_map: dict[str, list[dict]]) -> None:
    if not neighbor_map:
        return
    pool = await get_pool()
    query = """
        UPDATE memory_chunks
        SET graph_metadata = jsonb_set(
            COALESCE(graph_metadata, '{}'::jsonb),
            '{similarNeighbors}',
            $2::jsonb,
            true
        )
        WHERE id = $1
    """
    payload = [
        (chunk_id, json.dumps(neighbors))
        for chunk_id, neighbors in neighbor_map.items()
    ]
    async with pool.acquire() as conn:
        await conn.executemany(query, payload)


async def sync_similarity_neighbors_for_ingestions(
    ingestion_ids: Iterable[str],
    top_k: int = 8,
    min_score: float = 0.5,
    degree_cap: int = 20,
) -> None:
    for ingestion_id in {ing for ing in ingestion_ids if ing}:
        chunk_nodes = await fetch_chunk_nodes(ingestion_id)
        if len(chunk_nodes) < 2:
            continue
        degree_count: dict[str, int] = defaultdict(int)
        seen_pairs: set[tuple[str, str]] = set()
        edge_specs: list[tuple[str, str, float]] = []
        for chunk in chunk_nodes:
            node_id = chunk["chunk_id"]
            neighbors = await query_neighbors(
                ingestion_id, node_id, chunk["embedding"], top_k * 2
            )
            for neighbor_chunk_id, score, neighbor_node in neighbors:
                if score < min_score:
                    continue
                pair = tuple(sorted((node_id, neighbor_chunk_id)))
                if pair in seen_pairs:
                    continue
                source_node = chunk["chunk_node_id"]
                target_node = neighbor_node
                if (
                    degree_count[source_node] >= degree_cap
                    or degree_count[target_node] >= degree_cap
                ):
                    continue
                seen_pairs.add(pair)
                degree_count[source_node] += 1
                degree_count[target_node] += 1
                edge_specs.append((node_id, neighbor_chunk_id, score))
        if not edge_specs:
            continue
        adjacency: dict[str, list[dict]] = defaultdict(list)
        chunk_node_lookup = {entry["chunk_id"]: entry["chunk_node_id"] for entry in chunk_nodes}
        for source, target, score in edge_specs:
            source_node = chunk_node_lookup.get(source, source)
            target_node = chunk_node_lookup.get(target, target)
            adjacency[source].append({"chunkNodeId": target_node, "score": score})
            adjacency[target].append({"chunkNodeId": source_node, "score": score})
        trimmed: dict[str, list[dict]] = {}
        for chunk_id, neighbors in adjacency.items():
            sorted_neighbors = sorted(neighbors, key=lambda item: item["score"], reverse=True)
            trimmed[chunk_id] = sorted_neighbors[:top_k]
        await update_similarity_metadata(trimmed)
        logger.info(
            "Synced similarity neighborhoods for ingestion %s (chunks=%d)",
            ingestion_id,
            len(trimmed),
        )
