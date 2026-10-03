import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { ccy, dateStr, D, f2, f4, invalidState, listPage, names, nonNegative, pct, portfolioFilter, portfolioMap, positive, reasonSchema, resolvePortfolioId, resolveSecurity, securityMap, sod, statusIn, toDate, today, UUID, ZERO } from '../rp-common';
import { FACILITY_TYPES, margin, OPEN_CALL, termsProblems } from './fin.engine';
import { callViews, drawnOf, facilityMargin, facilityViews, loadRules, marginView, valuationView, valuePoolById, type CallRow, type FacilityRow, type PoolRow } from './fin.service';

/**
 * Collateral & Financing (SRD 5.A.15 `financing`). Admin-portal staff only, mounted at `/api/v1/financing`.
 * `risk.view` reads; `financing.manage` prepares facilities, pools, haircut rules, drawdowns and margin calls;
 * `financing.approve` is the checker (activates a facility, waives a margin call; not the maker; step-up MFA).
 * Drawn balance and coverage are derived from movements and the live pool valuation, never stored.
 */
export const financingRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('risk.view')];
const canManage = [...staff, requirePermission('risk.view'), requirePermission('financing.manage')];
const canApprove = [...staff, requirePermission('risk.view'), requirePermission('financing.approve')];

async function loadFacility(v: string): Promise<FacilityRow> {
  const r = await prisma.finFacility.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Facility not found');
  return r;
}
async function loadPool(v: string): Promise<PoolRow> {
  const r = await prisma.finPool.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Collateral pool not found');
  return r;
}
async function loadCall(v: string): Promise<CallRow> {
  const r = await prisma.finMarginCall.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Margin call not found');
  return r;
}

async function respondFacility(res: Response, id: string, status = 200) {
  res.status(status).json({ data: (await facilityViews([await prisma.finFacility.findUniqueOrThrow({ where: { id } })]))[0] });
}
async function respondCall(res: Response, id: string, status = 200) {
  res.status(status).json({ data: (await callViews([await prisma.finMarginCall.findUniqueOrThrow({ where: { id } })]))[0] });
}

// ================================================================ summary

financingRoutes.get('/summary', ...canView, async (_req, res) => {
  const facilities = await prisma.finFacility.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED'] } }, orderBy: { ref: 'asc' } });
  const views = await facilityViews(facilities);
  const calls = await prisma.finMarginCall.findMany({ where: { status: { in: OPEN_CALL } }, orderBy: { dueAt: 'asc' } });
  const cv = await callViews(calls);
  const byCcy = new Map<string, { limit: Prisma.Decimal; drawn: Prisma.Decimal }>();
  for (const v of views) {
    const e = byCcy.get(v.currency) ?? { limit: ZERO, drawn: ZERO };
    e.limit = e.limit.add(v.limitAmount ?? 0);
    e.drawn = e.drawn.add(v.margin.drawn ?? 0);
    byCcy.set(v.currency, e);
  }
  res.json({
    data: {
      facilities: views.length,
      pendingApproval: await prisma.finFacility.count({ where: { status: 'PENDING_APPROVAL' } }),
      inDeficit: views.filter((v) => v.margin.state === 'DEFICIT').length,
      warning: views.filter((v) => v.margin.state === 'WARNING').length,
      openCalls: cv.length,
      overdueCalls: cv.filter((c) => c.overdue).length,
      exposure: [...byCcy.entries()].map(([currency, e]) => ({ currency, limit: e.limit.toFixed(2), drawn: e.drawn.toFixed(2) })),
      watchlist: views.filter((v) => v.margin.coverage).sort((a, b) => Number(a.margin.coverage) - Number(b.margin.coverage)).slice(0, 5),
      openCallList: cv,
    },
  });
});

// ================================================================ facilities

const termsShape = {
  name: z.string().trim().min(2).max(160),
  type: z.enum(FACILITY_TYPES),
  lender: z.string().trim().min(2).max(160),
  portfolioId: z.string().trim().min(1).max(36),
  poolId: z.string().trim().max(36).optional(),
  currency: ccy.default('USD'),
  limitAmount: positive,
  ratePct: nonNegative.default(new D(0)),
  initialRatio: positive.default(new D('1.5')),
  maintenanceRatio: positive.default(new D('1.25')),
  callDueDays: z.number().int().min(0).max(30).default(2),
};
const facilityBody = z.object(termsShape).strict();
const facilityPatch = z.object(termsShape).partial().extend({ version: z.number().int().optional() }).strict();

async function resolvePoolFor(poolId: string | undefined, portfolioId: string): Promise<string | null> {
  if (!poolId) return null;
  const p = await loadPool(poolId).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'poolId', message: 'Unknown collateral pool' }]);
  });
  if (p.portfolioId !== portfolioId) throw HttpError.badRequest('Validation failed', [{ path: 'poolId', message: 'The pool belongs to a different portfolio' }]);
  return p.id;
}

financingRoutes.get('/facilities', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), portfolioId: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; portfolioId?: string }>(req);
  const where: Prisma.FinFacilityWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  const [rows, total] = await Promise.all([prisma.finFacility.findMany({ where, orderBy: { ref: 'asc' }, take: f.limit, skip: f.offset }), prisma.finFacility.count({ where })]);
  res.json({ data: await facilityViews(rows), total });
});

financingRoutes.post('/facilities', ...canManage, validateBody(facilityBody), idempotent('fin.facility_create'), async (req, res) => {
  const b = req.body as z.infer<typeof facilityBody>;
  const problems = termsProblems(b);
  if (problems.length) throw HttpError.badRequest('Validation failed', problems.map((message) => ({ path: 'terms', message })));
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const poolId = await resolvePoolFor(b.poolId, portfolioId);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'finFacility');
    const f = await tx.finFacility.create({ data: { ref, name: b.name, type: b.type, lender: b.lender, portfolioId, poolId, currency: b.currency, limitAmount: b.limitAmount, ratePct: b.ratePct, initialRatio: b.initialRatio, maintenanceRatio: b.maintenanceRatio, callDueDays: b.callDueDays, makerId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'fin.facility_created', objectType: 'fin_facility', objectId: f.id, after: { ref, type: b.type, lender: b.lender, limit: b.limitAmount.toFixed(2), initialRatio: b.initialRatio.toString(), maintenanceRatio: b.maintenanceRatio.toString() } });
    return f;
  });
  await respondFacility(res, row.id, 201);
});

financingRoutes.get('/facilities/:id', ...canView, async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  const [view] = await facilityViews([f]);
  const m = await facilityMargin(f);
  const [movements, calls] = await Promise.all([prisma.finMovement.findMany({ where: { facilityId: f.id }, orderBy: [{ valueDate: 'desc' }, { createdAt: 'desc' }], take: 100 }), prisma.finMarginCall.findMany({ where: { facilityId: f.id }, orderBy: { createdAt: 'desc' }, take: 50 })]);
  const usr = await names(movements.map((x) => x.createdBy));
  res.json({
    data: {
      ...view!,
      valuation: valuationView(m.valuation),
      movements: movements.map((x) => ({ id: x.id, kind: x.kind, amount: f2(x.amount), valueDate: x.valueDate.toISOString().slice(0, 10), note: x.note, createdByName: usr.get(x.createdBy) ?? null, createdAt: x.createdAt.toISOString() })),
      calls: await callViews(calls),
    },
  });
});

financingRoutes.patch('/facilities/:id', ...canManage, validateBody(facilityPatch), idempotent('financing.patch.facilities_id', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'DRAFT') throw invalidState(`${f.ref} is ${f.status}; only a DRAFT facility can be edited`);
  if (f.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who prepared this facility can change it', 'not_maker');
  const { version, ...b } = req.body as z.infer<typeof facilityPatch>;
  if (version !== undefined && version !== f.version) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  const terms = { limitAmount: b.limitAmount ?? f.limitAmount, initialRatio: b.initialRatio ?? f.initialRatio, maintenanceRatio: b.maintenanceRatio ?? f.maintenanceRatio };
  const problems = termsProblems(terms);
  if (problems.length) throw HttpError.badRequest('Validation failed', problems.map((message) => ({ path: 'terms', message })));
  const portfolioId = b.portfolioId ? await resolvePortfolioId(b.portfolioId) : f.portfolioId;
  const poolId = b.poolId !== undefined || b.portfolioId ? await resolvePoolFor(b.poolId ?? f.poolId ?? undefined, portfolioId) : f.poolId;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'DRAFT', version: f.version }, data: { name: b.name, type: b.type, lender: b.lender, portfolioId, poolId, currency: b.currency, limitAmount: b.limitAmount, ratePct: b.ratePct, initialRatio: b.initialRatio, maintenanceRatio: b.maintenanceRatio, callDueDays: b.callDueDays, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_updated', objectType: 'fin_facility', objectId: f.id, before: { limit: f.limitAmount.toFixed(2), initialRatio: f.initialRatio.toString() }, after: { ...b, limitAmount: b.limitAmount?.toFixed(2) } });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/submit', ...canManage, idempotent('fin.facility_submit', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'DRAFT') throw invalidState(`${f.ref} is ${f.status}; only a DRAFT can be submitted`);
  if (f.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who prepared this facility can submit it', 'not_maker');
  if (!f.poolId) throw new HttpError(409, 'pool_required', 'Link a collateral pool before submitting the facility');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL' } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_submitted', objectType: 'fin_facility', objectId: f.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL' } });
    await notifyPermission(tx, 'financing.approve', { type: 'fin.facility_pending', title: `Facility ${f.ref} awaits approval`, body: f.name, link: `/ops/financing?facility=${f.id}` });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/return', ...canApprove, validateBody(reasonSchema), idempotent('financing.post.facilities_id_return', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'PENDING_APPROVAL') throw invalidState(`${f.ref} is ${f.status}; only a pending facility can be returned`);
  if (f.makerId === req.user!.id) throw sod('Return a facility you did not prepare');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT' } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_returned', objectType: 'fin_facility', objectId: f.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'DRAFT' }, reason });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/approve', ...canApprove, requireStepUp, idempotent('fin.facility_approve', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'PENDING_APPROVAL') throw invalidState(`${f.ref} is ${f.status}; it must be PENDING_APPROVAL to approve`);
  if (f.makerId === req.user!.id) throw sod('The person who prepared a facility cannot approve it (maker-checker)');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'PENDING_APPROVAL' }, data: { status: 'ACTIVE', approverId: req.user!.id, approvedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_approved', objectType: 'fin_facility', objectId: f.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'ACTIVE', makerId: f.makerId, approverId: req.user!.id, limit: f.limitAmount.toFixed(2) } });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/suspend', ...canManage, validateBody(reasonSchema), idempotent('financing.post.facilities_id_suspend', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'ACTIVE') throw invalidState(`${f.ref} is ${f.status}`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'ACTIVE' }, data: { status: 'SUSPENDED' } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_suspended', objectType: 'fin_facility', objectId: f.id, before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' }, reason });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/reactivate', ...canApprove, requireStepUp, validateBody(reasonSchema), idempotent('financing.post.facilities_id_reactivate', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'SUSPENDED') throw invalidState(`${f.ref} is ${f.status}`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: 'SUSPENDED' }, data: { status: 'ACTIVE' } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_reactivated', objectType: 'fin_facility', objectId: f.id, before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE' }, reason });
  });
  await respondFacility(res, f.id);
});

financingRoutes.post('/facilities/:id/close', ...canManage, validateBody(reasonSchema), idempotent('financing.post.facilities_id_close', { required: false }), async (req, res) => {
  const f = await loadFacility(param(req, 'id'));
  if (f.status === 'CLOSED') throw invalidState(`${f.ref} is already closed`);
  const drawn = await drawnOf(f.id);
  if (drawn.gt(0)) throw new HttpError(409, 'outstanding_balance', `${f.ref} still has ${drawn.toFixed(2)} drawn; repay it first`);
  const open = await prisma.finMarginCall.count({ where: { facilityId: f.id, status: { in: OPEN_CALL } } });
  if (open) throw new HttpError(409, 'open_calls', `${f.ref} has ${open} open margin call(s)`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finFacility.updateMany({ where: { id: f.id, status: f.status }, data: { status: 'CLOSED' } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.facility_closed', objectType: 'fin_facility', objectId: f.id, before: { status: f.status }, after: { status: 'CLOSED' }, reason });
  });
  await respondFacility(res, f.id);
});

// ---------------------------------------------------------------- drawdowns and repayments

const moveBody = z.object({ amount: positive, valueDate: dateStr.optional(), note: z.string().trim().max(255).optional() }).strict();

async function recordMovement(req: Request, res: Response, kind: 'DRAW' | 'REPAY') {
  const b = req.body as z.infer<typeof moveBody>;
  const f = await loadFacility(param(req, 'id'));
  if (f.status !== 'ACTIVE') throw invalidState(`${f.ref} is ${f.status}; movements need an ACTIVE facility`);
  const valueDate = b.valueDate ? toDate(b.valueDate) : today();
  if (valueDate.getTime() > today().getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'valueDate', message: 'The value date cannot be in the future' }]);
  const out = await prisma.$transaction(async (tx) => {
    // Serialise movements on one facility so concurrent draws cannot both pass the limit check.
    await tx.$queryRaw`SELECT id FROM fin_facilities WHERE id = ${f.id} FOR UPDATE`;
    const drawn = await drawnOf(f.id, tx);
    if (kind === 'REPAY') {
      if (b.amount.gt(drawn)) throw new HttpError(409, 'exceeds_drawn', `Repayment of ${b.amount.toFixed(2)} exceeds the drawn balance of ${drawn.toFixed(2)}`);
    } else {
      const open = await tx.finMarginCall.count({ where: { facilityId: f.id, status: { in: OPEN_CALL } } });
      if (open) throw new HttpError(409, 'open_margin_call', `${f.ref} has an open margin call; meet it before drawing more`);
      const after = drawn.add(b.amount);
      if (after.gt(f.limitAmount)) throw new HttpError(409, 'exceeds_limit', `Drawing ${b.amount.toFixed(2)} takes the balance to ${after.toFixed(2)}, above the limit of ${f.limitAmount.toFixed(2)}`);
      const val = f.poolId ? await valuePoolById(f.poolId, f.currency, tx) : null;
      const m = margin({ limitAmount: f.limitAmount, initialRatio: f.initialRatio, maintenanceRatio: f.maintenanceRatio }, after, val?.counted ?? ZERO);
      if (!m.coverage || m.coverage.lt(f.initialRatio)) throw new HttpError(409, 'insufficient_collateral', `After this draw coverage would be ${m.coverage?.toFixed(2) ?? '0.00'}x, below the initial ratio of ${f.initialRatio.toFixed(2)}x. Available to draw: ${margin({ limitAmount: f.limitAmount, initialRatio: f.initialRatio, maintenanceRatio: f.maintenanceRatio }, drawn, val?.counted ?? ZERO).availableToDraw.toFixed(2)}`);
    }
    const mv = await tx.finMovement.create({ data: { facilityId: f.id, kind, amount: b.amount, valueDate, note: b.note ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: kind === 'DRAW' ? 'fin.drawdown' : 'fin.repayment', objectType: 'fin_facility', objectId: f.id, before: { drawn: drawn.toFixed(2) }, after: { movement: mv.id, amount: b.amount.toFixed(2), valueDate: valueDate.toISOString().slice(0, 10), drawn: (kind === 'DRAW' ? drawn.add(b.amount) : drawn.sub(b.amount)).toFixed(2) } });
    return mv;
  });
  void out;
  await respondFacility(res, f.id, 201);
}

financingRoutes.post('/facilities/:id/draw', ...canManage, requireStepUp, validateBody(moveBody), idempotent('fin.draw'), (req, res) => recordMovement(req, res, 'DRAW'));
financingRoutes.post('/facilities/:id/repay', ...canManage, validateBody(moveBody), idempotent('fin.repay'), (req, res) => recordMovement(req, res, 'REPAY'));

// ================================================================ pools and collateral

async function poolView(p: PoolRow, currency?: string) {
  const pf = await portfolioMap([p.portfolioId]);
  const ccyUse = currency ?? pf.get(p.portfolioId)?.baseCurrency ?? 'USD';
  const [val, facilities] = await Promise.all([valuePoolById(p.id, ccyUse), prisma.finFacility.findMany({ where: { poolId: p.id, status: { notIn: ['CLOSED'] } }, select: { id: true, ref: true, name: true, status: true } })]);
  return { id: p.id, ref: p.ref, name: p.name, portfolioId: p.portfolioId, portfolioRef: pf.get(p.portfolioId)?.ref ?? null, portfolioName: pf.get(p.portfolioId)?.name ?? null, status: p.status, currency: ccyUse, valuation: valuationView(val), facilities, createdAt: p.createdAt.toISOString() };
}

financingRoutes.get('/pools', ...canView, async (_req, res) => {
  const rows = await prisma.finPool.findMany({ orderBy: { ref: 'asc' } });
  const out = [];
  for (const p of rows) {
    const v = await poolView(p);
    out.push({ ...v, valuation: v.valuation && { ...v.valuation, lines: undefined }, items: v.valuation?.lines.length ?? 0 });
  }
  res.json({ data: out });
});

financingRoutes.post('/pools', ...canManage, validateBody(z.object({ name: z.string().trim().min(2).max(160), portfolioId: z.string().trim().min(1).max(36) }).strict()), idempotent('fin.pool_create'), async (req, res) => {
  const b = req.body as { name: string; portfolioId: string };
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'finPool');
    const p = await tx.finPool.create({ data: { ref, name: b.name, portfolioId, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'fin.pool_created', objectType: 'fin_pool', objectId: p.id, after: { ref, name: b.name, portfolioId } });
    return p;
  });
  res.status(201).json({ data: await poolView(row) });
});

financingRoutes.get('/pools/:id', ...canView, async (req, res) => {
  const p = await loadPool(param(req, 'id'));
  const fac = await prisma.finFacility.findFirst({ where: { poolId: p.id, status: { not: 'CLOSED' } }, select: { currency: true } });
  res.json({ data: await poolView(p, fac?.currency) });
});

/** Quantity of a security held by the portfolio, latest position row. */
async function heldQuantity(portfolioId: string, securityId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await db.portfolioPosition.findFirst({ where: { portfolioId, securityId }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
  return row?.quantity ?? ZERO;
}
async function pledgedQuantity(portfolioId: string, securityId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const g = await db.finCollateralItem.aggregate({ where: { securityId, status: 'POSTED', pool: { portfolioId } }, _sum: { quantity: true } });
  return g._sum.quantity ?? ZERO;
}

financingRoutes.post('/pools/:id/collateral', ...canManage, validateBody(z.object({ securityId: z.string().trim().min(1).max(36), quantity: positive }).strict()), idempotent('fin.collateral_post'), async (req, res) => {
  const p = await loadPool(param(req, 'id'));
  if (p.status !== 'ACTIVE') throw invalidState(`${p.ref} is ${p.status}`);
  const b = req.body as { securityId: string; quantity: Prisma.Decimal };
  const sec = await resolveSecurity(b.securityId);
  const rules = await loadRules();
  const rule = rules.find((r) => r.assetClass === sec.assetClass && r.market === sec.market) ?? rules.find((r) => r.assetClass === sec.assetClass && r.market === '');
  if (!rule || !rule.eligible) throw new HttpError(409, 'ineligible_collateral', `${sec.ticker} (${sec.assetClass}, ${sec.market}) is not eligible collateral`);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fin_pools WHERE id = ${p.id} FOR UPDATE`;
    const held = await heldQuantity(p.portfolioId, sec.id, tx);
    const pledged = await pledgedQuantity(p.portfolioId, sec.id, tx);
    const free = held.sub(pledged);
    if (b.quantity.gt(free)) throw new HttpError(409, 'insufficient_holding', `Only ${free.toString()} ${sec.ticker} is free to pledge (${held.toString()} held, ${pledged.toString()} already pledged)`);
    const item = await tx.finCollateralItem.create({ data: { poolId: p.id, securityId: sec.id, quantity: b.quantity, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'fin.collateral_posted', objectType: 'fin_pool', objectId: p.id, after: { item: item.id, ticker: sec.ticker, quantity: b.quantity.toString(), haircutPct: rule.haircutPct.toString() } });
  });
  const fac = await prisma.finFacility.findFirst({ where: { poolId: p.id, status: { not: 'CLOSED' } }, select: { currency: true } });
  res.status(201).json({ data: await poolView(p, fac?.currency) });
});

financingRoutes.post('/pools/:id/collateral/:itemId/release', ...canManage, requireStepUp, validateBody(reasonSchema), idempotent('financing.post.pools_id_collateral_itemid_release', { required: false }), async (req, res) => {
  const p = await loadPool(param(req, 'id'));
  const item = await prisma.finCollateralItem.findFirst({ where: { id: param(req, 'itemId'), poolId: p.id } });
  if (!item) throw HttpError.notFound('Collateral item not found');
  if (item.status !== 'POSTED') throw invalidState('This collateral was already released');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fin_pools WHERE id = ${p.id} FOR UPDATE`;
    // After the release every linked live facility must still hold the maintenance ratio and have no open call.
    const facilities = await tx.finFacility.findMany({ where: { poolId: p.id, status: { in: ['ACTIVE', 'SUSPENDED'] } } });
    for (const f of facilities) {
      const drawn = await drawnOf(f.id, tx);
      if (drawn.lte(0)) continue;
      const open = await tx.finMarginCall.count({ where: { facilityId: f.id, status: { in: OPEN_CALL } } });
      if (open) throw new HttpError(409, 'open_margin_call', `${f.ref} has an open margin call; collateral cannot be released`);
      const before = await valuePoolById(p.id, f.currency, tx);
      const remaining = before.lines.filter((l) => l.itemId !== item.id);
      const counted = remaining.reduce((s, l) => s.add(l.counted), ZERO);
      const m = margin({ limitAmount: f.limitAmount, initialRatio: f.initialRatio, maintenanceRatio: f.maintenanceRatio }, drawn, counted);
      if (m.state === 'DEFICIT' || (m.coverage && m.coverage.lt(f.initialRatio))) throw new HttpError(409, 'would_breach_margin', `Releasing this would leave ${f.ref} at ${m.coverage?.toFixed(2) ?? '0.00'}x, below the initial ratio of ${f.initialRatio.toFixed(2)}x`);
    }
    assertUpdated((await tx.finCollateralItem.updateMany({ where: { id: item.id, status: 'POSTED' }, data: { status: 'RELEASED', releasedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.collateral_released', objectType: 'fin_pool', objectId: p.id, before: { item: item.id, status: 'POSTED' }, after: { status: 'RELEASED', quantity: item.quantity.toString() }, reason });
  });
  const fac = await prisma.finFacility.findFirst({ where: { poolId: p.id, status: { not: 'CLOSED' } }, select: { currency: true } });
  res.json({ data: await poolView(p, fac?.currency) });
});

// ================================================================ eligibility and haircut rules

const ruleBody = z.object({ assetClass: z.string().trim().min(2).max(24), market: z.enum(['', 'ZSE', 'VFEX', 'OTC']).default(''), eligible: z.boolean(), haircutPct: pct, maxPoolPct: pct.optional(), note: z.string().trim().max(255).optional() }).strict();

financingRoutes.get('/rules', ...canView, async (_req, res) => {
  const rows = await prisma.finEligibilityRule.findMany({ orderBy: [{ assetClass: 'asc' }, { market: 'asc' }] });
  const usr = await names(rows.map((r) => r.updatedBy));
  res.json({ data: rows.map((r) => ({ id: r.id, assetClass: r.assetClass, market: r.market, eligible: r.eligible, haircutPct: f2(r.haircutPct), maxPoolPct: f2(r.maxPoolPct), note: r.note, updatedByName: usr.get(r.updatedBy) ?? null, updatedAt: r.updatedAt.toISOString() })) });
});

financingRoutes.put('/rules', ...canManage, requireStepUp, validateBody(ruleBody), idempotent('fin.rule_set', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof ruleBody>;
  const before = await prisma.finEligibilityRule.findUnique({ where: { assetClass_market: { assetClass: b.assetClass, market: b.market } } });
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.finEligibilityRule.upsert({ where: { assetClass_market: { assetClass: b.assetClass, market: b.market } }, create: { assetClass: b.assetClass, market: b.market, eligible: b.eligible, haircutPct: b.haircutPct, maxPoolPct: b.maxPoolPct ?? null, note: b.note ?? null, updatedBy: req.user!.id }, update: { eligible: b.eligible, haircutPct: b.haircutPct, maxPoolPct: b.maxPoolPct ?? null, note: b.note ?? null, updatedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'fin.rule_set', objectType: 'fin_eligibility_rule', objectId: r.id, before: before ? { eligible: before.eligible, haircutPct: before.haircutPct.toString() } : undefined, after: { assetClass: b.assetClass, market: b.market, eligible: b.eligible, haircutPct: b.haircutPct.toString(), maxPoolPct: b.maxPoolPct?.toString() ?? null } });
    return r;
  });
  res.json({ data: { id: row.id, assetClass: row.assetClass, market: row.market, eligible: row.eligible, haircutPct: f2(row.haircutPct), maxPoolPct: f2(row.maxPoolPct), note: row.note } });
});

// ================================================================ margin calls

/** Raises a margin call when the facility is in deficit and has none open. Returns the call or the reason it was not raised. */
async function evaluateFacility(f: FacilityRow, req: Request) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fin_facilities WHERE id = ${f.id} FOR UPDATE`;
    const fresh = await tx.finFacility.findUniqueOrThrow({ where: { id: f.id } });
    const { margin: m, drawn } = await facilityMargin(fresh, tx);
    const base = { facility: fresh.ref, margin: marginView(m) };
    if (fresh.status !== 'ACTIVE') return { ...base, raised: false as const, reason: `${fresh.ref} is ${fresh.status}`, callId: null as string | null };
    if (m.state !== 'DEFICIT') return { ...base, raised: false as const, reason: m.state === 'NO_DRAWINGS' ? 'Nothing drawn' : 'Coverage is above the maintenance ratio', callId: null };
    const open = await tx.finMarginCall.findFirst({ where: { facilityId: fresh.id, status: { in: OPEN_CALL } } });
    if (open) return { ...base, raised: false as const, reason: `${open.ref} is already open`, callId: open.id };
    const ref = await nextRef(tx, 'finMarginCall');
    const due = new Date(Date.now() + fresh.callDueDays * 86_400_000);
    const c = await tx.finMarginCall.create({ data: { ref, facilityId: fresh.id, calledAmount: m.callAmount, drawn, eligibleValue: m.counted, coverageRatio: m.coverage!, dueAt: due, issuedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_issued', objectType: 'fin_margin_call', objectId: c.id, after: { ref, facility: fresh.ref, calledAmount: m.callAmount.toFixed(2), coverage: m.coverage!.toFixed(4), maintenance: fresh.maintenanceRatio.toString(), dueAt: due.toISOString() } });
    await notifyPermission(tx, 'financing.manage', { type: 'fin.margin_call', title: `Margin call ${ref} on ${fresh.ref}: ${m.callAmount.toFixed(2)} ${fresh.currency}`, body: `Coverage ${m.coverage!.toFixed(2)}x against ${fresh.maintenanceRatio.toFixed(2)}x`, link: `/ops/financing?call=${c.id}` });
    return { ...base, raised: true as const, reason: 'Coverage is below the maintenance ratio', callId: c.id };
  });
}

financingRoutes.post('/facilities/:id/check', ...canManage, idempotent('fin.check', { required: false }), async (req, res) => {
  res.json({ data: await evaluateFacility(await loadFacility(param(req, 'id')), req) });
});

financingRoutes.post('/monitor', ...canManage, async (req, res) => {
  const facilities = await prisma.finFacility.findMany({ where: { status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const results = [];
  for (const f of facilities) results.push(await evaluateFacility(f, req));
  res.json({ data: { checked: results.length, raised: results.filter((r) => r.raised).length, results } });
});

financingRoutes.get('/calls', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), facilityId: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; facilityId?: string }>(req);
  const where: Prisma.FinMarginCallWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  if (f.facilityId) where.facilityId = UUID.test(f.facilityId) ? f.facilityId : ((await prisma.finFacility.findUnique({ where: { ref: f.facilityId }, select: { id: true } }))?.id ?? '0');
  const [rows, total] = await Promise.all([prisma.finMarginCall.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.finMarginCall.count({ where })]);
  res.json({ data: await callViews(rows), total });
});

financingRoutes.get('/calls/:id', ...canView, async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  const f = await prisma.finFacility.findUniqueOrThrow({ where: { id: c.facilityId } });
  const m = await facilityMargin(f);
  res.json({ data: { ...(await callViews([c]))[0]!, current: marginView(m.margin) } });
});

financingRoutes.post('/calls/:id/acknowledge', ...canManage, idempotent('fin.call_ack', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (!['ISSUED', 'DISPUTED'].includes(c.status)) throw invalidState(`${c.ref} is ${c.status}; only an issued or disputed call can be acknowledged`);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finMarginCall.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'ACKNOWLEDGED', acknowledgedBy: req.user!.id, acknowledgedAt: new Date(), version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_acknowledged', objectType: 'fin_margin_call', objectId: c.id, before: { status: c.status }, after: { status: 'ACKNOWLEDGED' } });
  });
  await respondCall(res, c.id);
});

financingRoutes.post('/calls/:id/dispute', ...canManage, validateBody(reasonSchema), idempotent('financing.post.calls_id_dispute', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (!['ISSUED', 'ACKNOWLEDGED'].includes(c.status)) throw invalidState(`${c.ref} is ${c.status}; only an open call can be disputed`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finMarginCall.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'DISPUTED', resolution: reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_disputed', objectType: 'fin_margin_call', objectId: c.id, before: { status: c.status }, after: { status: 'DISPUTED' }, reason });
  });
  await respondCall(res, c.id);
});

/** Meets the call: coverage must be back at or above the initial ratio on the live valuation. */
financingRoutes.post('/calls/:id/resolve', ...canManage, requireStepUp, validateBody(z.object({ note: z.string().trim().min(5).max(500) }).strict()), idempotent('fin.call_resolve', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (!OPEN_CALL.includes(c.status)) throw invalidState(`${c.ref} is ${c.status}; it is not open`);
  const note = (req.body as { note: string }).note;
  await prisma.$transaction(async (tx) => {
    const f = await tx.finFacility.findUniqueOrThrow({ where: { id: c.facilityId } });
    const { margin: m } = await facilityMargin(f, tx);
    if (!m.coverage || m.coverage.lt(f.initialRatio)) throw new HttpError(409, 'call_not_met', `Coverage is ${m.coverage?.toFixed(2) ?? '0.00'}x; restore it to the initial ratio of ${f.initialRatio.toFixed(2)}x first (post collateral or repay ${m.callAmount.toFixed(2)})`);
    assertUpdated((await tx.finMarginCall.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'MET', resolvedBy: req.user!.id, resolvedAt: new Date(), resolution: note, coverageAfter: m.coverage, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_met', objectType: 'fin_margin_call', objectId: c.id, before: { status: c.status }, after: { status: 'MET', coverageAfter: m.coverage.toFixed(4) }, reason: note });
  });
  await respondCall(res, c.id);
});

financingRoutes.post('/calls/:id/waive', ...canApprove, requireStepUp, validateBody(reasonSchema), idempotent('financing.post.calls_id_waive', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (!OPEN_CALL.includes(c.status)) throw invalidState(`${c.ref} is ${c.status}; it is not open`);
  if (c.issuedBy === req.user!.id) throw sod('The person who issued a call cannot waive it (maker-checker)');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finMarginCall.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'WAIVED', resolvedBy: req.user!.id, resolvedAt: new Date(), resolution: reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_waived', objectType: 'fin_margin_call', objectId: c.id, before: { status: c.status }, after: { status: 'WAIVED', issuedBy: c.issuedBy, waivedBy: req.user!.id }, reason });
  });
  await respondCall(res, c.id);
});

financingRoutes.post('/calls/:id/cancel', ...canManage, validateBody(reasonSchema), idempotent('financing.post.calls_id_cancel', { required: false }), async (req, res) => {
  const c = await loadCall(param(req, 'id'));
  if (!OPEN_CALL.includes(c.status)) throw invalidState(`${c.ref} is ${c.status}; it is not open`);
  if (c.issuedBy !== req.user!.id) throw HttpError.forbidden('Only the person who issued a call can cancel it', 'not_maker');
  const f = await prisma.finFacility.findUniqueOrThrow({ where: { id: c.facilityId } });
  const m = await facilityMargin(f);
  if (m.margin.state === 'DEFICIT') throw new HttpError(409, 'still_in_deficit', `${f.ref} is still below the maintenance ratio; the call stands`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.finMarginCall.updateMany({ where: { id: c.id, status: c.status }, data: { status: 'CANCELLED', resolvedBy: req.user!.id, resolvedAt: new Date(), resolution: reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'fin.margin_call_cancelled', objectType: 'fin_margin_call', objectId: c.id, before: { status: c.status }, after: { status: 'CANCELLED' }, reason });
  });
  await respondCall(res, c.id);
});

void f4;
void securityMap;
