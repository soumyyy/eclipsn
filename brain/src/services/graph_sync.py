from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from ..models.graph import GraphNodeType, make_node_id
from .database import get_pool
from .similarity_graph import sync_similarity_neighbors_for_ingestions


def estimate_tokens(text: str) -> int:
    clean = text.strip()
    if not clean:
        return 0
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


@dataclass
class ChunkGraphUpdate:
    chunk_id: str
    display_name: str
    summary: str
    graph_metadata: dict


def build_chunk_updates(ingestion: dict, chunks: list[dict]) -> tuple[list[ChunkGraphUpdate], dict]:
    ingestion_id = str(ingestion["id"])
    user_id = str(ingestion["user_id"])
    doc_node_id = make_node_id(GraphNodeType.DOCUMENT, ingestion_id)

    section_groups: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        section_groups[chunk["file_path"]].append(chunk)

    chunk_token_counts: list[int] = []
    overlap_values: list[float] = []
    sections_with_chunks = 0
    updates: list[ChunkGraphUpdate] = []

    for order, (file_path, section_chunks) in enumerate(section_groups.items()):
        section_id = make_node_id(GraphNodeType.SECTION, ingestion_id, file_path or str(order))
        if section_chunks:
            sections_with_chunks += 1
        for chunk in section_chunks:
            chunk_id = str(chunk["id"])
            chunk_node_id = make_node_id(GraphNodeType.CHUNK, chunk_id)
            text = chunk.get("content", "")
            tokens = estimate_tokens(text)
            chunk_token_counts.append(tokens)
            meta = normalize_metadata(chunk.get("metadata"))
            overlap = float(meta.get("overlap_ratio") or 0.17)
            overlap_values.append(overlap)
            summary = text[:177].rstrip() + "..." if len(text) > 180 else text
            metadata = {
                "ingestionId": ingestion_id,
                "userId": user_id,
                "documentNodeId": doc_node_id,
                "sectionNodeId": section_id,
                "chunkNodeId": chunk_node_id,
                "filePath": file_path,
                "chunkIndex": chunk["chunk_index"],
                "sectionOrder": order,
                "sectionChunkCount": len(section_chunks),
                "tokenCount": tokens,
                "charCount": len(text),
                "overlapRatio": overlap,
                "source": ingestion.get("source"),
                "batchName": ingestion.get("batch_name"),
                "createdAt": chunk.get("created_at").isoformat()
                if chunk.get("created_at")
                else None,
                "metadataVersion": "bespoke_v1",
            }
            updates.append(
                ChunkGraphUpdate(
                    chunk_id=chunk_id,
                    display_name=f"{file_path}#{chunk['chunk_index']}",
                    summary=summary,
                    graph_metadata=metadata,
                )
            )

    chunk_count = len(chunk_token_counts)
    section_count = len(section_groups)
    avg_tokens = float(sum(chunk_token_counts) / chunk_count) if chunk_count else 0.0
    max_tokens = max(chunk_token_counts) if chunk_token_counts else 0
    avg_overlap = float(sum(overlap_values) / len(overlap_values)) if overlap_values else 0.0
    orphan_rate = 1.0 - sections_with_chunks / section_count if section_count else 0.0
    metrics = {
        "ingestion_id": ingestion_id,
        "documentNodeId": doc_node_id,
        "chunk_count": chunk_count,
        "section_count": section_count,
        "avg_chunk_tokens": avg_tokens,
        "max_chunk_tokens": max_tokens,
        "avg_overlap_ratio": avg_overlap,
        "orphan_rate": orphan_rate,
    }
    return updates, metrics


async def apply_chunk_metadata(updates: Sequence[ChunkGraphUpdate]) -> None:
    if not updates:
        return
    pool = await get_pool()
    query = """
        UPDATE memory_chunks
        SET display_name = $2,
            summary = $3,
            graph_metadata = jsonb_strip_nulls(
                $4::jsonb || jsonb_build_object('similarNeighbors', graph_metadata->'similarNeighbors')
            )
        WHERE id = $1
    """
    payload = [
        (
            update.chunk_id,
            update.display_name,
            update.summary,
            json.dumps(update.graph_metadata),
        )
        for update in updates
    ]
    async with pool.acquire() as conn:
        await conn.executemany(query, payload)


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

    for ingestion in ingestions:
        ingestion_id = str(ingestion["id"])
        doc_chunks = chunks_by_ingestion.get(ingestion_id, [])
        updates, metrics = build_chunk_updates(ingestion, doc_chunks)
        if updates:
            await apply_chunk_metadata(updates)
        await update_ingestion_metrics(ingestion_id, metrics)

    await sync_similarity_neighbors_for_ingestions(ids)


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
