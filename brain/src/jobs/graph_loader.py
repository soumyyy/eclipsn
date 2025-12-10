from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path
from typing import Any, List

import pandas as pd

from ..models.graph import GraphEdgeType, GraphNodeType
from ..services.graph_store import (
    GraphEdgeInsert,
    GraphEmbeddingInsert,
    GraphNodeInsert,
    upsert_graph_edges,
    upsert_graph_embeddings,
    upsert_graph_nodes,
)

logger = logging.getLogger(__name__)


def load_jsonl(path: Path) -> List[dict]:
    records: List[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def summarize_text(text: str, limit: int = 180) -> str:
    normalized = (text or "").strip().replace("\n", " ")
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."


def compute_metrics_from_frame(chunks: pd.DataFrame, sections: List[dict]) -> dict:
    if chunks.empty:
        return {
            "chunk_count": 0,
            "avg_chunk_tokens": 0.0,
            "max_chunk_tokens": 0,
            "avg_overlap_ratio": 0.0,
            "orphan_rate": 0.0,
        }
    chunk_count = int(chunks.shape[0])
    avg_tokens = float(chunks["token_count"].mean())
    max_tokens = int(chunks["token_count"].max())
    avg_overlap = float(chunks["overlap_ratio"].mean())
    section_ids = {section.get("node_id") for section in sections}
    section_chunk_counts = chunks.groupby("section_id").size()
    orphan_sections = len([sid for sid in section_ids if not section_chunk_counts.get(sid, 0)])
    orphan_rate = orphan_sections / len(section_ids) if section_ids else 0.0
    return {
        "chunk_count": chunk_count,
        "avg_chunk_tokens": avg_tokens,
        "max_chunk_tokens": max_tokens,
        "avg_overlap_ratio": avg_overlap,
        "orphan_rate": orphan_rate,
    }


def enforce_metrics(metrics: dict, thresholds: dict) -> None:
    min_chunks = thresholds.get("min_chunks")
    if min_chunks and metrics["chunk_count"] < min_chunks:
        raise ValueError(f"Slice gate failed: chunk count {metrics['chunk_count']} < min {min_chunks}")
    max_chunks = thresholds.get("max_chunks")
    if max_chunks and metrics["chunk_count"] > max_chunks:
        raise ValueError(f"Slice gate failed: chunk count {metrics['chunk_count']} > max {max_chunks}")
    min_overlap = thresholds.get("min_overlap")
    if min_overlap is not None and metrics["avg_overlap_ratio"] < min_overlap - 0.01:
        raise ValueError(
            f"Slice gate failed: avg overlap {metrics['avg_overlap_ratio']:.2f} < min {min_overlap}"
        )
    max_overlap = thresholds.get("max_overlap")
    if max_overlap is not None and metrics["avg_overlap_ratio"] > max_overlap + 0.01:
        raise ValueError(
            f"Slice gate failed: avg overlap {metrics['avg_overlap_ratio']:.2f} > max {max_overlap}"
        )
    max_orphan_rate = thresholds.get("max_orphan_rate")
    if max_orphan_rate is not None and metrics["orphan_rate"] > max_orphan_rate:
        raise ValueError(
            f"Slice gate failed: orphan rate {metrics['orphan_rate']:.2%} > max {max_orphan_rate:.2%}"
        )


def derive_thresholds(args: argparse.Namespace, manifest_thresholds: dict | None) -> dict:
    resolved = manifest_thresholds.copy() if manifest_thresholds else {}
    if args.min_chunks is not None:
        resolved["min_chunks"] = args.min_chunks
    if args.max_chunks is not None:
        resolved["max_chunks"] = args.max_chunks
    if args.min_overlap is not None:
        resolved["min_overlap"] = args.min_overlap
    if args.max_overlap is not None:
        resolved["max_overlap"] = args.max_overlap
    if args.max_orphan_rate is not None:
        resolved["max_orphan_rate"] = args.max_orphan_rate
    return resolved


def build_node_metadata(
    base: dict,
    manifest: dict,
    extra: dict | None = None,
    include_raw: bool = True,
) -> dict:
    metadata = {
        "slice_id": manifest["slice_id"],
        "source_uri": base.get("source_uri"),
        "quality_metrics": manifest.get("quality_metrics"),
        "entity_plan": manifest.get("entity_plan"),
        "similarity_plan": manifest.get("similarity_plan"),
    }
    if include_raw:
        metadata["raw"] = base
    if extra:
        metadata.update(extra)
    return metadata


def build_graph_nodes(
    manifest: dict,
    documents: List[dict],
    sections: List[dict],
    chunks: List[dict],
) -> List[GraphNodeInsert]:
    nodes: List[GraphNodeInsert] = []
    user_id = manifest["user_id"]
    metadata_version = manifest.get("metadata_version")
    for doc in documents:
        nodes.append(
            GraphNodeInsert(
                id=doc["node_id"],
                user_id=user_id,
                node_type=GraphNodeType(doc["node_type"]),
                display_name=doc.get("title"),
                summary=doc.get("summary"),
                source_uri=doc.get("source_uri"),
                metadata_version=metadata_version,
                metadata=build_node_metadata(doc, manifest),
            )
        )
    for section in sections:
        nodes.append(
            GraphNodeInsert(
                id=section["node_id"],
                user_id=user_id,
                node_type=GraphNodeType(section["node_type"]),
                display_name=section.get("heading") or section.get("section_path"),
                summary=None,
                source_uri=None,
                metadata_version=metadata_version,
                metadata=build_node_metadata(
                    section,
                    manifest,
                    extra={
                        "section_path": section.get("section_path"),
                        "section_order": section.get("section_order"),
                    },
                ),
            )
        )
    for chunk in chunks:
        nodes.append(
            GraphNodeInsert(
                id=chunk["node_id"],
                user_id=user_id,
                node_type=GraphNodeType(chunk.get("node_type", "CHUNK")),
                display_name=f"{chunk.get('section_path')}#{chunk.get('chunk_index')}",
                summary=summarize_text(chunk.get("text", "")),
                source_uri=chunk.get("source_uri"),
                metadata_version=metadata_version,
                metadata=build_node_metadata(
                    chunk,
                    manifest,
                    extra={
                        "section_path": chunk.get("section_path"),
                        "chunk_index": chunk.get("chunk_index"),
                        "token_count": chunk.get("token_count"),
                        "acl_tags": chunk.get("acl_tags"),
                        "quality_score": chunk.get("quality_score"),
                        "orphan_risk": chunk.get("orphan_risk"),
                        "ner_status": chunk.get("ner_status"),
                        "similarity_status": chunk.get("similarity_status"),
                        "preview": summarize_text(chunk.get("text", "")),
                    },
                    include_raw=False,
                ),
            )
        )
    return nodes


def build_graph_edges(manifest: dict, edges: List[dict]) -> List[GraphEdgeInsert]:
    user_id = manifest["user_id"]
    payload: List[GraphEdgeInsert] = []
    for edge in edges:
        attributes = edge.get("attributes") or {}
        payload.append(
            GraphEdgeInsert(
                id=edge["edge_id"],
                user_id=user_id,
                edge_type=GraphEdgeType(edge["edge_type"]),
                from_id=edge["from_id"],
                to_id=edge["to_id"],
                weight=attributes.get("weight"),
                score=attributes.get("score"),
                confidence=attributes.get("confidence"),
                rank=attributes.get("rank"),
                metadata={
                    "slice_id": manifest["slice_id"],
                    "attributes": attributes,
                },
            )
        )
    return payload


def build_embeddings(manifest: dict, chunks: List[dict]) -> List[GraphEmbeddingInsert]:
    if manifest.get("skip_embeddings"):
        return []
    rows: List[GraphEmbeddingInsert] = []
    for chunk in chunks:
        vector = chunk.get("embedding")
        if not vector:
            continue
        rows.append(
            GraphEmbeddingInsert(
                node_id=chunk["node_id"],
                embedding=vector,
                embedding_model=chunk.get("embedding_model") or manifest["embedding_model"],
                embedding_version=chunk.get("embedding_version") or manifest["embedding_version"],
                metadata={
                    "slice_id": manifest["slice_id"],
                    "section_path": chunk.get("section_path"),
                    "source_uri": chunk.get("source_uri"),
                },
            )
        )
    return rows


async def load_slice(args: argparse.Namespace) -> None:
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    outputs = manifest.get("outputs", {})
    documents = load_jsonl(Path(outputs["documents_json"]))
    sections = load_jsonl(Path(outputs["sections_json"]))
    chunk_df = pd.read_parquet(Path(outputs["chunks_parquet"]))
    chunk_records = chunk_df.to_dict(orient="records")
    edges = load_jsonl(Path(outputs["edges_json"]))

    metrics = compute_metrics_from_frame(chunk_df, sections)
    thresholds = derive_thresholds(args, manifest.get("quality_thresholds"))
    enforce_metrics(metrics, thresholds)
    target_chunk = manifest.get("chunk_size_tokens")
    if target_chunk and metrics["max_chunk_tokens"] > target_chunk * 1.5:
        raise ValueError(
            f"Slice gate failed: max chunk tokens {metrics['max_chunk_tokens']} exceeds target {target_chunk}"
        )

    nodes = build_graph_nodes(manifest, documents, sections, chunk_records)
    edge_rows = build_graph_edges(manifest, edges)
    embedding_rows = build_embeddings(manifest, chunk_records)

    logger.info(
        "Upserting slice=%s nodes=%d edges=%d embeddings=%d",
        manifest["slice_id"],
        len(nodes),
        len(edge_rows),
        len(embedding_rows),
    )

    await upsert_graph_nodes(nodes)
    await upsert_graph_edges(edge_rows)
    if embedding_rows:
        await upsert_graph_embeddings(embedding_rows)
    logger.info("Slice %s load complete", manifest["slice_id"])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Load a graph slice manifest into Postgres")
    parser.add_argument("--manifest", type=Path, required=True, help="Path to manifest.json produced by graph_etl")
    parser.add_argument("--min-chunks", type=int, default=None, help="Override min chunk gate")
    parser.add_argument("--max-chunks", type=int, default=None, help="Override max chunk gate")
    parser.add_argument("--min-overlap", type=float, default=None, help="Override min overlap gate")
    parser.add_argument("--max-overlap", type=float, default=None, help="Override max overlap gate")
    parser.add_argument("--max-orphan-rate", type=float, default=None, help="Override max orphan rate gate")
    return parser


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = build_parser()
    args = parser.parse_args()
    asyncio.run(load_slice(args))


if __name__ == "__main__":  # pragma: no cover
    main()
