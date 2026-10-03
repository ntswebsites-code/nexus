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

/** Default factor definitions: key, label and points. Rows in `kyc_risk_factors` override points, enabled and params. */
export const DEFAULT_RISK_FACTORS: { key: string; label: string; points: number; params?: Record<string, unknown> }[] = [
  { key: 'country', label: 'Applicant country is a high-risk jurisdiction', points: 40, params: { countries: HIGH_RISK_COUNTRIES } },
  { key: 'bank', label: 'Bank jurisdiction is high-risk', points: 20 },
  { key: 'pep', label: 'Applicant is a politically exposed person', points: 30 },
  { key: 'owner_pep', label: 'A beneficial owner is a politically exposed person', points: 15 },
  { key: 'entity', label: 'Entity structure needs ownership look-through', points: 10 },
  { key: 'size_mid', label: 'Expected investment at or above the medium threshold', points: 10, params: { threshold: 1_000_000 } },
  { key: 'size_high', label: 'Expected investment at or above the high threshold', points: 20, params: { threshold: 5_000_000 } },
  { key: 'sanctions_match', label: 'Potential sanctions match', points: 40 },
  { key: 'sanctions_review', label: 'Sanctions screening needs review', points: 15 },
  { key: 'pep_screen', label: 'PEP screening hit', points: 15 },
  { key: 'screen_other', label: 'Adverse media or document screening hit', points: 10 },
  { key: 'check_fail', label: 'A KYC check failed (per kind)', points: 30 },
  { key: 'check_refer', label: 'A KYC check was referred (per kind)', points: 15 },
  { key: 'sof', label: 'Source of funds not stated', points: 10 },
];
export const DEFAULT_THRESHOLDS = { rating_medium: 30, rating_high: 60 };

export interface RiskConfig {
  factors: Record<string, { points: number; enabled: boolean; params?: Record<string, unknown> | null }>;
  medium: number;
  high: number;
}
export const defaultRiskConfig = (): RiskConfig => ({
  factors: Object.fromEntries(DEFAULT_RISK_FACTORS.map((f) => [f.key, { points: f.points, enabled: true, params: f.params ?? null }])),
  medium: DEFAULT_THRESHOLDS.rating_medium,
  high: DEFAULT_THRESHOLDS.rating_high,
});

const isYes = (v?: string | null) => !!v && /^(y|yes|true)/i.test(v.trim());

/** Deterministic risk score (0-100) with the factors that produced it. Pass a configuration to use the stored factor points. */
export function scoreRisk(i: RiskInput, cfg: RiskConfig = defaultRiskConfig()): { score: number; rating: Rating; factors: RiskFactor[] } {
  const f: RiskFactor[] = [];
  const pts = (k: string) => {
    const x = cfg.factors[k];
    return x ? (x.enabled ? x.points : 0) : (DEFAULT_RISK_FACTORS.find((d) => d.key === k)?.points ?? 0);
  };
  const add = (key: string, label: string, points: number) => points && f.push({ key, label, points });
  const countries = ((cfg.factors.country?.params as { countries?: string[] } | null | undefined)?.countries ?? HIGH_RISK_COUNTRIES).map((c) => c.trim().toLowerCase());
  const inHighRisk = (v?: string | null) => !!v && countries.includes(v.trim().toLowerCase());
  const thr = (k: string, d: number) => Number((cfg.factors[k]?.params as { threshold?: number } | null | undefined)?.threshold ?? d);
  if (inHighRisk(i.country)) add('country', 'Applicant country is a high-risk jurisdiction', pts('country'));
  if (inHighRisk(i.bankJurisdiction)) add('bank', 'Bank jurisdiction is high-risk', pts('bank'));
  if (isYes(i.pep)) add('pep', 'Applicant is a politically exposed person', pts('pep'));
  if (i.ownerPep) add('owner_pep', 'A beneficial owner is a politically exposed person', pts('owner_pep'));
  if (i.applicantType && /trust|company|fund|entity|corporate|partnership|foundation/i.test(i.applicantType)) add('entity', 'Entity structure needs ownership look-through', pts('entity'));
  const inv = i.expectedInvestment ?? 0;
  const hi = thr('size_high', 5_000_000);
  const mid = thr('size_mid', 1_000_000);
  if (inv >= hi) add('size', `Expected investment of ${hi.toLocaleString('en-US')} or more`, pts('size_high'));
  else if (inv >= mid) add('size', `Expected investment of ${mid.toLocaleString('en-US')} or more`, pts('size_mid'));
  if (i.screening?.sanctions === 'Match') add('sanctions', 'Potential sanctions match', pts('sanctions_match'));
  else if (i.screening?.sanctions === 'Review') add('sanctions', 'Sanctions screening needs review', pts('sanctions_review'));
  if (i.screening?.pep && i.screening.pep !== 'Clear') add('pep_screen', 'PEP screening hit', pts('pep_screen'));
  if (i.screening?.other && i.screening.other !== 'Clear') add('screen_other', 'Adverse media or document screening hit', pts('screen_other'));
  // Latest outcome per check kind.
  const latest = new Map<string, string>();
  for (const c of i.checks ?? []) latest.set(c.kind, c.outcome);
  for (const [kind, outcome] of latest) {
    if (outcome === 'FAIL') add(`check_${kind}`, `${kind.replace(/_/g, ' ').toLowerCase()} check failed`, pts('check_fail'));
    else if (outcome === 'REFER') add(`check_${kind}`, `${kind.replace(/_/g, ' ').toLowerCase()} check referred`, pts('check_refer'));
  }
  if (i.missingSourceOfFunds) add('sof', 'Source of funds not stated', pts('sof'));
  const score = Math.min(100, f.reduce((a, x) => a + x.points, 0));
  return { score, rating: ratingFor(score, cfg), factors: f };
}

export function ratingFor(score: number, cfg?: Pick<RiskConfig, 'medium' | 'high'>): Rating {
  const high = cfg?.high ?? DEFAULT_THRESHOLDS.rating_high;
  const medium = cfg?.medium ?? DEFAULT_THRESHOLDS.rating_medium;
  return score >= high ? 'High' : score >= medium ? 'Medium' : 'Low';
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
  if (kind === 'DISPOSAL') {
    if (from === 'Disposed') return 'The document was already disposed';
    if (held) return 'A document on legal hold cannot be disposed';
    return to === 'Disposed' ? null : 'Unknown disposal target';
  }
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
