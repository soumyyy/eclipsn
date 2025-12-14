import type { Request } from 'express';

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Authentication required') {
    super(message);
  }
}

export function requireUserId(req: Request): string {
  if (!req.userId) {
    throw new UnauthorizedError();
  }
  return req.userId;
}
