/**
 * FR-LP-004: a user linked to several investor relationships picks one; the choice is sent as `?client=<investorId>`
 * on every LP request (the API verifies membership and answers 403 otherwise). Kept per browser only.
 */
const KEY = "lp.client"

export function getLpClientScope(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setLpClientScope(investorId: string | null): void {
  try {
    if (investorId) window.localStorage.setItem(KEY, investorId)
    else window.localStorage.removeItem(KEY)
  } catch {
    /* storage can be unavailable (private mode); the first relationship is used */
  }
}
