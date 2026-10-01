import type { ErrorRequestHandler, Request, Response } from 'express';
import { HttpError } from '../../lib/errors';
import { config } from '../../config';

/** Success envelope the Investee runtime reads (`{ success, message, data, timestamp }`). */
export function ok<T>(res: Response, data: T, message = 'OK', status = 200) {
  res.status(status).json({ success: true, message, data, timestamp: new Date().toISOString() });
}

/**
 * Router-level error handler: `{ success:false, message, code, error:{ code, message, details } }` so
 * both the NVCCZ-style client (`message`) and the Nexus client (`error.code`) can read it.
 */
export const investeeErrorHandler: ErrorRequestHandler = (err, req: Request, res, _next) => {
  if (res.headersSent) return;
  let status = 500;
  let code = 'internal_error';
  let message = 'Internal server error';
  let details: unknown;
  if (err instanceof HttpError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'invalid_json';
    message = 'Request body is not valid JSON';
  } else {
    console.error('[investee-portal] unhandled error:', err);
    if (!config.isProduction && err instanceof Error) details = { stack: err.stack };
  }
  res.status(status).json({
    success: false,
    message,
    code,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  });
};

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
