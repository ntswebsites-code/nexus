"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api/api-client"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Account security for the LP portal (FR-LP-102): authenticator enrolment with backup codes, active sessions and
 * password change. All calls go to `/api/v1/account/security` and `/api/v1/auth/mfa/*`, which act only on the
 * signed-in user.
 */

export type SecurityPanel = "mfa" | "sessions" | "password"

interface SecuritySession {
  id: string
  current: boolean
  createdAt: string
  lastUsedAt: string
  userAgent: string | null
  ip: string | null
}

interface SecurityData {
  mfa: { enrolled: boolean; enrolledAt: string | null; required: boolean; backupCodesRemaining: number }
  sessions: SecuritySession[]
}

const fieldClass = "h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
const panelClass = "mt-4 rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-4"

function useSecurity() {
  const [data, setData] = React.useState<SecurityData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const reload = React.useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: SecurityData }>("/account/security")
      setData(res.data)
      setError(null)
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load security settings"))
    }
  }, [])
  React.useEffect(() => {
    void reload()
  }, [reload])
  return { data, error, reload }
}

export function LpSecurityPanels({ panel, onChanged }: { panel: SecurityPanel; onChanged?: () => void }) {
  if (panel === "password") return <PasswordPanel />
  return <LoadedPanels panel={panel} onChanged={onChanged} />
}

function LoadedPanels({ panel, onChanged }: { panel: Exclude<SecurityPanel, "password">; onChanged?: () => void }) {
  const security = useSecurity()
  if (security.error) {
    return (
      <p role="alert" className={`${panelClass} text-[12px] text-red-700`}>
        {security.error}
      </p>
    )
  }
  if (!security.data) {
    return (
      <p className={`${panelClass} flex items-center gap-2 text-[12px] text-[#6b7280]`}>
        <Loader2 className="size-3.5 animate-spin" /> Loading
      </p>
    )
  }
  if (panel === "mfa") return <MfaPanel data={security.data} reload={async () => { await security.reload(); onChanged?.() }} />
  return <SessionsPanel data={security.data} reload={security.reload} />
}

function MfaPanel({ data, reload }: { data: SecurityData; reload: () => Promise<void> }) {
  const [enrolment, setEnrolment] = React.useState<{ secret: string; otpauthUri: string } | null>(null)
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [codes, setCodes] = React.useState<string[] | null>(null)

  async function makeCodes() {
    const res = await apiClient.post<{ data: { codes: string[] } }>("/account/security/mfa/backup-codes", {})
    setCodes(res.data.codes)
  }

  async function start() {
    setBusy(true)
    setError(null)
    try {
      setEnrolment(await apiClient.post<{ secret: string; otpauthUri: string }>("/auth/mfa/enroll", {}, { stepUp: false }))
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not start two-factor set-up."))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault()
    const clean = code.replace(/\s+/g, "")
    if (!/^\d{6}$/.test(clean)) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiClient.post("/auth/mfa/verify", { code: clean }, { stepUp: false })
      setEnrolment(null)
      setCode("")
      toast.success("Two-factor authentication is on.")
      await makeCodes()
      await reload()
    } catch (err) {
      setError(getApiErrorMessage(err, "That code is not valid. Try the latest code."))
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    setBusy(true)
    setError(null)
    try {
      await makeCodes()
      await reload()
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not create backup codes."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={panelClass} data-testid="lp-mfa-panel">
      <p className="text-[12px] font-semibold text-[#111827]">Authenticator app</p>
      {!data.mfa.enrolled && !enrolment && (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-[#6b7280]">Add a second step to sign-in and to sensitive actions such as bank changes and acknowledgements.</p>
          <Button type="button" disabled={busy} onClick={() => void start()} className="h-8 rounded-full bg-[#2563eb] px-4 text-[11px] font-semibold text-white hover:bg-[#1d4ed8]">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Set up authenticator
          </Button>
        </div>
      )}
      {enrolment && (
        <form onSubmit={confirm} className="mt-2 grid max-w-sm gap-2">
          <p className="text-[12px] text-[#6b7280]">Add this key to your authenticator app (choose manual entry, time-based), then enter the 6-digit code it shows.</p>
          <code className="rounded-md border bg-white p-2 font-mono text-[12px] tracking-wider break-all" data-testid="lp-mfa-secret">
            {enrolment.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <a className="text-[11px] text-[#2563eb] underline" href={enrolment.otpauthUri}>
            Open in authenticator app
          </a>
          <Label htmlFor="lp-mfa-code" className="text-[11px]">
            Authentication code
          </Label>
          <Input id="lp-mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className={fieldClass} />
          <Button type="submit" disabled={busy} className="h-8 w-fit rounded-full bg-[#2563eb] px-4 text-[11px] font-semibold text-white hover:bg-[#1d4ed8]">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Confirm and turn on
          </Button>
        </form>
      )}
      {data.mfa.enrolled && !codes && (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-[#6b7280]">
            Enabled{data.mfa.enrolledAt ? ` on ${new Date(data.mfa.enrolledAt).toLocaleDateString()}` : ""}. Backup codes left: <strong>{data.mfa.backupCodesRemaining}</strong>.
          </p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void regenerate()} className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium shadow-none">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Generate new backup codes
          </Button>
        </div>
      )}
      {codes && (
        <div className="mt-3 space-y-2" data-testid="lp-backup-codes">
          <p className="text-[12px] font-semibold text-[#111827]">Save these backup codes now</p>
          <p className="text-[11px] text-[#6b7280]">Each code works once if you lose your authenticator. They are not shown again.</p>
          <ul className="grid max-w-sm grid-cols-2 gap-1 font-mono text-[12px]">
            {codes.map((c) => (
              <li key={c} className="rounded border bg-white px-2 py-1">
                {c}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] shadow-none"
              onClick={() => {
                void navigator.clipboard?.writeText(codes.join("\n"))
                toast.success("Backup codes copied.")
              }}
            >
              Copy
            </Button>
            <Button type="button" className="h-8 rounded-full bg-[#2563eb] px-3 text-[11px] text-white hover:bg-[#1d4ed8]" onClick={() => setCodes(null)}>
              I have saved them
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

function SessionsPanel({ data, reload }: { data: SecurityData; reload: () => Promise<void> }) {
  const [busy, setBusy] = React.useState<string | null>(null)
  const others = data.sessions.filter((s) => !s.current)

  async function revoke(id: string) {
    setBusy(id)
    try {
      await apiClient.delete(`/account/security/sessions/${id}`)
      toast.success("Session signed out.")
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not sign that session out."))
    } finally {
      setBusy(null)
    }
  }

  async function revokeOthers() {
    setBusy("others")
    try {
      await apiClient.post("/account/security/sessions/revoke-others", {})
      toast.success("Other sessions signed out.")
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not sign the other sessions out."))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={panelClass} data-testid="lp-sessions-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-[#111827]">Where you are signed in</p>
        <Button type="button" variant="outline" disabled={!others.length || busy !== null} onClick={() => void revokeOthers()} className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] shadow-none">
          Sign out other sessions
        </Button>
      </div>
      <ul className="mt-3 space-y-2">
        {data.sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-[12px]">
            <div className="min-w-0">
              <p className="truncate font-medium text-[#111827]">
                {s.userAgent ?? "Unknown device"} {s.current ? <span className="ml-1 rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] text-[#166534]">This browser</span> : null}
              </p>
              <p className="text-[11px] text-[#6b7280]">
                {s.ip ?? "Unknown IP"} - last active {new Date(s.lastUsedAt).toLocaleString()}
              </p>
            </div>
            {!s.current && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void revoke(s.id)} className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] shadow-none" aria-label={`Sign out ${s.userAgent ?? "session"}`}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function PasswordPanel() {
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [again, setAgain] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const e: Record<string, string> = {}
    if (!current) e.current = "Enter your current password"
    if (next.length < 10) e.next = "Use at least 10 characters"
    if (next !== again) e.again = "The passwords do not match"
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const res = await apiClient.post<{ data: { otherSessionsRevoked: number } }>("/account/security/password", { currentPassword: current, newPassword: next })
      toast.success(res.data.otherSessionsRevoked ? `Password changed. ${res.data.otherSessionsRevoked} other session(s) signed out.` : "Password changed.")
      setCurrent("")
      setNext("")
      setAgain("")
    } catch (err) {
      setErrors({ form: getApiErrorMessage(err, "Could not change the password.") })
    } finally {
      setBusy(false)
    }
  }

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-[11px] text-red-700">
        {errors[k]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} className={`${panelClass} grid max-w-sm gap-2`} data-testid="lp-password-panel">
      <Label htmlFor="lp-pw-current" className="text-[11px]">
        Current password
      </Label>
      <Input id="lp-pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={fieldClass} />
      {err("current")}
      <Label htmlFor="lp-pw-new" className="text-[11px]">
        New password
      </Label>
      <Input id="lp-pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={fieldClass} />
      {err("next")}
      <Label htmlFor="lp-pw-again" className="text-[11px]">
        Repeat new password
      </Label>
      <Input id="lp-pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={fieldClass} />
      {err("again")}
      {err("form")}
      <p className="text-[11px] text-[#6b7280]">Changing your password signs you out everywhere else.</p>
      <Button type="submit" disabled={busy} className="h-8 w-fit rounded-full bg-[#2563eb] px-4 text-[11px] font-semibold text-white hover:bg-[#1d4ed8]">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Change password
      </Button>
    </form>
  )
}
