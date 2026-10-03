import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@matanho/shared';
import { HttpError } from '../lib/errors';
import { fieldLabel } from './validate';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Route not found: ${req.method} ${req.path}`));
};

interface FieldDetail {
  path: string;
  message: string;
}

function fieldDetails(details: unknown): FieldDetail[] | null {
  if (!Array.isArray(details) || details.length === 0) return null;
  const ok = details.every(
    (d) => d && typeof d === 'object' && typeof (d as FieldDetail).path === 'string' && typeof (d as FieldDetail).message === 'string',
  );
  return ok ? (details as FieldDetail[]) : null;
}

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

  // Stack traces and file paths stay in the server log, never in the response (ISS-ADA-025).
  if (status >= 500 && !(err instanceof HttpError)) console.error('[api] unhandled error:', err);

  // Field-level validation: put the reason in the message (so every client shows it) and expose a
  // `fieldErrors` map; the top-level fields make this envelope a superset of the LP one (ISS-LPC-005).
  const fields = fieldDetails(body.details);
  let fieldErrors: Record<string, string> | undefined;
  if (fields) {
    fieldErrors = {};
    for (const f of fields) fieldErrors[f.path || '_'] ??= f.message;
    if (body.message === 'Validation failed') {
      const shown = fields.slice(0, 3).map((f) => (f.path && !f.message.startsWith(fieldLabel(f.path)) ? `${fieldLabel(f.path)}: ${f.message}` : f.message));
      body = { ...body, message: `Validation failed. ${shown.join('. ')}${fields.length > 3 ? ` (and ${fields.length - 3} more)` : ''}` };
    }
  }

  res.status(status).json({
    error: { ...body, ...(fieldErrors ? { fieldErrors } : {}) },
    success: false,
    code: body.code,
    message: body.message,
    ...(fieldErrors ? { fieldErrors } : {}),
  } satisfies ApiErrorBody);
};
