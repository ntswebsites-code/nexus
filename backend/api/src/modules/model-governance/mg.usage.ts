import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import type { Prisma } from '@prisma/client';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { setting } from '../../lib/settings';

/**
 * Model usage by platform calculations. A purpose (NAV_VALUATION, RISK_SCENARIO) is bound to one registered model; every
 * NAV run and every risk scenario run writes a usage row against the bound model's approved version, so the register
 * shows what the model was actually used for. When a binding is `enforce`, a calculation is refused while the model has
 * no approved version or its periodic review is overdue. Unbound purposes and logging problems never block a calculation.
 */
export const BINDING_PURPOSES = ['NAV_VALUATION', 'RISK_SCENARIO', 'RISK_LIMIT', 'RISK_VAR'] as const;
export type BindingPurpose = (typeof BINDING_PURPOSES)[number];

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Review cadence in months by tier (1 = high materiality). */
export const REVIEW_MONTHS: Record<number, number> = { 1: 6, 2: 12, 3: 24 };
export function addMonths(from: Date, months: number): Date {
  const d = startOfDay(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Keeps a stored inputs/outputs document small and JSON-safe (Decimals and dates become strings, long text is cut). */
export function compactJson(v: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}...` : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (depth >= 4) return String(v).slice(0, 200);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => compactJson(x, depth + 1) ?? '');
  if (typeof v === 'object') {
    if (typeof (v as { toFixed?: unknown }).toFixed === 'function') return String(v);
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
      const c = compactJson(x, depth + 1);
      if (c !== null) out[k] = c;
    }
    return out;
  }
  return String(v);
}

/** Stores the inputs and outputs of one model use next to its usage row. No-op when both are empty. */
export async function recordUsageIo(tx: Prisma.TransactionClient, usageId: string, modelId: string, purpose: string, inputs: unknown, outputs: unknown) {
  const i = compactJson(inputs);
  const out = compactJson(outputs);
  if (i === null && out === null) return;
  const data = { usageId, modelId, purpose, inputs: i ?? undefined, outputs: out ?? undefined };
  await tx.govModelUsageIo.upsert({ where: { usageId }, create: data, update: {} });
}

interface Usable {
  binding: { id: string; enforce: boolean; modelId: string };
  model: { id: string; ref: string; name: string; status: string; currentVersionId: string | null; nextReviewOn: Date | null };
  problem: string | null;
}

async function resolve(purpose: BindingPurpose, now = new Date()): Promise<Usable | null> {
  const binding = await prisma.govModelBinding.findUnique({ where: { purpose } });
  if (!binding) return null;
  const model = await prisma.govModel.findUnique({ where: { id: binding.modelId }, select: { id: true, ref: true, name: true, status: true, currentVersionId: true, nextReviewOn: true } });
  if (!model) return { binding, model: { id: binding.modelId, ref: '?', name: 'unknown', status: 'MISSING', currentVersionId: null, nextReviewOn: null }, problem: 'The bound model no longer exists' };
  let problem: string | null = null;
  if (model.status !== 'APPROVED' || !model.currentVersionId) problem = `${model.ref} has no approved version (status ${model.status})`;
  else if (model.nextReviewOn && model.nextReviewOn.getTime() < startOfDay(now).getTime()) problem = `The periodic review of ${model.ref} was due on ${model.nextReviewOn.toISOString().slice(0, 10)}`;
  return { binding, model, problem };
}

/** Throws 409 when the purpose's binding is enforced and its model is not currently usable. */
export async function assertModelUsable(purpose: BindingPurpose): Promise<void> {
  const u = await resolve(purpose);
  if (u?.problem && u.binding.enforce) throw HttpError.conflict(`This calculation is bound to ${u.model.ref} ${u.model.name}: ${u.problem}`, 'model_not_usable');
}

/** Records that a calculation used the bound model. Best effort: a logging failure is reported, never thrown (unless the model is enforced and unusable). */
export async function logModelUse(purpose: BindingPurpose, o: { context: string; objectRef?: string | null; userId: string; audit: AuditContext; inputs?: unknown; outputs?: unknown }): Promise<{ logged: boolean; warning?: string }> {
  try {
    const u = await resolve(purpose);
    if (!u) return { logged: false };
    if (u.problem) {
      if (u.binding.enforce) throw HttpError.conflict(`This calculation is bound to ${u.model.ref} ${u.model.name}: ${u.problem}`, 'model_not_usable');
      return { logged: false, warning: u.problem };
    }
    await prisma.$transaction(async (tx) => {
      const row = await tx.govModelUsage.create({ data: { modelId: u.model.id, versionId: u.model.currentVersionId!, context: o.context.slice(0, 200), objectRef: o.objectRef?.slice(0, 60) ?? null, note: `Automatic (${purpose})`, usedBy: o.userId } });
      await recordUsageIo(tx, row.id, u.model.id, purpose, o.inputs, o.outputs);
      await writeAudit(tx, o.audit, { action: 'model.used', objectType: 'gov_model', objectId: u.model.id, after: { purpose, context: o.context, objectRef: o.objectRef ?? null, automatic: true } });
    });
    return { logged: true };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.warn('[model-governance] usage logging failed', e);
    return { logged: false, warning: 'Usage could not be logged' };
  }
}

/**
 * Opens a periodic review for every APPROVED model whose review date falls within `horizonDays` and that has no open
 * review. Returns the number opened. Idempotent; safe to run from a scheduler or the screen.
 */
export async function openDueReviews(actorId: string, horizonDays = 30, now = new Date()): Promise<number> {
  const limit = new Date(startOfDay(now).getTime() + horizonDays * 86_400_000);
  const due = await prisma.govModel.findMany({ where: { status: 'APPROVED', nextReviewOn: { lte: limit } }, select: { id: true, nextReviewOn: true } });
  let n = 0;
  for (const m of due) {
    const open = await prisma.govModelReview.findFirst({ where: { modelId: m.id, status: { in: ['OPEN', 'SUBMITTED'] } }, select: { id: true } });
    if (open) continue;
    await prisma.govModelReview.create({ data: { modelId: m.id, dueOn: m.nextReviewOn!, openedBy: actorId } });
    n++;
  }
  return n;
}

/**
 * Review reminders (worker, daily). For every OPEN or SUBMITTED review: a DUE_SOON notice to the review approvers
 * when it falls due within `notify.review_reminder_days`, and an OVERDUE notice (with email) once past
 * its due date. One notice per review, kind and day (unique row), so repeated ticks are harmless. Also opens the
 * reviews that are due. Returns the number of notices queued.
 */
export async function sendReviewReminders(now = new Date()): Promise<number> {
  if (!(await setting<boolean>('feature.model_review_reminders'))) return 0;
  const lead = await setting<number>('notify.review_reminder_days');
  const today = startOfDay(now);
  const owner = await prisma.user.findFirst({ where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: 'model.approve' } } } } } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
  if (owner) await openDueReviews(owner.id, lead, now);
  const open = await prisma.govModelReview.findMany({ where: { status: { in: ['OPEN', 'SUBMITTED'] }, dueOn: { lte: new Date(today.getTime() + lead * 86_400_000) } }, take: 500 });
  if (!open.length) return 0;
  const models = await prisma.govModel.findMany({ where: { id: { in: open.map((r) => r.modelId) } }, select: { id: true, ref: true, name: true, ownerName: true } });
  const m = new Map(models.map((x) => [x.id, x]));
  let sent = 0;
  for (const r of open) {
    const model = m.get(r.modelId);
    if (!model) continue;
    const overdue = r.dueOn.getTime() < today.getTime();
    const kind = overdue ? 'OVERDUE' : 'DUE_SOON';
    const days = Math.round(Math.abs(r.dueOn.getTime() - today.getTime()) / 86_400_000);
    const title = overdue ? `${model.ref} periodic review is ${days} day(s) overdue` : `${model.ref} periodic review is due in ${days} day(s)`;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.govReviewReminder.create({ data: { reviewId: r.id, kind, sentOn: today } });
        await enqueue(tx, 'notify.permission', { permission: 'model.approve', type: 'model.review', title, body: `${model.name} (owner ${model.ownerName})`, link: `/ops/model-governance?model=${model.id}`, email: overdue });
      });
      sent++;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e; // already reminded today
    }
  }
  return sent;
}
