from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

def to_pgvector(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(v)) for v in values) + "]"

from ..models.graph import GraphEdgeType, GraphNodeType
from .database import get_pool


@dataclass
class GraphNodeInsert:
    id: str
    user_id: str
    node_type: GraphNodeType
    display_name: str | None = None
    summary: str | None = None
    source_uri: str | None = None
    source_table: str | None = None
    source_row_id: str | None = None
    metadata_version: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class GraphEdgeInsert:
    id: str
    user_id: str
    edge_type: GraphEdgeType
    from_id: str
    to_id: str
    weight: float | None = None
    score: float | None = None
    confidence: float | None = None
    rank: int | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class GraphEmbeddingInsert:
    node_id: str
    embedding: Sequence[float]
    embedding_model: str
    embedding_version: str
    metadata: dict[str, Any] | None = None


async def upsert_graph_nodes(rows: Sequence[GraphNodeInsert]) -> None:
    if not rows:
        return
    pool = await get_pool()
    query = """
        INSERT INTO graph_nodes (
            id,
            user_id,
            node_type,
            display_name,
            summary,
            source_uri,
            source_table,
            source_row_id,
            metadata_version,
            metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE
        SET display_name = EXCLUDED.display_name,
            summary = EXCLUDED.summary,
            source_uri = EXCLUDED.source_uri,
            source_table = EXCLUDED.source_table,
            source_row_id = EXCLUDED.source_row_id,
            metadata_version = EXCLUDED.metadata_version,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
    """
    records = [
        (
            row.id,
            row.user_id,
            row.node_type.value,
            row.display_name,
            row.summary,
            row.source_uri,
            row.source_table,
            row.source_row_id,
            row.metadata_version,
            json.dumps(row.metadata or {}),
        )
        for row in rows
    ]
    async with pool.acquire() as conn:
        await conn.executemany(query, records)


async def upsert_graph_edges(rows: Sequence[GraphEdgeInsert]) -> None:
    if not rows:
        return
    pool = await get_pool()
    query = """
        INSERT INTO graph_edges (
            id,
            user_id,
            edge_type,
            from_id,
            to_id,
            weight,
            score,
            confidence,
            rank,
            metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO UPDATE
        SET weight = EXCLUDED.weight,
            score = EXCLUDED.score,
            confidence = EXCLUDED.confidence,
            rank = EXCLUDED.rank,
            metadata = EXCLUDED.metadata
    """
    records = [
        (
            row.id,
            row.user_id,
            row.edge_type.value,
            row.from_id,
            row.to_id,
            row.weight,
            row.score,
            row.confidence,
            row.rank,
            json.dumps(row.metadata or {}),
        )
        for row in rows
    ]
    async with pool.acquire() as conn:
        await conn.executemany(query, records)


async def upsert_graph_embeddings(rows: Sequence[GraphEmbeddingInsert]) -> None:
    if not rows:
        return
    pool = await get_pool()
    query = """
        INSERT INTO graph_node_embeddings (
            node_id,
            embedding,
            embedding_model,
            embedding_version,
            metadata
        )
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (node_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            embedding_model = EXCLUDED.embedding_model,
            embedding_version = EXCLUDED.embedding_version,
            metadata = EXCLUDED.metadata
    """
    records = [
        (
            row.node_id,
            to_pgvector(row.embedding),
            row.embedding_model,
            row.embedding_version,
            json.dumps(row.metadata or {}),
        )
        for row in rows
    ]
    async with pool.acquire() as conn:
        await conn.executemany(query, records)
