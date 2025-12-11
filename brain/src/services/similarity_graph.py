from __future__ import annotations

import logging
from collections import defaultdict
import re
from typing import Iterable, Sequence

from ..models.graph import GraphEdgeType, make_edge_id
from .database import get_pool
from .graph_store import GraphEdgeInsert, to_pgvector, upsert_graph_edges

logger = logging.getLogger(__name__)


async def delete_similarity_edges(ingestion_id: str) -> None:
    pool = await get_pool()
    query = """
        DELETE FROM graph_edges
        WHERE edge_type = 'SIMILAR_TO'
          AND metadata->>'ingestion_id' = $1
    """
    async with pool.acquire() as conn:
        await conn.execute(query, ingestion_id)


def _normalize_metadata(value) -> dict:
    if not value:
        return {}
    if isinstance(value, dict):
        return value
    try:
        import json

        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:  # pragma: no cover - fallback
        return {}


async def fetch_chunk_nodes(ingestion_id: str) -> list[dict]:
    pool = await get_pool()
    query = """
        SELECT gn.id,
               gn.metadata,
               gne.embedding
        FROM graph_nodes gn
        JOIN graph_node_embeddings gne ON gne.node_id = gn.id
        WHERE gn.node_type = 'CHUNK'
          AND gn.metadata->>'ingestion_id' = $1
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_id)
    nodes: list[dict] = []
    for row in rows:
        metadata = _normalize_metadata(row["metadata"])
        raw_embedding = row["embedding"]
        if not raw_embedding:
            continue
        embedding = _parse_pgvector(raw_embedding)
        if not embedding:
            continue
        nodes.append(
            {
                "node_id": row["id"],
                "metadata": metadata,
                "embedding": embedding,
            }
        )
    return nodes


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
    node_id: str,
    vector: Sequence[float],
    limit: int,
) -> list[tuple[str, float]]:
    pool = await get_pool()
    query = """
        SELECT target.node_id,
               1 - (target.embedding <=> $2::vector) AS score
        FROM graph_node_embeddings target
        JOIN graph_nodes gn ON gn.id = target.node_id
        WHERE gn.node_type = 'CHUNK'
          AND gn.metadata->>'ingestion_id' = $1
          AND target.node_id <> $3
        ORDER BY target.embedding <=> $2::vector
        LIMIT $4
    """
    vector_literal = to_pgvector(vector)
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_id, vector_literal, node_id, limit)
    return [(row["node_id"], float(row["score"])) for row in rows if row["score"] is not None]


async def sync_similarity_edges_for_ingestions(
    ingestion_ids: Iterable[str],
    top_k: int = 8,
    min_score: float = 0.5,
    degree_cap: int = 20,
) -> None:
    for ingestion_id in {ing for ing in ingestion_ids if ing}:
        chunk_nodes = await fetch_chunk_nodes(ingestion_id)
        if len(chunk_nodes) < 2:
            continue
        await delete_similarity_edges(ingestion_id)
        degree_count: dict[str, int] = defaultdict(int)
        seen_pairs: set[tuple[str, str]] = set()
        edge_specs: list[tuple[str, str, float]] = []
        for chunk in chunk_nodes:
            node_id = chunk["node_id"]
            neighbors = await query_neighbors(
                ingestion_id, node_id, chunk["embedding"], top_k * 2
            )
            for neighbor_id, score in neighbors:
                if score < min_score:
                    continue
                pair = tuple(sorted((node_id, neighbor_id)))
                if pair in seen_pairs:
                    continue
                if degree_count[pair[0]] >= degree_cap or degree_count[pair[1]] >= degree_cap:
                    continue
                seen_pairs.add(pair)
                degree_count[pair[0]] += 1
                degree_count[pair[1]] += 1
                edge_specs.append((pair[0], pair[1], score))
        if not edge_specs:
            continue
        user_id = await _resolve_user_id(ingestion_id)
        if not user_id:
            continue
        edges = [
            GraphEdgeInsert(
                id=make_edge_id(GraphEdgeType.SIMILAR_TO, source, target),
                user_id=user_id,
                edge_type=GraphEdgeType.SIMILAR_TO,
                from_id=source,
                to_id=target,
                weight=score,
                metadata={
                    "ingestion_id": ingestion_id,
                    "method": "pgvector_cosine",
                    "min_score": min_score,
                    "top_k": top_k,
                    "similarity": score,
                },
            )
            for source, target, score in edge_specs
        ]
        await upsert_graph_edges(edges)
        logger.info(
            "Synced %d similarity edges for ingestion %s",
            len(edges),
            ingestion_id,
        )


async def _resolve_user_id(ingestion_id: str) -> str | None:
    pool = await get_pool()
    query = "SELECT user_id FROM memory_ingestions WHERE id = $1"
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(query, ingestion_id)
    return str(user_id) if user_id else None
