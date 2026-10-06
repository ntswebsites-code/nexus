/**
 * Credentialed client for the shared API's LP contract (`/api/v1/...`).
 *
 * - Base URL is `NEXT_PUBLIC_API_URL`, the same convention every portal uses (portal-kit).
 * - The session is the httpOnly `nexus_session` cookie set by `/api/auth/login`; every call opts in
 *   with `credentials: "include"`.
 * - Success bodies use the LP envelope `{ success, data, message?, timestamp, meta.requestId }` and
 *   are returned whole (callers read `.data`). Failures, in either the LP envelope
 *   (`{ success:false, code, message, fieldErrors?, retryable? }`) or the Nexus one
 *   (`{ error: { code, message, details } }`), are thrown as `LpApiError`.
 * - 401 `LP_UNAUTHORIZED` sends the browser to /login. `LP_STEP_UP_REQUIRED` / `LP_MFA_REQUIRED`
 *   open the step-up dialog and the same request (same headers, so the same Idempotency-Key) is
 *   retried once after a confirmed code.
 * - Network failures are thrown as `LP_NETWORK_ERROR`; nothing is swallowed.
 */
import { requestStepUp } from "./step-up"
import { getLpClientScope, setLpClientScope } from "../lp-portal/client-scope"

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100").replace(/\/+$/, "")
}

const API_PREFIX = "/api/v1"

export interface RequestOptions {
  headers?: HeadersInit
  responseType?: "json" | "blob"
  /** Open the step-up dialog on LP_STEP_UP_REQUIRED (default true). */
  stepUp?: boolean
  /** Redirect to /login on an expired session (default true). */
  authRedirect?: boolean
  signal?: AbortSignal
}

export interface LpApiErrorResponse {
  code: string
  message: string
  fieldErrors?: Record<string, string>
  retryable?: boolean
  requestId?: string
}

export class LpApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors?: Record<string, string>
  readonly retryable?: boolean
  readonly requestId?: string
  /** Kept for the `.response` readers in `lib/lp-portal/use-lp-api.ts`. */
  readonly response: LpApiErrorResponse

  constructor(status: number, body: LpApiErrorResponse) {
    super(body.message)
    this.name = "LpApiError"
    this.status = status
    this.code = body.code
    this.fieldErrors = body.fieldErrors
    this.retryable = body.retryable
    this.requestId = body.requestId
    this.response = body
  }
}

export function isLpApiError(err: unknown): err is LpApiError {
  return err instanceof LpApiError
}

const SESSION_EXPIRED_CODES = new Set(["LP_UNAUTHORIZED", "unauthorized", "mfa_required"])

let redirecting = false
let redirectHandler: ((href: string) => void) | undefined

export function loginRedirectHref(pathname: string, search = ""): string {
  return `/login?next=${encodeURIComponent(pathname + search)}`
}

export function redirectToLogin() {
  if (typeof window === "undefined" || redirecting) return
  redirecting = true
  const href = loginRedirectHref(window.location.pathname, window.location.search)
  if (redirectHandler) redirectHandler(href)
  else window.location.assign(href)
}

/** Vitest hook — jsdom cannot spy on `location.assign`. Pass null to reset. */
export function setRedirectHandler(handler: ((href: string) => void) | null) {
  redirectHandler = handler ?? undefined
  if (!handler) redirecting = false
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function toError(status: number, payload: unknown, requestId: string | undefined): LpApiError {
  const body = (payload ?? {}) as {
    code?: string
    message?: string
    fieldErrors?: Record<string, string>
    retryable?: boolean
    meta?: { requestId?: string }
    error?: { code?: string; message?: string; details?: unknown }
  }
  const nested = body.error
  let fieldErrors = body.fieldErrors
  if (!fieldErrors && Array.isArray(nested?.details)) {
    fieldErrors = Object.fromEntries(
      (nested.details as Array<{ path?: string; message?: string }>).map((d) => [d.path || "_", d.message ?? "Invalid"]),
    )
  }
  const rid = body.meta?.requestId ?? requestId
  let message = body.message ?? nested?.message ?? `Request failed with status ${status}`
  if (status >= 500 && rid) message = `${message} (reference ${rid})`
  return new LpApiError(status, {
    code: body.code ?? nested?.code ?? (status >= 500 ? "LP_INTERNAL" : "LP_HTTP_ERROR"),
    message,
    fieldErrors,
    retryable: body.retryable ?? (status >= 500 ? true : undefined),
    requestId: rid,
  })
}

async function request<T>(
  method: string,
  url: string,
  body: unknown,
  options: RequestOptions = {},
  attempt = 0,
): Promise<T> {
  const headers = new Headers(options.headers)
  const isForm = typeof FormData !== "undefined" && body instanceof FormData
  if (body !== undefined && !isForm && !headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  if (!headers.has("Accept")) headers.set("Accept", options.responseType === "blob" ? "*/*" : "application/json")

  const scope = url.startsWith("/lp-portal") && !/[?&]client=/.test(url) ? getLpClientScope() : null
  const target = scope ? `${url}${url.includes("?") ? "&" : "?"}client=${encodeURIComponent(scope)}` : url

  let res: Response
  try {
    res = await fetch(`${apiBaseUrl()}${API_PREFIX}${target}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new LpApiError(0, {
      code: "LP_NETWORK_ERROR",
      message: "Could not reach the Matanho server. Check your connection and try again.",
      retryable: true,
    })
  }

  const requestId = res.headers.get("X-Request-Id") ?? undefined

  if (!res.ok) {
    // A remembered relationship the user can no longer open must not lock the portal.
    if (scope && res.status === 403 && url.startsWith("/lp-portal/session")) setLpClientScope(null)
    const text = await res.text().catch(() => "")
    const error = toError(res.status, text ? safeJson(text) : undefined, requestId)

    const stepUpCode = error.code === "LP_STEP_UP_REQUIRED" || error.code === "step_up_required"
    const enrolCode = error.code === "LP_MFA_REQUIRED" || error.code === "mfa_enrolment_required"
    if ((stepUpCode || enrolCode) && attempt === 0 && options.stepUp !== false) {
      const confirmed = await requestStepUp({ mode: enrolCode ? "enroll" : "verify", message: error.message })
      if (confirmed) return request<T>(method, url, body, options, attempt + 1)
      throw error
    }
    if (res.status === 401 && SESSION_EXPIRED_CODES.has(error.code) && options.authRedirect !== false) {
      redirectToLogin()
    }
    throw error
  }

  if (options.responseType === "blob") return (await res.blob()) as T

  const text = await res.text()
  if (!text) return undefined as T
  const payload = safeJson(text)
  if (payload === undefined) {
    throw new LpApiError(res.status, {
      code: "LP_INVALID_RESPONSE",
      message: "The server sent a response the portal could not read.",
      requestId,
    })
  }
  if ((payload as { success?: unknown }).success === false) throw toError(res.status, payload, requestId)
  return payload as T
}

export const apiClient = {
  get: <T = unknown>(url: string, options?: RequestOptions) => request<T>("GET", url, undefined, options),
  post: <T = unknown>(url: string, body: unknown = {}, options?: RequestOptions) => request<T>("POST", url, body, options),
  patch: <T = unknown>(url: string, body: unknown = {}, options?: RequestOptions) => request<T>("PATCH", url, body, options),
  put: <T = unknown>(url: string, body: unknown = {}, options?: RequestOptions) => request<T>("PUT", url, body, options),
  delete: <T = unknown>(url: string, options?: RequestOptions) => request<T>("DELETE", url, undefined, options),
}
