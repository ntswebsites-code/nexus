/**
 * Bridge between the API client (plain module code) and the step-up dialog (React).
 *
 * The client calls `requestStepUp` when an action answers `LP_STEP_UP_REQUIRED` (or
 * `LP_MFA_REQUIRED` when the user has no authenticator yet); the dialog mounted in the LP layout
 * registers itself as the handler. Concurrent requests share one dialog.
 */
export type StepUpMode = "verify" | "enroll"

export interface StepUpRequest {
  mode: StepUpMode
  message?: string
}

type StepUpHandler = (request: StepUpRequest) => Promise<boolean>

let handler: StepUpHandler | null = null
let inflight: Promise<boolean> | null = null

export function registerStepUpHandler(next: StepUpHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/** Resolves true once the user has confirmed a code, false if they cancel or no dialog is mounted. */
export function requestStepUp(request: StepUpRequest): Promise<boolean> {
  if (!handler) return Promise.resolve(false)
  if (inflight) return inflight
  inflight = handler(request).finally(() => {
    inflight = null
  })
  return inflight
}
