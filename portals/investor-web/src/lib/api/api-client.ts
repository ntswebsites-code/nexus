/**
 * The LP portal runs on hard-coded demo data (see lib/lp-portal/mock-api.ts), so there is no
 * network client. This stub only exists so lp-portal-api.ts keeps its original shape; every
 * call is answered by the mock store before it can reach here.
 */
type RequestOptions = { headers?: HeadersInit; responseType?: "json" | "blob"; [key: string]: unknown }

function unavailable<T>(method: string, url: string): Promise<T> {
  return Promise.reject(new Error(`LP portal is running on demo data; ${method} ${url} is not available.`))
}

export const apiClient = {
  get: <T = never>(url: string, _options?: RequestOptions) => unavailable<T>("GET", url),
  post: <T = never>(url: string, _body?: unknown, _options?: RequestOptions) => unavailable<T>("POST", url),
  patch: <T = never>(url: string, _body?: unknown, _options?: RequestOptions) => unavailable<T>("PATCH", url),
}
