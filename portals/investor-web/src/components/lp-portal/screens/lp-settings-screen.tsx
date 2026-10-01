"use client"

import * as React from "react"
import {
  Bell,
  Eye,
  Globe2,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Smartphone,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { lpPortalApi, type LpSettings } from "@/lib/api/lp-portal-api"
import { useLpSettings } from "@/lib/lp-portal/hooks"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type EmailPrefKey = keyof Pick<
  LpSettings["notifications"],
  | "emailCapitalCalls"
  | "emailDistributions"
  | "emailDocuments"
  | "emailMessages"
  | "emailNotices"
>

type InAppPrefKey = keyof Pick<
  LpSettings["notifications"],
  | "inAppCapitalCalls"
  | "inAppDistributions"
  | "inAppDocuments"
  | "inAppMessages"
  | "inAppNotices"
>

const EMAIL_PREF_ROWS: Array<{ label: string; emailKeys: EmailPrefKey[]; inAppKeys: InAppPrefKey[] }> = [
  {
    label: "Capital calls & distributions",
    emailKeys: ["emailCapitalCalls", "emailDistributions"],
    inAppKeys: ["inAppCapitalCalls", "inAppDistributions"],
  },
  { label: "Documents published", emailKeys: ["emailDocuments"], inAppKeys: ["inAppDocuments"] },
  { label: "Notices & acknowledgements", emailKeys: ["emailNotices"], inAppKeys: ["inAppNotices"] },
  { label: "Requests & messages", emailKeys: ["emailMessages"], inAppKeys: ["inAppMessages"] },
]

function mapAsOfFromApi(api?: string): string {
  if (api === "LATEST_ANY") return "latest-any"
  if (api === "PRIOR_MONTH_END") return "month-end"
  return "latest-final"
}

function mapAsOfToApi(ui: string): string {
  if (ui === "latest-any") return "LATEST_ANY"
  if (ui === "month-end") return "PRIOR_MONTH_END"
  return "LATEST"
}

export function LpSettingsScreen() {
  const { data: settings, loading, error, reload } = useLpSettings()
  const [notifications, setNotifications] = React.useState<LpSettings["notifications"]>({
    emailCapitalCalls: true,
    emailDistributions: true,
    emailDocuments: true,
    emailMessages: true,
    emailNotices: true,
    inAppCapitalCalls: true,
    inAppDistributions: true,
    inAppDocuments: true,
    inAppMessages: true,
    inAppNotices: true,
    digest: "daily",
  })
  const [displayCurrency, setDisplayCurrency] = React.useState("USD")
  const [asOfDefault, setAsOfDefault] = React.useState("latest-final")
  const [digest, setDigest] = React.useState("daily")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!settings) return
    setNotifications(settings.notifications)
    setDisplayCurrency(settings.presentationCurrency)
    setAsOfDefault(mapAsOfFromApi(settings.defaultAsOfPreference))
    setDigest(settings.notifications.digest ?? "daily")
  }, [settings])

  const toggleEmail = (keys: EmailPrefKey[]) => {
    const allOn = keys.every((key) => notifications[key])
    setNotifications((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = !allOn
      return next
    })
  }

  const toggleInApp = (keys: InAppPrefKey[]) => {
    const allOn = keys.every((key) => notifications[key] ?? true)
    setNotifications((prev) => {
      const next = { ...prev }
      for (const key of keys) next[key] = !allOn
      return next
    })
  }

  const openExternal = (url?: string | null) => {
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  const save = async () => {
    setSaving(true)
    try {
      await Promise.all([
        lpPortalApi.updateNotificationSettings({
          ...notifications,
          digest: digest as "daily" | "weekly" | "off",
        }),
        lpPortalApi.updateDisplaySettings({
          presentationCurrency: displayCurrency,
          defaultAsOfPreference: mapAsOfToApi(asOfDefault),
        }),
      ])
      toast.success("Settings saved.")
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to save settings"))
    } finally {
      setSaving(false)
    }
  }

  const mfaEnabled = settings?.mfa.enabled ?? false

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Settings</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
            Notification preferences, security controls, and display defaults for your portal.
          </p>
        </div>
        <Button
          type="button"
          disabled={saving || loading}
          className="h-10 rounded-full bg-[#2563eb] px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save Changes
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            label: "MFA Status",
            value: loading ? "…" : mfaEnabled ? "Enabled" : "Not enabled",
            helper: settings?.mfa.issuerName ?? "Authenticator app",
            icon: <Smartphone className="size-4" />,
            bg: mfaEnabled ? "bg-[#dcfce7]" : "bg-[#f3f4f6]",
            color: mfaEnabled ? "text-[#16a34a]" : "text-[#6b7280]",
          },
          {
            label: "Security",
            value: settings?.mfa.requireMfaForLp ? "MFA required" : "Standard",
            helper: "Session + entitlement checks",
            icon: <ShieldCheck className="size-4" />,
            bg: "bg-[#dbeafe]",
            color: "text-[#2563eb]",
          },
          {
            label: "Email Digest",
            value: digest === "daily" ? "Daily" : digest === "weekly" ? "Weekly" : "Off",
            helper: "Capital & document alerts",
            icon: <Mail className="size-4" />,
            bg: "bg-[#ede9fe]",
            color: "text-[#7c3aed]",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <span className={cn("flex size-8 items-center justify-center rounded-full", card.bg, card.color)}>
              {card.icon}
            </span>
            <p className="mt-3 text-[12px] font-medium text-[#6b7280]">{card.label}</p>
            <p className="mt-1 text-[18px] font-bold text-[#0f172a]">{card.value}</p>
            <p className="mt-1 text-[12px] text-[#9ca3af]">{card.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-[#2563eb]" />
            <h2 className="text-[14px] font-semibold text-[#111827]">Notification Preferences</h2>
          </div>
          <p className="mt-1 text-[12px] text-[#6b7280]">
            Choose how you receive capital activity, document, notice, and message alerts.
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border border-[#e5e7eb]">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                  <th className="px-4 py-2.5">Alert Type</th>
                  <th className="px-3 py-2.5 text-center">Email</th>
                  <th className="px-3 py-2.5 text-center">In-App</th>
                </tr>
              </thead>
              <tbody>
                {EMAIL_PREF_ROWS.map(({ label, emailKeys, inAppKeys }) => (
                  <tr key={label} className="border-b border-[#f3f4f6] last:border-0">
                    <td className="px-4 py-3 font-medium text-[#111827]">{label}</td>
                    <td className="px-3 py-3 text-center">
                      <Switch
                        checked={emailKeys.every((key) => notifications[key])}
                        disabled={loading}
                        onCheckedChange={() => toggleEmail(emailKeys)}
                        aria-label={`${label} email`}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Switch
                        checked={inAppKeys.every((key) => notifications[key] ?? true)}
                        disabled={loading}
                        onCheckedChange={() => toggleInApp(inAppKeys)}
                        aria-label={`${label} in-app`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
              Email digest cadence
            </label>
            <Select value={digest} onValueChange={setDigest}>
              <SelectTrigger className="h-9 w-full max-w-[220px] rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily summary</SelectItem>
                <SelectItem value="weekly">Weekly summary</SelectItem>
                <SelectItem value="off">Off</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-[#2563eb]" />
              <h2 className="text-[14px] font-semibold text-[#111827]">Security</h2>
            </div>
            <ul className="mt-4 space-y-3">
              <li className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e7eb] px-3 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#111827]">Multi-factor authentication</p>
                  <p className="mt-0.5 text-[11px] text-[#6b7280]">
                    {mfaEnabled
                      ? `Enabled${settings?.mfa.enabledAt ? ` · ${new Date(settings.mfa.enabledAt).toLocaleDateString()}` : ""}`
                      : "Not enabled for this account"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!settings?.mfa.manageUrl}
                  className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium shadow-none"
                  onClick={() => openExternal(settings?.mfa.manageUrl)}
                >
                  Manage
                </Button>
              </li>
              <li className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e7eb] px-3 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#111827]">Active sessions</p>
                  <p className="mt-0.5 text-[11px] text-[#6b7280]">Managed by platform auth</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!settings?.mfa.sessionsUrl}
                  className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium shadow-none"
                  onClick={() => openExternal(settings?.mfa.sessionsUrl)}
                >
                  Review
                </Button>
              </li>
              <li className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e7eb] px-3 py-3">
                <div>
                  <p className="text-[12px] font-semibold text-[#111827]">Password</p>
                  <p className="mt-0.5 text-[11px] text-[#6b7280]">Change via account settings</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!settings?.mfa.passwordUrl}
                  className="h-8 rounded-full border-[#e5e7eb] px-3 text-[11px] font-medium shadow-none"
                  onClick={() => openExternal(settings?.mfa.passwordUrl)}
                >
                  Change
                </Button>
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-[#2563eb]" />
              <h2 className="text-[14px] font-semibold text-[#111827]">Display Preferences</h2>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Display currency
                </label>
                <Select value={displayCurrency} onValueChange={setDisplayCurrency} disabled={loading}>
                  <SelectTrigger className="h-9 rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-[#9ca3af]">
                  <Globe2 className="mt-0.5 size-3.5 shrink-0" />
                  Presentation currency for portal amounts and reports.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Default as-of preference
                </label>
                <Select value={asOfDefault} onValueChange={setAsOfDefault} disabled={loading}>
                  <SelectTrigger className="h-9 rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest-final">Latest FINAL valuation</SelectItem>
                    <SelectItem value="latest-any">Latest available (incl. provisional)</SelectItem>
                    <SelectItem value="month-end">Prior month-end FINAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
