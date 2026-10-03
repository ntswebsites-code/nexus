/**
 * Investee portal contract (D-08: derived by WS3, consumed by WS6).
 *
 * Source of truth for the shapes: the company-web runtime
 * (`portals/company-web/src/components/investee-portal-v8-mock/matanho-investee-portal-runtime.js`)
 * hydrates with an `InvesteeLivePayload` of `{ profile, application, company, termSheets, dashboard,
 * reportingRequests, financialReports, drawdown, errors }`, each slot being the API envelope below.
 * Field names follow the NVCCZ applicant API the runtime was written against
 * (`nvccz-new/lib/api/application-portal-api.ts`), retargeted to `/api/v1/investee-portal/*`;
 * Nexus-only fields are additive and marked "Nexus".
 *
 * Conventions: money is a decimal string (D-09), dates are ISO strings (`YYYY-MM-DD` for calendar
 * days), ids are Nexus references where one exists (company `PC-100`, period `2026-08`).
 */
import { z } from 'zod';

// ---------------------------------------------------------------- envelope

export const envelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), message: z.string(), data, timestamp: z.string() });

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  message: z.string(),
  code: z.string(),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  timestamp: z.string(),
});
export type InvesteeErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

const isoDateTime = z.string();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^-?\d+(\.\d+)?$/);

export const companyProfileSchema = z.enum([
  'workspace_administrator',
  'executive_approver',
  'report_contributor',
  'kpi_owner',
  'finance_editor',
  'read_only',
]);

/** Nexus: what the caller's access profile allows (drives button visibility in the UI). */
export const capabilitiesSchema = z.object({
  editDraft: z.boolean(),
  submitPack: z.boolean(),
  submitKpis: z.boolean(),
  sign: z.boolean(),
  postMessages: z.boolean(),
  manageCompany: z.boolean(),
});

// ---------------------------------------------------------------- profile  (GET/PUT /profile)

export const profileSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  userDepartment: z.string().nullable(),
  roleCode: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Nexus */
  name: z.string(),
  accessProfile: companyProfileSchema,
  title: z.string().nullable(),
  signingAuthority: z.string().nullable(),
  mfaEnabled: z.boolean(),
  capabilities: capabilitiesSchema,
  company: z.object({ id: z.string(), name: z.string() }),
});
export type InvesteeProfile = z.infer<typeof profileSchema>;

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().max(60).optional(),
    /** Read-only here: accepted only when equal to the current e-mail. */
    email: z.string().trim().toLowerCase().max(254).optional(),
  })
  .strict();

// ---------------------------------------------------------------- company  (GET/PUT /company)

export const financialKpisSchema = z.object({
  /** `{ [periodEnd YYYY-MM-DD]: { KEY: number } }` - the runtime KPI Centre reads the last period. */
  kpiValues: z.record(z.string(), z.record(z.string(), z.number())),
});

export const companySchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  registrationNumber: z.string().nullable(),
  industry: z.string().nullable(),
  foundingDate: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  status: z.string(),
  companySize: z.string().nullable(),
  employeeCount: z.number().nullable(),
  annualRevenue: z.number().nullable(),
  fundingStage: z.string().nullable(),
  contactPerson: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  socialMedia: z.record(z.string(), z.string()).nullable(),
  fundId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  /** Always null: the cap table is not exposed until its guarded API exists (no unguarded registry). */
  capTable: z.null(),
  financialKpis: financialKpisSchema,
  financialHistoryExcel: z.null(),
  eSign: z.null(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  fund: z.object({ name: z.string() }).nullable(),
  /** Nexus */
  legalName: z.string(),
  ticker: z.string(),
  sector: z.string(),
  country: z.string(),
  reportingCurrency: z.string(),
  version: z.number().int(),
});
export type InvesteeCompany = z.infer<typeof companySchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * Whitelisted company update (no mass assignment). `name` and `registrationNumber` are maintained by
 * the investment team: they are accepted only when unchanged so the settings form can post them back.
 */
export const updateCompanySchema = z
  .object({
    name: optionalText(200),
    registrationNumber: optionalText(80),
    industry: optionalText(120),
    website: optionalText(255).refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), { message: 'Website must start with http:// or https://' }),
    address: optionalText(255),
    description: optionalText(2000),
    employeeCount: z.number().int().min(0).max(10_000_000).optional(),
    fundingStage: optionalText(40),
    contactPerson: optionalText(120),
    contactPhone: optionalText(40),
    contactEmail: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(),
    socialMedia: z.record(z.string().max(32), z.string().max(255)).optional(),
    version: z.number().int().optional(),
  })
  .strict();

export const updateCompanyResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string().nullable(),
  status: z.string(),
  updatedAt: isoDateTime,
  version: z.number().int(),
});

// ---------------------------------------------------------------- letterhead  (GET/PUT/DELETE /letterhead, POST /letterhead/logo)

export const letterheadSchema = z.object({
  id: z.string(),
  portfolioCompanyId: z.string(),
  legalName: z.string(),
  registrationNumber: z.string().nullable(),
  taxNumber: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  addressLabel: z.string().nullable(),
  twitter: z.string().nullable(),
  facebook: z.string().nullable(),
  linkedin: z.string().nullable(),
  instagram: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type InvesteeLetterhead = z.infer<typeof letterheadSchema>;

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
export const updateLetterheadSchema = z
  .object({
    legalName: z.string().trim().min(1).max(255),
    registrationNumber: nullableText(80),
    taxNumber: nullableText(80),
    email: z.union([z.literal(''), z.string().trim().email().max(254)]).nullable().optional(),
    phone: nullableText(40),
    website: nullableText(255),
    line1: z.string().trim().min(1).max(255),
    line2: nullableText(255),
    city: z.string().trim().min(1).max(120),
    state: nullableText(120),
    postalCode: nullableText(20),
    country: z.string().trim().min(1).max(80),
    addressLabel: nullableText(120),
    twitter: nullableText(255),
    facebook: nullableText(255),
    linkedin: nullableText(255),
    instagram: nullableText(255),
  })
  .strict();

// ---------------------------------------------------------------- dashboard  (GET /dashboard)

export const activitySchema = z.object({
  id: z.string(),
  notificationType: z.string(),
  title: z.string(),
  message: z.string(),
  createdAt: isoDateTime,
});

export const dashboardApplicationSchema = z.object({
  id: z.string(),
  currentStage: z.string(),
  submittedAt: isoDateTime,
  businessName: z.string(),
  requestedAmount: z.number(),
  industry: z.string().nullable(),
  businessStage: z.string().nullable(),
  applicationProgress: z.number(),
  approvedAmount: z.number(),
});

export const dashboardSchema = z.object({
  hasReceivedInvestment: z.boolean(),
  /** Company investment summary. There is no separate deal-pipeline record. */
  application: dashboardApplicationSchema,
  portfolioCompany: z.object({ id: z.string(), name: z.string(), status: z.string(), industry: z.string().nullable(), fundingStage: z.string().nullable() }),
  recentActivities: z.array(activitySchema),
  summary: z.object({
    hasApplication: z.boolean(),
    hasPortfolioCompany: z.boolean(),
    hasReceivedInvestment: z.boolean(),
    applicationStage: z.string(),
    companyStatus: z.string(),
    applicationProgress: z.number(),
    requestedAmount: z.number(),
    approvedAmount: z.number(),
  }),
  /** Nexus */
  reporting: z.object({
    openPeriods: z.number().int(),
    returnedPeriods: z.number().int(),
    awaitingReview: z.number().int(),
    nextDue: z.object({ reportingPeriod: z.string(), label: z.string(), dueDate: isoDay }).nullable(),
  }),
  termSheets: z.object({ awaitingSignature: z.number().int(), total: z.number().int() }),
  openThreads: z.number().int(),
});
export type InvesteeDashboard = z.infer<typeof dashboardSchema>;

// ---------------------------------------------------------------- reporting schedule  (GET /reporting/requests, /reporting/requests/:period)

export const portalStatusSchema = z.enum(['REPORTING_OPEN', 'CHANGES_REQUESTED', 'SUBMITTED', 'ACCEPTED']);
export const requestStatusSchema = z.enum(['OPEN', 'RETURNED', 'SUBMITTED', 'ACCEPTED']);

export const packFileSchema = z.object({ id: z.string(), name: z.string(), size: z.number().int(), status: z.string() });

export const mandatoryAttachmentSchema = z.object({
  name: z.string(),
  formats: z.array(z.string()),
  /** Nexus */
  key: z.string(),
  reportId: z.string(),
  required: z.boolean(),
  status: z.string(),
  files: z.array(packFileSchema),
});

export const reportingRequestSchema = z.object({
  id: z.string(),
  portfolioCompanyId: z.string(),
  companyName: z.string(),
  /** Nexus period key `YYYY-MM`. */
  reportingPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  dueDate: isoDay,
  lastRequestedAt: isoDateTime.nullable(),
  status: requestStatusSchema,
  portalStatus: portalStatusSchema,
  mandatoryAttachments: z.array(mandatoryAttachmentSchema),
  /** Nexus */
  label: z.string(),
  periodType: z.string(),
  periodStart: isoDay.nullable(),
  periodEnd: isoDay.nullable(),
  submittedAt: isoDateTime.nullable(),
  reviewedAt: isoDateTime.nullable(),
  reviewerName: z.string().nullable(),
  reviewNote: z.string().nullable(),
  kpis: z.record(z.string(), z.union([z.number(), z.literal('')])),
  notes: z.string(),
  version: z.number().int(),
  canEdit: z.boolean(),
  canSubmit: z.boolean(),
});
export type InvesteeReportingRequest = z.infer<typeof reportingRequestSchema>;

// ---------------------------------------------------------------- financial reports / history  (GET /financial-reports[/:id])

export const reportTypeSchema = z.enum([
  'MANAGEMENT_ACCOUNTS',
  'OPERATIONAL_KPIS',
  'DEBT_AND_CASH',
  'BOARD_PACK',
  'COMPLIANCE_CERTIFICATES',
  'OTHER',
]);
export const reportStatusSchema = z.enum(['DRAFT', 'NEEDS_REVISION', 'SUBMITTED', 'ACCEPTED']);

export const financialReportSchema = z.object({
  id: z.string(),
  portfolioCompanyId: z.string(),
  companyName: z.string(),
  reportType: reportTypeSchema,
  periodType: z.string(),
  periodStart: isoDay.nullable(),
  periodEnd: isoDay.nullable(),
  reportingPeriod: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Never a storage path: downloads go through `/financial-reports/:id/files/:fileId/download-url`. */
  reportUrl: z.null(),
  fileUrl: z.null(),
  storagePath: z.null(),
  templateVersion: z.string(),
  status: reportStatusSchema,
  totalRevenue: z.number().nullable(),
  netProfit: z.number().nullable(),
  cashFlowNet: z.number().nullable(),
  reviewerId: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
  reviewerComment: z.string().nullable(),
  isDraft: z.boolean(),
  canSubmit: z.boolean(),
  canUploadFile: z.boolean(),
  canDownload: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Nexus */
  slot: z.string(),
  required: z.boolean(),
  accept: z.string(),
  files: z.array(packFileSchema),
});
export type InvesteeFinancialReport = z.infer<typeof financialReportSchema>;

export const financialReportDetailSchema = financialReportSchema.extend({
  data: z.record(z.string(), z.number()),
  lineNotes: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  narrative: z.record(z.string(), z.string()).optional(),
});

export const financialReportPageSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  items: z.array(financialReportSchema),
});

export const draftKindSchema = z.enum(['income-statement', 'balance-sheet', 'cash-flow', 'operational-kpis']);
export type DraftKind = z.infer<typeof draftKindSchema>;

/** `POST /financial-reports/:kind/draft` - only for a period with an open request (BR-246). */
export const draftRequestSchema = z.object({
  /** `YYYY-MM` or `YYYY-MM-DD` (the NVCCZ client sends a day); falls back to `periodStart`. */
  reportingPeriod: z.string().trim().max(32).optional(),
  periodType: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'ANNUALLY']).optional(),
  periodStart: z.string().trim().max(32).optional(),
  periodEnd: z.string().trim().max(32).optional(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
  templateVersion: z.string().trim().max(32).optional(),
  /** Period version the editor loaded. A mismatch is 409 `version_conflict`. */
  version: z.number().int().positive().optional(),
  data: z.record(z.string().max(64), z.unknown()),
});

export const draftResultSchema = z.object({
  id: z.string(),
  status: z.literal('DRAFT'),
  reportType: reportTypeSchema,
  reportingPeriod: z.string(),
  reportUrl: z.null(),
  fileUrl: z.null(),
  storagePath: z.null(),
});

export const uploadResultSchema = z.object({
  id: z.string(),
  reportUrl: z.null(),
  fileUrl: z.null(),
  storagePath: z.null(),
  files: z.array(packFileSchema),
});

export const submitRequestSchema = z.object({
  reportId: z.string().optional(),
  reportIds: z.array(z.string()).max(50).optional(),
  kpis: z.record(z.string().max(64), z.union([z.number().finite(), z.literal('')])).optional(),
  notes: z.string().max(10_000).optional(),
});

/** `PUT /reporting/requests/:period/draft` */
export const saveDraftSchema = z.object({
  kpis: z.record(z.string().max(64), z.union([z.number().finite(), z.literal('')])).optional(),
  notes: z.string().max(10_000).optional(),
  version: z.number().int().optional(),
});

export const periodKpisRequestSchema = z.object({
  periodStart: z.string().trim().max(32),
  periodEnd: z.string().trim().max(32),
  totalRevenue: z.number().finite().optional(),
  netProfit: z.number().finite().optional(),
  cashFlowNet: z.number().finite().optional(),
  /** Nexus: values for the company's KPI register keys. */
  kpis: z.record(z.string().max(32), z.number().finite()).optional(),
  varianceExplanationNote: z.string().max(5000).optional(),
});

export const periodKpisResultSchema = z.object({
  periodStart: isoDay,
  periodEnd: isoDay,
  totalRevenue: z.number().nullable(),
  netProfit: z.number().nullable(),
  cashFlowNet: z.number().nullable(),
  reportingPeriod: z.string(),
});

// ---------------------------------------------------------------- KPIs  (GET /kpis)

export const kpiDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  prev: z.number(),
  budget: z.number(),
  invert: z.boolean(),
  series: z.array(z.number()),
  latest: z.number().nullable(),
});

export const kpiRegisterSchema = z.object({
  definitions: z.array(kpiDefinitionSchema),
  periods: z.array(
    z.object({
      reportingPeriod: z.string(),
      label: z.string(),
      status: z.string(),
      values: z.record(z.string(), z.union([z.number(), z.literal('')])),
    }),
  ),
  covenants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      threshold: z.string(),
      actual: z.number(),
      limit: z.number(),
      unit: z.string(),
      headroom: z.number(),
      evidence: z.string(),
      note: z.string().optional(),
    }),
  ),
});

// ---------------------------------------------------------------- term sheets  (GET /term-sheets/my, /term-sheets/:id, POST sign / decline)

export const termSheetStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ISSUED',
  'VIEWED',
  'SIGNED_BY_COMPANY',
  'COUNTERSIGNED',
  'EXECUTED',
  'DECLINED',
  'WITHDRAWN',
]);

const personSchema = z.object({ id: z.string(), firstName: z.string(), lastName: z.string(), email: z.string() });

export const signatureEvidenceSchema = z.object({
  signerName: z.string(),
  authority: z.string(),
  signedAt: isoDateTime,
  docSha256: z.string(),
  consentTextVersion: z.string().nullable(),
  consentHash: z.string().nullable(),
  mfaAt: isoDateTime.nullable(),
  certificateDocumentId: z.string().nullable(),
});

export const termSheetSchema = z.object({
  id: z.string(),
  applicationId: z.null(),
  title: z.string(),
  version: z.string(),
  status: termSheetStatusSchema,
  investmentAmount: money,
  equityPercentage: z.number(),
  valuation: money,
  keyTerms: z.string().nullable(),
  conditions: z.string().nullable(),
  timeline: z.string().nullable(),
  /** Short-lived signed URL (300 s), null before issue. */
  documentUrl: z.string().nullable(),
  documentFileName: z.string().nullable(),
  documentSize: z.number().nullable(),
  isDraft: z.boolean(),
  isFinal: z.boolean(),
  isSigned: z.boolean(),
  signedAt: isoDateTime.nullable(),
  applicantSignatureUrl: z.null(),
  applicantSignatureFileName: z.null(),
  applicantSignedById: z.string().nullable(),
  applicantSignedAt: isoDateTime.nullable(),
  investorSignatureUrl: z.null(),
  investorSignatureFileName: z.null(),
  investorSignedById: z.null(),
  investorSignedAt: z.null(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  createdBy: personSchema.nullable(),
  application: z.null(),
  /** Nexus */
  ref: z.string(),
  currency: z.string(),
  structuredTerms: z.unknown().nullable(),
  issuedAt: isoDateTime.nullable(),
  viewedAt: isoDateTime.nullable(),
  canSign: z.boolean(),
  canDecline: z.boolean(),
  consent: z.object({ version: z.string(), text: z.string(), hash: z.string() }),
  signature: signatureEvidenceSchema.nullable(),
});
export type InvesteeTermSheet = z.infer<typeof termSheetSchema>;

export const termSheetListSchema = z.object({
  termSheets: z.array(termSheetSchema),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
});

/** JSON or multipart (optional `signature` image as in NVCCZ). Step-up MFA and `Idempotency-Key` required. */
export const signTermSheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  consent: z.union([z.literal(true), z.literal('true')]),
  consentTextVersion: z.string().trim().max(32),
});

export const declineTermSheetSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

export const signResultSchema = z.object({
  id: z.string(),
  applicationId: z.null(),
  status: termSheetStatusSchema,
  isSigned: z.boolean(),
  signedAt: isoDateTime.nullable(),
  investmentAmount: money,
  equityPercentage: z.number(),
  valuation: money,
  signature: signatureEvidenceSchema,
});

// ---------------------------------------------------------------- settings  (GET/PUT /settings)

export const NOTIFICATION_TYPES = ['reporting.deadlines', 'reporting.review', 'term_sheets', 'messages'] as const;

export const settingsSchema = z.object({
  notifications: z.array(z.object({ type: z.enum(NOTIFICATION_TYPES), channel: z.enum(['email', 'in_app']), enabled: z.boolean() })),
  security: z.object({ mfaEnabled: z.boolean(), mfaRequired: z.boolean(), sessionTimeoutMinutes: z.number() }),
  accessProfile: companyProfileSchema,
  capabilities: capabilitiesSchema,
});

export const updateSettingsSchema = z
  .object({
    notifications: z
      .array(z.object({ type: z.enum(NOTIFICATION_TYPES), channel: z.enum(['email', 'in_app']), enabled: z.boolean() }).strict())
      .max(16),
  })
  .strict();

// ---------------------------------------------------------------- team (read-only)  (GET /team)

export const teamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  title: z.string().nullable(),
  accessProfile: companyProfileSchema,
  status: z.string(),
  lastActiveAt: isoDateTime.nullable(),
  mfaEnabled: z.boolean(),
  signingAuthority: z.boolean(),
  isYou: z.boolean(),
});

// ---------------------------------------------------------------- threads  (GET/POST /threads, POST /threads/:id/messages)

export const threadSchema = z.object({
  id: z.string(),
  title: z.string(),
  from: z.string(),
  role: z.string(),
  opened: z.string(),
  status: z.string(),
  messages: z.array(z.object({ who: z.enum(['me', 'them']), name: z.string(), at: z.string(), text: z.string() })),
});

export const startThreadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
  /** Optional `YYYY-MM` period the question is about. */
  reportingPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const replyThreadSchema = z.object({ text: z.string().trim().min(1).max(5000) });

// ---------------------------------------------------------------- the hydration payload (WS6)

export const livePayloadSchema = z.object({
  profile: envelopeSchema(profileSchema).nullable(),
  application: envelopeSchema(dashboardApplicationSchema.extend({ documents: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough()),
  company: envelopeSchema(companySchema).nullable(),
  termSheets: envelopeSchema(termSheetListSchema).nullable(),
  dashboard: envelopeSchema(dashboardSchema).nullable(),
  reportingRequests: envelopeSchema(z.array(reportingRequestSchema)).nullable(),
  financialReports: envelopeSchema(financialReportPageSchema).nullable(),
  drawdown: envelopeSchema(z.object({ requisitions: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()) })),
  errors: z.array(z.string()),
});
export type InvesteeLivePayload = z.infer<typeof livePayloadSchema>;
