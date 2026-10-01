"use client"

import * as React from "react"
import Link from "next/link"
import {
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Loader2,
  Search,
} from "lucide-react"
import { toast } from "sonner"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InfoHint } from "@/components/lp-portal/info-hint"
import { lpPortalApi } from "@/lib/api/lp-portal-api"
import { createIdempotencyKey } from "@/lib/lp-portal/format"
import { useLpNotices } from "@/lib/lp-portal/hooks"
import { mapNoticeRow } from "@/lib/lp-portal/mappers"
import { subscribeLpRealtime } from "@/lib/lp-portal/realtime"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type NoticeStatus = "Unread" | "Opened" | "Acknowledged"

type Notice = ReturnType<typeof mapNoticeRow>

const KIND_STYLE: Record<string, string> = {
  "Report Available": "bg-[#dbeafe] text-[#1d4ed8]",
  "AGM Notice": "bg-[#ede9fe] text-[#6d28d9]",
  "Valuation Update": "bg-[#ccfbf1] text-[#0f766e]",
  "Capital Call": "bg-[#ffedd5] text-[#c2410c]",
  Distribution: "bg-[#dcfce7] text-[#15803d]",
  "Policy Update": "bg-[#f3f4f6] text-[#4b5563]",
}

function getKindStyle(kind: string): string {
  return KIND_STYLE[kind] ?? "bg-[#f3f4f6] text-[#4b5563]"
}

const STATUS_STYLE: Record<NoticeStatus, string> = {
  Unread: "bg-[#dbeafe] text-[#1d4ed8]",
  Opened: "bg-[#fef9c3] text-[#a16207]",
  Acknowledged: "bg-[#dcfce7] text-[#15803d]",
}

export function LpNoticesScreen({ initialNoticeId }: { initialNoticeId?: string } = {}) {
  const { data, loading, error, reload } = useLpNotices()
  const notices = data ?? []
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [kindFilter, setKindFilter] = React.useState("all")
  const [fundFilter, setFundFilter] = React.useState("all")
  const [ackOnly, setAckOnly] = React.useState(false)
  const [publishedFrom, setPublishedFrom] = React.useState("")
  const [publishedTo, setPublishedTo] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(initialNoticeId ?? null)
  const [detail, setDetail] = React.useState<Notice | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [acknowledging, setAcknowledging] = React.useState(false)

  React.useEffect(() => {
    if (initialNoticeId) setSelectedId(initialNoticeId)
    else if (notices.length && !selectedId) setSelectedId(notices[0].id)
  }, [notices, selectedId, initialNoticeId])

  const advancedFilterCount = [
    fundFilter !== "all",
    ackOnly,
    publishedFrom.length > 0,
    publishedTo.length > 0,
  ].filter(Boolean).length

  React.useEffect(() => {
    const unsub = subscribeLpRealtime("lp_notice_updated", () => {
      void reload()
    })
    return unsub
  }, [reload])

  React.useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    void lpPortalApi
      .getNotice(selectedId)
      .then((res) => {
        if (!cancelled) setDetail(mapNoticeRow(res.data))
      })
      .catch((err) => {
        if (!cancelled) toast.error(getApiErrorMessage(err, "Failed to load notice"))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const filtered = React.useMemo(() => {
    return notices.filter((n) => {
      if (statusFilter !== "all" && n.status !== statusFilter) return false
      if (kindFilter !== "all" && n.kind !== kindFilter) return false
      if (fundFilter !== "all" && n.fund !== fundFilter) return false
      if (ackOnly && (!n.requiresAck || n.status === "Acknowledged")) return false
      if (publishedFrom && n.publishedAtRaw && n.publishedAtRaw.slice(0, 10) < publishedFrom) return false
      if (publishedTo && n.publishedAtRaw && n.publishedAtRaw.slice(0, 10) > publishedTo) return false
      if (query.trim()) {
        const q = query.toLowerCase()
        if (!`${n.title} ${n.summary} ${n.fund}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [ackOnly, fundFilter, kindFilter, notices, publishedFrom, publishedTo, query, statusFilter])

  const fundOptions = React.useMemo(
    () => Array.from(new Set(notices.map((n) => n.fund))).sort(),
    [notices],
  )

  const selected = detail ?? filtered.find((n) => n.id === selectedId) ?? filtered[0] ?? null

  React.useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  const acknowledge = async (id: string) => {
    setAcknowledging(true)
    try {
      await lpPortalApi.acknowledgeNotice(id, createIdempotencyKey())
      toast.success("Notice acknowledged.")
      await reload()
      const res = await lpPortalApi.getNotice(id)
      setDetail(mapNoticeRow(res.data))
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to acknowledge notice"))
    } finally {
      setAcknowledging(false)
    }
  }

  const kindOptions = React.useMemo(
    () => Array.from(new Set(notices.map((n) => n.kind))).sort(),
    [notices],
  )

  const counts = {
    total: notices.length,
    unread: notices.filter((n) => n.status === "Unread").length,
    ackRequired: notices.filter((n) => n.requiresAck && n.status !== "Acknowledged").length,
    acknowledged: notices.filter((n) => n.status === "Acknowledged").length,
  }

  return (
    <div className="space-y-5 pb-8">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Notices</h1>
          <InfoHint
            label="Notices"
            description="Fund and organisation announcements requiring review or acknowledgement."
          />
        </div>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          Announcements, valuation updates, and actions requiring your attention.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "All Notices", value: counts.total, icon: <Bell className="size-4" />, bg: "bg-[#dbeafe]", color: "text-[#2563eb]" },
          { label: "Unread", value: counts.unread, icon: <Clock3 className="size-4" />, bg: "bg-[#e0f2fe]", color: "text-[#0284c7]" },
          { label: "Ack. Required", value: counts.ackRequired, icon: <FileText className="size-4" />, bg: "bg-[#ffedd5]", color: "text-[#ea580c]" },
          { label: "Acknowledged", value: counts.acknowledged, icon: <CheckCircle2 className="size-4" />, bg: "bg-[#dcfce7]", color: "text-[#16a34a]" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <span className={cn("flex size-8 items-center justify-center rounded-full", card.bg, card.color)}>
              {card.icon}
            </span>
            <p className="mt-3 text-[12px] font-medium text-[#6b7280]">{card.label}</p>
            <p className="mt-1 text-[22px] font-bold tabular-nums text-[#0f172a]">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#f1f5f9] px-4 py-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[130px] rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Unread">Unread</SelectItem>
                <SelectItem value="Opened">Opened</SelectItem>
                <SelectItem value="Acknowledged">Acknowledged</SelectItem>
              </SelectContent>
            </Select>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="h-9 w-[160px] rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {kindOptions.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              className="relative h-9 rounded-full border-[#e5e7eb] px-3 text-[12px] shadow-none"
              onClick={() => setFiltersOpen(true)}
            >
              <Filter className="size-3.5" />
              Filters
              {advancedFilterCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#2563eb] text-[9px] font-bold text-white">
                  {advancedFilterCount}
                </span>
              ) : null}
            </Button>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notices..."
                className="h-9 rounded-full border-[#e5e7eb] pl-9 text-[12px] shadow-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-[#6b7280]">
              <Loader2 className="size-4 animate-spin" />
              Loading notices…
            </div>
          ) : (
            <ul className="divide-y divide-[#f3f4f6]">
              {filtered.map((notice) => {
                const active = selected?.id === notice.id
                return (
                  <li key={notice.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(notice.id)}
                      className={cn(
                        "flex w-full gap-3 px-4 py-3.5 text-left transition",
                        active
                          ? "bg-[#eff6ff] shadow-[inset_3px_0_0_0_#2563eb]"
                          : "hover:bg-[#f9fafb]",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 size-2 shrink-0 rounded-full",
                          notice.status === "Unread" ? "bg-[#2563eb]" : "bg-transparent",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold text-[#111827]">{notice.title}</p>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              getKindStyle(notice.kind),
                            )}
                          >
                            {notice.kind}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-1 text-[12px] text-[#6b7280]">{notice.summary}</p>
                        <p className="mt-1.5 text-[11px] text-[#9ca3af]">
                          {notice.fund} · {notice.publishedAt}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          STATUS_STYLE[notice.status],
                        )}
                      >
                        {notice.status}
                      </span>
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 && (
                <li className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                  No notices match your filters.
                </li>
              )}
            </ul>
          )}
        </section>

        {selected && (
          <aside className="sticky top-4 rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-[#111827]">{selected.title}</h2>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  STATUS_STYLE[selected.status],
                )}
              >
                {selected.status}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-[#6b7280]">
              {selected.fund} · {selected.audience}
            </p>
            <dl className="mt-4 space-y-2.5 text-[12px]">
              {[
                ["Type", selected.kind],
                ["Published", selected.publishedAt],
                ["Requires Ack.", selected.requiresAck ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[110px_1fr] gap-2">
                  <dt className="text-[#9ca3af]">{label}</dt>
                  <dd className="font-medium text-[#111827]">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-[12px] leading-5 text-[#374151]">
              {detailLoading ? "Loading notice…" : selected.body || "No content available."}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {selected.requiresAck && selected.status !== "Acknowledged" && (
                <Button
                  type="button"
                  disabled={acknowledging}
                  className="h-10 rounded-full bg-[#2563eb] text-[13px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
                  onClick={() => void acknowledge(selected.id)}
                >
                  {acknowledging ? <Loader2 className="size-4 animate-spin" /> : null}
                  Acknowledge Notice
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-full border-[#d1d5db] text-[12px] font-medium text-[#2563eb] shadow-none"
                asChild
              >
                <Link href="/lp-portal/documents?category=Notices">Open in Documents</Link>
              </Button>
            </div>
          </aside>
        )}
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>Notice filters</DialogTitle>
            <DialogDescription>Filter by fund, acknowledgement requirement, or publish date.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">Fund</label>
              <Select value={fundFilter} onValueChange={setFundFilter}>
                <SelectTrigger className="h-9 w-full rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
                  <SelectValue placeholder="All funds" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All funds</SelectItem>
                  {fundOptions.map((fund) => (
                    <SelectItem key={fund} value={fund}>
                      {fund}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-[#374151]">
              <input
                type="checkbox"
                checked={ackOnly}
                onChange={(e) => setAckOnly(e.target.checked)}
                className="size-4 rounded border-[#cbd5e1]"
              />
              Acknowledgement required only
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">Published from</label>
                <Input
                  type="date"
                  value={publishedFrom}
                  onChange={(e) => setPublishedFrom(e.target.value)}
                  className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">Published to</label>
                <Input
                  type="date"
                  value={publishedTo}
                  onChange={(e) => setPublishedTo(e.target.value)}
                  className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setFundFilter("all")
                setAckOnly(false)
                setPublishedFrom("")
                setPublishedTo("")
              }}
            >
              Reset
            </Button>
            <Button type="button" className="rounded-full" onClick={() => setFiltersOpen(false)}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
