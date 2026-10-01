"use client"

import * as React from "react"
import {
  Building2,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  UserPlus,
} from "lucide-react"
import { toast } from "sonner"
import { useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { lpPortalApi, type LpBankInstructionChange, type LpColleague } from "@/lib/api/lp-portal-api"
import { createIdempotencyKey, formatDate } from "@/lib/lp-portal/format"
import { useLpOrganisation } from "@/lib/lp-portal/hooks"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type Role = "Investor Admin" | "Viewer" | "Signatory"
type UserStatus = "Active" | "Invited" | "Suspended"
type BankStatus =
  | "Active"
  | "Submitted"
  | "Under Verification"
  | "Approved"
  | "Rejected"

type Colleague = {
  id: string
  name: string
  email: string
  role: Role
  funds: number
  mfa: boolean
  status: UserStatus
  lastActive: string
}

type BankChange = {
  id: string
  fund: string
  requestedBy: string
  submittedAt: string
  status: BankStatus
  maskedAccount: string
}

const ROLE_STYLE: Record<Role, string> = {
  "Investor Admin": "bg-[#dbeafe] text-[#1d4ed8]",
  Viewer: "bg-[#f3f4f6] text-[#4b5563]",
  Signatory: "bg-[#ede9fe] text-[#6d28d9]",
}

const USER_STATUS: Record<UserStatus, string> = {
  Active: "bg-[#dcfce7] text-[#15803d]",
  Invited: "bg-[#e0f2fe] text-[#0369a1]",
  Suspended: "bg-[#fee2e2] text-[#b91c1c]",
}

const BANK_STATUS: Record<BankStatus, string> = {
  Active: "bg-[#dcfce7] text-[#15803d]",
  Submitted: "bg-[#e0f2fe] text-[#0369a1]",
  "Under Verification": "bg-[#ffedd5] text-[#c2410c]",
  Approved: "bg-[#dbeafe] text-[#1d4ed8]",
  Rejected: "bg-[#fee2e2] text-[#b91c1c]",
}

function mapColleagueRole(lpRole: string): Role {
  if (lpRole === "MANAGER") return "Investor Admin"
  if (lpRole === "SIGNATORY") return "Signatory"
  return "Viewer"
}

function mapColleagueStatus(status: string): UserStatus {
  const s = status.toUpperCase()
  if (s === "INVITED") return "Invited"
  if (s === "SUSPENDED") return "Suspended"
  return "Active"
}

function mapColleague(c: LpColleague): Colleague {
  return {
    id: c.membershipId,
    name: c.name,
    email: c.email,
    role: mapColleagueRole(c.lpRole),
    // `fundIds` is null when a membership is not restricted to specific funds — the API returns
    // `Array.isArray(r.fundIds) ? r.fundIds : r.fundIds || null`, so null is the normal
    // "all funds" case, not an error. The mock store always supplied an array, so reading
    // `.length` here only started throwing once this screen moved to live data, and it took the
    // whole screen down through the error boundary rather than failing visibly.
    funds: Array.isArray(c.fundIds) ? c.fundIds.length : 0,
    mfa: c.mfaEnabled ?? false,
    status: mapColleagueStatus(c.status),
    lastActive: c.lastActiveAt ? formatDate(c.lastActiveAt, "datetime") : "—",
  }
}

function mapBankChangeStatus(status: string): BankStatus {
  const s = status.toUpperCase().replace(/-/g, "_")
  if (s === "SUBMITTED") return "Submitted"
  if (s === "UNDER_VERIFICATION" || s === "PENDING_VERIFICATION" || s === "PENDING") {
    return "Under Verification"
  }
  if (s === "APPROVED") return "Approved"
  if (s === "REJECTED") return "Rejected"
  if (s === "ACTIVE") return "Active"
  return "Submitted"
}

function mapBankChange(row: LpBankInstructionChange): BankChange {
  return {
    id: row.id,
    fund: row.fundName ?? row.fundId,
    requestedBy: row.requestedBy,
    submittedAt: formatDate(row.submittedAt, "datetime"),
    status: mapBankChangeStatus(row.status),
    maskedAccount: row.accountNumberMasked,
  }
}

export function LpOrganisationScreen() {
  const { data: org, loading, error, reload } = useLpOrganisation()
  const { lpRole, funds } = useLpPortal()
  const canManage = lpRole === "MANAGER"

  const colleagues = React.useMemo(() => (org?.colleagues ?? []).map(mapColleague), [org])
  const bankChanges = React.useMemo(
    () => (org?.bankChanges ?? []).map(mapBankChange),
    [org?.bankChanges],
  )

  const [query, setQuery] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("all")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [inviteEmail, setInviteEmail] = React.useState("")
  const [inviting, setInviting] = React.useState(false)
  const [revokingId, setRevokingId] = React.useState<string | null>(null)
  const [bankChangeOpen, setBankChangeOpen] = React.useState(false)
  const [bankChangeSubmitting, setBankChangeSubmitting] = React.useState(false)
  const [bankChangeForm, setBankChangeForm] = React.useState({
    fundId: "",
    bankName: "",
    accountName: "",
    accountNumber: "",
  })

  React.useEffect(() => {
    if (colleagues.length && !selectedId) setSelectedId(colleagues[0].id)
  }, [colleagues, selectedId])

  const filtered = colleagues.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false
    if (query.trim()) {
      const q = query.toLowerCase()
      if (!`${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q)) return false
    }
    return true
  })

  const selected = filtered.find((u) => u.id === selectedId) ?? filtered[0] ?? null

  const activeCount = colleagues.filter((c) => c.status === "Active").length
  const invitedCount = colleagues.filter((c) => c.status === "Invited").length
  const mfaCount = colleagues.filter((c) => c.mfa).length
  const fundEntitlements = new Set(colleagues.flatMap((c) => Array.from({ length: c.funds }, (_, i) => `${c.id}-${i}`))).size

  React.useEffect(() => {
    if (funds.length && !bankChangeForm.fundId) {
      setBankChangeForm((f) => ({ ...f, fundId: funds[0].id }))
    }
  }, [funds, bankChangeForm.fundId])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Email is required.")
      return
    }
    setInviting(true)
    try {
      await lpPortalApi.inviteColleague(
        {
          email: inviteEmail.trim(),
          role: "VIEWER",
          fundIds: funds.map((f) => f.id),
        },
        createIdempotencyKey(),
      )
      toast.success("Invitation sent.")
      setInviteOpen(false)
      setInviteEmail("")
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to send invitation"))
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (membershipId: string) => {
    setRevokingId(membershipId)
    try {
      await lpPortalApi.revokeColleague(membershipId)
      toast.success("Access revoked.")
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to revoke colleague"))
    } finally {
      setRevokingId(null)
    }
  }

  const handleBankChangeSubmit = async () => {
    if (!bankChangeForm.fundId || !bankChangeForm.bankName.trim() || !bankChangeForm.accountNumber.trim()) {
      toast.error("Fund, bank name, and account number are required.")
      return
    }
    setBankChangeSubmitting(true)
    try {
      await lpPortalApi.submitBankInstructionChange(
        {
          fundId: bankChangeForm.fundId,
          bankName: bankChangeForm.bankName.trim(),
          accountName: bankChangeForm.accountName.trim() || undefined,
          accountNumber: bankChangeForm.accountNumber.trim(),
        },
        createIdempotencyKey(),
      )
      toast.success("Bank instruction change submitted.")
      setBankChangeOpen(false)
      setBankChangeForm({
        fundId: funds[0]?.id ?? "",
        bankName: "",
        accountName: "",
        accountNumber: "",
      })
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit bank instruction change"))
    } finally {
      setBankChangeSubmitting(false)
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">My Organisation</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
            Manage users, roles, fund entitlements, and bank instruction changes.
          </p>
        </div>
        <Button
          type="button"
          disabled={!canManage}
          className="h-10 rounded-full bg-[#2563eb] px-5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-50"
          onClick={() => setInviteOpen(true)}
        >
          <UserPlus className="size-3.5" />
          Invite User
        </Button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      {!canManage && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Colleague management requires Manager role.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Organisation",
            value: org?.legalName ?? "—",
            helper: org?.investorId ? `Investor ${org.investorId}` : "Investor entity",
            icon: <Building2 className="size-4" />,
            bg: "bg-[#dbeafe]",
            color: "text-[#2563eb]",
          },
          {
            label: "Authorised Users",
            value: loading ? "…" : String(colleagues.length),
            helper: `${activeCount} active · ${invitedCount} invited`,
            icon: <UserPlus className="size-4" />,
            bg: "bg-[#ede9fe]",
            color: "text-[#7c3aed]",
          },
          {
            label: "Fund Entitlements",
            value: loading ? "…" : String(Math.max(fundEntitlements, funds.length)),
            helper: "Across private capital & open-ended",
            icon: <CheckCircle2 className="size-4" />,
            bg: "bg-[#dcfce7]",
            color: "text-[#16a34a]",
          },
          {
            label: "MFA Coverage",
            value: loading ? "…" : colleagues.length ? `${mfaCount}/${colleagues.length}` : "—",
            helper: colleagues.length ? `${Math.round((mfaCount / colleagues.length) * 100)}% enabled` : "No users yet",
            icon: <ShieldCheck className="size-4" />,
            bg: "bg-[#ffedd5]",
            color: "text-[#ea580c]",
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
            <p className="mt-1 text-[18px] font-bold tracking-tight text-[#0f172a]">{card.value}</p>
            <p className="mt-1 text-[12px] text-[#9ca3af]">{card.helper}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#f1f5f9] px-4 py-3">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 w-[150px] rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="Investor Admin">Investor Admin</SelectItem>
                <SelectItem value="Viewer">Viewer</SelectItem>
                <SelectItem value="Signatory">Signatory</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users..."
                className="h-9 rounded-full border-[#e5e7eb] pl-9 text-[12px] shadow-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-[#6b7280]">
              <Loader2 className="size-4 animate-spin" />
              Loading colleagues…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                    <th className="px-4 py-2.5">User</th>
                    <th className="px-3 py-2.5">Role</th>
                    <th className="px-3 py-2.5">Funds</th>
                    <th className="px-3 py-2.5">MFA</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Last Active</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const active = selected?.id === user.id
                    return (
                      <tr
                        key={user.id}
                        onClick={() => setSelectedId(user.id)}
                        className={cn(
                          "cursor-pointer border-b border-[#f3f4f6] last:border-0",
                          active
                            ? "bg-[#eff6ff] shadow-[inset_3px_0_0_0_#2563eb]"
                            : "hover:bg-[#f9fafb]",
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-[#2563eb] text-[11px] font-semibold text-white">
                                {user.name
                                  .split(" ")
                                  .map((p) => p[0])
                                  .join("")
                                  .slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-[#111827]">{user.name}</p>
                              <p className="text-[11px] text-[#9ca3af]">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              ROLE_STYLE[user.role],
                            )}
                          >
                            {user.role}
                          </span>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-[#374151]">{user.funds}</td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              user.mfa ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#f3f4f6] text-[#6b7280]",
                            )}
                          >
                            {user.mfa ? "Enabled" : "Off"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                              USER_STATUS[user.status],
                            )}
                          >
                            {user.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">{user.lastActive}</td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                disabled={!canManage}
                                className="rounded-full p-1.5 text-[#6b7280] hover:bg-[#f3f4f6] disabled:opacity-40"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Actions for ${user.name}`}
                              >
                                <MoreHorizontal className="size-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl">
                              <DropdownMenuItem
                                disabled={!canManage || revokingId === user.id}
                                className="text-red-600 focus:text-red-600"
                                onClick={() => void handleRevoke(user.id)}
                              >
                                {revokingId === user.id ? "Revoking…" : "Revoke access"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                        No colleagues match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selected && (
          <aside className="space-y-4">
            <section className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <h2 className="text-[14px] font-semibold text-[#111827]">User Details</h2>
              <dl className="mt-3 space-y-2.5 text-[12px]">
                {[
                  ["Name", selected.name],
                  ["Email", selected.email],
                  ["Role", selected.role],
                  ["Funds", String(selected.funds)],
                  ["MFA", selected.mfa ? "Enabled" : "Off"],
                  ["Status", selected.status],
                  ["Last Active", selected.lastActive],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[90px_1fr] gap-2">
                    <dt className="text-[#9ca3af]">{label}</dt>
                    <dd className="font-medium text-[#111827]">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[11px] leading-4 text-[#1d4ed8]">
                Fund access must remain a subset of organisation entitlements.
              </p>
            </section>
          </aside>
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f5f9] px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[#111827]">Bank Instruction Changes</h2>
            <p className="mt-0.5 text-[12px] text-[#6b7280]">
              Changes never activate immediately — MFA and verification are required.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!canManage}
            className="h-9 rounded-full border-[#e5e7eb] px-4 text-[12px] font-medium shadow-none"
            onClick={() => setBankChangeOpen(true)}
          >
            <Plus className="size-3.5" />
            Request Change
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                <th className="px-4 py-2.5">Fund</th>
                <th className="px-3 py-2.5">Account</th>
                <th className="px-3 py-2.5">Requested By</th>
                <th className="px-3 py-2.5">Submitted</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {bankChanges.map((row) => (
                <tr key={row.id} className="border-b border-[#f3f4f6] last:border-0">
                  <td className="px-4 py-3 font-medium text-[#111827]">{row.fund}</td>
                  <td className="px-3 py-3 font-mono text-[11px] text-[#4b5563]">{row.maskedAccount}</td>
                  <td className="px-3 py-3 text-[#4b5563]">{row.requestedBy}</td>
                  <td className="px-3 py-3 text-[#4b5563]">{row.submittedAt}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                        BANK_STATUS[row.status],
                      )}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {bankChanges.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                    No bank instruction changes on record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={bankChangeOpen} onOpenChange={setBankChangeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Bank Instruction Change</DialogTitle>
            <DialogDescription>
              Submit a new bank account for verification. Changes require MFA and will not activate immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">Fund</label>
              <Select
                value={bankChangeForm.fundId}
                onValueChange={(v) => setBankChangeForm((f) => ({ ...f, fundId: v }))}
                disabled={bankChangeSubmitting}
              >
                <SelectTrigger className="h-9 rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                  <SelectValue placeholder="Select fund" />
                </SelectTrigger>
                <SelectContent>
                  {funds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Bank name"
              value={bankChangeForm.bankName}
              onChange={(e) => setBankChangeForm((f) => ({ ...f, bankName: e.target.value }))}
              disabled={bankChangeSubmitting}
            />
            <Input
              placeholder="Account name (optional)"
              value={bankChangeForm.accountName}
              onChange={(e) => setBankChangeForm((f) => ({ ...f, accountName: e.target.value }))}
              disabled={bankChangeSubmitting}
            />
            <Input
              placeholder="Account number"
              value={bankChangeForm.accountNumber}
              onChange={(e) => setBankChangeForm((f) => ({ ...f, accountNumber: e.target.value }))}
              disabled={bankChangeSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setBankChangeOpen(false)}
              disabled={bankChangeSubmitting}
            >
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void handleBankChangeSubmit()} disabled={bankChangeSubmitting}>
              {bankChangeSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>
              Grant another team member access to this organisation. They must already have an Matanho account.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="email"
            placeholder="colleague@company.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            disabled={inviting}
          />
          <DialogFooter>
            <Button variant="outline" className="rounded-full" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={() => void handleInvite()} disabled={inviting}>
              {inviting ? <Loader2 className="size-4 animate-spin" /> : null}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
