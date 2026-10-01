"use client"

import * as React from "react"
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  History,
  Lock,
  Maximize2,
  Minus,
  MoreHorizontal,
  PenLine,
  Plus,
  Scan,
  Search,
  Shield,
  Sparkles,
  User,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { InfoHint } from "@/components/lp-portal/info-hint"
import { cn } from "@/lib/utils"
import { useLpPortal } from "@/components/lp-portal/lp-portal-context"
import { lpPortalApi, type LpDocument } from "@/lib/api/lp-portal-api"
import { downloadBlob, formatDate } from "@/lib/lp-portal/format"
import { useLpDocuments } from "@/lib/lp-portal/hooks"
import { API_DOC_CATEGORY, mapDocumentCategory } from "@/lib/lp-portal/mappers"
import { getApiErrorMessage } from "@/lib/lp-portal/use-lp-api"

type DocCategory =
  | "Statements"
  | "Capital Calls"
  | "Distributions"
  | "Fund Reports"
  | "Tax"
  | "Legal"
  | "Governance"
  | "Subscription Documents"
  | "Notices"
  | "Other"

type DocStatus = "New" | "Requires Signature" | "Published" | "Active" | "Paid"
type FileKind = "pdf" | "xlsx" | "docx"

type DocRow = {
  id: string
  title: string
  fileName: string
  fund: string
  category: DocCategory
  period: string
  publishedDate: string
  publishedAt: string
  version: string
  accessScope: "Investors" | "Advisory Board" | "Authorised Signatories"
  status: DocStatus
  fileKind: FileKind
  fileSize: string
  pages: number
  checksum: string
  documentType: string
  permissions: string[]
  history: Array<{ user: string; at: string; ip: string; action?: string }>
}

const PAGE_SIZE = 10

const CATEGORY_TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All Documents" },
  { id: "Statements", label: "Statements" },
  { id: "Capital Calls", label: "Capital Calls" },
  { id: "Distributions", label: "Distributions" },
  { id: "Fund Reports", label: "Fund Reports" },
  { id: "Tax", label: "Tax" },
  { id: "Legal", label: "Legal" },
  { id: "Governance", label: "Governance" },
]

const MORE_CATEGORIES: DocCategory[] = ["Subscription Documents", "Notices", "Other"]

const CATEGORY_STYLE: Record<DocCategory, string> = {
  Statements: "bg-[#dbeafe] text-[#1d4ed8]",
  "Capital Calls": "bg-[#ffedd5] text-[#c2410c]",
  Distributions: "bg-[#ccfbf1] text-[#0f766e]",
  "Fund Reports": "bg-[#dbeafe] text-[#2563eb]",
  Tax: "bg-[#fef9c3] text-[#a16207]",
  Legal: "bg-[#ede9fe] text-[#6d28d9]",
  Governance: "bg-[#ede9fe] text-[#7c3aed]",
  "Subscription Documents": "bg-[#ccfbf1] text-[#0d9488]",
  Notices: "bg-[#dcfce7] text-[#15803d]",
  Other: "bg-[#f3f4f6] text-[#4b5563]",
}

const STATUS_STYLE: Record<DocStatus, string> = {
  New: "bg-[#dbeafe] text-[#1d4ed8]",
  "Requires Signature": "border border-[#fdba74] bg-[#fff7ed] text-[#c2410c]",
  Published: "border border-[#86efac] bg-[#f0fdf4] text-[#15803d]",
  Active: "bg-[#dbeafe] text-[#2563eb]",
  Paid: "bg-[#dcfce7] text-[#15803d]",
}

function InfoHintLoose({ label }: { label: string }) {
  const descriptions: Record<string, string> = {
    "Document Centre": "Secure repository for fund documents and communications.",
  }
  return <InfoHint label={label} description={descriptions[label] ?? label} />
}

function FileIcon({ kind }: { kind: FileKind }) {
  if (kind === "xlsx") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#dcfce7] text-[#16a34a]">
        <FileSpreadsheet className="size-4" />
      </span>
    )
  }
  if (kind === "docx") {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#dbeafe] text-[#2563eb]">
        <FileText className="size-4" />
      </span>
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#fee2e2] text-[#dc2626]">
      <FileText className="size-4" />
    </span>
  )
}

function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        STATUS_STYLE[status],
      )}
    >
      {status}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const style =
    CATEGORY_STYLE[category as DocCategory] ?? "bg-[#f3f4f6] text-[#4b5563]"
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        style,
      )}
    >
      {category}
    </span>
  )
}

function StatusBadgeLoose({ status }: { status: string }) {
  const style = STATUS_STYLE[status as DocStatus] ?? "bg-[#f3f4f6] text-[#4b5563]"
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        style,
      )}
    >
      {status}
    </span>
  )
}

async function handleDownload(doc: Pick<DocRow, "id" | "fileName" | "title">) {
  try {
    const blob = await lpPortalApi.downloadDocument(doc.id)
    downloadBlob(blob, doc.fileName || `${doc.title}.pdf`)
    toast.success("Document downloaded.")
  } catch (err) {
    toast.error(getApiErrorMessage(err, "Download failed"))
  }
}

export function LpDocumentCentreScreen({
  initialCategory = "All Documents",
  initialDocumentId,
}: {
  initialCategory?: string
  initialDocumentId?: string
}) {
  const { funds } = useLpPortal()
  const resolvedTab =
    CATEGORY_TABS.find((t) => t.label === initialCategory || t.id === initialCategory)?.id ??
    (MORE_CATEGORIES.includes(initialCategory as DocCategory) ? "more" : "all")

  const [tab, setTab] = React.useState(resolvedTab)
  const [moreCategory, setMoreCategory] = React.useState<DocCategory | null>(
    MORE_CATEGORIES.includes(initialCategory as DocCategory) ? (initialCategory as DocCategory) : null,
  )
  const [query, setQuery] = React.useState("")
  const [debouncedQuery, setDebouncedQuery] = React.useState("")
  const [sort, setSort] = React.useState("recent")
  const [page, setPage] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<string | null>(initialDocumentId ?? null)
  const [detailTab, setDetailTab] = React.useState<"details" | "permissions">("details")
  const [previewPage, setPreviewPage] = React.useState(1)
  const [zoom, setZoom] = React.useState(100)
  const [detailDoc, setDetailDoc] = React.useState<LpDocument | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [fullscreenPreviewOpen, setFullscreenPreviewOpen] = React.useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false)

  React.useEffect(() => {
    if (initialDocumentId) setSelectedId(initialDocumentId)
  }, [initialDocumentId])

  React.useEffect(() => {
    setTab(resolvedTab)
  }, [resolvedTab])

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const apiCategory = React.useMemo(() => {
    if (tab === "all") return undefined
    if (tab === "more") return moreCategory ? API_DOC_CATEGORY[moreCategory] : undefined
    return API_DOC_CATEGORY[tab]
  }, [moreCategory, tab])

  const { data, loading, error, reload } = useLpDocuments({
    category: apiCategory,
    q: debouncedQuery || undefined,
    page,
  })

  const pageRows = data?.items ?? []
  const docSummary = data?.summary
  const totalPages = data?.totalPages ?? 1
  const totalDocs = docSummary?.total ?? data?.total ?? 0
  const safePage = Math.min(page, Math.max(1, totalPages))
  const start = (safePage - 1) * PAGE_SIZE
  const selected = pageRows.find((d) => d.id === selectedId) ?? null

  const categoryCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of docSummary?.byCategory ?? []) {
      counts.set(mapDocumentCategory(row.category), row.count)
    }
    return counts
  }, [docSummary?.byCategory])

  const tabCount = React.useCallback(
    (tabId: string) => {
      if (tabId === "all") return totalDocs
      if (tabId === "more" && moreCategory) return categoryCounts.get(moreCategory) ?? 0
      return categoryCounts.get(tabId) ?? 0
    },
    [categoryCounts, moreCategory, totalDocs],
  )

  const sortedRows = React.useMemo(() => {
    const rows = [...pageRows]
    if (sort === "name") rows.sort((a, b) => a.title.localeCompare(b.title))
    if (sort === "fund") rows.sort((a, b) => a.fund.localeCompare(b.fund))
    return rows
  }, [pageRows, sort])

  React.useEffect(() => {
    if (safePage !== page) setPage(safePage)
  }, [page, safePage])

  React.useEffect(() => {
    if (selectedId && !pageRows.some((d) => d.id === selectedId)) {
      setSelectedId(pageRows[0]?.id ?? null)
    }
  }, [pageRows, selectedId])

  React.useEffect(() => {
    if (!selectedId && pageRows[0]) setSelectedId(pageRows[0].id)
  }, [pageRows, selectedId])

  React.useEffect(() => {
    setPreviewPage(1)
    setZoom(100)
    setDetailTab("details")
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (!selectedId) {
      setDetailDoc(null)
      return
    }
    setDetailLoading(true)
    lpPortalApi
      .getDocument(selectedId)
      .then((res) => setDetailDoc(res.data))
      .catch((err) => {
        setDetailDoc(null)
        toast.error(getApiErrorMessage(err, "Could not load document detail"))
      })
      .finally(() => setDetailLoading(false))

    void lpPortalApi
      .previewDocument(selectedId)
      .then((blob) => {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(blob)
        })
      })
      .catch((err) => {
        const status = err && typeof err === "object" && "status" in err ? (err as { status: number }).status : undefined
        if (status === 415) {
          toast.error("Preview is not available for this file type.")
          return
        }
        toast.error(getApiErrorMessage(err, "Preview unavailable for this document"))
      })
  }, [selectedId])

  React.useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  const selectedDetail = selected
    ? {
        ...selected,
        checksum: detailDoc?.checksumSha256 ?? selected.checksum,
        history: detailDoc?.history?.map((h) => ({
          user: h.user,
          at: formatDate(h.at, "datetime"),
          ip: h.ip,
          action: h.action,
        })) ?? selected.history,
        permissions: detailDoc?.permissions ?? selected.permissions,
        publishedAt: detailDoc?.publishedDate ?? selected.publishedAt,
      }
    : null

  const kpiCards = [
    {
      label: "Total Documents",
      value: String(docSummary?.total ?? totalDocs),
      helper: `Across ${funds.length} fund${funds.length === 1 ? "" : "s"}`,
      iconBg: "bg-[#dbeafe]",
      iconColor: "text-[#2563eb]",
      icon: <FileText className="size-4" strokeWidth={2.25} />,
    },
    {
      label: "New This Week",
      value: String(docSummary?.newThisWeek ?? 0),
      helper: "Published in the last 7 days",
      iconBg: "bg-[#dcfce7]",
      iconColor: "text-[#16a34a]",
      icon: <Sparkles className="size-4" strokeWidth={2.25} />,
    },
    {
      label: "Requires Signature",
      value: String(docSummary?.requiresSignature ?? 0),
      helper: "Awaiting your signature",
      iconBg: "bg-[#ffedd5]",
      iconColor: "text-[#ea580c]",
      icon: <PenLine className="size-4" strokeWidth={2.25} />,
    },
    {
      label: "Secure Downloads YTD",
      value: String(docSummary?.secureDownloadsYtd ?? 0),
      helper: "Verified downloads this year",
      iconBg: "bg-[#ede9fe]",
      iconColor: "text-[#7c3aed]",
      icon: <Shield className="size-4" strokeWidth={2.25} />,
    },
  ]

  const pageNumbers = React.useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (safePage <= 3) return [1, 2, 3, 4, 5]
    if (safePage >= totalPages - 2) {
      return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    }
    return [safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2]
  }, [safePage, totalPages])

  return (
    <div className="space-y-5 pb-8">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Document Centre</h1>
          <InfoHintLoose label="Document Centre" />
        </div>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          Secure repository for all fund documents and communications.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] p-4 text-center">
          <p className="text-[13px] text-[#dc2626]">{error}</p>
          <button
            type="button"
            className="mt-3 rounded-full bg-[#2563eb] px-4 py-2 text-[12px] font-medium text-white"
            onClick={() => void reload()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Category tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e7eb] pb-0">
        {CATEGORY_TABS.map((item) => {
          const active = tab === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id)
                setPage(1)
              }}
              className={cn(
                "relative -mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 text-[13px] font-medium transition",
                active
                  ? "border-[#2563eb] text-[#2563eb]"
                  : "border-transparent text-[#6b7280] hover:text-[#111827]",
              )}
            >
              {item.label}
              {tabCount(item.id) > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    active ? "bg-[#dbeafe] text-[#1d4ed8]" : "bg-[#f3f4f6] text-[#6b7280]",
                  )}
                >
                  {tabCount(item.id)}
                </span>
              ) : null}
            </button>
          )
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "relative -mb-px inline-flex items-center gap-1 border-b-2 px-1 pb-2.5 text-[13px] font-medium",
                tab === "more"
                  ? "border-[#2563eb] text-[#2563eb]"
                  : "border-transparent text-[#6b7280] hover:text-[#111827]",
              )}
            >
              More <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="rounded-xl">
            {MORE_CATEGORIES.map((cat) => (
              <DropdownMenuItem
                key={cat}
                onClick={() => {
                  setTab("more")
                  setMoreCategory(cat)
                  setPage(1)
                }}
              >
                {cat}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full",
                  kpi.iconBg,
                  kpi.iconColor,
                )}
              >
                {kpi.icon}
              </span>
              <InfoHint label={kpi.label} />
            </div>
            <p className="mt-3 text-[12px] font-medium text-[#6b7280]">{kpi.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums tracking-[-0.03em] text-[#0f172a]">
              {kpi.value}
            </p>
            <p className="mt-1 text-[12px] text-[#9ca3af]">{kpi.helper}</p>
          </div>
        ))}
      </div>

      {/* Table + detail */}
      <div
        className={cn(
          "grid items-start gap-4",
          selectedDetail ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1",
        )}
      >
        <section className="min-w-0 overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f5f9] px-4 py-3">
            <div className="relative w-full max-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder="Search documents..."
                className="h-9 rounded-lg border-[#e5e7eb] bg-white pl-9 text-[12px] shadow-none"
              />
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#6b7280]">
              <span>Sort by:</span>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-9 w-[140px] rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most Recent</SelectItem>
                  <SelectItem value="name">Document Name</SelectItem>
                  <SelectItem value="fund">Fund</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                  <th className="px-4 py-2.5">Document Name</th>
                  <th className="px-3 py-2.5">Fund</th>
                  <th className="px-3 py-2.5">Category</th>
                  <th className="px-3 py-2.5">Period</th>
                  <th className="whitespace-nowrap px-3 py-2.5">Published Date ↓</th>
                  <th className="px-3 py-2.5">Version</th>
                  <th className="px-3 py-2.5">Access Scope</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                      Loading documents…
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((doc) => {
                  const isSelected = selectedDetail?.id === doc.id
                  return (
                    <tr
                      key={doc.id}
                      onClick={() => setSelectedId(doc.id)}
                      className={cn(
                        "cursor-pointer border-b border-[#f3f4f6] transition last:border-0",
                        isSelected
                          ? "bg-[#eff6ff] shadow-[inset_3px_0_0_0_#2563eb]"
                          : "hover:bg-[#f9fafb]",
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <FileIcon kind={doc.fileKind} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-[#111827]">{doc.title}</p>
                            <p className="truncate text-[11px] text-[#9ca3af]">{doc.fileName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-3 text-[#4b5563]">{doc.fund}</td>
                      <td className="px-3 py-3">
                        <CategoryBadge category={doc.category} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">{doc.period}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">{doc.publishedDate}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-[#111827]">
                        {doc.version}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className="inline-flex items-center gap-1.5 text-[#4b5563]">
                          <User className="size-3.5 text-[#9ca3af]" />
                          {doc.accessScope}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadgeLoose status={doc.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-full p-1.5 text-[#2563eb] hover:bg-[#eff6ff]"
                            aria-label={`Download ${doc.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleDownload(doc)
                            }}
                          >
                            <Download className="size-3.5" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="rounded-full p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]"
                                aria-label={`More actions for ${doc.title}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="size-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl">
                              <DropdownMenuItem
                                onClick={() => setSelectedId(doc.id)}
                              >
                                Open preview
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleDownload(doc)}>
                                Download
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDetailTab("permissions")}>
                                View permissions
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  )
                  })
                )}
                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-[#9ca3af]">
                      No documents match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f5f9] px-4 py-3">
            <p className="text-[12px] text-[#6b7280]">
              Showing{" "}
              <span className="font-medium text-[#111827]">
                {totalDocs === 0 ? 0 : start + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-[#111827]">
                {Math.min(start + sortedRows.length, totalDocs)}
              </span>{" "}
              of <span className="font-medium text-[#111827]">{totalDocs}</span> documents
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                className="flex size-8 items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] disabled:opacity-40"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </button>
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-[12px] font-medium",
                    n === safePage
                      ? "bg-[#2563eb] text-white"
                      : "border border-[#e5e7eb] text-[#374151] hover:bg-[#f9fafb]",
                  )}
                >
                  {n}
                </button>
              ))}
              {totalPages > 5 && safePage < totalPages - 2 && (
                <>
                  <span className="px-1 text-[#9ca3af]">…</span>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-[#e5e7eb] px-2 text-[12px] font-medium text-[#374151] hover:bg-[#f9fafb]"
                  >
                    {totalPages}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={safePage >= totalPages}
                className="flex size-8 items-center justify-center rounded-lg border border-[#e5e7eb] text-[#6b7280] disabled:opacity-40"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </section>

        {selectedDetail && (
          <aside className="sticky top-4 flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto">
            {/* Card 1 — document preview + details */}
            <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-[#111827]">{selectedDetail.title}</h2>
                      <StatusBadgeLoose status={selectedDetail.status} />
                    </div>
                    <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px] text-[#6b7280]">
                      <FolderOpen className="size-3.5 shrink-0 text-[#2563eb]" />
                      <span className="truncate">
                        {selectedDetail.fund} · {selectedDetail.category}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-full p-1 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#4b5563]"
                    onClick={() => setSelectedId(null)}
                    aria-label="Close details"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 px-4 pb-4">
                {/* Preview */}
                <div className="overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#f3f4f6]">
                  <div className="flex items-center justify-between border-b border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-[#6b7280]">
                      <FileText className="size-3.5" />
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-[#e5e7eb] disabled:opacity-40"
                        disabled={previewPage <= 1}
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                        aria-label="Previous preview page"
                      >
                        <ChevronLeft className="size-3.5" />
                      </button>
                      <span>
                        {previewPage} / {selectedDetail.pages}
                      </span>
                      <button
                        type="button"
                        className="rounded p-0.5 hover:bg-[#e5e7eb] disabled:opacity-40"
                        disabled={previewPage >= selectedDetail.pages}
                        onClick={() => setPreviewPage((p) => Math.min(selectedDetail.pages, p + 1))}
                        aria-label="Next preview page"
                      >
                        <ChevronRight className="size-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-0.5 text-[#6b7280]">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-[#e5e7eb]"
                        onClick={() => setZoom((z) => Math.max(60, z - 10))}
                        aria-label="Zoom out"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="min-w-[36px] text-center text-[10px] tabular-nums">{zoom}%</span>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-[#e5e7eb]"
                        onClick={() => setZoom((z) => Math.min(160, z + 10))}
                        aria-label="Zoom in"
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-[#e5e7eb]"
                        onClick={() => setZoom(100)}
                        aria-label="Fit to screen"
                      >
                        <Scan className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-[#e5e7eb]"
                        onClick={() => {
                          if (!previewUrl) {
                            toast.error("Preview is not available for this document.")
                            return
                          }
                          setFullscreenPreviewOpen(true)
                        }}
                        aria-label="Fullscreen"
                      >
                        <Maximize2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex h-[200px] items-center justify-center p-4">
                    {previewUrl ? (
                      <iframe
                        title={`Preview ${selectedDetail.title}`}
                        src={previewUrl}
                        className="h-full w-full rounded-sm border border-[#e5e7eb] bg-white"
                        style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
                      />
                    ) : (
                    <div
                      className="flex h-full w-[78%] origin-center flex-col items-center justify-center rounded-sm border border-[#e5e7eb] bg-white px-4 py-5 text-center shadow-sm"
                      style={{ transform: `scale(${zoom / 100})` }}
                    >
                      <p className="text-[10px] font-semibold leading-snug text-[#111827]">
                        {selectedDetail.title}
                      </p>
                      <p className="mt-3 text-[9px] text-[#6b7280]">{selectedDetail.publishedDate}</p>
                      {detailLoading ? (
                        <p className="mt-2 text-[9px] text-[#9ca3af]">Loading detail…</p>
                      ) : null}
                    </div>
                    )}
                  </div>
                </div>

                {/* Details / Permissions tabs */}
                <div className="flex gap-5 border-b border-[#e5e7eb]">
                  {(
                    [
                      ["details", "Details"],
                      ["permissions", "Permissions"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id)}
                      className={cn(
                        "-mb-px border-b-2 pb-2 text-[13px] font-semibold",
                        detailTab === id
                          ? "border-[#2563eb] text-[#2563eb]"
                          : "border-transparent text-[#6b7280]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === "details" ? (
                  <div className="space-y-3.5">
                    {[
                      {
                        icon: <FileText className="size-3.5" />,
                        label: "Document Type",
                        value: selectedDetail.documentType === "PDF" ? "PDF Document" : selectedDetail.documentType,
                      },
                      {
                        icon: <CalendarDays className="size-3.5" />,
                        label: "Published Date",
                        value: selectedDetail.publishedAt,
                      },
                      {
                        icon: <History className="size-3.5" />,
                        label: "Version",
                        value: selectedDetail.version,
                      },
                      {
                        icon: <FileText className="size-3.5" />,
                        label: "File Size",
                        value: selectedDetail.fileSize,
                      },
                    ].map((row) => (
                      <div key={row.label} className="flex items-start gap-2.5">
                        <span className="mt-0.5 text-[#9ca3af]">{row.icon}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] text-[#9ca3af]">{row.label}</p>
                          <p className="mt-0.5 text-[12px] font-medium text-[#111827]">{row.value}</p>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 text-[#9ca3af]">
                        <Shield className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-[#9ca3af]">Checksum (SHA-256)</p>
                        <div className="mt-0.5 flex items-start gap-1.5">
                          <p className="break-all font-mono text-[10px] font-medium leading-4 text-[#111827]">
                            {selectedDetail.checksum}
                          </p>
                          <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-[#2563eb] hover:bg-[#eff6ff]"
                            aria-label="Copy checksum"
                            onClick={() => {
                              void navigator.clipboard.writeText(selectedDetail.checksum)
                              toast.success("Checksum copied")
                            }}
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {selectedDetail.permissions.map((item) => (
                      <li
                        key={item}
                        className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[12px] text-[#374151]"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Card 2 — download history */}
            <div className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-[#111827]">Download History</h3>
                <button
                  type="button"
                  className="text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8] disabled:text-[#9ca3af]"
                  disabled={!selectedDetail.history.length}
                  onClick={() => setHistoryDialogOpen(true)}
                >
                  View All
                </button>
              </div>
              {selectedDetail.history.length === 0 ? (
                <p className="mt-3 text-[12px] text-[#9ca3af]">No downloads recorded yet.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {selectedDetail.history.slice(0, 3).map((entry, idx) => (
                    <li key={`${entry.user}-${entry.at}-${idx}`} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#9ca3af]">
                        <User className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-[#111827]">{entry.user}</p>
                            <p className="mt-0.5 text-[11px] text-[#6b7280]">{entry.at}</p>
                          </div>
                          <p className="shrink-0 text-[11px] text-[#9ca3af]">IP: {entry.ip}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                  {selectedDetail.history.length > 3 ? (
                    <li>
                      <button
                        type="button"
                        className="text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8]"
                        onClick={() => setHistoryDialogOpen(true)}
                      >
                        +{selectedDetail.history.length - 3} more downloads
                      </button>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={fullscreenPreviewOpen} onOpenChange={setFullscreenPreviewOpen}>
        <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col gap-0 overflow-hidden rounded-xl p-0">
          <DialogHeader className="shrink-0 border-b border-[#e5e7eb] px-4 py-3">
            <DialogTitle className="text-[14px]">{selectedDetail?.title ?? "Document preview"}</DialogTitle>
            <DialogDescription className="sr-only">Fullscreen document preview</DialogDescription>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[11px] text-[#6b7280] hover:bg-[#f3f4f6]"
                onClick={() => setZoom((z) => Math.max(60, z - 10))}
              >
                Zoom out
              </button>
              <span className="text-[11px] tabular-nums text-[#6b7280]">{zoom}%</span>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[11px] text-[#6b7280] hover:bg-[#f3f4f6]"
                onClick={() => setZoom((z) => Math.min(200, z + 10))}
              >
                Zoom in
              </button>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-[11px] text-[#6b7280] hover:bg-[#f3f4f6]"
                onClick={() => setZoom(100)}
              >
                Reset
              </button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-[#f8fafc] p-4">
            {previewUrl ? (
              <iframe
                title={`Fullscreen preview ${selectedDetail?.title ?? ""}`}
                src={previewUrl}
                className="h-full w-full rounded-lg border border-[#e5e7eb] bg-white"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-[#6b7280]">
                Preview unavailable
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden rounded-xl">
          <DialogHeader>
            <DialogTitle>Download history</DialogTitle>
            <DialogDescription>
              {selectedDetail?.title ?? "Document"} — {selectedDetail?.history.length ?? 0} recorded
              download{selectedDetail?.history.length === 1 ? "" : "s"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {selectedDetail?.history.length ? (
              <ul className="space-y-3">
                {selectedDetail.history.map((entry, idx) => (
                  <li
                    key={`${entry.user}-${entry.at}-${idx}`}
                    className="flex items-start gap-2.5 rounded-lg border border-[#e5e7eb] bg-[#f9fafb] p-3"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-[#9ca3af]">
                      <User className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-[#111827]">{entry.user}</p>
                          {entry.action ? (
                            <p className="mt-0.5 text-[11px] font-medium text-[#2563eb]">{entry.action}</p>
                          ) : null}
                          <p className="mt-0.5 text-[11px] text-[#6b7280]">{entry.at}</p>
                        </div>
                        <p className="shrink-0 text-[11px] text-[#9ca3af]">IP: {entry.ip}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[13px] text-[#9ca3af]">No downloads recorded yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
