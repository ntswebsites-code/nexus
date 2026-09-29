import type {
  ApiErrorBody,
  AuthResponse,
  HealthResponse,
  LoginRequest,
  RegisterRequest,
} from './auth';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
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
    if (init.body !== undefined && !headers.has('Content-Type')) {
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

  return {
    health: () => request<HealthResponse>('/api/health'),
    register: (input: RegisterRequest) =>
      request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) }),
    login: (input: LoginRequest) =>
      request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST', body: '{}' }),
    me: () => request<AuthResponse>('/api/auth/me'),
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
