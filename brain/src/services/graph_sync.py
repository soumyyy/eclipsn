from __future__ import annotations

import json
import math
from collections import defaultdict
from typing import Iterable, List, Sequence

from ..models.graph import GraphEdgeType, GraphNodeType, make_edge_id, make_node_id
from .database import get_pool
from .graph_store import (
    GraphEdgeInsert,
    GraphEmbeddingInsert,
    GraphNodeInsert,
    upsert_graph_edges,
    upsert_graph_embeddings,
    upsert_graph_nodes,
)
from .similarity_graph import sync_similarity_edges_for_ingestions


def estimate_tokens(text: str) -> int:
    clean = text.strip()
    if not clean:
        return 0
    # Rough heuristic: average English token ~4 characters
    return max(1, math.ceil(len(clean) / 4))


async def fetch_ingestion_rows(ingestion_ids: Sequence[str]) -> list[dict]:
    if not ingestion_ids:
        return []
    pool = await get_pool()
    query = """
        SELECT id,
               user_id,
               source,
               batch_name,
               total_files,
               chunked_files,
               indexed_chunks,
               created_at,
               completed_at
        FROM memory_ingestions
        WHERE id = ANY($1::uuid[])
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_ids)
    return [dict(row) for row in rows]


async def fetch_chunks_for_ingestions(ingestion_ids: Sequence[str]) -> list[dict]:
    if not ingestion_ids:
        return []
    pool = await get_pool()
    query = """
        SELECT id,
               ingestion_id,
               user_id,
               file_path,
               chunk_index,
               content,
               metadata,
               created_at
        FROM memory_chunks
        WHERE ingestion_id = ANY($1::uuid[])
        ORDER BY file_path, chunk_index
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, ingestion_ids)
    return [dict(row) for row in rows]


async def fetch_embeddings(chunk_ids: Sequence[str]) -> dict[str, list[float]]:
    if not chunk_ids:
        return {}
    pool = await get_pool()
    query = """
        SELECT chunk_id,
               embedding
        FROM memory_chunk_embeddings
        WHERE chunk_id = ANY($1::uuid[])
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, chunk_ids)
    vectors: dict[str, list[float]] = {}
    for row in rows:
        vector = row["embedding"] or []
        vectors[str(row["chunk_id"])] = [float(val) for val in vector]
    return vectors


async def update_ingestion_metrics(ingestion_id: str, metrics: dict) -> None:
    pool = await get_pool()
    query = """
        UPDATE memory_ingestions
        SET graph_metrics = $2,
            graph_synced_at = NOW()
        WHERE id = $1
    """
    async with pool.acquire() as conn:
        await conn.execute(query, ingestion_id, json.dumps(metrics))


def build_nodes_and_edges(
    ingestion: dict,
    chunks: list[dict],
    embeddings: dict[str, list[float]],
    preserve_existing_ids: bool = True,
) -> tuple[list[GraphNodeInsert], list[GraphEdgeInsert], list[GraphEmbeddingInsert], dict]:
    ingestion_id = str(ingestion["id"])
    user_id = str(ingestion["user_id"])
    doc_node_id = make_node_id(GraphNodeType.DOCUMENT, ingestion_id)
    document_node = GraphNodeInsert(
        id=doc_node_id,
        user_id=user_id,
        node_type=GraphNodeType.DOCUMENT,
        display_name=ingestion.get("batch_name") or "Bespoke Upload",
        summary=f"Bespoke upload ({ingestion.get('total_files', 0)} files)",
        source_uri=None,
        source_table="memory_ingestions",
        source_row_id=ingestion_id,
        metadata_version="bespoke_v1",
        metadata={
            "ingestion_id": ingestion_id,
            "source": ingestion.get("source"),
            "batch_name": ingestion.get("batch_name"),
            "file_count": ingestion.get("total_files"),
            "chunked_files": ingestion.get("chunked_files"),
            "indexed_chunks": ingestion.get("indexed_chunks"),
            "created_at": ingestion.get("created_at").isoformat() if ingestion.get("created_at") else None,
        },
    )

    section_groups: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        section_groups[chunk["file_path"]].append(chunk)

    nodes: list[GraphNodeInsert] = [document_node]
    edges: list[GraphEdgeInsert] = []
    embeddings_rows: list[GraphEmbeddingInsert] = []

    chunk_token_counts: list[int] = []
    overlap_values: list[float] = []
    sections_with_chunks = 0

    for order, (file_path, section_chunks) in enumerate(section_groups.items()):
        if preserve_existing_ids:
            section_id = file_path if file_path else make_node_id(GraphNodeType.SECTION, ingestion_id, str(order))
        else:
            section_id = make_node_id(GraphNodeType.SECTION, ingestion_id, file_path or str(order))
        nodes.append(
            GraphNodeInsert(
                id=section_id,
                user_id=user_id,
                node_type=GraphNodeType.SECTION,
                display_name=file_path,
                summary=f"{len(section_chunks)} chunks",
                source_uri=file_path,
                source_table="memory_ingestions",
                source_row_id=None,
                metadata_version="bespoke_v1",
                metadata={
                    "ingestion_id": ingestion_id,
                    "file_path": file_path,
                    "chunk_count": len(section_chunks),
                    "order": order,
                },
            )
        )
        edges.append(
            GraphEdgeInsert(
                id=make_edge_id(GraphEdgeType.HAS_SECTION, doc_node_id, section_id),
                user_id=user_id,
                edge_type=GraphEdgeType.HAS_SECTION,
                from_id=doc_node_id,
                to_id=section_id,
                metadata={
                    "ingestion_id": ingestion_id,
                    "file_path": file_path,
                    "order": order,
                },
            )
        )
        if section_chunks:
            sections_with_chunks += 1
        for chunk in section_chunks:
            chunk_id = str(chunk["id"])
            if preserve_existing_ids:
                chunk_node_id = chunk_id
            else:
                chunk_node_id = make_node_id(GraphNodeType.CHUNK, chunk_id)
            text = chunk.get("content", "")
            tokens = estimate_tokens(text)
            chunk_token_counts.append(tokens)
            meta = normalize_metadata(chunk.get("metadata"))
            overlap = float(meta.get("overlap_ratio") or 0.17)
            overlap_values.append(overlap)
            nodes.append(
                GraphNodeInsert(
                    id=chunk_node_id,
                    user_id=user_id,
                    node_type=GraphNodeType.CHUNK,
                    display_name=f"{file_path}#{chunk['chunk_index']}",
                    summary=text[:180] + ("..." if len(text) > 180 else ""),
                    source_uri=file_path,
                    source_table="memory_chunks",
                    source_row_id=chunk_id,
                    metadata_version="bespoke_v1",
                    metadata={
                        "ingestion_id": ingestion_id,
                        "chunk_id": chunk_id,
                        "file_path": file_path,
                        "chunk_index": chunk["chunk_index"],
                        "token_count": tokens,
                        "char_count": len(text),
                        "overlap_ratio": overlap,
                        "created_at": chunk.get("created_at").isoformat()
                        if chunk.get("created_at")
                        else None,
                    },
                )
            )
            edges.append(
                GraphEdgeInsert(
                    id=make_edge_id(GraphEdgeType.HAS_CHUNK, section_id, chunk_node_id),
                    user_id=user_id,
                    edge_type=GraphEdgeType.HAS_CHUNK,
                    from_id=section_id,
                    to_id=chunk_node_id,
                    metadata={
                        "ingestion_id": ingestion_id,
                        "chunk_index": chunk["chunk_index"],
                        "token_count": tokens,
                    },
                )
            )
            vector = embeddings.get(chunk_id)
            if vector:
                embeddings_rows.append(
                    GraphEmbeddingInsert(
                        node_id=chunk_node_id,
                        embedding=vector,
                        embedding_model="text-embedding-3-small",
                        embedding_version="bespoke-memory",
                        metadata={
                            "ingestion_id": ingestion_id,
                            "chunk_id": chunk_id,
                        },
                    )
                )

    chunk_count = len(chunk_token_counts)
    section_count = len(section_groups)
    avg_tokens = float(sum(chunk_token_counts) / chunk_count) if chunk_count else 0.0
    max_tokens = max(chunk_token_counts) if chunk_token_counts else 0
    avg_overlap = float(sum(overlap_values) / len(overlap_values)) if overlap_values else 0.0
    orphan_rate = (
        1.0 - sections_with_chunks / section_count if section_count else 0.0
    )
    metrics = {
        "ingestion_id": ingestion_id,
        "chunk_count": chunk_count,
        "section_count": section_count,
        "avg_chunk_tokens": avg_tokens,
        "max_chunk_tokens": max_tokens,
        "avg_overlap_ratio": avg_overlap,
        "orphan_rate": orphan_rate,
    }
    return nodes, edges, embeddings_rows, metrics


async def sync_ingestions_to_graph(ingestion_ids: Iterable[str]) -> None:
    ids = [str(ing_id) for ing_id in ingestion_ids if ing_id]
    if not ids:
        return
    ingestions = await fetch_ingestion_rows(ids)
    if not ingestions:
        return
    chunks = await fetch_chunks_for_ingestions(ids)
    chunks_by_ingestion: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        chunks_by_ingestion[str(chunk["ingestion_id"])].append(chunk)
    chunk_ids = [str(chunk["id"]) for chunk in chunks]
    embeddings = await fetch_embeddings(chunk_ids)

    all_nodes: list[GraphNodeInsert] = []
    all_edges: list[GraphEdgeInsert] = []
    all_embeddings: list[GraphEmbeddingInsert] = []

    for ingestion in ingestions:
        ingestion_id = str(ingestion["id"])
        doc_chunks = chunks_by_ingestion.get(ingestion_id, [])
        nodes, edges, embedding_rows, metrics = build_nodes_and_edges(
            ingestion, doc_chunks, embeddings
        )
        all_nodes.extend(nodes)
        all_edges.extend(edges)
        all_embeddings.extend(embedding_rows)
        await update_ingestion_metrics(ingestion_id, metrics)

    if all_nodes:
        await upsert_graph_nodes(all_nodes)
    if all_edges:
        await upsert_graph_edges(all_edges)
    if all_embeddings:
        await upsert_graph_embeddings(all_embeddings)
    await sync_similarity_edges_for_ingestions(ids)
def normalize_metadata(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}
