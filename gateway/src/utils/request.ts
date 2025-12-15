import type { Request } from 'express';

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Authentication required') {
    super(message);
  }
}

export function requireUserId(req: Request): string {
  if (!req.userId) {
    console.warn('[auth] requireUserId called without session');
    throw new UnauthorizedError();
  }
  return req.userId;
}

export function getUserId(req: Request): string | undefined {
  return req.userId;
}
