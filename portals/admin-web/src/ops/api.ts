'use client';

/**
 * Client for the staff operations API (`/api/v1/ops/*`) and the few existing staff
 * endpoints the console reads (clients, companies). Uses the admin cookie session.
 *
 * Step-up: a `401 step_up_required` asks the registered handler (the TOTP modal) for a
 * fresh code, then retries the request once with the same headers, including the same
 * `Idempotency-Key`.
 */

export const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '');

export class OpsError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'OpsError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get notAvailable(): boolean {
    return this.status === 501 || this.code === 'not_implemented';
  }
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function setStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}

export interface RequestOptions {
  idempotencyKey?: string;
  /** Internal: set on the retry after a step-up so it can never loop. */
  noStepUp?: boolean;
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new OpsError(0, 'network_error', 'The API could not be reached. Check your connection and try again.');
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (res.ok) return json as T;

  const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
  const error = new OpsError(
    res.status,
    err?.code ?? 'http_error',
    err?.message ?? `Request failed with status ${res.status}`,
    err?.details,
  );

  if (res.status === 401 && error.code === 'step_up_required' && !opts.noStepUp && stepUpHandler) {
    const confirmed = await stepUpHandler();
    if (!confirmed) throw new OpsError(401, 'step_up_cancelled', 'Confirmation cancelled. Nothing was changed.');
    return apiRequest<T>(method, path, body, { ...opts, noStepUp: true });
  }
  throw error;
}

/** Nexus staff JSON style: `{ data: ... }`. Bare payloads are accepted as-is. */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) return (payload as { data: T }).data;
  return payload as T;
}

export const api = {
  get: async <T>(path: string) => unwrap<T>(await apiRequest('GET', path)),
  post: async <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    unwrap<T>(await apiRequest('POST', path, body, opts)),
  patch: async <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    unwrap<T>(await apiRequest('PATCH', path, body, opts)),
  put: async <T>(path: string, body: unknown = {}, opts?: RequestOptions) =>
    unwrap<T>(await apiRequest('PUT', path, body, opts)),
};

export const ops = (path: string) => `/api/v1/ops${path}`;

/** Staff domain endpoints mounted at the root of `/api/v1` (portfolios, securities, ibor, brokers). */
export const v1 = (path: string) => `/api/v1${path}`;

export function qs(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Human message for an API error, with the console's wording for the control failures. */
export function describeError(e: unknown): string {
  if (e instanceof OpsError) {
    switch (e.code) {
      case 'segregation_of_duties':
        return `A different approver is required. ${e.message}`.trim();
      case 'step_up_cancelled':
        return e.message;
      case 'forbidden':
        return `You do not have permission for this action. ${e.message}`.trim();
      case 'version_conflict':
        return e.message;
      case 'conflict':
        return `${e.message} Reload the page to see the latest version.`;
      case 'not_implemented':
        return 'This action is not available yet: the operations API for it has not been deployed.';
      default:
        if (e.status === 501) return 'This action is not available yet: the operations API for it has not been deployed.';
        return e.message;
    }
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}
