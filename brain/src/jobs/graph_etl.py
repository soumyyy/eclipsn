from __future__ import annotations

import argparse
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from statistics import mean
from pathlib import Path
from typing import Iterable, List, Sequence

import pandas as pd
from langchain_openai import OpenAIEmbeddings

from ..config import get_settings
from ..models.graph import GraphEdgeType, GraphNodeType, make_edge_id, make_node_id

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".md", ".markdown", ".txt", ".html", ".htm"}
SENTENCE_SPLIT_REGEX = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")

try:  # pragma: no cover - optional dependency is already part of lock but keep fallback
    import tiktoken
except Exception:  # pragma: no cover
    tiktoken = None


@dataclass
class DocumentRecord:
    node_id: str
    title: str
    source_uri: str
    metadata_version: str
    section_count: int = 0
    chunk_count: int = 0

    @property
    def node_payload(self) -> dict:
        return {
            "node_id": self.node_id,
            "node_type": GraphNodeType.DOCUMENT.value,
            "title": self.title,
            "source_uri": self.source_uri,
            "metadata_version": self.metadata_version,
            "section_count": self.section_count,
            "chunk_count": self.chunk_count,
        }


@dataclass
class SectionRecord:
    node_id: str
    document_id: str
    section_path: str
    heading: str
    section_order: int
    token_count: int
    chunk_count: int = 0

    @property
    def node_payload(self) -> dict:
        return {
            "node_id": self.node_id,
            "node_type": GraphNodeType.SECTION.value,
            "document_id": self.document_id,
            "section_path": self.section_path,
            "heading": self.heading,
            "section_order": self.section_order,
            "token_count": self.token_count,
            "chunk_count": self.chunk_count,
        }


@dataclass
class ChunkRecord:
    node_id: str
    section_id: str
    document_id: str
    chunk_index: int
    text: str
    token_count: int
    overlap_ratio: float
    source_uri: str
    section_path: str
    quality_score: float
    orphan_risk: float
    acl_tags: List[str]
    embedding_model: str
    embedding_version: str
    ner_status: str = "pending"
    ner_threshold: float = 0.4
    similarity_status: str = "pending"
    similarity_top_k: int = 10
    similarity_min_cosine: float = 0.5
    similarity_degree_cap: int = 20
    embedding: List[float] | None = None

    def to_row(self) -> dict:
        return {
            "node_id": self.node_id,
            "node_type": GraphNodeType.CHUNK.value,
            "section_id": self.section_id,
            "document_id": self.document_id,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "token_count": self.token_count,
            "overlap_ratio": self.overlap_ratio,
            "quality_score": round(self.quality_score, 4),
            "orphan_risk": round(self.orphan_risk, 4),
            "acl_tags": self.acl_tags,
            "source_uri": self.source_uri,
            "section_path": self.section_path,
            "embedding_model": self.embedding_model,
            "embedding_version": self.embedding_version,
            "embedding": self.embedding,
            "embedding_dim": len(self.embedding) if self.embedding else 0,
            "ner_status": self.ner_status,
            "ner_threshold": self.ner_threshold,
            "similarity_status": self.similarity_status,
            "similarity_top_k": self.similarity_top_k,
            "similarity_min_cosine": self.similarity_min_cosine,
            "similarity_degree_cap": self.similarity_degree_cap,
        }


@dataclass
class EdgeRecord:
    edge_id: str
    edge_type: GraphEdgeType
    from_id: str
    to_id: str
    attributes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        payload = {
            "edge_id": self.edge_id,
            "edge_type": self.edge_type.value,
            "from_id": self.from_id,
            "to_id": self.to_id,
        }
        if self.attributes:
            payload["attributes"] = self.attributes
        return payload


class Tokenizer:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self.encoder = None
        if tiktoken is not None:
            try:
                self.encoder = tiktoken.encoding_for_model(model_name)
            except KeyError:
                self.encoder = tiktoken.get_encoding("cl100k_base")

    def count(self, text: str) -> int:
        if not text:
            return 0
        if self.encoder:
            return len(self.encoder.encode(text))
        return max(1, len(re.findall(r"\w+|\S", text)))


def split_sentences(text: str) -> List[str]:
    normalized = text.strip()
    if not normalized:
        return []
    candidates = SENTENCE_SPLIT_REGEX.split(normalized)
    if len(candidates) == 1:
        return [normalized]
    return [segment.strip() for segment in candidates if segment.strip()]


def load_documents(path: Path) -> List[tuple[Path, str]]:
    if path.is_file():
        return [(path, path.read_text(encoding="utf-8", errors="ignore"))]
    files: List[tuple[Path, str]] = []
    for file_path in sorted(path.rglob("*")):
        if not file_path.is_file() or file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue
        files.append((file_path, file_path.read_text(encoding="utf-8", errors="ignore")))
    return files


def build_sections(document_text: str, tokenizer: Tokenizer) -> List[dict]:
    sections: List[dict] = []
    stack: List[tuple[int, str]] = []
    current: dict | None = None
    section_order = 0

    def flush() -> None:
        nonlocal current, section_order
        if current is None:
            return
        current["text"] = "\n".join(current["lines"]).strip()
        current["token_count"] = tokenizer.count(current["text"])
        if current["text"]:
            sections.append(current)
            section_order += 1
        current = None

    def ensure_current(level: int, heading: str) -> None:
        nonlocal current
        flush()
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, heading))
        path = "/".join(item[1] for item in stack) or heading
        current = {
            "heading": heading,
            "path": path,
            "level": level,
            "order": section_order,
            "lines": [],
            "token_count": 0,
        }

    lines = document_text.splitlines()
    for line in lines:
        match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if match:
            ensure_current(len(match.group(1)), match.group(2).strip())
            continue
        if current is None:
            ensure_current(1, "ROOT")
        current["lines"].append(line)
    flush()
    return sections


def chunk_section_text(
    section_text: str,
    tokenizer: Tokenizer,
    chunk_tokens: int,
    overlap_ratio: float,
) -> List[tuple[str, int]]:
    sentences = split_sentences(section_text)
    if not sentences:
        return []
    tokenized = [tokenizer.count(sentence) for sentence in sentences]
    windows: List[tuple[str, int]] = []
    cursor = 0
    overlap_tokens = max(1, int(chunk_tokens * overlap_ratio))
    while cursor < len(sentences):
        tokens_used = 0
        end = cursor
        while end < len(sentences) and tokens_used + tokenized[end] <= chunk_tokens:
            tokens_used += tokenized[end]
            end += 1
        if end == cursor:
            tokens_used = tokenized[end]
            end += 1
        chunk_text = " ".join(sentences[cursor:end]).strip()
        windows.append((chunk_text, tokens_used))
        if end >= len(sentences):
            break
        target_tokens = overlap_tokens
        new_cursor = end
        while new_cursor > cursor and target_tokens > 0:
            new_cursor -= 1
            target_tokens -= tokenized[new_cursor]
        cursor = max(new_cursor, 0)
        if cursor == end:
            break
    return windows


def compute_quality_score(chunk_tokens: int, target_tokens: int) -> float:
    if target_tokens <= 0:
        return 0.5
    ratio = chunk_tokens / target_tokens
    return max(0.4, min(1.0, 0.45 + 0.55 * min(1.2, ratio)))


def compute_orphan_risk(chunk_index: int, total_chunks: int) -> float:
    if total_chunks <= 1:
        return 0.9
    midpoint = (total_chunks - 1) / 2
    distance = abs(chunk_index - midpoint)
    normalized = distance / max(1.0, midpoint)
    return 0.2 + 0.6 * normalized


def compute_slice_metrics(chunks: Sequence[ChunkRecord], sections: Sequence[SectionRecord]) -> dict:
    chunk_tokens = [chunk.token_count for chunk in chunks]
    overlap_values = [chunk.overlap_ratio for chunk in chunks]
    quality_scores = [chunk.quality_score for chunk in chunks]
    section_ids = {section.node_id for section in sections}
    section_chunk_counts: dict[str, int] = {}
    for chunk in chunks:
        section_chunk_counts[chunk.section_id] = section_chunk_counts.get(chunk.section_id, 0) + 1
    orphan_sections = len([section_id for section_id in section_ids if section_chunk_counts.get(section_id, 0) == 0])
    orphan_rate = orphan_sections / len(section_ids) if section_ids else 0.0
    metrics = {
        "chunk_count": len(chunks),
        "section_count": len(sections),
        "avg_chunk_tokens": mean(chunk_tokens) if chunk_tokens else 0.0,
        "max_chunk_tokens": max(chunk_tokens) if chunk_tokens else 0,
        "avg_overlap_ratio": mean(overlap_values) if overlap_values else 0.0,
        "avg_quality_score": mean(quality_scores) if quality_scores else 0.0,
        "orphan_rate": orphan_rate,
    }
    return metrics


def enforce_quality(metrics: dict, args: argparse.Namespace) -> None:
    chunk_count = metrics["chunk_count"]
    if chunk_count < args.min_chunks:
        raise ValueError(f"Slice has only {chunk_count} chunks (< min {args.min_chunks})")
    if args.max_chunks_threshold and chunk_count > args.max_chunks_threshold:
        raise ValueError(f"Slice has {chunk_count} chunks (> max {args.max_chunks_threshold})")
    if metrics["avg_overlap_ratio"] < args.min_overlap - 0.01:
        raise ValueError(
            f"Overlap ratio too low ({metrics['avg_overlap_ratio']:.2f}); expected >= {args.min_overlap}"
        )
    if metrics["avg_overlap_ratio"] > args.max_overlap + 0.01:
        raise ValueError(
            f"Overlap ratio too high ({metrics['avg_overlap_ratio']:.2f}); expected <= {args.max_overlap}"
        )
    if metrics["orphan_rate"] > args.max_orphan_rate:
        raise ValueError(
            f"Orphan section rate {metrics['orphan_rate']:.2%} exceeds threshold {args.max_orphan_rate:.2%}"
        )


def embed_chunks(
    chunks: Sequence[ChunkRecord],
    embedder: OpenAIEmbeddings | None,
) -> None:
    if not chunks:
        return
    if embedder is None:
        logger.warning("Embedding client unavailable; skipping vector generation.")
        return
    texts = [chunk.text for chunk in chunks]
    batch_size = 128
    vectors: List[List[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        logger.info("Embedding batch %s-%s", start, start + len(batch))
        vectors.extend(embedder.embed_documents(batch))
    for chunk, vector in zip(chunks, vectors):
        chunk.embedding = [float(item) for item in vector]


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False))
            handle.write("\n")


def run_etl(args: argparse.Namespace) -> None:
    output_dir = args.output_dir / args.slice_id
    output_dir.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    embedding_version = args.embedding_version or f"{args.embedding_model}@{datetime.utcnow().date().isoformat()}"
    tokenizer = Tokenizer(args.embedding_model)
    embedder: OpenAIEmbeddings | None = None
    if not args.skip_embeddings:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is required unless --skip-embeddings is set")
        embedder = OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model=args.embedding_model,
            show_progress_bar=False,
        )

    documents: List[DocumentRecord] = []
    sections: List[SectionRecord] = []
    chunks: List[ChunkRecord] = []
    edges: List[EdgeRecord] = []

    files = load_documents(args.input_path)
    if args.max_documents:
        files = files[: args.max_documents]

    for file_path, content in files:
        title = None
        first_heading = re.search(r"^#\s+(.*)$", content, re.MULTILINE)
        if first_heading:
            title = first_heading.group(1).strip()
        if not title:
            title = file_path.stem
        document_id = make_node_id(GraphNodeType.DOCUMENT, args.slice_id, file_path.stem)
        doc_record = DocumentRecord(
            node_id=document_id,
            title=title,
            source_uri=str(file_path.resolve()),
            metadata_version=args.metadata_version,
        )
        documents.append(doc_record)

        section_payloads = build_sections(content, tokenizer)
        doc_section_count = 0
        for section in section_payloads:
            doc_section_count += 1
            section_id = make_node_id(
                GraphNodeType.SECTION,
                document_id,
                section["path"],
                str(section["order"]),
            )
            section_record = SectionRecord(
                node_id=section_id,
                document_id=document_id,
                section_path=section["path"],
                heading=section["heading"],
                section_order=section["order"],
                token_count=section["token_count"],
            )
            sections.append(section_record)
            edges.append(
                EdgeRecord(
                    edge_id=make_edge_id(GraphEdgeType.HAS_SECTION, document_id, section_id),
                    edge_type=GraphEdgeType.HAS_SECTION,
                    from_id=document_id,
                    to_id=section_id,
                    attributes={"order": section["order"]},
                )
            )

            section_chunks = chunk_section_text(
                section_text=section.get("text", ""),
                tokenizer=tokenizer,
                chunk_tokens=args.chunk_size,
                overlap_ratio=args.chunk_overlap,
            )
            if not section_chunks:
                continue

            chunk_records: List[ChunkRecord] = []
            for idx, (chunk_text, token_count) in enumerate(section_chunks):
                chunk_id = make_node_id(
                    GraphNodeType.CHUNK,
                    section_id,
                    str(idx),
                    str(token_count),
                )
                chunk_record = ChunkRecord(
                    node_id=chunk_id,
                    section_id=section_id,
                    document_id=document_id,
                    chunk_index=idx,
                    text=chunk_text,
                    token_count=token_count,
                    overlap_ratio=args.chunk_overlap,
                    source_uri=doc_record.source_uri,
                    section_path=section["path"],
                    quality_score=compute_quality_score(token_count, args.chunk_size),
                    orphan_risk=0.0,  # placeholder until totals known
                    acl_tags=list(args.acl_tags),
                    embedding_model=args.embedding_model,
                    embedding_version=embedding_version,
                    ner_threshold=args.ner_threshold,
                    similarity_top_k=args.similarity_top_k,
                    similarity_min_cosine=args.similarity_min_cosine,
                    similarity_degree_cap=args.similarity_degree_cap,
                )
                chunk_records.append(chunk_record)
                edges.append(
                    EdgeRecord(
                        edge_id=make_edge_id(GraphEdgeType.HAS_CHUNK, section_id, chunk_id),
                        edge_type=GraphEdgeType.HAS_CHUNK,
                        from_id=section_id,
                        to_id=chunk_id,
                        attributes={
                            "chunk_index": idx,
                            "token_count": token_count,
                        },
                    )
                )
            for chunk_record in chunk_records:
                chunk_record.orphan_risk = compute_orphan_risk(
                    chunk_record.chunk_index, len(chunk_records)
                )
                chunks.append(chunk_record)
            section_record.chunk_count = len(chunk_records)
            doc_record.chunk_count += len(chunk_records)
        doc_record.section_count = doc_section_count

    if args.chunk_cap:
        chunks = chunks[: args.chunk_cap]

    metrics = compute_slice_metrics(chunks, sections)
    enforce_quality(metrics, args)

    embed_chunks(chunks, embedder)

    chunk_rows = [chunk.to_row() for chunk in chunks]
    chunk_df = pd.DataFrame(chunk_rows)
    chunks_parquet = output_dir / "chunks.parquet"
    chunk_df.to_parquet(chunks_parquet, index=False)

    documents_json = output_dir / "documents.jsonl"
    sections_json = output_dir / "sections.jsonl"
    chunks_json = output_dir / "chunks.jsonl"
    edges_json = output_dir / "edges.jsonl"

    write_jsonl(documents_json, (doc.node_payload for doc in documents))
    write_jsonl(sections_json, (section.node_payload for section in sections))
    write_jsonl(chunks_json, chunk_rows)
    write_jsonl(edges_json, (edge.to_dict() for edge in edges))

    manifest = {
        "slice_id": args.slice_id,
        "user_id": args.user_id,
        "source_root": str(args.input_path),
        "chunk_size_tokens": args.chunk_size,
        "chunk_overlap_ratio": args.chunk_overlap,
        "embedding_model": args.embedding_model,
        "embedding_version": embedding_version,
        "metadata_version": args.metadata_version,
        "document_count": len(documents),
        "section_count": len(sections),
        "chunk_count": len(chunks),
        "generated_at": datetime.utcnow().isoformat(),
        "output_dir": str(output_dir),
        "skip_embeddings": bool(args.skip_embeddings),
        "quality_metrics": metrics,
        "quality_thresholds": {
            "min_chunks": args.min_chunks,
            "max_chunks": args.max_chunks_threshold,
            "min_overlap": args.min_overlap,
            "max_overlap": args.max_overlap,
            "max_orphan_rate": args.max_orphan_rate,
        },
        "entity_plan": {
            "status": "pending",
            "ner_threshold": args.ner_threshold,
        },
        "similarity_plan": {
            "status": "pending",
            "top_k": args.similarity_top_k,
            "min_cosine": args.similarity_min_cosine,
            "degree_cap": args.similarity_degree_cap,
        },
        "outputs": {
            "documents_json": str(documents_json),
            "sections_json": str(sections_json),
            "chunks_json": str(chunks_json),
            "edges_json": str(edges_json),
            "chunks_parquet": str(chunks_parquet),
        },
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    logger.info(
        "Slice %s complete: %d documents, %d sections, %d chunks",
        args.slice_id,
        len(documents),
        len(sections),
        len(chunks),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Graph ETL pipeline for Pluto corpus slices")
    parser.add_argument("--input-path", type=Path, required=True, help="Path to file or directory to ingest")
    parser.add_argument("--slice-id", required=True, help="Identifier for this ETL slice")
    parser.add_argument("--user-id", required=True, help="User ID owning the slice")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("brain") / "out" / "graph_slices",
        help="Directory to stage outputs",
    )
    parser.add_argument("--chunk-size", type=int, default=768, help="Target chunk size in tokens (512-1024 recommended)")
    parser.add_argument(
        "--chunk-overlap",
        type=float,
        default=0.18,
        help="Overlap ratio between adjacent chunks (0.15-0.2 recommended)",
    )
    parser.add_argument("--embedding-model", default="text-embedding-3-small", help="Embedding model to use")
    parser.add_argument(
        "--embedding-version",
        default=None,
        help="Embedding metadata version (defaults to <model>@<date>)",
    )
    parser.add_argument(
        "--metadata-version",
        default="v1",
        help="Node metadata version to stamp on documents/sections",
    )
    parser.add_argument(
        "--acl-tags",
        nargs="*",
        default=["private"],
        help="ACL tags applied to every chunk (space separated)",
    )
    parser.add_argument("--max-documents", type=int, default=None, help="Optional cap for testing")
    parser.add_argument("--chunk-cap", type=int, default=None, help="Optional chunk cap for testing/dev")
    parser.add_argument("--skip-embeddings", action="store_true", help="Skip vector generation (for offline runs)")
    parser.add_argument("--min-chunks", type=int, default=500, help="Quality gate: minimum chunk count")
    parser.add_argument("--max-chunks-threshold", type=int, default=25000, help="Quality gate: maximum chunk count")
    parser.add_argument("--min-overlap", type=float, default=0.12, help="Quality gate: minimum average overlap ratio")
    parser.add_argument("--max-overlap", type=float, default=0.25, help="Quality gate: maximum average overlap ratio")
    parser.add_argument(
        "--max-orphan-rate",
        type=float,
        default=0.25,
        help="Quality gate: max percentage of sections missing chunks",
    )
    parser.add_argument("--ner-threshold", type=float, default=0.4, help="NER confidence threshold metadata")
    parser.add_argument("--similarity-top-k", type=int, default=10, help="Similarity graph top-k plan")
    parser.add_argument("--similarity-min-cosine", type=float, default=0.5, help="Minimum cosine threshold for similarity edges")
    parser.add_argument("--similarity-degree-cap", type=int, default=20, help="Maximum degree for similarity edges")
    return parser


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = build_parser()
    args = parser.parse_args()
    run_etl(args)


if __name__ == "__main__":  # pragma: no cover
    main()
