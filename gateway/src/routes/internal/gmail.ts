/**
 * Internal API for Gmail thread summaries (e.g. Phase 4 memory extraction).
 */
import { Router } from 'express';
import {
  validateInternalAuth,
  requireInternalUser,
  getInternalUserId,
  type AuthenticatedRequest
} from '../../middleware/internalAuth';
import { listGmailThreadSummaries, isValidUUID } from '../../services/db';
import { createSuccessResponse, createErrorResponse } from '../../models/internal';

const router = Router();
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * GET /internal/gmail/threads/:userId - List thread summaries for extraction.
 * Query: limit (optional, default 500, max 2000).
 */
router.get(
  '/threads/:userId',
  [validateInternalAuth, requireInternalUser],
  async (req: AuthenticatedRequest, res) => {
    const requestId = req.internal!.requestId;
    const userId = getInternalUserId(req);
    if (!userId || !isValidUUID(userId)) {
      return res.status(400).json(
        createErrorResponse('Valid user ID is required', 'INVALID_USER_ID', requestId)
      );
    }
    const limit = Math.min(
      parseInt(String(req.query.limit), 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    try {
      const threads = await listGmailThreadSummaries(userId, limit);
      return res.json(createSuccessResponse({ threads }, requestId));
    } catch (error) {
      console.error('[InternalAPI] listGmailThreadSummaries failed', { userId, error });
      return res.status(500).json(
        createErrorResponse(
          error instanceof Error ? error.message : 'Failed to list threads',
          'LIST_THREADS_FAILED',
          requestId
        )
      );
    }
  }
);

export default router;
