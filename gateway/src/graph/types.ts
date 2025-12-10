import crypto from 'crypto';

export enum GraphNodeType {
  DOCUMENT = 'DOCUMENT',
  SECTION = 'SECTION',
  CHUNK = 'CHUNK',
  ENTITY = 'ENTITY',
  TOPIC = 'TOPIC',
  QUERY = 'QUERY'
}

export enum GraphEdgeType {
  HAS_SECTION = 'HAS_SECTION',
  HAS_CHUNK = 'HAS_CHUNK',
  MENTIONS = 'MENTIONS',
  SIMILAR_TO = 'SIMILAR_TO',
  BELONGS_TO = 'BELONGS_TO',
  RETRIEVED = 'RETRIEVED'
}

export interface NodeSchema {
  type: GraphNodeType;
  prefix: string;
  description: string;
  requiredAttrs: string[];
  optionalAttrs: string[];
}

export interface EdgeSchema {
  type: GraphEdgeType;
  description: string;
  sourceTypes: GraphNodeType[];
  targetTypes: GraphNodeType[];
  attributes: string[];
}

export const NODE_SCHEMAS: Record<GraphNodeType, NodeSchema> = {
  [GraphNodeType.DOCUMENT]: {
    type: GraphNodeType.DOCUMENT,
    prefix: 'DOC',
    description: 'Root document or thread',
    requiredAttrs: ['title', 'source_uri'],
    optionalAttrs: ['external_id', 'etag', 'metadata_version']
  },
  [GraphNodeType.SECTION]: {
    type: GraphNodeType.SECTION,
    prefix: 'SEC',
    description: 'Document section or heading block',
    requiredAttrs: ['document_id', 'section_path'],
    optionalAttrs: ['heading', 'order', 'token_count']
  },
  [GraphNodeType.CHUNK]: {
    type: GraphNodeType.CHUNK,
    prefix: 'CHK',
    description: 'Embeddable chunk of content',
    requiredAttrs: ['section_id', 'chunk_index', 'text'],
    optionalAttrs: [
      'token_count',
      'overlap_ratio',
      'quality',
      'embedding_model',
      'embedding_version',
      'acl_tags',
      'orphan_risk'
    ]
  },
  [GraphNodeType.ENTITY]: {
    type: GraphNodeType.ENTITY,
    prefix: 'ENT',
    description: 'Canonical named entity',
    requiredAttrs: ['canonical_name'],
    optionalAttrs: ['entity_type', 'aliases', 'source', 'metadata_version']
  },
  [GraphNodeType.TOPIC]: {
    type: GraphNodeType.TOPIC,
    prefix: 'TOP',
    description: 'Embedding-derived topic cluster',
    requiredAttrs: ['label', 'cluster_id'],
    optionalAttrs: ['algorithm', 'score', 'keywords']
  },
  [GraphNodeType.QUERY]: {
    type: GraphNodeType.QUERY,
    prefix: 'QRY',
    description: 'Captured user query or retrieval event',
    requiredAttrs: ['query_text', 'issued_at'],
    optionalAttrs: ['latency_ms', 'profile_id', 'embedding_version']
  }
};

export const EDGE_SCHEMAS: Record<GraphEdgeType, EdgeSchema> = {
  [GraphEdgeType.HAS_SECTION]: {
    type: GraphEdgeType.HAS_SECTION,
    description: 'Document contains Section',
    sourceTypes: [GraphNodeType.DOCUMENT],
    targetTypes: [GraphNodeType.SECTION],
    attributes: ['order']
  },
  [GraphEdgeType.HAS_CHUNK]: {
    type: GraphEdgeType.HAS_CHUNK,
    description: 'Section contains Chunk',
    sourceTypes: [GraphNodeType.SECTION],
    targetTypes: [GraphNodeType.CHUNK],
    attributes: ['chunk_index', 'token_count']
  },
  [GraphEdgeType.MENTIONS]: {
    type: GraphEdgeType.MENTIONS,
    description: 'Chunk mentions Entity',
    sourceTypes: [GraphNodeType.CHUNK],
    targetTypes: [GraphNodeType.ENTITY],
    attributes: ['confidence', 'evidence_span']
  },
  [GraphEdgeType.SIMILAR_TO]: {
    type: GraphEdgeType.SIMILAR_TO,
    description: 'Chunk-to-chunk semantic similarity',
    sourceTypes: [GraphNodeType.CHUNK],
    targetTypes: [GraphNodeType.CHUNK],
    attributes: ['weight', 'source', 'embedding_version']
  },
  [GraphEdgeType.BELONGS_TO]: {
    type: GraphEdgeType.BELONGS_TO,
    description: 'Chunk belongs to Topic cluster',
    sourceTypes: [GraphNodeType.CHUNK],
    targetTypes: [GraphNodeType.TOPIC],
    attributes: ['score']
  },
  [GraphEdgeType.RETRIEVED]: {
    type: GraphEdgeType.RETRIEVED,
    description: 'Query retrieved Chunk',
    sourceTypes: [GraphNodeType.QUERY],
    targetTypes: [GraphNodeType.CHUNK],
    attributes: ['rank', 'score', 'retrieved_at']
  }
};

function normalizeKey(value: string): string {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  const trimmed = compact.replace(/^-+|-+$/g, '');
  return trimmed || 'UNK';
}

function stableHash(parts: string[], length = 10): string {
  const joined = parts.join('::');
  return crypto.createHash('sha1').update(joined).digest('hex').toUpperCase().slice(0, length);
}

export function makeNodeId(nodeType: GraphNodeType, ...parts: string[]): string {
  const schema = NODE_SCHEMAS[nodeType];
  const normalized = parts.filter(Boolean).map(part => normalizeKey(part));
  const digest = stableHash([schema.prefix, ...normalized]);
  const stem = normalized[0] ?? nodeType;
  return `${schema.prefix}_${stem}_${digest}`;
}

export function makeEdgeId(edgeType: GraphEdgeType, fromId: string, toId: string): string {
  const digest = stableHash([edgeType, fromId, toId]);
  return `${edgeType}_${digest}`;
}
