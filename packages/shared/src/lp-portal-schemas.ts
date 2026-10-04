import { z } from 'zod';

/**
 * Request schemas, error codes and runtime-flag vocabulary for /api/v1/lp-portal/*
 * (SRD 5B API contract; docs/srd/appendix/5B__api-contract.md).
 */

/** LP data domains; each maps to a group of `lpPortalApi` methods (LP_METHOD_DOMAIN in the UI). */
export const LP_DOMAINS = [
  'session',
  'dashboard',
  'capital',
  'activity',
  'dealing',
  'performance',
  'documents',
  'notices',
  'requests',
  'organisation',
  'settings',
  'reports',
] as const;
export type LpDomain = (typeof LP_DOMAINS)[number];

export const LP_ROLES = ['VIEWER', 'SIGNATORY', 'MANAGER'] as const;
export type LpRole = (typeof LP_ROLES)[number];

/** Error codes of the LP envelope (`{ success:false, code, message, fieldErrors?, retryable? }`). */
export const LP_ERROR_CODES = [
  'LP_UNAUTHORIZED',
  'LP_FORBIDDEN',
  'LP_NOT_FOUND',
  'LP_VALIDATION',
  'LP_IDEMPOTENCY_KEY_REUSED',
  'LP_IDEMPOTENCY_IN_PROGRESS',
  'LP_VERSION_CONFLICT',
  'LP_MFA_REQUIRED',
  'LP_STEP_UP_REQUIRED',
  'LP_UNSUPPORTED_MEDIA',
  'LP_ESTIMATE_EXPIRED',
  'LP_INSUFFICIENT_UNITS',
  'LP_MIN_BALANCE_BREACH',
  'LP_NOTICE_PERIOD',
  'LP_COMPLIANCE_HOLD',
  'LP_DEALING_SUSPENDED',
  'LP_ACCOUNT_INACTIVE',
  'LP_CALL_NOT_ISSUED',
  'LP_CALL_ALREADY_ACKNOWLEDGED',
  'LP_DOMAIN_NOT_LIVE',
  'LP_EXPORT_FAILED',
  'LP_JOB_NOT_READY',
  'LP_JOB_FINISHED',
  'LP_JOB_FAILED',
  'LP_JOB_CANCELLED',
  'LP_INTERNAL',
] as const;
export type LpErrorCode = (typeof LP_ERROR_CODES)[number];

const decimalString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'Enter a positive number');

export const lpPageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const lpCreateRequestSchema = z.object({
  type: z.string().trim().min(1).max(64),
  fundId: z.string().trim().max(36).optional(),
  subject: z.string().trim().min(1).max(512),
  description: z.string().trim().min(1).max(10_000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  attachmentIds: z.array(z.string().max(20)).max(10).optional(),
});

export const lpReplySchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  attachmentIds: z.array(z.string().max(20)).max(10).optional(),
});

export const lpInviteColleagueSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['VIEWER', 'SIGNATORY']),
  fundIds: z.array(z.string().max(36)).max(50),
});

export const lpUpdateColleagueSchema = z.object({
  role: z.enum(['VIEWER', 'SIGNATORY']).optional(),
  fundIds: z.array(z.string().max(36)).max(50).optional(),
});

export const lpSubscriptionEstimateSchema = z.object({
  fundId: z.string().max(36),
  shareClass: z.string().max(32),
  amount: decimalString,
  currency: z.string().length(3),
});

export const lpRedemptionEstimateSchema = z.object({
  fundId: z.string().max(36),
  shareClass: z.string().max(32),
  mode: z.enum(['AMOUNT', 'UNITS', 'FULL']),
  amount: decimalString.optional(),
  units: decimalString.optional(),
  full: z.boolean().optional(),
  earliestDealingDate: z.string().max(10),
});

export const lpSubmitDealingSchema = z.object({
  fundId: z.string().max(36),
  shareClass: z.string().max(32).optional(),
  estimateSnapshotId: z.string().max(36),
  amount: decimalString.optional(),
  units: decimalString.optional(),
  mode: z.enum(['AMOUNT', 'UNITS', 'FULL']).optional(),
  currency: z.string().length(3).optional(),
  bankAccountId: z.string().max(36).optional(),
  requestedDealingDate: z.string().max(10).optional(),
  notes: z.string().max(2000).optional(),
  acceptTerms: z.boolean().optional(),
});

export const lpNotificationSettingsSchema = z
  .object({
    emailCapitalCalls: z.boolean(),
    emailDistributions: z.boolean(),
    emailDocuments: z.boolean(),
    emailMessages: z.boolean(),
    emailNotices: z.boolean(),
    inAppCapitalCalls: z.boolean(),
    inAppDistributions: z.boolean(),
    inAppDocuments: z.boolean(),
    inAppMessages: z.boolean(),
    inAppNotices: z.boolean(),
    digest: z.enum(['daily', 'weekly', 'off']).nullable(),
  })
  .partial();

export const lpDisplaySettingsSchema = z.object({
  presentationCurrency: z.string().length(3).optional(),
  defaultAsOfPreference: z.string().max(16).optional(),
});

export const lpBankChangeSchema = z.object({
  fundId: z.string().max(36).optional(),
  bankName: z.string().trim().min(1).max(120),
  accountName: z.string().trim().min(1).max(160),
  accountNumber: z.string().trim().min(4).max(40),
  swift: z.string().trim().max(11).optional(),
  currency: z.string().length(3).optional(),
  reference: z.string().max(80).optional(),
});

export const lpPaymentConfirmationFields = z.object({
  amountClaimed: decimalString.optional(),
  notes: z.string().max(2000).optional(),
});

/** Public runtime flags (GET /api/v1/platform/flags). */
export interface PlatformFlags {
  lp: Record<LpDomain, boolean>;
  investee: { liveActions: string[] };
  custodian: { live: boolean };
  onboarding: { live: boolean };
  /** Active object-store backend (INTEGRATION_OBJECT_STORAGE). */
  storage?: { backend: 'local' | 's3' | 'fake' };
}
