/**
 * Pure rules for Clients & Accounts, Investor Services, Onboarding & KYC and the Document Vault
 * (SRD 5.A pages `clients`, `investor-services`, `onboarding`, `vault`). No database access.
 */
import { HIGH_RISK_COUNTRIES } from '../kyc/constants';

export const CHECK_KINDS = ['SANCTIONS', 'PEP', 'ADVERSE_MEDIA', 'ID_VERIFICATION', 'ADDRESS', 'SOURCE_OF_FUNDS', 'SOURCE_OF_WEALTH', 'UBO'] as const;
export const CHECK_OUTCOMES = ['PASS', 'REFER', 'FAIL'] as const;
export const RATINGS = ['Low', 'Medium', 'High'] as const;
export type Rating = (typeof RATINGS)[number];

export const CLASSIFICATIONS = ['Public', 'Client', 'Internal', 'Restricted'] as const;
/** Higher = more restrictive. */
export const CLASS_RANK: Record<string, number> = { Public: 0, Client: 1, Internal: 2, Restricted: 3 };
export const MIN_RETENTION_YEARS = 1;
export const MAX_RETENTION_YEARS = 50;

export const REQUEST_TYPES = ['Query', 'Statement request', 'Transfer', 'Redemption', 'Account change', 'Tax document', 'Complaint', 'Other'] as const;
export const PRIORITIES = ['Normal', 'Time sensitive'] as const;
/** Fallback SLA when no policy row exists for a type and priority. */
export const DEFAULT_SLA_HOURS: Record<string, number> = { Normal: 48, 'Time sensitive': 8 };

export interface RiskInput {
  country?: string | null;
  bankJurisdiction?: string | null;
  pep?: string | null;
  applicantType?: string | null;
  expectedInvestment?: number | null;
  ownerPep?: boolean;
  screening?: { sanctions?: string; pep?: string; other?: string };
  checks?: { kind: string; outcome: string }[];
  missingSourceOfFunds?: boolean;
}

export interface RiskFactor {
  key: string;
  label: string;
  points: number;
}

const inHighRisk = (v?: string | null) => !!v && HIGH_RISK_COUNTRIES.includes(v.trim().toLowerCase());
const isYes = (v?: string | null) => !!v && /^(y|yes|true)/i.test(v.trim());

/** Deterministic risk score (0-100) with the factors that produced it. */
export function scoreRisk(i: RiskInput): { score: number; rating: Rating; factors: RiskFactor[] } {
  const f: RiskFactor[] = [];
  const add = (key: string, label: string, points: number) => points && f.push({ key, label, points });
  if (inHighRisk(i.country)) add('country', 'Applicant country is a high-risk jurisdiction', 40);
  if (inHighRisk(i.bankJurisdiction)) add('bank', 'Bank jurisdiction is high-risk', 20);
  if (isYes(i.pep)) add('pep', 'Applicant is a politically exposed person', 30);
  if (i.ownerPep) add('owner_pep', 'A beneficial owner is a politically exposed person', 15);
  if (i.applicantType && /trust|company|fund|entity|corporate|partnership|foundation/i.test(i.applicantType)) add('entity', 'Entity structure needs ownership look-through', 10);
  const inv = i.expectedInvestment ?? 0;
  if (inv >= 5_000_000) add('size', 'Expected investment of 5M or more', 20);
  else if (inv >= 1_000_000) add('size', 'Expected investment of 1M or more', 10);
  if (i.screening?.sanctions === 'Match') add('sanctions', 'Potential sanctions match', 40);
  else if (i.screening?.sanctions === 'Review') add('sanctions', 'Sanctions screening needs review', 15);
  if (i.screening?.pep && i.screening.pep !== 'Clear') add('pep_screen', 'PEP screening hit', 15);
  if (i.screening?.other && i.screening.other !== 'Clear') add('screen_other', 'Adverse media or document screening hit', 10);
  // Latest outcome per check kind.
  const latest = new Map<string, string>();
  for (const c of i.checks ?? []) latest.set(c.kind, c.outcome);
  for (const [kind, outcome] of latest) {
    if (outcome === 'FAIL') add(`check_${kind}`, `${kind.replace(/_/g, ' ').toLowerCase()} check failed`, 30);
    else if (outcome === 'REFER') add(`check_${kind}`, `${kind.replace(/_/g, ' ').toLowerCase()} check referred`, 15);
  }
  if (i.missingSourceOfFunds) add('sof', 'Source of funds not stated', 10);
  const score = Math.min(100, f.reduce((a, x) => a + x.points, 0));
  return { score, rating: ratingFor(score), factors: f };
}

export function ratingFor(score: number): Rating {
  return score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';
}

/** SLA state for a due date: Breached | At risk (under 25% of window, min 1h left) | On track | Closed. */
export function slaState(dueAt: Date | null | undefined, createdAt: Date, closed: boolean, now = new Date()): 'Closed' | 'Breached' | 'At risk' | 'On track' | 'No SLA' {
  if (closed) return 'Closed';
  if (!dueAt) return 'No SLA';
  const left = dueAt.getTime() - now.getTime();
  if (left < 0) return 'Breached';
  const window = Math.max(1, dueAt.getTime() - createdAt.getTime());
  return left <= Math.max(3_600_000, window * 0.25) ? 'At risk' : 'On track';
}

export function slaDueFor(hours: number, from = new Date()): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

/** Retention end date: the document date (or creation) plus the retention years. */
export function retainUntil(base: Date, years: number): Date {
  const d = new Date(base.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

export type RetentionState = 'Held' | 'Disposal eligible' | 'Due within 90 days' | 'Retained';

export function retentionState(base: Date, years: number, held: boolean, now = new Date()): { state: RetentionState; retainUntil: Date } {
  const until = retainUntil(base, years);
  if (held) return { state: 'Held', retainUntil: until };
  if (until.getTime() <= now.getTime()) return { state: 'Disposal eligible', retainUntil: until };
  if (until.getTime() - now.getTime() <= 90 * 86_400_000) return { state: 'Due within 90 days', retainUntil: until };
  return { state: 'Retained', retainUntil: until };
}

/** Why a proposed document change is not allowed, or null. */
export function documentChangeProblem(kind: string, from: string, to: string, held: boolean): string | null {
  if (from === to) return 'The new value is the same as the current value';
  if (kind === 'CLASSIFICATION') {
    if (!(CLASSIFICATIONS as readonly string[]).includes(to)) return 'Unknown classification';
    return null;
  }
  if (kind === 'RETENTION') {
    const n = Number(to);
    if (!Number.isInteger(n) || n < MIN_RETENTION_YEARS || n > MAX_RETENTION_YEARS) return `Retention must be ${MIN_RETENTION_YEARS} to ${MAX_RETENTION_YEARS} whole years`;
    if (held && n < Number(from)) return 'A document on legal hold cannot have its retention shortened';
    return null;
  }
  return 'Unknown change kind';
}
