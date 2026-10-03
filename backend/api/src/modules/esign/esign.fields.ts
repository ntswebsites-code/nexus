/**
 * Pure helpers for positioned signature fields and reminder cadence (R4-4). No database or config, so
 * scripts/test-esign-depth.ts can exercise them directly.
 */
import { REMINDER_AFTER_MS, MAX_REMINDERS } from './esign.logic';

export const FIELD_KINDS = ['SIGNATURE', 'INITIALS', 'DATE', 'NAME'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const MAX_FIELDS_PER_REQUEST = 60;
const MIN_W = 0.04;
const MIN_H = 0.015;

/** Fractions (0..1) of the page, origin top-left, page numbers 1-based. */
export interface FieldSpec {
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
}

const r5 = (n: number) => Math.round(n * 100000) / 100000;

/** Validates one field against the page count and returns it rounded to 5 decimals. Throws Error with a user message. */
export function normaliseField(f: FieldSpec, pageCount: number): FieldSpec {
  if (!FIELD_KINDS.includes(f.kind)) throw new Error(`Unknown field type ${String(f.kind)}`);
  if (!Number.isInteger(f.page) || f.page < 1 || f.page > pageCount) throw new Error(`Page ${f.page} does not exist (the document has ${pageCount} page${pageCount === 1 ? '' : 's'})`);
  for (const [k, v] of Object.entries({ x: f.x, y: f.y, width: f.width, height: f.height })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Field ${k} is not a number`);
  }
  if (f.x < 0 || f.y < 0 || f.width < MIN_W || f.height < MIN_H) throw new Error('A field is too small or outside the page');
  if (f.x + f.width > 1.0005 || f.y + f.height > 1.0005) throw new Error('A field extends past the page edge');
  return { kind: f.kind, page: f.page, x: r5(f.x), y: r5(f.y), width: r5(f.width), height: r5(f.height), label: f.label?.trim().slice(0, 80) || null };
}

/** True when two boxes on the same page overlap by more than a sliver. */
export function overlaps(a: FieldSpec, b: FieldSpec): boolean {
  if (a.page !== b.page) return false;
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return ox > 0.005 && oy > 0.005;
}

/**
 * Validates the whole layout: fields must belong to a signer, must not overlap, and every signer needs at
 * least one SIGNATURE field once any field exists. Returns the normalised fields.
 */
export function validateLayout<T extends FieldSpec & { signerKey: string }>(fields: T[], pageCount: number, signerKeys: string[]): T[] {
  if (fields.length > MAX_FIELDS_PER_REQUEST) throw new Error(`At most ${MAX_FIELDS_PER_REQUEST} fields per request`);
  const keys = new Set(signerKeys);
  const out = fields.map((f) => {
    if (!keys.has(f.signerKey)) throw new Error('A field is assigned to someone who is not a signer on this request');
    return { ...f, ...normaliseField(f, pageCount) };
  });
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (overlaps(out[i]!, out[j]!)) throw new Error(`Two fields overlap on page ${out[i]!.page}`);
    }
  }
  if (out.length) {
    for (const k of signerKeys) {
      if (!out.some((f) => f.signerKey === k && f.kind === 'SIGNATURE')) throw new Error('Every signer needs at least one signature field');
    }
  }
  return out;
}

export function initialsOf(name: string): string {
  const parts = name.replace(/[^A-Za-zÀ-ɏ' -]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Deterministic text of a layout for hashing (signers identified by e-mail so it can be recomputed from the
 * database). The caller hashes it with SHA-256.
 */
export function layoutCanonical(fields: { signerEmail: string; kind: string; page: number; x: number; y: number; width: number; height: number }[]): string {
  const rows = fields.map((f) => [f.page, r5(f.y), r5(f.x), f.signerEmail.toLowerCase(), f.kind, r5(f.width), r5(f.height)] as const);
  rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]) || a[4].localeCompare(b[4]));
  return JSON.stringify(rows);
}

// ------------------------------------------------------------------ reminder cadence

export const MAX_REMINDER_INTERVAL_DAYS = 30;
export const MAX_REMINDER_CAP = 10;

export interface ReminderPolicy {
  intervalDays: number;
  max: number;
}

export function reminderPolicy(r: { reminderIntervalDays?: number | null; reminderMax?: number | null }): ReminderPolicy {
  const intervalDays = Math.min(Math.max(r.reminderIntervalDays ?? REMINDER_AFTER_MS / 86_400_000, 1), MAX_REMINDER_INTERVAL_DAYS);
  const max = Math.min(Math.max(r.reminderMax ?? MAX_REMINDERS, 0), MAX_REMINDER_CAP);
  return { intervalDays, max };
}

/** Whether a PENDING signer is due a reminder at `now` under the request's cadence. */
export function reminderDue(signer: { reminderCount: number; notifiedAt: Date | null }, policy: ReminderPolicy, now: Date): boolean {
  if (signer.reminderCount >= policy.max || !signer.notifiedAt) return false;
  return now.getTime() - signer.notifiedAt.getTime() >= policy.intervalDays * 86_400_000;
}

/** Next reminder time for display, or null when none will be sent. */
export function nextReminderAt(signer: { reminderCount: number; notifiedAt: Date | null }, policy: ReminderPolicy): Date | null {
  if (signer.reminderCount >= policy.max || !signer.notifiedAt) return null;
  return new Date(signer.notifiedAt.getTime() + policy.intervalDays * 86_400_000);
}
