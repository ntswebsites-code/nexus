import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { LpErrorCode, LpListData, LpPortalResponse } from '@matanho/shared';
import { HttpError } from '../../lib/errors';
import { config } from '../../config';

/**
 * LP contract envelope (SRD 5B API contract): `{ success, data, message?, timestamp, meta.requestId }`
 * on success and `{ success:false, code, message, fieldErrors?, retryable? }` on failure.
 */
export function lpOk<T>(req: Request, res: Response, data: T, message?: string, status = 200) {
  const body: LpPortalResponse<T> = {
    success: true,
    data,
    ...(message ? { message } : {}),
    timestamp: new Date().toISOString(),
    meta: { requestId: req.requestId },
  };
  res.status(status).json(body);
}

export function lpList<T>(items: T[], page: number, pageSize: number, total: number): LpListData<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Paginates an in-memory array (read-time unions such as account activity). */
export function lpPaginate<T>(all: T[], page: number, pageSize: number): LpListData<T> {
  const start = (page - 1) * pageSize;
  return lpList(all.slice(start, start + pageSize), page, pageSize, all.length);
}

export class LpError extends HttpError {
  readonly fieldErrors?: Record<string, string>;
  readonly retryable?: boolean;
  constructor(status: number, code: LpErrorCode, message: string, opts: { fieldErrors?: Record<string, string>; retryable?: boolean } = {}) {
    super(status, code, message);
    this.fieldErrors = opts.fieldErrors;
    this.retryable = opts.retryable;
  }
  static notFound(what = 'Record') {
    return new LpError(404, 'LP_NOT_FOUND', `${what} not found`);
  }
  static forbidden(message: string) {
    return new LpError(403, 'LP_FORBIDDEN', message);
  }
  static validation(message: string, fieldErrors?: Record<string, string>) {
    return new LpError(400, 'LP_VALIDATION', message, { fieldErrors });
  }
}

const MAP: Record<string, LpErrorCode> = {
  unauthorized: 'LP_UNAUTHORIZED',
  mfa_required: 'LP_UNAUTHORIZED',
  forbidden: 'LP_FORBIDDEN',
  permission_denied: 'LP_FORBIDDEN',
  portal_access_denied: 'LP_FORBIDDEN',
  no_client_access: 'LP_FORBIDDEN',
  not_found: 'LP_NOT_FOUND',
  bad_request: 'LP_VALIDATION',
  invalid_json: 'LP_VALIDATION',
  version_conflict: 'LP_VERSION_CONFLICT',
  conflict: 'LP_VALIDATION',
  step_up_required: 'LP_STEP_UP_REQUIRED',
  mfa_enrolment_required: 'LP_MFA_REQUIRED',
  payload_too_large: 'LP_VALIDATION',
  unsupported_media: 'LP_UNSUPPORTED_MEDIA',
  idempotency_key_required: 'LP_VALIDATION',
  idempotency_key_reused: 'LP_IDEMPOTENCY_KEY_REUSED',
  idempotency_in_progress: 'LP_IDEMPOTENCY_IN_PROGRESS',
};

/** Router-level error handler: every LP route answers in the LP envelope, never the Nexus one. */
export const lpErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;
  let status = 500;
  let code: string = 'LP_INTERNAL';
  let message = 'Something went wrong. Try again.';
  let fieldErrors: Record<string, string> | undefined;
  let retryable: boolean | undefined = true;

  if (err instanceof HttpError) {
    status = err.status;
    code = err.code.startsWith('LP_') ? err.code : (MAP[err.code] ?? 'LP_VALIDATION');
    message = err.message;
    retryable = undefined;
    if (err instanceof LpError) {
      fieldErrors = err.fieldErrors;
      retryable = err.retryable;
    } else if (Array.isArray(err.details)) {
      fieldErrors = Object.fromEntries(
        (err.details as { path: string; message: string }[]).map((d) => [d.path || '_', d.message]),
      );
    }
  } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'LP_VALIDATION';
    message = 'Request body is not valid JSON';
    retryable = undefined;
  } else {
    console.error('[lp-portal] unhandled error:', err);
  }

  res.status(status).json({
    success: false,
    code,
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    timestamp: new Date().toISOString(),
    meta: { requestId: req.requestId },
  });
};

/** `page` / `pageSize` from the query string (1-based, pageSize capped at 100). */
export function pageOf(req: Request): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20));
  return { page, pageSize };
}

/** WS0 stub: an empty, contract-valid list. */
export const lpStubList: RequestHandler = (req, res) => {
  const { page, pageSize } = pageOf(req);
  lpOk(req, res, lpList([], page, pageSize, 0));
};

/** WS0 stub: `{ items: [] }` (dashboard actions, recent activity, notifications). */
export const lpStubItems: RequestHandler = (req, res) => lpOk(req, res, { items: [] });

/** WS0 stub: a bare empty array (ledger, vault, colleagues, bank accounts ...). */
export const lpStubArray: RequestHandler = (req, res) => lpOk(req, res, []);

/** WS0 stub: the endpoint exists but is not built yet; the UI keeps that domain on demo data. */
export const lpStubNotLive: RequestHandler = () => {
  throw new LpError(503, 'LP_DOMAIN_NOT_LIVE', 'This feature is not available yet', { retryable: false });
};

/** Decimal-safe string for money/units (Prisma Decimal, number, null). */
export function dec(value: { toString(): string } | number | null | undefined, places?: number): string {
  if (value === null || value === undefined) return '0';
  if (places !== undefined) return Number(value.toString()).toFixed(places);
  return value.toString();
}

/** YYYY-MM-DD for DATE columns. */
export function day(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '';
}
