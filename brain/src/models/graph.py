from __future__ import annotations

import base64
from dataclasses import dataclass
from enum import Enum
from typing import Dict, Iterable, Tuple


class GraphNodeType(str, Enum):
    DOCUMENT = "DOCUMENT"
    SECTION = "SECTION"
    CHUNK = "CHUNK"
    ENTITY = "ENTITY"
    TOPIC = "TOPIC"
    QUERY = "QUERY"


class GraphEdgeType(str, Enum):
    HAS_SECTION = "HAS_SECTION"
    HAS_CHUNK = "HAS_CHUNK"
    MENTIONS = "MENTIONS"
    SIMILAR_TO = "SIMILAR_TO"
    BELONGS_TO = "BELONGS_TO"
    RETRIEVED = "RETRIEVED"


@dataclass(frozen=True)
class NodeSchema:
    type: GraphNodeType
    prefix: str
    description: str
    required_attrs: Tuple[str, ...] = ()
    optional_attrs: Tuple[str, ...] = ()


@dataclass(frozen=True)
class EdgeSchema:
    type: GraphEdgeType
    description: str
    source_types: Tuple[GraphNodeType, ...]
    target_types: Tuple[GraphNodeType, ...]
    attributes: Tuple[str, ...] = ()


NODE_SCHEMAS: Dict[GraphNodeType, NodeSchema] = {
    GraphNodeType.DOCUMENT: NodeSchema(
        type=GraphNodeType.DOCUMENT,
        prefix="DOC",
        description="Represents the root artifact (file, mail thread, etc.)",
        required_attrs=("title", "source_uri"),
        optional_attrs=("external_id", "etag", "metadata_version"),
    ),
    GraphNodeType.SECTION: NodeSchema(
        type=GraphNodeType.SECTION,
        prefix="SEC",
        description="Semantic or structural section scoped within a document",
        required_attrs=("document_id", "section_path"),
        optional_attrs=("heading", "order", "token_count"),
    ),
    GraphNodeType.CHUNK: NodeSchema(
        type=GraphNodeType.CHUNK,
        prefix="CHK",
        description="Embeddable chunk derived from a section",
        required_attrs=("section_id", "chunk_index", "text"),
        optional_attrs=(
            "token_count",
            "overlap_ratio",
            "quality",
            "embedding_model",
            "embedding_version",
            "acl_tags",
            "orphan_risk",
        ),
    ),
    GraphNodeType.ENTITY: NodeSchema(
        type=GraphNodeType.ENTITY,
        prefix="ENT",
        description="Canonical named entity resolved from chunks",
        required_attrs=("canonical_name",),
        optional_attrs=("entity_type", "aliases", "source", "metadata_version"),
    ),
    GraphNodeType.TOPIC: NodeSchema(
        type=GraphNodeType.TOPIC,
        prefix="TOP",
        description="Embedding-derived topic or cluster centroid",
        required_attrs=("label", "cluster_id"),
        optional_attrs=("algorithm", "score", "keywords"),
    ),
    GraphNodeType.QUERY: NodeSchema(
        type=GraphNodeType.QUERY,
        prefix="QRY",
        description="Captured retrieval request issued by the user/agent",
        required_attrs=("query_text", "issued_at"),
        optional_attrs=("latency_ms", "profile_id", "embedding_version"),
    ),
}


EDGE_SCHEMAS: Dict[GraphEdgeType, EdgeSchema] = {
    GraphEdgeType.HAS_SECTION: EdgeSchema(
        type=GraphEdgeType.HAS_SECTION,
        description="Document to Section containment",
        source_types=(GraphNodeType.DOCUMENT,),
        target_types=(GraphNodeType.SECTION,),
        attributes=("order",),
    ),
    GraphEdgeType.HAS_CHUNK: EdgeSchema(
        type=GraphEdgeType.HAS_CHUNK,
        description="Section to Chunk containment",
        source_types=(GraphNodeType.SECTION,),
        target_types=(GraphNodeType.CHUNK,),
        attributes=("chunk_index", "token_count"),
    ),
    GraphEdgeType.MENTIONS: EdgeSchema(
        type=GraphEdgeType.MENTIONS,
        description="Chunk mention of an Entity",
        source_types=(GraphNodeType.CHUNK,),
        target_types=(GraphNodeType.ENTITY,),
        attributes=("confidence", "evidence_span"),
    ),
    GraphEdgeType.SIMILAR_TO: EdgeSchema(
        type=GraphEdgeType.SIMILAR_TO,
        description="Chunk-to-chunk semantic similarity",
        source_types=(GraphNodeType.CHUNK,),
        target_types=(GraphNodeType.CHUNK,),
        attributes=("weight", "source", "embedding_version"),
    ),
    GraphEdgeType.BELONGS_TO: EdgeSchema(
        type=GraphEdgeType.BELONGS_TO,
        description="Chunk assignment to a Topic cluster",
        source_types=(GraphNodeType.CHUNK,),
        target_types=(GraphNodeType.TOPIC,),
        attributes=("score",),
    ),
    GraphEdgeType.RETRIEVED: EdgeSchema(
        type=GraphEdgeType.RETRIEVED,
        description="Query to chunk provenance edge",
        source_types=(GraphNodeType.QUERY,),
        target_types=(GraphNodeType.CHUNK,),
        attributes=("rank", "score", "retrieved_at"),
    ),
}


def ensure_node_type(node_type: GraphNodeType) -> NodeSchema:
    try:
        return NODE_SCHEMAS[node_type]
    except KeyError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Unsupported node type: {node_type}") from exc


def ensure_edge_type(edge_type: GraphEdgeType) -> EdgeSchema:
    try:
        return EDGE_SCHEMAS[edge_type]
    except KeyError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Unsupported edge type: {edge_type}") from exc


def make_node_id(node_type: GraphNodeType, *parts: str) -> str:
    if node_type == GraphNodeType.DOCUMENT:
        return f"{node_type.value}::{parts[0] if parts else ''}"
    if node_type == GraphNodeType.SECTION:
        ingestion_id = parts[0] if parts else ""
        section_path = parts[1] if len(parts) > 1 else ""
        encoded_path = _encode_graph_part(section_path)
        return f"{node_type.value}::{ingestion_id}::{encoded_path}"
    if node_type == GraphNodeType.CHUNK:
        return f"{node_type.value}::{parts[0] if parts else ''}"
    extra = [_encode_graph_part(part) for part in parts if part]
    return "::".join([node_type.value, *extra])


def make_edge_id(edge_type: GraphEdgeType, from_id: str, to_id: str) -> str:
    ensure_edge_type(edge_type)
    encoded_from = _encode_graph_part(from_id)
    encoded_to = _encode_graph_part(to_id)
    return f"{edge_type.value}::{encoded_from}::{encoded_to}"


def _encode_graph_part(value: str) -> str:
    encoded = base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")
