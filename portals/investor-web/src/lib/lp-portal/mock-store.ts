/**
 * In-memory LP Portal mock store — API-shaped data for offline UI.
 * Mutators are used by `mock-api.ts`; screens consume via `lpPortalApi`.
 */

import type {
  LpAccountActivityEntry,
  LpBankAccount,
  LpBankInstructionChange,
  LpBenchmarkSeries,
  LpCapitalCallDetail,
  LpCapitalCallDocument,
  LpCapitalCallSummary,
  LpColleague,
  LpDashboardAction,
  LpDashboardData,
  LpDealingOverview,
  LpDealingRequest,
  LpDisplaySettings,
  LpDistribution,
  LpDocument,
  LpDocumentsSummary,
  LpJobStatus,
  LpLedgerDetail,
  LpMessageThreadDetail,
  LpMessageThreadSummary,
  LpNotice,
  LpNotificationItem,
  LpNotificationPreferences,
  LpOrganisation,
  LpPerformanceByFundRow,
  LpPerformanceData,
  LpPerformanceHistory,
  LpRedemptionEstimate,
  LpReport,
  LpRequestAttachment,
  LpServiceRequest,
  LpSession,
  LpSettings,
  LpSubscriptionEstimate,
  LpVaultDocument,
} from "@/lib/api/lp-portal-api"

const GROWTH = "growth-fund-i"
const EQUITY = "equity-opportunities"
const AS_OF = "2026-06-30"
const NOW = "2026-07-21T10:00:00Z"

function money(n: number): string {
  return n.toFixed(2)
}

function paginate<T>(items: T[], page = 1, pageSize = 20) {
  const p = Math.max(1, page)
  const size = Math.max(1, pageSize)
  const start = (p - 1) * size
  const slice = items.slice(start, start + size)
  const total = items.length
  return {
    items: slice,
    page: p,
    pageSize: size,
    total,
    totalPages: Math.max(1, Math.ceil(total / size)),
  }
}

export interface MockLpPortalStore {
  session: LpSession
  notifications: LpNotificationItem[]
  settings: LpSettings
  dashboards: Record<string, LpDashboardData>
  dashboardActions: LpDashboardAction[]
  recentActivity: LpRecentActivityLike[]
  capitalCalls: LpCapitalCallDetail[]
  capitalCallDocuments: Record<string, LpCapitalCallDocument[]>
  capitalCallSummaries: Record<string, LpCapitalCallSummary>
  distributions: LpDistribution[]
  dealingOverviews: Record<string, LpDealingOverview>
  bankAccounts: LpBankAccount[]
  dealingRequests: LpDealingRequest[]
  performance: Record<string, LpPerformanceData>
  performanceHistory: Record<string, LpPerformanceHistory>
  performanceByFundRows: LpPerformanceByFundRow[]
  benchmarks: Record<string, LpBenchmarkSeries>
  accountActivity: LpAccountActivityEntry[]
  ledgerDetails: Record<string, LpLedgerDetail>
  documents: LpDocument[]
  documentsSummary: LpDocumentsSummary
  notices: LpNotice[]
  requests: LpServiceRequest[]
  messageThreads: LpMessageThreadDetail[]
  organisation: LpOrganisation
  bankChanges: LpBankInstructionChange[]
  vault: LpVaultDocument[]
  reports: LpReport[]
  jobs: Record<string, LpJobStatus>
  attachments: LpRequestAttachment[]
  estimateCounter: number
  requestCounter: number
  colleagueCounter: number
  bankChangeCounter: number
  dealingCounter: number
  jobCounter: number
}

type LpRecentActivityLike = {
  id: string
  type: string
  title: string
  fundId: string
  amount: string
  status: string
  at: string
}

function buildSeed(): MockLpPortalStore {
  const colleagues: LpColleague[] = [
    {
      membershipId: "mem-1",
      userId: "usr-1",
      email: "jane.smith@horizonpension.example",
      name: "Jane Smith",
      lpRole: "MANAGER",
      fundIds: [GROWTH, EQUITY],
      isActive: true,
      status: "ACTIVE",
      revokedAt: null,
      mfaEnabled: true,
      lastActiveAt: "2026-07-21T08:12:00Z",
    },
    {
      membershipId: "mem-2",
      userId: "usr-2",
      email: "tawanda.moyo@horizonpension.example",
      name: "Tawanda Moyo",
      lpRole: "SIGNATORY",
      fundIds: [GROWTH],
      isActive: true,
      status: "ACTIVE",
      revokedAt: null,
      mfaEnabled: true,
      lastActiveAt: "2026-07-20T16:40:00Z",
    },
    {
      membershipId: "mem-3",
      userId: "usr-3",
      email: "rudo.maposa@horizonpension.example",
      name: "Rudo Maposa",
      lpRole: "VIEWER",
      fundIds: [GROWTH, EQUITY],
      isActive: true,
      status: "ACTIVE",
      revokedAt: null,
      mfaEnabled: true,
      lastActiveAt: "2026-07-18T11:05:00Z",
    },
  ]

  const capitalCalls: LpCapitalCallDetail[] = [
    {
      id: "cc-013",
      callNo: 13,
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      issueDate: "2026-07-01",
      dueDate: "2026-07-20",
      currencyCode: "USD",
      amount: money(150000),
      paid: money(0),
      outstanding: money(150000),
      status: "ISSUED",
      acknowledgedAt: null,
      wiring: {
        bankName: "First National Correspondent Bank",
        accountName: "Matanho Growth Fund I LP Collection",
        accountNumber: null,
        accountNumberMasked: "•••• 4812",
        abaRouting: "021000021",
        reference: "INV-AGFI-1042 / CC-013",
        raw: [
          "Beneficiary: Matanho Growth Fund I LP Collection",
          "Bank: First National Correspondent Bank",
          "ABA/Routing: 021000021",
          "Account: ****4812",
          "Reference: INV-AGFI-1042 / CC-013",
          "Currency: USD",
          "Amount due: 150,000.00",
        ].join("\n"),
      },
      timeline: [
        { code: "ISSUED", at: "2026-07-01T09:00:00Z", completed: true },
        { code: "ACKNOWLEDGED", at: null, completed: false },
        { code: "PAYMENT_RECEIVED", at: null, completed: false },
        { code: "ALLOCATED", at: null, completed: false },
      ],
    },
    {
      id: "cc-012",
      callNo: 12,
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      issueDate: "2026-06-01",
      dueDate: "2026-06-20",
      currencyCode: "USD",
      amount: money(250000),
      paid: money(250000),
      outstanding: money(0),
      status: "PAID",
      acknowledgedAt: "2026-06-04T14:22:00Z",
      wiring: {
        bankName: "First National Correspondent Bank",
        accountName: "Matanho Growth Fund I LP Collection",
        accountNumber: null,
        accountNumberMasked: "•••• 4812",
        abaRouting: "021000021",
        reference: "INV-AGFI-1042 / CC-012",
        raw: "Beneficiary: Matanho Growth Fund I LP Collection\nBank: First National Correspondent Bank\nABA: 021000021\nAccount: ****4812\nReference: INV-AGFI-1042 / CC-012",
      },
      timeline: [
        { code: "ISSUED", at: "2026-06-01T09:00:00Z", completed: true },
        { code: "ACKNOWLEDGED", at: "2026-06-04T14:22:00Z", completed: true },
        { code: "PAYMENT_RECEIVED", at: "2026-06-18T11:05:00Z", completed: true },
        { code: "ALLOCATED", at: "2026-06-19T08:00:00Z", completed: true },
      ],
    },
    {
      id: "cc-011",
      callNo: 11,
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      issueDate: "2026-02-01",
      dueDate: "2026-02-15",
      currencyCode: "USD",
      amount: money(500000),
      paid: money(500000),
      outstanding: money(0),
      status: "PAID",
      acknowledgedAt: "2026-02-03T10:15:00Z",
      wiring: {
        bankName: "First National Correspondent Bank",
        accountName: "Matanho Growth Fund I LP Collection",
        accountNumber: null,
        accountNumberMasked: "•••• 4812",
        abaRouting: "021000021",
        reference: "INV-AGFI-1042 / CC-011",
        raw: "Beneficiary: Matanho Growth Fund I LP Collection\nBank: First National Correspondent Bank\nABA: 021000021\nAccount: ****4812\nReference: INV-AGFI-1042 / CC-011",
      },
      timeline: [
        { code: "ISSUED", at: "2026-02-01T09:00:00Z", completed: true },
        { code: "ACKNOWLEDGED", at: "2026-02-03T10:15:00Z", completed: true },
        { code: "PAYMENT_RECEIVED", at: "2026-02-12T16:40:00Z", completed: true },
        { code: "ALLOCATED", at: "2026-02-13T09:00:00Z", completed: true },
      ],
    },
    {
      id: "cc-010",
      callNo: 10,
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      issueDate: "2025-11-01",
      dueDate: "2025-11-20",
      currencyCode: "USD",
      amount: money(400000),
      paid: money(400000),
      outstanding: money(0),
      status: "PAID",
      acknowledgedAt: "2025-11-05T12:00:00Z",
      wiring: {
        bankName: "First National Correspondent Bank",
        accountName: "Matanho Growth Fund I LP Collection",
        accountNumber: null,
        accountNumberMasked: "•••• 4812",
        abaRouting: "021000021",
        reference: "INV-AGFI-1042 / CC-010",
        raw: "Reference: INV-AGFI-1042 / CC-010\nAccount: ****4812",
      },
      timeline: [
        { code: "ISSUED", at: "2025-11-01T09:00:00Z", completed: true },
        { code: "ACKNOWLEDGED", at: "2025-11-05T12:00:00Z", completed: true },
        { code: "PAYMENT_RECEIVED", at: "2025-11-18T10:00:00Z", completed: true },
        { code: "ALLOCATED", at: "2025-11-19T08:00:00Z", completed: true },
      ],
    },
  ]

  const documents: LpDocument[] = [
    {
      id: "doc-101",
      name: "Q2 2026 Investor Report",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Fund Reports",
      period: "Q2 2026",
      publishedDate: "2026-07-10",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor organisation",
      checksumSha256: "9b28c40eb5a3d1249b28c40eb5a3d1249b28c40eb5a3d1249b28c40eb5a3d124",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 5033164,
      pageCount: 42,
      mimeType: "application/pdf",
      history: [{ user: "Jane Smith", action: "DOWNLOAD", at: "2026-07-11T09:20:00Z", ip: "196.27.0.12" }],
    },
    {
      id: "doc-102",
      name: "June 2026 Investor Statement",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      category: "Statements",
      period: "Jun 2026",
      publishedDate: "2026-07-05",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "2ac18d1170f214bc2ac18d1170f214bc2ac18d1170f214bc2ac18d1170f214bc",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 1258291,
      pageCount: 8,
      mimeType: "application/pdf",
    },
    {
      id: "doc-103",
      name: "CC-013 Capital Call Notice",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Capital Calls",
      period: "Jul 2026",
      publishedDate: "2026-07-01",
      version: "1.0",
      status: "REQUIRES_SIGNATURE",
      accessScope: "Investor account",
      checksumSha256: "f402aa9c0109f22af402aa9c0109f22af402aa9c0109f22af402aa9c0109f22a",
      permissions: ["VIEW", "DOWNLOAD", "ACKNOWLEDGE"],
      sourceType: "CAPITAL_CALL",
      sourceRefId: "cc-013",
      fileSizeBytes: 839680,
      pageCount: 4,
      mimeType: "application/pdf",
    },
    {
      id: "doc-104",
      name: "2025 Audited Financial Statements",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Financial Statements",
      period: "FY 2025",
      publishedDate: "2026-04-18",
      version: "2.0",
      status: "RESTATED",
      accessScope: "Fund investors",
      checksumSha256: "a811d5108f39ab06a811d5108f39ab06a811d5108f39ab06a811d5108f39ab06",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 7969177,
      pageCount: 96,
      mimeType: "application/pdf",
    },
    {
      id: "doc-105",
      name: "DIST-008 Distribution Statement",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Distributions",
      period: "Mar 2026",
      publishedDate: "2026-03-20",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "c1d2e3f4a5b60718c1d2e3f4a5b60718c1d2e3f4a5b60718c1d2e3f4a5b60718",
      permissions: ["VIEW", "DOWNLOAD"],
      sourceType: "DISTRIBUTION",
      sourceRefId: "dist-008",
      fileSizeBytes: 512000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-106",
      name: "DIST-007 Distribution Statement",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Distributions",
      period: "Dec 2025",
      publishedDate: "2025-12-12",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "d2e3f4a5b6071891d2e3f4a5b6071891d2e3f4a5b6071891d2e3f4a5b6071891",
      permissions: ["VIEW", "DOWNLOAD"],
      sourceType: "DISTRIBUTION",
      sourceRefId: "dist-007",
      fileSizeBytes: 498000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-107",
      name: "Q1 2026 Investor Report",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Fund Reports",
      period: "Q1 2026",
      publishedDate: "2026-04-12",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor organisation",
      checksumSha256: "e3f4a5b607189102e3f4a5b607189102e3f4a5b607189102e3f4a5b607189102",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 4200000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-108",
      name: "LPA Side Letter – Horizon Pension Fund",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Legal",
      period: null,
      publishedDate: "2023-03-15",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor organisation",
      checksumSha256: "f4a5b60718910213f4a5b60718910213f4a5b60718910213f4a5b60718910213",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 890000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-109",
      name: "May 2026 Investor Statement",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      category: "Statements",
      period: "May 2026",
      publishedDate: "2026-06-05",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "a5b6071891021345a5b6071891021345a5b6071891021345a5b6071891021345",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 1100000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-110",
      name: "Tax Form K-1 Estimate 2025",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Tax",
      period: "FY 2025",
      publishedDate: "2026-02-28",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "b607189102134567b607189102134567b607189102134567b607189102134567",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 320000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-111",
      name: "CC-012 Capital Call Notice",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      category: "Capital Calls",
      period: "Jun 2026",
      publishedDate: "2026-06-01",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "c718920213456789c718920213456789c718920213456789c718920213456789",
      permissions: ["VIEW", "DOWNLOAD"],
      sourceType: "CAPITAL_CALL",
      sourceRefId: "cc-012",
      fileSizeBytes: 810000,
      mimeType: "application/pdf",
    },
    {
      id: "doc-112",
      name: "Subscription Confirmation SUB-024",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      category: "Dealing",
      period: "May 2026",
      publishedDate: "2026-06-03",
      version: "1.0",
      status: "PUBLISHED",
      accessScope: "Investor account",
      checksumSha256: "d829031324567890d829031324567890d829031324567890d829031324567890",
      permissions: ["VIEW", "DOWNLOAD"],
      fileSizeBytes: 240000,
      mimeType: "application/pdf",
    },
  ]

  const notices: LpNotice[] = [
    {
      id: "notice-31",
      title: "Q2 2026 investor report is available",
      status: "PUBLISHED",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      shareClass: null,
      publishedAt: "2026-07-10T08:00:00Z",
      acknowledgedAt: null,
      category: "REPORT",
      kind: "INFO",
      requiresAcknowledgement: false,
      preview: "The Q2 2026 investor report for Matanho Growth Fund I is now available in Document Centre.",
      body: "Dear Investor,\n\nThe Q2 2026 investor report for Matanho Growth Fund I has been published and is available for download in the Document Centre.\n\nKind regards,\nMatanho Investor Relations",
      openedAt: null,
    },
    {
      id: "notice-30",
      title: "Capital Call CC-013 issued",
      status: "PUBLISHED",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      shareClass: null,
      publishedAt: "2026-07-01T09:00:00Z",
      acknowledgedAt: null,
      category: "CAPITAL_CALL",
      kind: "ACTION_REQUIRED",
      requiresAcknowledgement: true,
      preview: "Capital Call #13 for USD 150,000 is due 20 Jul 2026. Please acknowledge and arrange remittance.",
      body: "Dear Investor,\n\nCapital Call #13 has been issued for USD 150,000.00 with a due date of 20 July 2026.\n\nPlease acknowledge this notice and arrange payment using the wiring instructions on the call notice.\n\nReference: INV-AGFI-1042 / CC-013",
      openedAt: null,
    },
    {
      id: "notice-29",
      title: "June NAV finalised",
      status: "PUBLISHED",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      shareClass: "Class A USD",
      publishedAt: "2026-07-05T07:30:00Z",
      acknowledgedAt: "2026-07-06T10:00:00Z",
      category: "NAV",
      kind: "INFO",
      requiresAcknowledgement: false,
      preview: "June 2026 NAV per unit finalised at USD 15.4448.",
      body: "The June 2026 NAV for Class A USD has been finalised at USD 15.4448 per unit.",
      openedAt: "2026-07-06T09:55:00Z",
    },
    {
      id: "notice-28",
      title: "Scheduled maintenance – weekend window",
      status: "PUBLISHED",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      shareClass: null,
      publishedAt: "2026-06-28T12:00:00Z",
      acknowledgedAt: null,
      category: "SYSTEM",
      kind: "INFO",
      requiresAcknowledgement: false,
      preview: "Portal maintenance Saturday 28 Jun 22:00–02:00 UTC.",
      body: "The LP Portal will undergo scheduled maintenance from 22:00 UTC Saturday to 02:00 UTC Sunday. Access may be intermittent.",
      openedAt: "2026-06-28T14:00:00Z",
    },
    {
      id: "notice-27",
      title: "Distribution DIST-008 paid",
      status: "PUBLISHED",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      shareClass: null,
      publishedAt: "2026-03-20T11:00:00Z",
      acknowledgedAt: "2026-03-21T09:00:00Z",
      category: "DISTRIBUTION",
      kind: "INFO",
      requiresAcknowledgement: false,
      preview: "Exit proceeds distribution of USD 490,000 net has been paid.",
      body: "Distribution DIST-008 (Exit Proceeds) has been paid to your nominated bank account ending 7719.",
      openedAt: "2026-03-20T15:00:00Z",
    },
    {
      id: "notice-26",
      title: "Updated dealing calendar for Equity Opportunities",
      status: "PUBLISHED",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      shareClass: "Class A USD",
      publishedAt: "2026-05-01T08:00:00Z",
      acknowledgedAt: null,
      category: "DEALING",
      kind: "INFO",
      requiresAcknowledgement: true,
      preview: "Please review the updated monthly dealing calendar and notice periods.",
      body: "An updated dealing calendar is in effect from May 2026. Subscriptions settle T+2; redemptions require 30 days' notice.",
      openedAt: null,
    },
  ]

  const requests: LpServiceRequest[] = [
    {
      id: "req-1082",
      reference: "REQ-1082",
      type: "Capital Activity",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      status: "AWAITING_INVESTOR",
      subject: "Confirm payment reference for CC-013",
      description: "Please confirm the remittance reference that will accompany your payment for Capital Call #13.",
      createdAt: "2026-07-12T10:00:00Z",
      updatedAt: "2026 the-07-16T14:10:00Z".replace(" the-", "-"),
      priority: "HIGH",
      submittedBy: "Jane Smith",
      attachments: [],
      messages: [
        {
          id: "rmsg-1",
          authorType: "INTERNAL",
          authorId: "ops-1",
          body: "Please confirm the remittance reference that will accompany your payment.",
          createdAt: "2026-07-16T14:10:00Z",
        },
        {
          id: "rmsg-0",
          authorType: "INVESTOR",
          authorId: "usr-1",
          body: "We intend to wire funds on 18 July. What reference should we use?",
          createdAt: "2026-07-12T10:05:00Z",
        },
      ],
    },
    {
      id: "req-1074",
      reference: "REQ-1074",
      type: "Account / Statement",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      status: "UNDER_REVIEW",
      subject: "June statement reconciliation",
      description: "Request for transaction-level reconciliation of the June 2026 investor statement.",
      createdAt: "2026-07-07T09:00:00Z",
      updatedAt: "2026-07-15T09:42:00Z",
      priority: "NORMAL",
      submittedBy: "Jane Smith",
      attachments: [
        {
          id: "att-rec-1",
          name: "June-Reconciliation.xlsx",
          size: 48200,
        },
      ],
      messages: [
        {
          id: "rmsg-3",
          authorType: "INTERNAL",
          authorId: "ops-2",
          body: "We have attached the transaction-level reconciliation requested.",
          createdAt: "2026-07-15T09:42:00Z",
          attachments: [{ id: "att-rec-1", name: "June-Reconciliation.xlsx", size: 48200 }],
        },
        {
          id: "rmsg-2",
          authorType: "INVESTOR",
          authorId: "usr-1",
          body: "Thank you. Please include the NAV approval date.",
          createdAt: "2026-07-14T15:22:00Z",
        },
      ],
    },
    {
      id: "req-1031",
      reference: "REQ-1031",
      type: "Profile / Access",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      status: "CLOSED",
      subject: "Add finance colleague",
      description: "Please invite Rudo Maposa as Viewer on both funds.",
      createdAt: "2026-05-14T11:00:00Z",
      updatedAt: "2026-05-19T16:00:00Z",
      priority: "NORMAL",
      submittedBy: "Jane Smith",
      attachments: [],
      messages: [
        {
          id: "rmsg-4",
          authorType: "INTERNAL",
          authorId: "ops-1",
          body: "Colleague access has been provisioned. Closing this request.",
          createdAt: "2026-05-19T16:00:00Z",
        },
      ],
    },
    {
      id: "req-1090",
      reference: "REQ-1090",
      type: "Tax / Reporting",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      status: "SUBMITTED",
      subject: "Request final K-1 for FY 2025",
      description: "Please advise when the final Schedule K-1 will be available.",
      createdAt: "2026-07-18T08:30:00Z",
      updatedAt: "2026-07-18T08:30:00Z",
      priority: "NORMAL",
      submittedBy: "Jane Smith",
      attachments: [],
      messages: [],
    },
  ]

  const messageThreads: LpMessageThreadDetail[] = [
    {
      id: "thread-req-1082",
      subject: "Capital Call #13 – Payment reference",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      relatedType: "REQUEST",
      relatedId: "REQ-1082",
      status: "OPEN",
      participants: [
        { name: "Jane Smith", initials: "JS", role: "MANAGER" },
        { name: "Matanho Fund Operations", initials: "AO", role: "INTERNAL" },
      ],
      messages: [
        {
          id: "tmsg-1",
          authorType: "INVESTOR",
          authorId: "usr-1",
          body: "We intend to wire funds on 18 July. What reference should we use?",
          readAt: "2026-07-12T12:00:00Z",
          createdAt: "2026-07-12T10:05:00Z",
        },
        {
          id: "tmsg-2",
          authorType: "INTERNAL",
          authorId: "ops-1",
          body: "Please confirm the remittance reference that will accompany your payment. Use INV-AGFI-1042 / CC-013.",
          readAt: null,
          createdAt: "2026-07-16T14:10:00Z",
        },
      ],
    },
    {
      id: "thread-req-1074",
      subject: "June statement reconciliation",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      relatedType: "REQUEST",
      relatedId: "REQ-1074",
      status: "OPEN",
      participants: [
        { name: "Jane Smith", initials: "JS", role: "MANAGER" },
        { name: "Miriam Dube", initials: "MD", role: "INTERNAL" },
      ],
      messages: [
        {
          id: "tmsg-3",
          authorType: "INVESTOR",
          authorId: "usr-1",
          body: "Thank you. Please include the NAV approval date.",
          readAt: "2026-07-14T16:00:00Z",
          createdAt: "2026-07-14T15:22:00Z",
        },
        {
          id: "tmsg-4",
          authorType: "INTERNAL",
          authorId: "ops-2",
          body: "We have attached the transaction-level reconciliation requested. NAV was approved on 3 Jul 2026.",
          readAt: null,
          createdAt: "2026-07-15T09:42:00Z",
          attachments: [{ id: "att-rec-1", name: "June-Reconciliation.xlsx", size: 48200 }],
        },
      ],
    },
    {
      id: "thread-gen-01",
      subject: "Welcome to the LP Portal",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      relatedType: "GENERAL",
      relatedId: "welcome",
      status: "CLOSED",
      participants: [
        { name: "Jane Smith", initials: "JS", role: "MANAGER" },
        { name: "Matanho Investor Relations", initials: "IR", role: "INTERNAL" },
      ],
      messages: [
        {
          id: "tmsg-5",
          authorType: "INTERNAL",
          authorId: "ir-1",
          body: "Welcome to the Matanho LP Portal. Your organisation has access to Growth Fund I and Equity Opportunities.",
          readAt: "2026-01-10T10:00:00Z",
          createdAt: "2026-01-09T09:00:00Z",
        },
      ],
    },
  ]

  const accountActivity: LpAccountActivityEntry[] = [
    {
      entryId: "txn-1008",
      entryType: "FEE",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      transactionDate: "2026-07-15",
      amount: money(-1250),
      currency: "USD",
      description: "Management fee accrual – Jul 2026",
      status: "POSTED",
      operatingModel: "OPEN_ENDED",
      structure: "Open-ended",
    },
    {
      entryId: "txn-1007",
      entryType: "REDEMPTION",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      transactionDate: "2026-07-08",
      amount: money(-250000),
      currency: "USD",
      description: "Redemption request RDM-016",
      status: "UNDER_REVIEW",
      operatingModel: "OPEN_ENDED",
      structure: "Open-ended",
    },
    {
      entryId: "txn-1006",
      entryType: "CAPITAL_CALL",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      transactionDate: "2026-07-01",
      amount: money(150000),
      currency: "USD",
      description: "Capital Call CC-013",
      status: "ISSUED",
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      entryId: "txn-1005",
      entryType: "SUBSCRIPTION",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      transactionDate: "2026-05-22",
      amount: money(500000),
      currency: "USD",
      description: "Subscription SUB-024",
      status: "ALLOCATED",
      operatingModel: "OPEN_ENDED",
      structure: "Open-ended",
    },
    {
      entryId: "txn-1004",
      entryType: "DISTRIBUTION",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      transactionDate: "2026-03-20",
      amount: money(-490000),
      currency: "USD",
      description: "Distribution DIST-008 – Exit Proceeds",
      status: "PAID",
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      entryId: "txn-1003",
      entryType: "CAPITAL_CALL",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      transactionDate: "2026-06-01",
      amount: money(250000),
      currency: "USD",
      description: "Capital Call CC-012",
      status: "PAID",
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      entryId: "txn-1002",
      entryType: "DISTRIBUTION",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      transactionDate: "2025-12-12",
      amount: money(-176400),
      currency: "USD",
      description: "Distribution DIST-007 – Dividend",
      status: "PAID",
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      entryId: "txn-1001",
      entryType: "CAPITAL_CALL",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      transactionDate: "2026-02-01",
      amount: money(500000),
      currency: "USD",
      description: "Capital Call CC-011",
      status: "PAID",
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      entryId: "txn-1000",
      entryType: "OTHER",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      transactionDate: "2026-04-01",
      amount: money(0),
      currency: "USD",
      description: "Share class rebalancing (book entry)",
      status: "POSTED",
      operatingModel: "OPEN_ENDED",
      structure: "Open-ended",
    },
  ]

  const ledgerDetails: Record<string, LpLedgerDetail> = {
    "txn-1006": {
      entryType: "CAPITAL_CALL",
      allocation: {
        id: "alloc-cc-013",
        clientId: "cli-horizon-001",
        currentCallAmount: money(150000),
        amountPaid: money(0),
        status: "OUTSTANDING",
      },
      payments: [],
      callNoticeDocumentId: "doc-103",
      documents: [
        { id: "doc-103", name: "CC-013 Capital Call Notice", publishedDate: "2026-07-01", size: 839680 },
      ],
    },
    "txn-1003": {
      entryType: "CAPITAL_CALL",
      allocation: {
        id: "alloc-cc-012",
        clientId: "cli-horizon-001",
        currentCallAmount: money(250000),
        amountPaid: money(250000),
        status: "PAID",
      },
      payments: [
        { id: "pay-012", amount: money(250000), receivedAt: "2026-06-18T11:05:00Z", method: "WIRE" },
      ],
      callNoticeDocumentId: "doc-111",
      documents: [
        { id: "doc-111", name: "CC-012 Capital Call Notice", publishedDate: "2026-06-01", size: 810000 },
      ],
    },
    "txn-1004": {
      entryType: "DISTRIBUTION",
      payments: [
        { id: "pay-dist-008", amount: money(490000), paidAt: "2026-03-20T11:00:00Z", method: "WIRE" },
      ],
      documents: [
        { id: "doc-105", name: "DIST-008 Distribution Statement", publishedDate: "2026-03-20", size: 512000 },
      ],
    },
    "txn-1007": {
      entryType: "REDEMPTION",
      payments: [],
      documents: [],
    },
    "txn-1005": {
      entryType: "SUBSCRIPTION",
      payments: [
        { id: "pay-sub-024", amount: money(500000), receivedAt: "2026-05-28T14:00:00Z", method: "WIRE" },
      ],
      documents: [
        { id: "doc-112", name: "Subscription Confirmation SUB-024", publishedDate: "2026-06-03", size: 240000 },
      ],
    },
  }

  // default ledger detail for any entry without a specific one
  for (const entry of accountActivity) {
    if (!ledgerDetails[entry.entryId]) {
      ledgerDetails[entry.entryId] = {
        entryType: entry.entryType,
        payments: [],
        documents: [],
      }
    }
  }

  const dealingOverviews: Record<string, LpDealingOverview> = {
    [EQUITY]: {
      fundId: EQUITY,
      shareClass: "Class A USD",
      asOfDate: AS_OF,
      valuationStatus: "FINAL",
      navPerUnit: "15.4448",
      accountValue: money(2845390),
      unitsHeld: "184233.4821",
      availableToRedeemValue: money(2595390),
      availableUnits: "168046.7120",
      pendingSubscriptions: money(0),
      pendingRedemptions: money(250000),
      rules: {
        minBalanceAmount: money(100000),
        minBalanceUnits: "5000.0000",
        noticeDays: 30,
        dealingFrequency: "MONTHLY",
        nextEligibleDealingDate: "2026-08-01",
        settlementLagDays: 2,
        subscription: { mgmtFeeRate: "0.0150", otherFeeFlat: money(250), maxFileMb: 10 },
        redemption: { feeRate: "0.0050", modes: ["AMOUNT", "UNITS", "FULL"] },
        compliance: {
          accreditedInvestor: true,
          kycStatus: "APPROVED",
          noUnsettledCapitalCalls: true,
          noLegalHolds: true,
          blockers: [],
          termsUrl: "/legal/dealing-terms",
          holdReason: null,
        },
      },
      compliance: {
        accreditedInvestor: true,
        kycStatus: "APPROVED",
        noUnsettledCapitalCalls: true,
        noLegalHolds: true,
        blockers: [],
        termsUrl: "/legal/dealing-terms",
        holdReason: null,
      },
    },
    [GROWTH]: {
      fundId: GROWTH,
      shareClass: "N/A",
      asOfDate: AS_OF,
      valuationStatus: "FINAL",
      navPerUnit: "0",
      accountValue: money(4420000),
      unitsHeld: "0",
      availableToRedeemValue: money(0),
      availableUnits: "0",
      pendingSubscriptions: money(0),
      pendingRedemptions: money(0),
      rules: {
        minBalanceAmount: money(0),
        minBalanceUnits: "0",
        noticeDays: 0,
        dealingFrequency: "N/A",
        nextEligibleDealingDate: AS_OF,
        settlementLagDays: 0,
        subscription: { mgmtFeeRate: "0", otherFeeFlat: money(0), maxFileMb: 10 },
        redemption: { feeRate: "0", modes: ["AMOUNT"] },
        compliance: {
          accreditedInvestor: true,
          kycStatus: "APPROVED",
          noUnsettledCapitalCalls: false,
          noLegalHolds: true,
          blockers: ["Dealing not available for private capital funds"],
          holdReason: null,
        },
      },
      compliance: {
        accreditedInvestor: true,
        kycStatus: "APPROVED",
        noUnsettledCapitalCalls: false,
        noLegalHolds: true,
        blockers: ["Dealing not available for private capital funds"],
        holdReason: null,
      },
    },
  }

  const performanceGrowth: LpPerformanceData = {
    asOfDate: AS_OF,
    valuationStatus: "FINAL",
    period: "SI",
    calculationDate: "2026-07-08",
    version: "v2026.06.1",
    sourceModule: "PERFORMANCE",
    reportingCurrency: "USD",
    approvedBy: "IR Desk",
    metrics: {
      totalCommitment: money(5000000),
      paidIn: money(3750000),
      distributions: money(1820000),
      currentNav: money(4420000),
      netIrr: "0.1840",
      tvpi: "1.66",
      dpi: "0.49",
      rvpi: "1.18",
    },
    byFund: [],
    benchmark: null,
  }

  const performanceEquity: LpPerformanceData = {
    asOfDate: AS_OF,
    valuationStatus: "FINAL",
    period: "SI",
    calculationDate: "2026-07-05",
    version: "v2026.06.1",
    sourceModule: "PERFORMANCE",
    reportingCurrency: "USD",
    approvedBy: "IR Desk",
    metrics: {
      totalCommitment: money(0),
      paidIn: money(2500000),
      distributions: money(350000),
      currentNav: money(2845390),
      netIrr: "0.1282",
      tvpi: "1.28",
      dpi: "0.14",
      rvpi: "1.14",
    },
    byFund: [],
    benchmark: null,
    openEndedMetrics: {
      ytdReturn: "0.1282",
      navPerUnit: "15.4448",
      unitsHeld: "184233.4821",
      accountValue: money(2845390),
    },
  }

  const performanceByFundRows: LpPerformanceByFundRow[] = [
    {
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      netIrr: "0.1840",
      tvpi: "1.66",
      dpi: "0.49",
      rvpi: "1.18",
      nav: money(4420000),
      paidIn: money(3750000),
      distributions: money(1820000),
      operatingModel: "PRIVATE_CAPITAL",
      structure: "Private capital",
    },
    {
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      netIrr: "0.1282",
      tvpi: "1.28",
      dpi: "0.14",
      rvpi: "1.14",
      nav: money(2845390),
      paidIn: money(2500000),
      distributions: money(350000),
      operatingModel: "OPEN_ENDED",
      structure: "Open-ended",
    },
  ]

  performanceGrowth.byFund = performanceByFundRows
  performanceEquity.byFund = performanceByFundRows

  const historyGrowth: LpPerformanceHistory = {
    asOfDate: AS_OF,
    valuationStatus: "FINAL",
    range: "SI",
    points: [
      { date: "2025-06-30", label: "Jun 2025", nav: money(3610000), paidIn: money(3250000), distributions: money(1140000) },
      { date: "2025-12-31", label: "Dec 2025", nav: money(3980000), paidIn: money(3250000), distributions: money(1316400) },
      { date: "2026-03-31", label: "Mar 2026", nav: money(4210000), paidIn: money(3750000), distributions: money(1806400) },
      { date: "2026-06-30", label: "Jun 2026", nav: money(4420000), paidIn: money(3750000), distributions: money(1820000) },
    ],
  }

  const historyEquity: LpPerformanceHistory = {
    asOfDate: AS_OF,
    valuationStatus: "FINAL",
    range: "SI",
    points: [
      { date: "2025-06-30", label: "Jun 2025", nav: money(2280000), paidIn: money(2000000), distributions: money(100000) },
      { date: "2025-12-31", label: "Dec 2025", nav: money(2520000), paidIn: money(2200000), distributions: money(200000) },
      { date: "2026-03-31", label: "Mar 2026", nav: money(2675000), paidIn: money(2500000), distributions: money(300000) },
      { date: "2026-06-30", label: "Jun 2026", nav: money(2845390), paidIn: money(2500000), distributions: money(350000) },
    ],
  }

  const vault: LpVaultDocument[] = [
    {
      documentId: "vault-tax-1",
      category: "TAX",
      title: "Tax Form K-1 Estimate 2025",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      publishedAt: "2026-02-28T10:00:00Z",
      sourceType: "TAX",
      sha256: "b607189102134567b607189102134567b607189102134567b607189102134567",
    },
    {
      documentId: "vault-audit-1",
      category: "AUDIT",
      title: "2025 Audited Financial Statements",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      publishedAt: "2026-04-18T10:00:00Z",
      sourceType: "AUDIT",
      sha256: "a811d5108f39ab06a811d5108f39ab06a811d5108f39ab06a811d5108f39ab06",
    },
    {
      documentId: "vault-perf-1",
      category: "PERFORMANCE_REPORT",
      title: "Q2 2026 Investor Report",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      publishedAt: "2026-07-10T08:00:00Z",
      sourceType: "REPORT",
      sha256: "9b28c40eb5a3d1249b28c40eb5a3d1249b28c40eb5a3d1249b28c40eb5a3d124",
    },
    {
      documentId: "vault-call-1",
      category: "CALL_NOTICE",
      title: "CC-013 Capital Call Notice",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      publishedAt: "2026-07-01T09:00:00Z",
      sourceType: "CAPITAL_CALL",
      sha256: "f402aa9c0109f22af402aa9c0109f22af402aa9c0109f22af402aa9c0109f22a",
    },
    {
      documentId: "vault-stmt-1",
      category: "QUARTERLY_STATEMENT",
      title: "June 2026 Investor Statement",
      fundId: EQUITY,
      fundName: "Matanho Equity Opportunities Fund",
      publishedAt: "2026-07-05T07:30:00Z",
      sourceType: "STATEMENT",
      sha256: "2ac18d1170f214bc2ac18d1170f214bc2ac18d1170f214bc2ac18d1170f214bc",
    },
    {
      documentId: "vault-legal-1",
      category: "LEGAL",
      title: "LPA Side Letter – Horizon Pension Fund",
      fundId: GROWTH,
      fundName: "Matanho Growth Fund I",
      publishedAt: "2023-03-15T12:00:00Z",
      sourceType: "LEGAL",
      sha256: "f4a5b60718910213f4a5b60718910213f4a5b60718910213f4a5b60718910213",
    },
  ]

  const reports: LpReport[] = [
    {
      jobId: "job-rpt-001",
      runId: "run-2026-q2-agfi",
      fundName: "Matanho Growth Fund I",
      templateName: "Quarterly Investor Pack",
      reportLevel: "INVESTOR",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      status: "DELIVERED",
      deliveredAt: "2026-07-10T08:00:00Z",
      transportMethod: "PORTAL",
      metrics: {
        dpi: 0.49,
        nav: 4420000,
        rvpi: 1.18,
        tvpi: 1.66,
        fundId: GROWTH,
        netIrr: 0.184,
        clientId: "cli-horizon-001",
        fundName: "Matanho Growth Fund I",
        periodEnd: "2026-06-30",
        lpLegalName: "Horizon Pension Fund LP",
        periodStart: "2026-04-01",
        totalPaidIn: 3750000,
        currencyCode: "USD",
        holdingsSummary: "12 active holdings",
        totalCommitment: 5000000,
        totalDistributions: 1820000,
        unfundedCommitment: 1100000,
      },
    },
    {
      jobId: "job-rpt-002",
      runId: "run-2026-jun-aeof",
      fundName: "Matanho Equity Opportunities Fund",
      templateName: "Monthly Statement Pack",
      reportLevel: "INVESTOR",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      status: "DELIVERED",
      deliveredAt: "2026-07-05T07:30:00Z",
      transportMethod: "PORTAL",
      metrics: {
        dpi: 0.14,
        nav: 2845390,
        rvpi: 1.14,
        tvpi: 1.28,
        fundId: EQUITY,
        netIrr: 0.1282,
        clientId: "cli-horizon-001",
        fundName: "Matanho Equity Opportunities Fund",
        periodEnd: "2026-06-30",
        lpLegalName: "Horizon Pension Fund LP",
        periodStart: "2026-06-01",
        totalPaidIn: 2500000,
        currencyCode: "USD",
        holdingsSummary: "Class A USD",
        totalCommitment: 0,
        totalDistributions: 350000,
        unfundedCommitment: 0,
      },
    },
  ]

  const store: MockLpPortalStore = {
    session: {
      client: {
        id: "cli-horizon-001",
        legalName: "Horizon Pension Fund LP",
        email: "jane.smith@horizonpension.example",
        investorId: "INV-HORIZON-001",
        displayName: "Jane Smith",
      },
      lpRole: "MANAGER",
      presentationCurrency: "USD",
      defaultAsOfDate: AS_OF,
      defaultValuationStatus: "FINAL",
      funds: [
        {
          fundId: GROWTH,
          publicReference: "FND-AGFI",
          fundName: "Matanho Growth Fund I",
          shortName: "Growth Fund I",
          operatingModel: "PRIVATE_CAPITAL",
          currencyCode: "USD",
          shareClass: null,
          asOfDate: AS_OF,
          valuationStatus: "FINAL",
          investorAccountReference: "INV-AGFI-1042",
          commitmentAmount: money(5000000),
        },
        {
          fundId: EQUITY,
          publicReference: "FND-AEOF",
          fundName: "Matanho Equity Opportunities Fund",
          shortName: "Equity Opportunities",
          operatingModel: "OPEN_ENDED",
          currencyCode: "USD",
          shareClass: "Class A USD",
          asOfDate: AS_OF,
          valuationStatus: "FINAL",
          investorAccountReference: "INV-AEOF-2218",
          commitmentAmount: money(0),
        },
      ],
      unreadCounts: {
        requests: 2,
        messages: 2,
        notices: 3,
        notifications: 5,
      },
    },
    notifications: [
      {
        id: "ntf-1",
        title: "Capital Call CC-013 is due soon",
        href: "/lp-portal/capital-activity?call=cc-013",
        fundName: "Matanho Growth Fund I",
        createdAt: "2026-07-18T08:00:00Z",
        type: "CAPITAL_CALL",
        read: false,
      },
      {
        id: "ntf-2",
        title: "New message on REQ-1082",
        href: "/lp-portal/requests?thread=thread-req-1082",
        fundName: "Matanho Growth Fund I",
        createdAt: "2026-07-16T14:12:00Z",
        type: "MESSAGE",
        read: false,
      },
      {
        id: "ntf-3",
        title: "Q2 2026 investor report published",
        href: "/lp-portal/documents?doc=doc-101",
        fundName: "Matanho Growth Fund I",
        createdAt: "2026-07-10T08:05:00Z",
        type: "DOCUMENT",
        read: false,
      },
      {
        id: "ntf-4",
        title: "June NAV finalised",
        href: "/lp-portal/notices?id=notice-29",
        fundName: "Matanho Equity Opportunities Fund",
        createdAt: "2026-07-05T07:35:00Z",
        type: "NOTICE",
        read: true,
      },
      {
        id: "ntf-5",
        title: "Redemption RDM-016 under review",
        href: "/lp-portal/subscriptions-redemptions",
        fundName: "Matanho Equity Opportunities Fund",
        createdAt: "2026-07-09T10:00:00Z",
        type: "DEALING",
        read: false,
      },
    ],
    settings: {
      notifications: {
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
        digest: "weekly",
      },
      mfa: {
        requireMfaForLp: true,
        issuerName: "Matanho LP Portal",
        enabled: true,
        enabledAt: "2025-11-02T09:00:00Z",
        manageUrl: "/account/security/mfa",
        sessionsUrl: "/account/security/sessions",
        passwordUrl: "/account/security/password",
      },
      presentationCurrency: "USD",
      defaultAsOfPreference: "LATEST_FINAL",
    },
    dashboards: {
      [GROWTH]: {
        asOfDate: AS_OF,
        valuationStatus: "FINAL",
        kpis: {
          totalCommitment: money(5000000),
          paidIn: money(3750000),
          unfunded: money(1100000),
          currentNav: money(4420000),
          distributions: money(1820000),
          netIrr: "0.1840",
          tvpi: "1.66",
          dpi: "0.49",
          rvpi: "1.18",
          investmentCount: 12,
        },
      },
      [EQUITY]: {
        asOfDate: AS_OF,
        valuationStatus: "FINAL",
        kpis: {
          totalCommitment: money(0),
          paidIn: money(2500000),
          unfunded: money(0),
          currentNav: money(2845390),
          distributions: money(350000),
          netIrr: "0.1282",
          tvpi: "1.28",
          dpi: "0.14",
          rvpi: "1.14",
          investmentCount: 1,
        },
        openEndedSummary: {
          accountValue: money(2845390),
          unitsHeld: "184233.4821",
          navPerUnit: "15.4448",
          ytdReturn: "0.1282",
        },
        openEndedHistory: {
          points: [
            { label: "Jun 2025", navPerUnit: "13.2014", date: "2025-06-30" },
            { label: "Dec 2025", navPerUnit: "13.6899", date: "2025-12-31" },
            { label: "Mar 2026", navPerUnit: "14.5197", date: "2026-03-31" },
            { label: "Jun 2026", navPerUnit: "15.4448", date: "2026-06-30" },
          ],
        },
      },
    },
    dashboardActions: [
      {
        id: "act-1",
        type: "CAPITAL_CALL",
        severity: "HIGH",
        title: "Acknowledge Capital Call CC-013",
        fundId: GROWTH,
        relatedRecordId: "cc-013",
        href: "/lp-portal/capital-activity?call=cc-013",
        dueDate: "2026-07-20",
        amount: money(150000),
        fundName: "Matanho Growth Fund I",
        label: "Action required",
      },
      {
        id: "act-2",
        type: "NOTICE",
        severity: "MEDIUM",
        title: "Acknowledge dealing calendar notice",
        fundId: EQUITY,
        relatedRecordId: "notice-26",
        href: "/lp-portal/notices?id=notice-26",
        dueDate: null,
        fundName: "Matanho Equity Opportunities Fund",
        label: "Acknowledgement",
      },
      {
        id: "act-3",
        type: "REQUEST",
        severity: "MEDIUM",
        title: "Reply to payment reference request",
        fundId: GROWTH,
        relatedRecordId: "REQ-1082",
        href: "/lp-portal/requests?ref=REQ-1082",
        dueDate: "2026-07-22",
        fundName: "Matanho Growth Fund I",
        label: "Awaiting you",
      },
    ],
    recentActivity: [
      {
        id: "ra-1",
        type: "CAPITAL_CALL",
        title: "Capital Call CC-013 issued",
        fundId: GROWTH,
        amount: money(150000),
        status: "ISSUED",
        at: "2026-07-01T09:00:00Z",
      },
      {
        id: "ra-2",
        type: "DOCUMENT",
        title: "Q2 2026 Investor Report published",
        fundId: GROWTH,
        amount: money(0),
        status: "PUBLISHED",
        at: "2026-07-10T08:00:00Z",
      },
      {
        id: "ra-3",
        type: "REDEMPTION",
        title: "Redemption RDM-016 submitted",
        fundId: EQUITY,
        amount: money(250000),
        status: "UNDER_REVIEW",
        at: "2026-07-08T11:00:00Z",
      },
      {
        id: "ra-4",
        type: "DISTRIBUTION",
        title: "Distribution DIST-008 paid",
        fundId: GROWTH,
        amount: money(490000),
        status: "PAID",
        at: "2026-03-20T11:00:00Z",
      },
      {
        id: "ra-5",
        type: "SUBSCRIPTION",
        title: "Subscription SUB-024 allocated",
        fundId: EQUITY,
        amount: money(500000),
        status: "ALLOCATED",
        at: "2026-06-03T10:00:00Z",
      },
    ],
    capitalCalls,
    capitalCallDocuments: {
      "cc-013": [
        {
          id: "doc-103",
          name: "CC-013 Capital Call Notice",
          category: "Capital Calls",
          publishedDate: "2026-07-01",
          checksumSha256: "f402aa9c0109f22af402aa9c0109f22af402aa9c0109f22af402aa9c0109f22a",
          status: "REQUIRES_SIGNATURE",
        },
        {
          id: "doc-103-wire",
          name: "CC-013 Wiring Instructions",
          category: "Capital Calls",
          publishedDate: "2026-07-01",
          checksumSha256: "aa11bb22cc33dd44aa11bb22cc33dd44aa11bb22cc33dd44aa11bb22cc33dd44",
          status: "PUBLISHED",
        },
      ],
      "cc-012": [
        {
          id: "doc-111",
          name: "CC-012 Capital Call Notice",
          category: "Capital Calls",
          publishedDate: "2026-06-01",
          checksumSha256: "c718920213456789c718920213456789c718920213456789c718920213456789",
          status: "PUBLISHED",
        },
      ],
      "cc-011": [],
      "cc-010": [],
    },
    capitalCallSummaries: {
      [GROWTH]: {
        openCount: 1,
        outstanding: money(150000),
        overdue: money(0),
        paidYtd: money(750000),
        currencyCode: "USD",
        paidCallCount: 3,
        dueSoonCount: 1,
        dueSoonAmount: money(150000),
        totalDistributions: money(1820000),
        upcomingDistributionNotices: { count: 0 },
      },
      [EQUITY]: {
        openCount: 0,
        outstanding: money(0),
        overdue: money(0),
        paidYtd: money(0),
        currencyCode: "USD",
        paidCallCount: 0,
        dueSoonCount: 0,
        dueSoonAmount: money(0),
        totalDistributions: money(350000),
        upcomingDistributionNotices: { count: 0 },
      },
    },
    distributions: [
      {
        id: "dist-008",
        reference: "DIST-008",
        fundId: GROWTH,
        fundName: "Matanho Growth Fund I",
        paymentDate: "2026-03-20",
        type: "Exit Proceeds",
        currencyCode: "USD",
        gross: money(500000),
        adjustments: money(10000),
        netPaid: money(490000),
        status: "PAID",
        destinationBankMasked: "•••• 7719",
        documentId: "doc-105",
      },
      {
        id: "dist-007",
        reference: "DIST-007",
        fundId: GROWTH,
        fundName: "Matanho Growth Fund I",
        paymentDate: "2025-12-12",
        type: "Dividend",
        currencyCode: "USD",
        gross: money(180000),
        adjustments: money(3600),
        netPaid: money(176400),
        status: "PAID",
        destinationBankMasked: "•••• 7719",
        documentId: "doc-106",
      },
      {
        id: "dist-006",
        reference: "DIST-006",
        fundId: GROWTH,
        fundName: "Matanho Growth Fund I",
        paymentDate: "2025-06-30",
        type: "Return of Capital",
        currencyCode: "USD",
        gross: money(220000),
        adjustments: money(0),
        netPaid: money(220000),
        status: "PAID",
        destinationBankMasked: "•••• 7719",
        documentId: null,
      },
    ],
    dealingOverviews,
    bankAccounts: [
      {
        id: "bank-1",
        label: "Primary USD operating",
        bankName: "Standard Chartered Bank",
        accountName: "Horizon Pension Fund LP",
        accountNumberMasked: "•••• 7719",
        currencyCode: "USD",
        isDefault: true,
        fundId: null,
        status: "ACTIVE",
      },
      {
        id: "bank-2",
        label: "Equity Opportunities settlement",
        bankName: "Stanbic Bank",
        accountName: "Horizon Pension Fund LP",
        accountNumberMasked: "•••• 3341",
        currencyCode: "USD",
        isDefault: false,
        fundId: EQUITY,
        status: "ACTIVE",
      },
      {
        id: "bank-3",
        label: "Growth Fund collections (read-only)",
        bankName: "First National Correspondent Bank",
        accountName: "Matanho Growth Fund I LP Collection",
        accountNumberMasked: "•••• 4812",
        currencyCode: "USD",
        isDefault: false,
        fundId: GROWTH,
        status: "ACTIVE",
      },
    ],
    dealingRequests: [
      {
        id: "deal-sub-024",
        fundId: EQUITY,
        fundName: "Matanho Equity Opportunities Fund",
        shareClass: "Class A USD",
        requestType: "SUBSCRIPTION",
        status: "ALLOCATED",
        amount: money(500000),
        units: "32935.9432",
        redemptionMode: null,
        currencyCode: "USD",
        requestedDealingDate: "2026-06-01",
        estimateSnapshotId: "est-sub-024",
        isEstimate: false,
        createdAt: "2026-05-22T14:00:00Z",
        notes: null,
      },
      {
        id: "deal-rdm-016",
        fundId: EQUITY,
        fundName: "Matanho Equity Opportunities Fund",
        shareClass: "Class A USD",
        requestType: "REDEMPTION",
        status: "UNDER_REVIEW",
        amount: money(250000),
        units: "16186.7702",
        redemptionMode: "AMOUNT",
        currencyCode: "USD",
        requestedDealingDate: "2026-08-01",
        estimateSnapshotId: "est-rdm-016",
        isEstimate: false,
        createdAt: "2026-07-08T11:00:00Z",
        notes: "Partial redemption",
      },
      {
        id: "deal-sub-018",
        fundId: EQUITY,
        fundName: "Matanho Equity Opportunities Fund",
        shareClass: "Class A USD",
        requestType: "SUBSCRIPTION",
        status: "ALLOCATED",
        amount: money(250000),
        units: "18245.1200",
        redemptionMode: null,
        currencyCode: "USD",
        requestedDealingDate: "2025-12-01",
        estimateSnapshotId: "est-sub-018",
        isEstimate: false,
        createdAt: "2025-11-20T10:00:00Z",
        notes: null,
      },
    ],
    performance: {
      [GROWTH]: performanceGrowth,
      [EQUITY]: performanceEquity,
    },
    performanceHistory: {
      [GROWTH]: historyGrowth,
      [EQUITY]: historyEquity,
    },
    performanceByFundRows,
    benchmarks: {
      [GROWTH]: {
        metric: "NET_IRR",
        asOfDate: AS_OF,
        valuationStatus: "FINAL",
        series: [
          { date: "2025-06-30", label: "Jun 2025", value: "0.1620" },
          { date: "2025-12-31", label: "Dec 2025", value: "0.1710" },
          { date: "2026-03-31", label: "Mar 2026", value: "0.1780" },
          { date: "2026-06-30", label: "Jun 2026", value: "0.1840" },
        ],
        note: "Mock Cambridge PE median IRR (illustrative).",
      },
      [EQUITY]: {
        metric: "NET_IRR",
        asOfDate: AS_OF,
        valuationStatus: "FINAL",
        series: [
          { date: "2025-06-30", label: "Jun 2025", value: "0.0850" },
          { date: "2025-12-31", label: "Dec 2025", value: "0.1010" },
          { date: "2026-03-31", label: "Mar 2026", value: "0.1120" },
          { date: "2026-06-30", label: "Jun 2026", value: "0.1200" },
        ],
        note: "Mock MSCI World equity benchmark (illustrative).",
      },
    },
    accountActivity,
    ledgerDetails,
    documents,
    documentsSummary: {
      total: documents.length,
      byCategory: [
        { category: "Fund Reports", count: 2 },
        { category: "Statements", count: 2 },
        { category: "Capital Calls", count: 2 },
        { category: "Distributions", count: 2 },
        { category: "Financial Statements", count: 1 },
        { category: "Legal", count: 1 },
        { category: "Tax", count: 1 },
        { category: "Dealing", count: 1 },
      ],
      newThisWeek: 2,
      requiresSignature: 1,
      secureDownloadsYtd: 14,
    },
    notices,
    requests,
    messageThreads,
    organisation: {
      id: "cli-horizon-001",
      legalName: "Horizon Pension Fund LP",
      investorId: "INV-HORIZON-001",
      email: "ir@horizonpension.example",
      country: "Zimbabwe",
      phone: "+263 242 000 000",
      address: "12 Samora Machel Avenue, Harare",
      status: "ACTIVE",
      lpRole: "MANAGER",
      colleagues,
    },
    bankChanges: [
      {
        id: "bic-1",
        fundId: EQUITY,
        fundName: "Matanho Equity Opportunities Fund",
        bankName: "Stanbic Bank",
        accountNumberMasked: "•••• 3341",
        requestedBy: "Jane Smith",
        submittedAt: "2026-04-02T11:20:00Z",
        status: "APPROVED",
      },
      {
        id: "bic-2",
        fundId: GROWTH,
        fundName: "Matanho Growth Fund I",
        bankName: "Standard Chartered Bank",
        accountNumberMasked: "•••• 7719",
        requestedBy: "Jane Smith",
        submittedAt: "2025-09-15T09:00:00Z",
        status: "APPROVED",
      },
    ],
    vault,
    reports,
    jobs: {
      "job-rpt-001": {
        jobId: "job-rpt-001",
        jobType: "PERFORMANCE_REPORT",
        status: "COMPLETED",
        downloadUrl: "/mock/reports/job-rpt-001.pdf",
        errorMessage: null,
        createdAt: "2026-07-10T07:55:00Z",
        completedAt: "2026-07-10T08:00:00Z",
      },
      "job-rpt-002": {
        jobId: "job-rpt-002",
        jobType: "PERFORMANCE_REPORT",
        status: "COMPLETED",
        downloadUrl: "/mock/reports/job-rpt-002.pdf",
        errorMessage: null,
        createdAt: "2026-07-05T07:20:00Z",
        completedAt: "2026-07-05T07:30:00Z",
      },
    },
    attachments: [],
    estimateCounter: 100,
    requestCounter: 1091,
    colleagueCounter: 4,
    bankChangeCounter: 3,
    dealingCounter: 30,
    jobCounter: 10,
  }

  return store
}

let store: MockLpPortalStore = buildSeed()

export function getMockStore(): MockLpPortalStore {
  return store
}

export function cloneStore(): MockLpPortalStore {
  return structuredClone(store)
}

export function resetMockStore(): void {
  store = buildSeed()
}

export { paginate }

export function acknowledgeNotice(id: string): { acknowledgedAt: string } {
  const notice = store.notices.find((n) => n.id === id)
  const acknowledgedAt = new Date().toISOString()
  if (notice) {
    notice.acknowledgedAt = acknowledgedAt
    notice.openedAt = notice.openedAt ?? acknowledgedAt
    store.dashboardActions = store.dashboardActions.filter((a) => a.relatedRecordId !== id)
  }
  return { acknowledgedAt }
}

export function acknowledgeCall(id: string): { acknowledgedAt: string } {
  const call = store.capitalCalls.find((c) => c.id === id)
  const acknowledgedAt = new Date().toISOString()
  if (call) {
    call.acknowledgedAt = acknowledgedAt
    if (call.status === "ISSUED") call.status = "ACKNOWLEDGED"
    const ackStep = call.timeline.find((t) => t.code === "ACKNOWLEDGED")
    if (ackStep) {
      ackStep.at = acknowledgedAt
      ackStep.completed = true
    }
    store.dashboardActions = store.dashboardActions.filter((a) => a.relatedRecordId !== id)
  }
  return { acknowledgedAt }
}

export function updateNotificationSettings(
  body: Partial<LpNotificationPreferences>,
): LpNotificationPreferences {
  store.settings.notifications = { ...store.settings.notifications, ...body }
  return { ...store.settings.notifications }
}

export function updateDisplaySettings(body: LpDisplaySettings): LpDisplaySettings {
  if (body.presentationCurrency) {
    store.settings.presentationCurrency = body.presentationCurrency
    store.session.presentationCurrency = body.presentationCurrency
  }
  if (body.defaultAsOfPreference !== undefined) {
    store.settings.defaultAsOfPreference = body.defaultAsOfPreference
  }
  return {
    presentationCurrency: store.settings.presentationCurrency,
    defaultAsOfPreference: store.settings.defaultAsOfPreference,
  }
}

export function addRequest(input: {
  type: string
  fundId?: string
  subject: string
  description: string
  priority?: string
  attachmentIds?: string[]
}): LpServiceRequest {
  const ref = `REQ-${store.requestCounter++}`
  const fundId = input.fundId ?? GROWTH
  const fund = store.session.funds.find((f) => f.fundId === fundId)
  const attachments = (input.attachmentIds ?? [])
    .map((id) => store.attachments.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => ({ id: a!.id, name: a!.name, size: a!.size }))

  const req: LpServiceRequest = {
    id: `req-${ref.toLowerCase()}`,
    reference: ref,
    type: input.type,
    fundId,
    fundName: fund?.fundName ?? "Unknown fund",
    status: "SUBMITTED",
    subject: input.subject,
    description: input.description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    priority: input.priority ?? "NORMAL",
    submittedBy: store.session.client.displayName ?? "Investor",
    attachments,
    messages: [],
  }
  store.requests.unshift(req)
  store.session.unreadCounts.requests += 1
  return req
}

export function addRequestMessage(
  reference: string,
  body: string,
  attachmentIds?: string[],
): { id: string; authorType: string; body: string; createdAt: string } {
  const req = store.requests.find((r) => r.reference === reference)
  const createdAt = new Date().toISOString()
  const id = `rmsg-${Date.now()}`
  const attachments = (attachmentIds ?? [])
    .map((aid) => store.attachments.find((a) => a.id === aid))
    .filter(Boolean)
    .map((a) => ({ id: a!.id, name: a!.name, size: a!.size }))

  const message = {
    id,
    authorType: "INVESTOR",
    authorId: store.session.client.id,
    body,
    createdAt,
    attachments: attachments.length ? attachments : undefined,
  }
  if (req) {
    req.messages = [...(req.messages ?? []), message]
    req.updatedAt = createdAt
    if (req.status === "AWAITING_INVESTOR") req.status = "UNDER_REVIEW"
  }
  return { id, authorType: "INVESTOR", body, createdAt }
}

export function addThreadMessage(
  threadId: string,
  body: string,
  attachmentIds?: string[],
): { id: string; authorType: string; body: string; createdAt: string } {
  const thread = store.messageThreads.find((t) => t.id === threadId)
  const createdAt = new Date().toISOString()
  const id = `tmsg-${Date.now()}`
  const attachments = (attachmentIds ?? [])
    .map((aid) => store.attachments.find((a) => a.id === aid))
    .filter(Boolean)
    .map((a) => ({ id: a!.id, name: a!.name, size: a!.size }))

  const message = {
    id,
    authorType: "INVESTOR",
    authorId: store.session.client.id,
    body,
    readAt: createdAt,
    createdAt,
    attachments: attachments.length ? attachments : undefined,
  }
  if (thread) {
    thread.messages.push(message)
    thread.status = "OPEN"
  }
  return { id, authorType: "INVESTOR", body, createdAt }
}

export function markThreadRead(threadId: string): { threadId: string; markedRead: number } {
  const thread = store.messageThreads.find((t) => t.id === threadId)
  let marked = 0
  if (thread) {
    const now = new Date().toISOString()
    for (const msg of thread.messages) {
      if (!msg.readAt && msg.authorType !== "INVESTOR") {
        msg.readAt = now
        marked += 1
      }
    }
    store.session.unreadCounts.messages = Math.max(0, store.session.unreadCounts.messages - marked)
  }
  return { threadId, markedRead: marked }
}

export function inviteColleague(body: {
  email: string
  role: string
  fundIds: string[]
}): {
  id: string
  userId: string
  clientId: string
  lpRole: string
  fundIds: string[]
  isActive: boolean
  invitedById: string
} {
  const n = store.colleagueCounter++
  const membershipId = `mem-${n}`
  const userId = `usr-${n}`
  const colleague: LpColleague = {
    membershipId,
    userId,
    email: body.email,
    name: body.email.split("@")[0]?.replace(/\./g, " ") ?? body.email,
    lpRole: body.role,
    fundIds: body.fundIds,
    isActive: false,
    status: "INVITED",
    revokedAt: null,
    mfaEnabled: false,
    lastActiveAt: null,
  }
  store.organisation.colleagues.push(colleague)
  return {
    id: membershipId,
    userId,
    clientId: store.organisation.id,
    lpRole: body.role,
    fundIds: body.fundIds,
    isActive: false,
    invitedById: store.session.client.id,
  }
}

export function revokeColleague(membershipId: string): {
  membershipId: string
  userId: string
  revokedById: string
} {
  const colleague = store.organisation.colleagues.find((c) => c.membershipId === membershipId)
  const revokedAt = new Date().toISOString()
  if (colleague) {
    colleague.isActive = false
    colleague.status = "REVOKED"
    colleague.revokedAt = revokedAt
  }
  return {
    membershipId,
    userId: colleague?.userId ?? "",
    revokedById: store.session.client.id,
  }
}

export function updateColleague(
  membershipId: string,
  body: { role?: string; fundIds?: string[] },
): {
  id: string
  userId: string
  clientId: string
  lpRole: string
  fundIds: string[]
  isActive: boolean
} {
  const colleague = store.organisation.colleagues.find((c) => c.membershipId === membershipId)
  if (colleague) {
    if (body.role) colleague.lpRole = body.role
    if (body.fundIds) colleague.fundIds = body.fundIds
  }
  return {
    id: membershipId,
    userId: colleague?.userId ?? "",
    clientId: store.organisation.id,
    lpRole: colleague?.lpRole ?? "VIEWER",
    fundIds: colleague?.fundIds ?? [],
    isActive: colleague?.isActive ?? false,
  }
}

export function addBankInstructionChange(body: Record<string, unknown>): LpBankInstructionChange {
  const fundId = String(body.fundId ?? GROWTH)
  const fund = store.session.funds.find((f) => f.fundId === fundId)
  const accountNumber = String(body.accountNumber ?? "")
  const masked =
    accountNumber.length >= 4 ? `•••• ${accountNumber.slice(-4)}` : "•••• ****"
  const change: LpBankInstructionChange = {
    id: `bic-${store.bankChangeCounter++}`,
    fundId,
    fundName: fund?.fundName,
    bankName: String(body.bankName ?? "Unknown bank"),
    accountNumberMasked: masked,
    requestedBy: store.session.client.displayName ?? "Investor",
    submittedAt: new Date().toISOString(),
    status: "PENDING",
  }
  store.bankChanges.unshift(change)
  return change
}

export function addDealingRequest(partial: Omit<LpDealingRequest, "id" | "createdAt"> & { id?: string }): LpDealingRequest {
  const req: LpDealingRequest = {
    ...partial,
    id: partial.id ?? `deal-${store.dealingCounter++}`,
    createdAt: new Date().toISOString(),
  }
  store.dealingRequests.unshift(req)
  return req
}

export function nextEstimateId(prefix: string): string {
  return `${prefix}-${store.estimateCounter++}`
}

export function estimateSubscription(body: {
  fundId: string
  shareClass: string
  amount: string
  currency: string
}): LpSubscriptionEstimate {
  const overview = store.dealingOverviews[body.fundId] ?? store.dealingOverviews[EQUITY]
  const nav = Number(overview?.navPerUnit ?? 15.4448)
  const amount = Number(body.amount) || 0
  const mgmtFeeRate = Number(overview?.rules.subscription.mgmtFeeRate ?? 0.015)
  const otherFee = Number(overview?.rules.subscription.otherFeeFlat ?? 250)
  const managementFee = amount * mgmtFeeRate
  // D-19 / BR-162: fees are added on top of the subscription amount, not deducted from it.
  const estimatedUnits = nav > 0 ? amount / nav : 0
  return {
    estimateSnapshotId: nextEstimateId("est-sub"),
    navPerUnit: nav.toFixed(4),
    estimatedUnits: estimatedUnits.toFixed(4),
    managementFee: money(managementFee),
    otherFees: money(otherFee),
    estimatedTotalInvestment: money(amount + managementFee + otherFee),
    isEstimate: true,
    disclaimer: "Estimates use the latest published NAV and are indicative only.",
  }
}

export function estimateRedemption(body: {
  fundId: string
  shareClass: string
  mode: "AMOUNT" | "UNITS" | "FULL"
  amount?: string
  units?: string
  full?: boolean
  earliestDealingDate: string
}): LpRedemptionEstimate {
  const overview = store.dealingOverviews[body.fundId] ?? store.dealingOverviews[EQUITY]
  const nav = Number(overview?.navPerUnit ?? 15.4448)
  const feeRate = Number(overview?.rules.redemption.feeRate ?? 0.005)
  const noticeDays = overview?.rules.noticeDays ?? 30
  let units = 0
  let settlement = 0
  if (body.mode === "FULL" || body.full) {
    units = Number(overview?.availableUnits ?? 0)
    settlement = Number(overview?.availableToRedeemValue ?? 0)
  } else if (body.mode === "UNITS") {
    units = Number(body.units) || 0
    settlement = units * nav
  } else {
    settlement = Number(body.amount) || 0
    units = nav > 0 ? settlement / nav : 0
  }
  const redemptionFee = settlement * feeRate
  const net = settlement - redemptionFee
  const minBal = Number(overview?.rules.minBalanceAmount ?? 100000)
  const remaining = Number(overview?.accountValue ?? 0) - settlement
  return {
    estimateSnapshotId: nextEstimateId("est-rdm"),
    estimatedUnitsToCancel: units.toFixed(4),
    estimatedSettlementAmount: money(net),
    earliestDealingDate: body.earliestDealingDate,
    estimatedSettlementDate: body.earliestDealingDate,
    noticeDays,
    aboveMinBalance: remaining >= minBal,
    isEstimate: true,
    redemptionFee: money(redemptionFee),
    disclaimer: "Redemption estimates are indicative pending dealing-day NAV.",
  }
}

export function addAttachment(fileName: string, size: number): LpRequestAttachment {
  const att: LpRequestAttachment = {
    id: `att-${Date.now()}`,
    name: fileName,
    size,
    mimeType: "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  }
  store.attachments.push(att)
  return att
}

export function createJob(jobType: string): LpJobStatus {
  const jobId = `job-mock-${store.jobCounter++}`
  const createdAt = new Date().toISOString()
  const job: LpJobStatus = {
    jobId,
    jobType,
    status: "COMPLETED",
    downloadUrl: `/mock/reports/${jobId}.pdf`,
    errorMessage: null,
    createdAt,
    completedAt: createdAt,
  }
  store.jobs[jobId] = job
  return job
}

export function threadSummaries(): LpMessageThreadSummary[] {
  return store.messageThreads.map((t) => {
    const last = t.messages[t.messages.length - 1]
    const unread = t.messages.filter((m) => !m.readAt && m.authorType !== "INVESTOR").length
    return {
      id: t.id,
      subject: t.subject,
      fundId: t.fundId,
      fundName: t.fundName,
      relatedType: t.relatedType,
      relatedId: t.relatedId,
      status: t.status,
      lastMessageAt: last?.createdAt ?? NOW,
      lastMessagePreview: last?.body?.slice(0, 120) ?? "",
      unreadCount: unread,
    }
  })
}

export const MOCK_FUND_IDS = { GROWTH, EQUITY, AS_OF } as const
