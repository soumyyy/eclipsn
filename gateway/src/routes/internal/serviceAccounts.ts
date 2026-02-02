/**
 * Internal API for service account thread summaries (memory extraction).
 */
import { Router } from 'express';
import {
  validateInternalAuth,
  requireInternalUser,
  getInternalUserId,
  type AuthenticatedRequest
} from '../../middleware/internalAuth';
import { createSuccessResponse, createErrorResponse } from '../../models/internal';
import { listServiceAccountThreadSummaries } from '../../services/serviceAccountThreads';
import { isValidUUID } from '../../services/db';

const router = Router();
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

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
    const limitPerAccount = Math.min(
      parseInt(String(req.query.limit), 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const lookbackDays = parseInt(String(req.query.lookbackDays), 10) || 365;
    try {
      const threads = await listServiceAccountThreadSummaries({
        userId,
        limitPerAccount,
        lookbackDays
      });
      return res.json(createSuccessResponse({ threads }, requestId));
    } catch (error) {
      console.error('[InternalAPI] listServiceAccountThreadSummaries failed', { userId, error });
      return res.status(500).json(
        createErrorResponse(
          error instanceof Error ? error.message : 'Failed to list service account threads',
          'LIST_SERVICE_THREADS_FAILED',
          requestId
        )
      );
    }
  }
);

export default router;
