import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';

/**
 * Model usage by platform calculations. A purpose (NAV_VALUATION, RISK_SCENARIO) is bound to one registered model; every
 * NAV run and every risk scenario run writes a usage row against the bound model's approved version, so the register
 * shows what the model was actually used for. When a binding is `enforce`, a calculation is refused while the model has
 * no approved version or its periodic review is overdue. Unbound purposes and logging problems never block a calculation.
 */
export const BINDING_PURPOSES = ['NAV_VALUATION', 'RISK_SCENARIO'] as const;
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
export async function logModelUse(purpose: BindingPurpose, o: { context: string; objectRef?: string | null; userId: string; audit: AuditContext }): Promise<{ logged: boolean; warning?: string }> {
  try {
    const u = await resolve(purpose);
    if (!u) return { logged: false };
    if (u.problem) {
      if (u.binding.enforce) throw HttpError.conflict(`This calculation is bound to ${u.model.ref} ${u.model.name}: ${u.problem}`, 'model_not_usable');
      return { logged: false, warning: u.problem };
    }
    await prisma.$transaction(async (tx) => {
      await tx.govModelUsage.create({ data: { modelId: u.model.id, versionId: u.model.currentVersionId!, context: o.context.slice(0, 200), objectRef: o.objectRef?.slice(0, 60) ?? null, note: `Automatic (${purpose})`, usedBy: o.userId } });
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
