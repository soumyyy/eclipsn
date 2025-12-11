import { Router } from 'express';
import { TEST_USER_ID } from '../constants';
import { GraphNodeType, GraphEdgeType } from '../graph/types';
import { fetchGraphSlice, fetchGraphNeighborhood } from '../services/db';

const router = Router();

function parseNodeTypes(value: unknown): GraphNodeType[] | undefined {
  if (!value) return undefined;
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const cleaned = raw
    .map((token) => token?.toString().trim().toUpperCase())
    .filter((token) => token?.length);
  const unique = Array.from(new Set(cleaned)) as GraphNodeType[];
  return unique.length ? unique : undefined;
}

function parseEdgeTypes(value: unknown): GraphEdgeType[] | undefined {
  if (!value) return undefined;
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  const cleaned = raw
    .map((token) => token?.toString().trim().toUpperCase())
    .filter((token) => token?.length);
  const unique = Array.from(new Set(cleaned)) as GraphEdgeType[];
  return unique.length ? unique : undefined;
}

router.get('/slice', async (req, res) => {
  const sliceId = typeof req.query.sliceId === 'string' ? req.query.sliceId : undefined;
  const ingestionId = typeof req.query.ingestionId === 'string' ? req.query.ingestionId : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const edgeLimit = req.query.edgeLimit ? Number(req.query.edgeLimit) : undefined;
  const nodeTypes = parseNodeTypes(req.query.types);
  const edgeTypes = parseEdgeTypes(req.query.edgeTypes);

  try {
    const result = await fetchGraphSlice({
      userId: TEST_USER_ID,
      sliceId,
      ingestionId,
      nodeTypes,
      edgeTypes,
      limit,
      edgeLimit
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to load graph slice', error);
    res.status(500).json({ error: 'Failed to load graph slice' });
  }
});

router.get('/node/:id', async (req, res) => {
  const nodeId = req.params.id;
  const depth = req.query.depth ? Number(req.query.depth) : 1;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const edgeLimit = req.query.edgeLimit ? Number(req.query.edgeLimit) : undefined;
  const nodeTypes = parseNodeTypes(req.query.nodeTypes);
  const edgeTypes = parseEdgeTypes(req.query.edgeTypes);
  const ingestionId = typeof req.query.ingestionId === 'string' ? req.query.ingestionId : undefined;

  if (!nodeId) {
    return res.status(400).json({ error: 'Node ID required' });
  }

  try {
    const result = await fetchGraphNeighborhood({
      userId: TEST_USER_ID,
      centerId: nodeId,
      depth,
      nodeTypes,
      edgeTypes,
      nodeLimit: limit,
      edgeLimit,
      ingestionId
    });
    res.json(result);
  } catch (error) {
    console.error('Failed to load node neighborhood', error);
    res.status(500).json({ error: 'Failed to load node neighborhood' });
  }
});

export default router;
