import { describeApiError } from './auth';
import type {
  ApiErrorBody,
  AuthResponse,
  HealthResponse,
  InvitationPreview,
  LoginRequest,
  MfaEnrollResponse,
  RegisterRequest,
} from './auth';
import type { PortalId } from './portals';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(describeApiError(body.message, body.fieldErrors));
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.fieldErrors = body.fieldErrors;
  }
}

export interface ApiClientOptions {
  /** Base URL of the shared Express API, e.g. http://localhost:4100 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Small typed wrapper around the shared API. Every portal uses the same
 * client so authentication behaves identically everywhere. Session cookies are
 * httpOnly and managed by the API - the client only opts in to sending them.
 */
export function createApiClient({ baseUrl, fetchImpl }: ApiClientOptions) {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch: typeof fetch = (...args) => (fetchImpl ?? fetch)(...args);

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
    if (init.body !== undefined && !isForm && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    headers.set('Accept', 'application/json');

    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });

    const text = await response.text();
    const payload = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const body =
        (payload as ApiErrorBody | undefined)?.error ??
        ({ code: 'http_error', message: `Request failed with status ${response.status}` } as const);
      throw new ApiError(response.status, body);
    }
    return payload as T;
  }

  const send = <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });

  return {
    request,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => send<T>('POST', path, body, headers),
    put: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => send<T>('PUT', path, body, headers),
    patch: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) => send<T>('PATCH', path, body, headers),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    health: () => request<HealthResponse>('/api/health'),
    register: (input: RegisterRequest) =>
      request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
    login: (input: LoginRequest) =>
      request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }),
    me: () => request<AuthResponse>('/api/auth/me'),
    mfaEnroll: () => send<MfaEnrollResponse>('POST', '/api/auth/mfa/enroll', {}),
    mfaVerify: (code: string) => send<AuthResponse>('POST', '/api/auth/mfa/verify', { code }),
    mfaStepUp: (code: string) => send<{ ok: true }>('POST', '/api/auth/mfa/step-up', { code }),
    mfaStatus: () => request<{ enrolled: boolean; enrolledAt: string | null }>('/api/auth/mfa/status'),
    forgotPassword: (email: string, portal?: PortalId) =>
      send<{ ok: true }>('POST', '/api/auth/password/forgot', { email, portal }),
    resetPassword: (token: string, password: string) =>
      send<{ ok: true }>('POST', '/api/auth/password/reset', { token, password }),
    invitation: (token: string) => request<InvitationPreview>(`/api/auth/invitations/${encodeURIComponent(token)}`),
    acceptInvitation: (input: { token: string; name?: string; password: string }) =>
      send<AuthResponse>('POST', '/api/auth/invitations/accept', input),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
