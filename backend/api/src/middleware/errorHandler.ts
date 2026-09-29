import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@matanho/shared';
import { config } from '../config';
import { HttpError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) return;

  let status = 500;
  let body: ApiErrorBody['error'] = { code: 'internal_error', message: 'Internal server error' };

  if (err instanceof HttpError) {
    status = err.status;
    body = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'invalid_json', message: 'Request body is not valid JSON' };
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
    status = 413;
    body = { code: 'payload_too_large', message: 'Request body too large' };
  }

  if (status >= 500) {
    console.error('[api] unhandled error:', err);
    if (!config.isProduction && err instanceof Error) {
      body = { ...body, details: { stack: err.stack } };
    }
  }

  res.status(status).json({ error: body } satisfies ApiErrorBody);
};
