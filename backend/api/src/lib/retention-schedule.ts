import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * FR-DOC-017 retention schedules. A schedule row sets the minimum retention (years) for a document type and
 * classification, `*` meaning any. The most specific active row wins: type+classification, then type, then
 * classification, then the catch-all. Enforcement only ever raises retention; it never shortens or deletes.
 */
type Db = Prisma.TransactionClient | typeof prisma;

export interface ScheduleRow {
  docType: string;
  classification: string;
  retentionYears: number;
}

/** Pure matcher so it can be unit-tested without a database. */
export function matchSchedule(rows: ScheduleRow[], type: string, classification: string): ScheduleRow | null {
  const rank = (r: ScheduleRow) => (r.docType === type ? 2 : 0) + (r.classification === classification ? 1 : 0);
  const fits = rows.filter((r) => (r.docType === '*' || r.docType === type) && (r.classification === '*' || r.classification === classification));
  if (!fits.length) return null;
  return fits.reduce((best, r) => (rank(r) > rank(best) ? r : best));
}

export async function activeSchedules(db: Db = prisma): Promise<ScheduleRow[]> {
  return db.documentRetentionSchedule.findMany({ where: { active: true }, select: { docType: true, classification: true, retentionYears: true } });
}

/** Minimum retention for a new or changed document: the schedule when one applies, otherwise 1 year. */
export async function scheduleMinimum(type: string, classification: string, db: Db = prisma): Promise<number> {
  return matchSchedule(await activeSchedules(db), type, classification)?.retentionYears ?? 1;
}

/** Requested retention raised to the schedule minimum. */
export async function enforcedRetention(type: string, classification: string, requested: number, db: Db = prisma): Promise<number> {
  return Math.max(requested, await scheduleMinimum(type, classification, db));
}

/**
 * Nightly enforcement: raises retention_years on documents below their schedule minimum (never lowers) and counts
 * documents past their retention end with no open legal hold. Disposed documents are skipped. Nothing is deleted:
 * disposal stays a maker-checker request in the vault.
 */
export async function enforceSchedules(dryRun: boolean, now = new Date()): Promise<{ raised: number; eligible: number; heldPastRetention: number }> {
  const rows = await activeSchedules();
  const docs = await prisma.document.findMany({
    where: { status: { not: 'Disposed' } },
    select: { id: true, type: true, classification: true, retentionYears: true, documentDate: true, createdAt: true },
    take: 20_000,
  });
  const holdRows = await prisma.documentHold.findMany({ where: { releasedAt: null }, select: { documentId: true } });
  const held = new Set(holdRows.map((h) => h.documentId));
  let raised = 0;
  let eligible = 0;
  let heldPast = 0;
  for (const d of docs) {
    let years = d.retentionYears;
    const min = matchSchedule(rows, d.type, d.classification)?.retentionYears;
    if (min !== undefined && years < min) {
      raised += 1;
      years = min;
      if (!dryRun) await prisma.document.update({ where: { id: d.id }, data: { retentionYears: min, version: { increment: 1 } } });
    }
    const base = d.documentDate ?? d.createdAt;
    const end = new Date(base);
    end.setUTCFullYear(end.getUTCFullYear() + years);
    if (end.getTime() <= now.getTime()) {
      if (held.has(d.id)) heldPast += 1;
      else eligible += 1;
    }
  }
  return { raised, eligible, heldPastRetention: heldPast };
}
