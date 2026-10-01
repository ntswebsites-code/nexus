"use client"

import * as React from "react"
import { ShieldCheck } from "lucide-react"
import { apiClient } from "@/lib/api/api-client"
import { registerStepUpHandler, type StepUpRequest } from "@/lib/api/step-up"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface Enrolment {
  secret: string
  otpauthUri: string
}

const NO_RETRY = { stepUp: false, authRedirect: false } as const

/**
 * Step-up MFA for money and sensitive actions. Mounted once in the LP layout; the API client opens
 * it when an action answers `LP_STEP_UP_REQUIRED` and retries that action (same Idempotency-Key)
 * after the code is accepted. For a user with no authenticator yet (`LP_MFA_REQUIRED`) it enrols
 * one first; confirming the enrolment code also counts as the step-up.
 */
export function LpStepUpProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = React.useState<StepUpRequest | null>(null)
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [enrolment, setEnrolment] = React.useState<Enrolment | null>(null)
  const resolver = React.useRef<((ok: boolean) => void) | null>(null)

  React.useEffect(
    () =>
      registerStepUpHandler(
        (next) =>
          new Promise<boolean>((resolve) => {
            resolver.current = resolve
            setCode("")
            setError(null)
            setEnrolment(null)
            setBusy(false)
            setRequest(next)
          }),
      ),
    [],
  )

  React.useEffect(() => {
    if (request?.mode !== "enroll") return
    let alive = true
    apiClient
      .post<Enrolment>("/auth/mfa/enroll", {}, NO_RETRY)
      .then((res) => alive && setEnrolment(res))
      .catch((err) => alive && setError(getApiErrorMessage(err, "Could not start two-factor set-up.")))
    return () => {
      alive = false
    }
  }, [request])

  const finish = React.useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setRequest(null)
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const field = event.currentTarget.elements.namedItem("code")
    const clean = (field instanceof HTMLInputElement ? field.value : code).replace(/\s+/g, "")
    if (!/^\d{6}$/.test(clean)) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const path = request?.mode === "enroll" ? "/auth/mfa/verify" : "/auth/mfa/step-up"
      await apiClient.post(path, { code: clean }, NO_RETRY)
      finish(true)
    } catch (err) {
      setError(getApiErrorMessage(err, "That code is not valid. Try the latest code."))
      setBusy(false)
    }
  }

  const enrolling = request?.mode === "enroll"

  return (
    <>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && finish(false)}>
        <DialogContent className="sm:max-w-md" data-testid="lp-step-up-dialog">
          <form onSubmit={onSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-indigo-600" />
                {enrolling ? "Set up two-factor authentication" : "Confirm with your authentication code"}
              </DialogTitle>
              <DialogDescription>
                {enrolling
                  ? "This action needs two-factor authentication. Add this key to your authenticator app, then enter the 6-digit code it shows."
                  : (request?.message ?? "Confirm this action with your authentication code.")}
              </DialogDescription>
            </DialogHeader>

            {enrolling &&
              (enrolment ? (
                <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
                  <code className="font-mono tracking-wider break-all">
                    {enrolment.secret.replace(/(.{4})/g, "$1 ").trim()}
                  </code>
                  <a className="text-indigo-600 underline-offset-4 hover:underline" href={enrolment.otpauthUri}>
                    Open in authenticator app
                  </a>
                </div>
              ) : (
                !error && <p className="text-sm text-muted-foreground">Preparing a new key…</p>
              ))}

            <div className="grid gap-2">
              <Label htmlFor="lp-step-up-code">Authentication code</Label>
              <Input
                id="lp-step-up-code"
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                autoFocus
                className="text-center font-mono text-lg tracking-[0.4em]"
                aria-invalid={error ? true : undefined}
              />
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => finish(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="gradient" disabled={busy || (enrolling && !enrolment)}>
                {busy ? "Verifying…" : "Confirm"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
