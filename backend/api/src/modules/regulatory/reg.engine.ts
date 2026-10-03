/**
 * Regulatory Reporting engine (SRD 5.A page `regulatory`): templates, period and due-date maths, the filing state
 * machine and the payload hash. Pure; the live-data builders are in reg.service.ts.
 */
import { createHash } from 'node:crypto';

export const FILING_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'SUBMITTED', 'RETURNED', 'WAIVED'] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];
export const OPEN_STATUSES: FilingStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETURNED'];

export interface TemplateSpec {
  key: string;
  regulator: string;
  formCode: string;
  name: string;
  description: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  dueAfterDays: number;
}

/** Day-one templates. Form codes are internal working codes for the return, not regulator-issued identifiers. */
export const TEMPLATES: TemplateSpec[] = [
  { key: 'SECZ_QUARTERLY', regulator: 'SECZ', formCode: 'SECZ-AM-Q', name: 'SECZ quarterly return (asset manager)', description: 'Assets under management from released NAV runs, client base by type and KYC status, trading activity and limit breaches for the quarter.', frequency: 'QUARTERLY', dueAfterDays: 30 },
  { key: 'SECZ_ANNUAL_AUM', regulator: 'SECZ', formCode: 'SECZ-AM-A', name: 'SECZ annual funds under management schedule', description: 'Each fund with its latest NAV, valuation status, investor count and total commitments at year end.', frequency: 'ANNUAL', dueAfterDays: 90 },
  { key: 'FIU_CTR', regulator: 'FIU', formCode: 'FIU-CTR', name: 'FIU large cash transaction report', description: 'Posted client deposits and withdrawals at or above the reporting threshold (policy reg.fiu_ctr_threshold, default 10,000).', frequency: 'MONTHLY', dueAfterDays: 15 },
  { key: 'FIU_KYC_RISK', regulator: 'FIU', formCode: 'FIU-RISK', name: 'FIU client risk and screening summary', description: 'Clients by risk rating and KYC status, high-risk cases, screening matches and reviews in the period, and overdue KYC reviews.', frequency: 'QUARTERLY', dueAfterDays: 30 },
];

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** The reporting period that CONTAINS `on` for a frequency (calendar month, quarter or year). */
export function periodContaining(f: TemplateSpec['frequency'], on: Date) {
  const y = on.getUTCFullYear();
  const m = on.getUTCMonth();
  if (f === 'MONTHLY') return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 0)) };
  if (f === 'QUARTERLY') {
    const q = Math.floor(m / 3);
    return { start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 0)) };
  }
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 31)) };
}

/** The last period that has fully ended before `today`. */
export function lastClosedPeriod(f: TemplateSpec['frequency'], today: Date) {
  const cur = periodContaining(f, today);
  return periodContaining(f, addDays(cur.start, -1));
}

export const dueDateFor = (periodEnd: Date, dueAfterDays: number) => addDays(periodEnd, dueAfterDays);

/** OVERDUE is derived, never stored: an unsubmitted filing past its due date. */
export function effectiveStatus(s: { status: string; dueDate: Date }, today: Date) {
  return OPEN_STATUSES.includes(s.status as FilingStatus) && s.dueDate.getTime() < today.getTime() ? 'OVERDUE' : s.status;
}

export function daysToDue(dueDate: Date, today: Date) {
  return Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
}

/** Legal moves of the filing state machine. */
const MOVES: Record<string, FilingStatus[]> = {
  submitReview: ['DRAFT', 'RETURNED'],
  approve: ['IN_REVIEW'],
  return: ['IN_REVIEW', 'APPROVED'],
  submit: ['APPROVED'],
  waive: ['DRAFT', 'RETURNED'],
  edit: ['DRAFT', 'RETURNED'],
};
export const canMove = (action: keyof typeof MOVES, status: string) => MOVES[action]!.includes(status as FilingStatus);

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
}
export const payloadHash = (payload: unknown) => createHash('sha256').update(canonical(payload)).digest('hex');

export interface Payload {
  template: string;
  period: { start: string; end: string };
  figures: { label: string; value: string }[];
  tables: { name: string; columns: string[]; rows: (string | number | null)[][] }[];
  notes: string[];
}

/** Flattens a payload to CSV for the regulator's upload portal. */
export function payloadCsv(p: Payload): string {
  const cell = (v: string | number | null) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [cell(p.template), `Period,${p.period.start},${p.period.end}`];
  for (const f of p.figures) out.push(`${cell(f.label)},${cell(f.value)}`);
  for (const t of p.tables) {
    out.push('', cell(t.name), t.columns.map(cell).join(','));
    for (const r of t.rows) out.push(r.map(cell).join(','));
  }
  for (const n of p.notes) out.push('', cell(`Note: ${n}`));
  return `${out.join('\r\n')}\r\n`;
}
