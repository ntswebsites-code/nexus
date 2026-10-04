"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  UploadCloud,
  UserRound,
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
import { Textarea } from "@/components/ui/textarea"
import { lpPortalApi, type LpMessageThreadDetail, type LpServiceRequestAttachment } from "@/lib/api/lp-portal-api"
import { createIdempotencyKey, formatDate, formatFileSize } from "@/lib/lp-portal/format"
import { useLpOrganisation, useLpRequestsMessages } from "@/lib/lp-portal/hooks"
import { resolveLpLinkedRecordHref, resolveRequestTypeHref } from "@/lib/lp-portal/navigation"
import { mapServiceRequestRow, mapThreadParticipants } from "@/lib/lp-portal/mappers"
import {
  joinLpRequestRoom,
  joinLpThreadRoom,
  leaveLpRequestRoom,
  leaveLpThreadRoom,
  subscribeLpRealtime,
} from "@/lib/lp-portal/realtime"
import { getApiErrorMessage, getApiFieldErrors } from "@/lib/lp-portal/use-lp-api"
import { cn } from "@/lib/utils"

type PortalTab = "requests" | "messages"
type Priority = "High" | "Medium" | "Low"
type Status =
  | "Under Review"
  | "Awaiting Investor"
  | "Assigned"
  | "Submitted"
  | "Resolved"
  | "Closed"

type ServiceRequest = {
  id: string
  reference: string
  type: string
  apiType: string
  fund: string
  fundId: string
  subject: string
  submittedBy: string
  lastUpdated: string
  status: Status
  priority: Priority
  linkedTo: string
  description: string
  attachments: Array<{ id?: string; name: string; size: string; downloadUrl?: string }>
}

type ChatAttachment = { name: string; size: string; downloadUrl?: string }

type ThreadMessage = {
  id: string
  sender: string
  initials: string
  role: "investor" | "team"
  timestamp: string
  body: string
  attachments?: ChatAttachment[]
}

type Conversation = {
  id: string
  requestId: string
  title: string
  fund: string
  fundId: string
  relatedType: string
  relatedId: string
  preview: string
  updated: string
  unread?: number
  linkedLabel: string
  participants: Array<{ name: string; initials: string; color: string }>
  messages: ThreadMessage[]
}

const REQUEST_TYPES = [
  { label: "Account / Statement", apiType: "ACCOUNT_STATEMENT" },
  { label: "Capital Activity", apiType: "CAPITAL_ACTIVITY" },
  { label: "Open-Ended Activity", apiType: "OPEN_ENDED_ACTIVITY" },
  { label: "Profile / Access", apiType: "PROFILE_ACCESS" },
]

const STATUS_STYLE: Record<Status, string> = {
  "Under Review": "bg-[#ffedd5] text-[#c2410c]",
  "Awaiting Investor": "bg-[#ede9fe] text-[#6d28d9]",
  Assigned: "bg-[#dbeafe] text-[#1d4ed8]",
  Submitted: "bg-[#e0f2fe] text-[#0369a1]",
  Resolved: "bg-[#dcfce7] text-[#15803d]",
  Closed: "bg-[#f3f4f6] text-[#4b5563]",
}

const PRIORITY_DOT: Record<Priority, string> = {
  High: "bg-[#ef4444]",
  Medium: "bg-[#f97316]",
  Low: "bg-[#22c55e]",
}

/** "Check the request details: subject At most 200 characters" instead of only the generic summary. */
function withFieldErrors(message: string, fieldErrors?: Record<string, string>): string {
  const detail = Object.entries(fieldErrors ?? {})
    .map(([field, text]) => `${field}: ${text}`)
    .join("; ")
  return detail ? `${message} (${detail})` : message
}

function mapPriorityToApi(priority: Priority): string {
  if (priority === "High") return "HIGH"
  if (priority === "Low") return "LOW"
  return "MEDIUM"
}

function mapThreadMessage(msg: {
  id: string
  authorType: string
  body: string
  createdAt: string
  attachments?: LpServiceRequestAttachment[]
}): ThreadMessage {
  const isInvestor = msg.authorType.toUpperCase() === "INVESTOR"
  return {
    id: msg.id,
    sender: isInvestor ? "You" : "Matanho Team",
    initials: isInvestor ? "Y" : "A",
    role: isInvestor ? "investor" : "team",
    timestamp: formatDate(msg.createdAt, "datetime"),
    body: msg.body,
    attachments: (msg.attachments ?? []).map((a) => ({
      name: a.name,
      size: formatFileSize(a.size),
      downloadUrl: a.downloadUrl,
    })),
  }
}

async function uploadAttachmentFiles(files: File[]): Promise<string[]> {
  const ids: string[] = []
  for (const file of files) {
    const formData = new FormData()
    formData.append("file", file)
    const res = await lpPortalApi.uploadRequestAttachment(formData, createIdempotencyKey())
    ids.push(res.data.id)
  }
  return ids
}

function downloadAttachment(url: string | undefined, name: string) {
  if (!url) {
    toast.error("Download URL not available.")
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

function StatusBadge({ status }: { status: Status }) {
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

function PriorityCell({ priority }: { priority: Priority }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#374151]">
      <span className={cn("size-2 rounded-full", PRIORITY_DOT[priority])} />
      {priority}
    </span>
  )
}

export function LpRequestsMessagesScreen({
  initialTab = "requests",
  initialRequestRef,
}: {
  initialTab?: PortalTab
  initialRequestRef?: string
}) {
  const router = useRouter()
  const { funds, lpRole } = useLpPortal()
  const { data, loading, error, reload } = useLpRequestsMessages()
  const { data: organisation } = useLpOrganisation()
  const requests = data?.requests ?? []
  const conversations = data?.messages ?? []

  const [tab, setTab] = React.useState<PortalTab>(initialTab)
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [query, setQuery] = React.useState("")
  const [selectedRequestId, setSelectedRequestId] = React.useState<string | null>(null)
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null)
  const [threadDetail, setThreadDetail] = React.useState<LpMessageThreadDetail | null>(null)
  const [threadMessages, setThreadMessages] = React.useState<ThreadMessage[]>([])
  const [threadLoading, setThreadLoading] = React.useState(false)
  const [requestDetail, setRequestDetail] = React.useState<ServiceRequest | null>(null)
  const [convQuery, setConvQuery] = React.useState("")
  const [reply, setReply] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [sendingReply, setSendingReply] = React.useState(false)
  const [form, setForm] = React.useState({
    type: REQUEST_TYPES[0].label,
    fundId: "",
    subject: "",
    priority: "Medium" as Priority,
    description: "",
  })
  const [formFiles, setFormFiles] = React.useState<File[]>([])
  const [replyFiles, setReplyFiles] = React.useState<File[]>([])
  const [threadParticipants, setThreadParticipants] = React.useState<
    Array<{ name: string; initials: string; color: string }>
  >([])
  const [addParticipantOpen, setAddParticipantOpen] = React.useState(false)
  const [selectedColleagueId, setSelectedColleagueId] = React.useState<string | null>(null)
  const [addingParticipant, setAddingParticipant] = React.useState(false)
  const formFileRef = React.useRef<HTMLInputElement>(null)
  const replyFileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (funds.length && !form.fundId) {
      setForm((f) => ({ ...f, fundId: funds[0].id }))
    }
  }, [funds, form.fundId])

  React.useEffect(() => {
    if (requests.length && !selectedRequestId) setSelectedRequestId(requests[0].id)
  }, [requests, selectedRequestId])

  React.useEffect(() => {
    if (conversations.length && !activeConversationId) setActiveConversationId(conversations[0].id)
  }, [conversations, activeConversationId])

  React.useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  React.useEffect(() => {
    if (!initialRequestRef || requests.length === 0) return
    const match = requests.find((r) => r.reference === initialRequestRef)
    if (match) {
      setSelectedRequestId(match.id)
      setTab("requests")
    }
  }, [initialRequestRef, requests])

  const navigateLinkedRecord = (relatedType: string, relatedId: string) => {
    const href = resolveLpLinkedRecordHref(relatedType, relatedId)
    if (href) router.push(href)
    else toast.message("Linked record", { description: `${relatedType} ${relatedId}` })
  }

  React.useEffect(() => {
    const unsubs = [
      subscribeLpRealtime("lp_request_created", () => void reload()),
      subscribeLpRealtime("lp_request_message", () => void reload()),
      subscribeLpRealtime("lp_thread_message", () => void reload()),
    ]
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [reload])

  React.useEffect(() => {
    const req = requests.find((r) => r.id === selectedRequestId)
    if (!req?.reference) return
    joinLpRequestRoom(req.reference)
    return () => leaveLpRequestRoom(req.reference)
  }, [selectedRequestId, requests])

  React.useEffect(() => {
    if (!activeConversationId) return
    joinLpThreadRoom(activeConversationId)
    return () => leaveLpThreadRoom(activeConversationId)
  }, [activeConversationId])

  React.useEffect(() => {
    if (!activeConversationId) {
      setThreadDetail(null)
      setThreadMessages([])
      return
    }
    let cancelled = false
    setThreadLoading(true)
    void lpPortalApi
      .getMessageThread(activeConversationId)
      .then((res) => {
        if (cancelled) return
        setThreadDetail(res.data)
        setThreadMessages(res.data.messages.map(mapThreadMessage))
        setThreadParticipants(mapThreadParticipants(res.data))
        void lpPortalApi.markMessageThreadRead(activeConversationId)
      })
      .catch((err) => {
        if (!cancelled) toast.error(getApiErrorMessage(err, "Failed to load conversation"))
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeConversationId])

  React.useEffect(() => {
    const req = requests.find((r) => r.id === selectedRequestId)
    if (!req?.reference) {
      setRequestDetail(null)
      return
    }
    let cancelled = false
    void lpPortalApi
      .getRequest(req.reference)
      .then((res) => {
        if (!cancelled) setRequestDetail(mapServiceRequestRow(res.data))
      })
      .catch((err) => {
        if (!cancelled) toast.error(getApiErrorMessage(err, "Failed to load request"))
      })
    return () => {
      cancelled = true
    }
  }, [selectedRequestId, requests])

  const filteredRequests = React.useMemo(() => {
    return requests.filter((row) => {
      if (statusFilter === "open" && (row.status === "Resolved" || row.status === "Closed")) {
        return false
      }
      if (statusFilter === "awaiting" && row.status !== "Awaiting Investor") return false
      if (statusFilter === "review" && row.status !== "Under Review") return false
      if (statusFilter === "closed" && row.status !== "Closed" && row.status !== "Resolved") {
        return false
      }
      if (query.trim()) {
        const q = query.toLowerCase()
        const hay = `${row.reference} ${row.type} ${row.fund} ${row.subject} ${row.submittedBy}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [query, requests, statusFilter])

  const selectedRequest =
    requestDetail ??
    filteredRequests.find((r) => r.id === selectedRequestId) ??
    requests.find((r) => r.id === selectedRequestId) ??
    filteredRequests[0] ??
    null

  const filteredConversations = React.useMemo(() => {
    if (!convQuery.trim()) return conversations
    const q = convQuery.toLowerCase()
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.fund.toLowerCase().includes(q) ||
        c.preview.toLowerCase().includes(q),
    )
  }, [convQuery, conversations])

  const activeConversation = React.useMemo(() => {
    const summary = conversations.find((c) => c.id === activeConversationId) ?? conversations[0]
    if (!summary) return null
    return {
      ...summary,
      participants: threadParticipants.length ? threadParticipants : summary.participants,
      messages: threadMessages.length ? threadMessages : summary.messages,
    }
  }, [activeConversationId, conversations, threadMessages, threadParticipants])

  const availableColleagues = React.useMemo(() => {
    const participantNames = new Set(
      (activeConversation?.participants ?? []).map((p) => p.name.trim().toLowerCase()),
    )
    return (organisation?.colleagues ?? []).filter(
      (c) =>
        c.isActive &&
        !c.revokedAt &&
        !participantNames.has(c.name.trim().toLowerCase()) &&
        !participantNames.has(c.email.trim().toLowerCase()),
    )
  }, [activeConversation?.participants, organisation?.colleagues])

  const requestParticipantAccess = async () => {
    if (!selectedColleagueId || !activeConversation) return
    const colleague = availableColleagues.find((c) => c.membershipId === selectedColleagueId)
    if (!colleague) return

    const fundMatch = funds.find((f) => f.name === activeConversation.fund)
    setAddingParticipant(true)
    try {
      await lpPortalApi.createRequest(
        {
          type: "PROFILE_ACCESS",
          fundId: fundMatch?.id ?? funds[0]?.id,
          subject: `Add participant to conversation: ${activeConversation.title}`,
          description: [
            `Please add ${colleague.name} (${colleague.email}) to the message thread "${activeConversation.title}".`,
            `Linked record: ${activeConversation.linkedLabel}`,
            `Thread ID: ${activeConversation.id}`,
            `Current participants: ${activeConversation.participants.map((p) => p.name).join(", ") || "None listed"}`,
          ].join("\n"),
          priority: "MEDIUM",
        },
        createIdempotencyKey(),
      )
      toast.success(`Access request submitted for ${colleague.name}.`)
      setAddParticipantOpen(false)
      setSelectedColleagueId(null)
      await reload()
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not submit participant request"))
    } finally {
      setAddingParticipant(false)
    }
  }

  // A request thread's `relatedId` is the request REFERENCE ("REQ-1082"), while the table rows are
  // keyed by request id; match on either so a conversation and its request always open together
  // (LPC-022: the detail panel kept showing the first row for a conversation about another request).
  const requestForLink = (link: string) => requests.find((r) => r.id === link || r.reference === link)

  const selectRequest = (id: string) => {
    setSelectedRequestId(id)
    const ref = requests.find((r) => r.id === id)?.reference
    const linked = conversations.find((c) => c.requestId === id || (ref && c.requestId === ref))
    if (linked) setActiveConversationId(linked.id)
  }

  const submitRequest = async () => {
    if (!form.subject.trim()) {
      toast.error("Subject is required.")
      return
    }
    const typeDef = REQUEST_TYPES.find((t) => t.label === form.type) ?? REQUEST_TYPES[0]
    setSubmitting(true)
    try {
      const attachmentIds = formFiles.length ? await uploadAttachmentFiles(formFiles) : undefined
      const res = await lpPortalApi.createRequest(
        {
          type: typeDef.apiType,
          fundId: form.fundId || undefined,
          subject: form.subject.trim(),
          description: form.description.trim() || "No description provided.",
          priority: mapPriorityToApi(form.priority),
          attachmentIds,
        },
        createIdempotencyKey(),
      )
      toast.success("Request submitted.")
      await reload()
      setSelectedRequestId(res.data.id)
      setForm({
        type: REQUEST_TYPES[0].label,
        fundId: funds[0]?.id ?? "",
        subject: "",
        priority: "Medium",
        description: "",
      })
      setFormFiles([])
    } catch (err) {
      toast.error(withFieldErrors(getApiErrorMessage(err, "Failed to submit request"), getApiFieldErrors(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const sendReply = async () => {
    if (!reply.trim() || !activeConversationId) return
    setSendingReply(true)
    try {
      const attachmentIds = replyFiles.length ? await uploadAttachmentFiles(replyFiles) : undefined
      const isRequestThread = threadDetail?.relatedType?.toUpperCase().includes("REQUEST")
      if (isRequestThread) {
        const req =
          requests.find((r) => r.id === threadDetail?.relatedId) ??
          requests.find((r) => r.reference === threadDetail?.relatedId)
        if (req?.reference) {
          await lpPortalApi.replyToRequest(req.reference, { body: reply.trim(), attachmentIds })
        } else if (threadDetail?.relatedId) {
          await lpPortalApi.replyToRequest(threadDetail.relatedId, { body: reply.trim(), attachmentIds })
        } else {
          throw new Error("Could not resolve request reference for reply")
        }
      } else {
        await lpPortalApi.replyToMessageThread(activeConversationId, {
          body: reply.trim(),
          attachmentIds,
        })
      }
      toast.success("Message sent.")
      setReply("")
      setReplyFiles([])
      await reload()
      const res = await lpPortalApi.getMessageThread(activeConversationId)
      setThreadDetail(res.data)
      setThreadMessages(res.data.messages.map(mapThreadMessage))
      setThreadParticipants(mapThreadParticipants(res.data))
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to send message"))
    } finally {
      setSendingReply(false)
    }
  }

  const onKpiClick = (id: string) => {
    if (id === "unread") {
      setTab("messages")
      return
    }
    setTab("requests")
    if (id === "open") setStatusFilter("open")
    else if (id === "awaiting") setStatusFilter("awaiting")
    else if (id === "review") setStatusFilter("review")
    else if (id === "closed") setStatusFilter("closed")
  }

  const unreadCount = conversations.reduce((sum, c) => sum + (c.unread ?? 0), 0)

  const kpis = [
    {
      id: "open",
      label: "Open Requests",
      value: String(requests.filter((r) => r.status !== "Resolved" && r.status !== "Closed").length),
      link: "View all open",
      linkTone: "blue" as const,
      iconBg: "bg-[#dbeafe]",
      iconColor: "text-[#2563eb]",
      icon: <Inbox className="size-4" strokeWidth={2.25} />,
    },
    {
      id: "awaiting",
      label: "Awaiting Investor",
      value: String(requests.filter((r) => r.status === "Awaiting Investor").length),
      link: "Action required",
      linkTone: "red" as const,
      iconBg: "bg-[#ede9fe]",
      iconColor: "text-[#7c3aed]",
      icon: <AlertCircle className="size-4" strokeWidth={2.25} />,
    },
    {
      id: "review",
      label: "Under Review",
      value: String(requests.filter((r) => r.status === "Under Review").length),
      link: "In progress",
      linkTone: "blue" as const,
      iconBg: "bg-[#ffedd5]",
      iconColor: "text-[#ea580c]",
      icon: <Clock3 className="size-4" strokeWidth={2.25} />,
    },
    {
      id: "unread",
      label: "Unread Messages",
      value: String(unreadCount),
      link: "View messages",
      linkTone: "blue" as const,
      iconBg: "bg-[#dcfce7]",
      iconColor: "text-[#16a34a]",
      icon: <MessageSquare className="size-4" strokeWidth={2.25} />,
    },
    {
      id: "closed",
      label: "Closed / Resolved",
      value: String(requests.filter((r) => r.status === "Closed" || r.status === "Resolved").length),
      link: "View history",
      linkTone: "blue" as const,
      iconBg: "bg-[#ccfbf1]",
      iconColor: "text-[#0d9488]",
      icon: <CheckCircle2 className="size-4" strokeWidth={2.25} />,
    },
  ]

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-[24px] font-bold tracking-tight text-[#0f172a]">Requests & Messages</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-[#6b7280]">
          Submit, track, and manage your requests or communicate with the Matanho team.
        </p>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {kpis.map((kpi) => (
          <button
            key={kpi.id}
            type="button"
            onClick={() => onKpiClick(kpi.id)}
            className="rounded-xl border border-[#e5e7eb] bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#cbd5e1]"
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full",
                  kpi.iconBg,
                  kpi.iconColor,
                )}
              >
                {kpi.icon}
              </span>
            </div>
            <p className="mt-3 text-[12px] font-medium text-[#6b7280]">{kpi.label}</p>
            <p className="mt-1 text-[22px] font-bold tabular-nums tracking-[-0.03em] text-[#0f172a]">
              {kpi.value}
            </p>
            <span
              className={cn(
                "mt-2 inline-block text-[12px] font-medium",
                kpi.linkTone === "red" ? "text-[#dc2626]" : "text-[#2563eb]",
              )}
            >
              {kpi.link}
            </span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Left column */}
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-5 border-b border-[#e5e7eb] px-4">
              {(
                [
                  ["requests", `Requests (${requests.length})`],
                  ["messages", `Messages (${unreadCount})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "-mb-px border-b-2 py-3 text-[13px] font-semibold",
                    tab === id
                      ? "border-[#2563eb] text-[#2563eb]"
                      : "border-transparent text-[#6b7280] hover:text-[#111827]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "requests" ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-[#f1f5f9] px-4 py-3">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-[140px] rounded-full border-[#e5e7eb] text-[12px] shadow-none">
                      <SelectValue placeholder="All Requests" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Requests</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="awaiting">Awaiting Investor</SelectItem>
                      <SelectItem value="review">Under Review</SelectItem>
                      <SelectItem value="closed">Closed / Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-full border-[#e5e7eb] px-3 text-[12px] font-medium text-[#374151] shadow-none"
                  >
                    <SlidersHorizontal className="size-3.5" />
                    Filters
                  </Button>
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#9ca3af]" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search requests..."
                      className="h-9 rounded-full border-[#e5e7eb] pl-9 text-[12px] shadow-none"
                    />
                  </div>
                  <button
                    type="button"
                    className="flex size-9 items-center justify-center rounded-full border border-[#e5e7eb] text-[#6b7280] hover:bg-[#f9fafb]"
                    aria-label="Export"
                  >
                    <Download className="size-3.5" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {loading ? (
                    <div className="px-4 py-10 text-center text-[13px] text-[#6b7280]">Loading requests…</div>
                  ) : (
                  <table className="w-full min-w-[900px] text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-[#e5e7eb] bg-[#fafafa] text-[11px] font-semibold text-[#6b7280]">
                        <th className="px-4 py-2.5">Reference</th>
                        <th className="px-3 py-2.5">Request Type</th>
                        <th className="px-3 py-2.5">Linked Fund</th>
                        <th className="px-3 py-2.5">Subject</th>
                        <th className="px-3 py-2.5">Submitted By</th>
                        <th className="px-3 py-2.5">Last Updated</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Priority</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((row) => {
                        const active = selectedRequest?.id === row.id
                        return (
                          <tr
                            key={row.id}
                            onClick={() => selectRequest(row.id)}
                            className={cn(
                              "cursor-pointer border-b border-[#f3f4f6] transition last:border-0",
                              active
                                ? "bg-[#eff6ff] shadow-[inset_3px_0_0_0_#2563eb]"
                                : "hover:bg-[#f9fafb]",
                            )}
                          >
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] font-medium text-[#2563eb]">
                              {row.reference}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-[#374151]">{row.type}</td>
                            <td className="max-w-[150px] truncate px-3 py-3 text-[#4b5563]">
                              {row.fund}
                            </td>
                            <td className="max-w-[180px] truncate px-3 py-3 font-medium text-[#111827]">
                              {row.subject}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">
                              {row.submittedBy}
                            </td>
                            <td className="whitespace-nowrap px-3 py-3 text-[#4b5563]">
                              {row.lastUpdated}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={row.status} />
                            </td>
                            <td className="px-3 py-3">
                              <PriorityCell priority={row.priority} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="rounded-full p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]"
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={`Actions for ${row.reference}`}
                                  >
                                    <MoreHorizontal className="size-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="rounded-xl">
                                  <DropdownMenuItem onClick={() => selectRequest(row.id)}>
                                    View details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      selectRequest(row.id)
                                      setTab("messages")
                                    }}
                                  >
                                    Open conversation
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        )
                      })}
                      {filteredRequests.length === 0 && (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-4 py-10 text-center text-[13px] text-[#9ca3af]"
                          >
                            No requests match your filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  )}
                </div>
                <div className="border-t border-[#f1f5f9] px-4 py-3 text-[12px] text-[#6b7280]">
                  Showing{" "}
                  <span className="font-medium text-[#111827]">
                    {filteredRequests.length === 0 ? 0 : 1}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium text-[#111827]">{filteredRequests.length}</span> of{" "}
                  <span className="font-medium text-[#111827]">{filteredRequests.length}</span>{" "}
                  requests
                </div>
              </>
            ) : (
              <div className="px-4 py-8 text-center text-[13px] text-[#6b7280]">
                Conversation workspace is below. Select a thread to continue messaging the Matanho
                team.
              </div>
            )}
          </section>

          {/* Conversations + thread */}
          <section className="grid min-h-[420px] overflow-hidden rounded-xl border border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="border-b border-[#e5e7eb] lg:border-b-0 lg:border-r">
              <div className="border-b border-[#f1f5f9] px-3 py-3">
                <p className="text-[13px] font-semibold text-[#111827]">Conversations</p>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9ca3af]" />
                  <Input
                    value={convQuery}
                    onChange={(e) => setConvQuery(e.target.value)}
                    placeholder="Search conversations..."
                    className="h-8 rounded-lg border-[#e5e7eb] pl-8 text-[11px] shadow-none"
                  />
                </div>
              </div>
              <ul className="max-h-[360px] overflow-y-auto">
                {filteredConversations.map((conv) => {
                  const active = conv.id === activeConversation?.id
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveConversationId(conv.id)
                          setSelectedRequestId(requestForLink(conv.requestId)?.id ?? selectedRequestId)
                        }}
                        className={cn(
                          "w-full border-b border-[#f3f4f6] px-3 py-3 text-left transition last:border-0",
                          active ? "bg-[#eff6ff]" : "hover:bg-[#f9fafb]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e8f1ff] text-[#2563eb]">
                              <FolderOpen className="size-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-semibold text-[#111827]">
                                {conv.title}
                              </p>
                              <p className="mt-0.5 truncate text-[10px] text-[#9ca3af]">{conv.fund}</p>
                              <p className="mt-1 line-clamp-2 text-[11px] text-[#6b7280]">
                                {conv.preview}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[10px] text-[#9ca3af]">{conv.updated}</span>
                            {!!conv.unread && (
                              <span className="rounded-full bg-[#2563eb] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                {conv.unread}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <button
                type="button"
                className="w-full border-t border-[#f1f5f9] px-3 py-2.5 text-left text-[12px] font-medium text-[#2563eb] hover:bg-[#f8fafc]"
                onClick={() => setTab("messages")}
              >
                View all conversations
              </button>
            </div>

            {activeConversation && (
              <div className="flex min-w-0 flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f1f5f9] px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#111827]">
                      {activeConversation.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#6b7280]">
                      <button
                        type="button"
                        className="rounded-full bg-[#eff6ff] px-2 py-0.5 font-medium text-[#2563eb] hover:underline"
                        onClick={() => {
                          const conv = conversations.find((c) => c.id === activeConversationId)
                          if (conv?.relatedType && conv?.relatedId) {
                            navigateLinkedRecord(conv.relatedType, conv.relatedId)
                          }
                        }}
                      >
                        Linked to {activeConversation.linkedLabel}
                      </button>
                      <span>{activeConversation.fund}</span>
                      <span className="font-mono text-[#9ca3af]">
                        {requestForLink(activeConversation.requestId)?.reference}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-[#6b7280]">
                      Participants ({activeConversation.participants.length})
                    </span>
                    <div className="flex -space-x-2">
                      {activeConversation.participants.map((p) => (
                        <Avatar key={p.name} className="size-7 border-2 border-white">
                          <AvatarFallback className={cn("text-[10px] text-white", p.color)}>
                            {p.initials}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-full border border-dashed border-[#cbd5e1] text-[#9ca3af] hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Add participant"
                      disabled={lpRole === "VIEWER"}
                      title={lpRole === "VIEWER" ? "Viewers cannot request participant changes" : "Request to add colleague"}
                      onClick={() => {
                        setSelectedColleagueId(availableColleagues[0]?.membershipId ?? null)
                        setAddParticipantOpen(true)
                      }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                  {threadLoading ? (
                    <p className="text-center text-[13px] text-[#6b7280]">Loading messages…</p>
                  ) : (
                  activeConversation.messages.map((msg) => (
                    <div key={msg.id} className="flex gap-2.5">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback
                          className={cn(
                            "text-[11px] font-semibold text-white",
                            msg.role === "investor" ? "bg-[#2563eb]" : "bg-[#0f172a]",
                          )}
                        >
                          {msg.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[12px] font-semibold text-[#111827]">{msg.sender}</p>
                          <p className="text-[10px] text-[#9ca3af]">{msg.timestamp}</p>
                        </div>
                        <div
                          className={cn(
                            "mt-1.5 rounded-xl px-3 py-2.5 text-[12px] leading-5 text-[#374151]",
                            msg.role === "investor"
                              ? "border border-[#e5e7eb] bg-white"
                              : "bg-[#f3f4f6]",
                          )}
                        >
                          {msg.body}
                          {msg.attachments?.map((file) => (
                            <div
                              key={file.name}
                              className="mt-2 flex items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-2.5 py-2"
                            >
                              <FileText className="size-4 shrink-0 text-[#dc2626]" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-medium text-[#111827]">
                                  {file.name}
                                </p>
                                <p className="text-[10px] text-[#9ca3af]">{file.size}</p>
                              </div>
                              <button
                                type="button"
                                className="rounded-full p-1 text-[#2563eb] hover:bg-[#eff6ff]"
                                aria-label={`Download ${file.name}`}
                                onClick={() => downloadAttachment(file.downloadUrl, file.name)}
                              >
                                <Download className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                  )}
                </div>

                <div className="border-t border-[#f1f5f9] px-4 py-3">
                  {replyFiles.length > 0 && (
                    <ul className="mb-2 space-y-1">
                      {replyFiles.map((f) => (
                        <li key={f.name + f.size} className="truncate text-[11px] text-[#4b5563]">
                          {f.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-end gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="Type your message..."
                        className="min-h-[44px] resize-none rounded-xl border-[#e5e7eb] pr-10 text-[12px] shadow-none"
                        rows={2}
                      />
                      <button
                        type="button"
                        className="absolute bottom-2 right-2 rounded-full p-1.5 text-[#9ca3af] hover:bg-[#f3f4f6] hover:text-[#2563eb]"
                        aria-label="Attach file"
                        onClick={() => replyFileRef.current?.click()}
                      >
                        <Paperclip className="size-3.5" />
                      </button>
                      <input
                        ref={replyFileRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) setReplyFiles((prev) => [...prev, file])
                          e.target.value = ""
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      disabled={sendingReply}
                      className="h-10 rounded-full bg-[#93c5fd] px-5 text-[12px] font-semibold text-[#1e3a8a] shadow-none hover:bg-[#60a5fa]"
                      onClick={() => void sendReply()}
                    >
                      <Send className="size-3.5" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <section className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <h2 className="text-[14px] font-semibold text-[#111827]">Create New Request</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Request Type
                </label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                >
                  <SelectTrigger className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REQUEST_TYPES.map((t) => (
                      <SelectItem key={t.label} value={t.label}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Linked Fund
                </label>
                <Select
                  value={form.fundId}
                  onValueChange={(v) => setForm((f) => ({ ...f, fundId: v }))}
                >
                  <SelectTrigger className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
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
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Subject
                </label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Brief summary of your request"
                  className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Priority
                </label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm((f) => ({ ...f, priority: v as Priority }))}
                >
                  <SelectTrigger className="h-9 rounded-lg border-[#e5e7eb] text-[12px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["High", "Medium", "Low"] as Priority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("size-2 rounded-full", PRIORITY_DOT[p])} />
                          {p}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Description
                </label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Provide details to help the Matanho team respond..."
                  className="min-h-[88px] rounded-lg border-[#e5e7eb] text-[12px] shadow-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold text-[#374151]">
                  Attachments
                </label>
                <button
                  type="button"
                  onClick={() => formFileRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#cbd5e1] bg-[#fafafa] px-3 py-5 text-center transition hover:border-[#93c5fd] hover:bg-[#f8fbff]"
                >
                  <UploadCloud className="size-5 text-[#2563eb]" />
                  <p className="mt-2 text-[12px] font-medium text-[#374151]">
                    Drag & drop or click to browse
                  </p>
                  <p className="mt-1 text-[10px] text-[#9ca3af]">
                    PDF, DOC, XLSX, PNG · Max 20MB
                  </p>
                </button>
                <input
                  ref={formFileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const next = Array.from(e.target.files ?? [])
                    if (next.length) setFormFiles((prev) => [...prev, ...next])
                    e.target.value = ""
                  }}
                />
                {formFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {formFiles.map((f) => (
                      <li
                        key={f.name + f.size}
                        className="truncate text-[11px] text-[#4b5563]"
                      >
                        {f.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                type="button"
                disabled={submitting}
                className="h-10 w-full rounded-full bg-[#2563eb] text-[13px] font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
                onClick={() => void submitRequest()}
              >
                Submit Request
              </Button>
            </div>
          </section>

          {selectedRequest && (
            <section className="rounded-xl border border-[#e5e7eb] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2">
                <UserRound className="size-4 text-[#2563eb]" />
                <h2 className="text-[14px] font-semibold text-[#111827]">Request Details</h2>
              </div>
              <dl className="mt-4 space-y-2.5 text-[12px]">
                {[
                  ["Reference", selectedRequest.reference],
                  ["Status", <StatusBadge key="s" status={selectedRequest.status} />],
                  ["Priority", <PriorityCell key="p" priority={selectedRequest.priority} />],
                  [
                    "Linked To",
                    <button
                      key="l"
                      type="button"
                      className="font-medium text-[#2563eb] hover:underline"
                      onClick={() => router.push(resolveRequestTypeHref(selectedRequest.apiType))}
                    >
                      {selectedRequest.linkedTo}
                    </button>,
                  ],
                  ["Fund", selectedRequest.fund],
                  ["Submitted By", selectedRequest.submittedBy],
                  ["Last Updated", selectedRequest.lastUpdated],
                ].map(([label, value]) => (
                  <div key={String(label)} className="grid grid-cols-[100px_1fr] gap-2">
                    <dt className="text-[#9ca3af]">{label}</dt>
                    <dd className="min-w-0 font-medium text-[#111827]">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 border-t border-[#f1f5f9] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold text-[#111827]">
                    Attachments ({(selectedRequest.attachments?.length ?? 0)})
                  </h3>
                </div>
                {(selectedRequest.attachments?.length ?? 0) === 0 ? (
                  <p className="mt-2 text-[12px] text-[#9ca3af]">No attachments.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {(selectedRequest.attachments ?? []).map((file) => (
                      <li
                        key={file.name}
                        className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] px-2.5 py-2"
                      >
                        <FileText className="size-4 shrink-0 text-[#dc2626]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium text-[#111827]">
                            {file.name}
                          </p>
                          <p className="text-[10px] text-[#9ca3af]">{file.size}</p>
                        </div>
                        <button
                          type="button"
                          className="rounded-full p-1 text-[#2563eb] hover:bg-[#eff6ff]"
                          aria-label={`Download ${file.name}`}
                          onClick={() => downloadAttachment(file.downloadUrl, file.name)}
                        >
                          <Download className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      <Dialog open={addParticipantOpen} onOpenChange={setAddParticipantOpen}>
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle>Add participant</DialogTitle>
            <DialogDescription>
              Select a colleague from your organisation. We will submit a profile access request to your fund
              administrator to add them to this conversation.
            </DialogDescription>
          </DialogHeader>
          {availableColleagues.length === 0 ? (
            <p className="py-4 text-[13px] text-[#6b7280]">
              All active colleagues are already on this thread, or no eligible colleagues were found. Invite new
              colleagues from Organisation settings.
            </p>
          ) : (
            <ul className="max-h-56 space-y-2 overflow-y-auto py-1">
              {availableColleagues.map((colleague) => {
                const selected = selectedColleagueId === colleague.membershipId
                return (
                  <li key={colleague.membershipId}>
                    <button
                      type="button"
                      onClick={() => setSelectedColleagueId(colleague.membershipId)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                        selected
                          ? "border-[#93c5fd] bg-[#eff6ff]"
                          : "border-[#e5e7eb] bg-white hover:border-[#cbd5e1]",
                      )}
                    >
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-[#2563eb] text-[11px] text-white">
                          {colleague.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold text-[#111827]">
                          {colleague.name}
                        </span>
                        <span className="block truncate text-[11px] text-[#6b7280]">{colleague.email}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={() => setAddParticipantOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full"
              disabled={!selectedColleagueId || addingParticipant || availableColleagues.length === 0}
              onClick={() => void requestParticipantAccess()}
            >
              {addingParticipant ? "Submitting…" : "Request access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
