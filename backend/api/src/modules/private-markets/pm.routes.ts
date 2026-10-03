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
import { ccy, dateStr, D, type Dec, f2, f4, invalidState, iso, isoDay, listPage, names, portfolioFilter, portfolioMap, positive, reasonSchema, resolvePortfolioId, sod, statusIn, toDate, today, UUID, ZERO } from '../rp-common';
import { BIG_MOVE_PCT, callProblem, EVIDENCE_KINDS, MARK_METHODS, markMovePct, performance, pooled, STALE_DAYS, STRATEGIES, type Flow, type Perf } from './pm.engine';

/**
 * Private Markets (SRD 5.A.3 `private-markets`). Admin-portal staff only, mounted at `/api/v1/private-markets`
 * next to the company-reporting hub (`/companies`, `/reporting-packs`, which are unchanged).
 * `portfolio.view` reads; `portfolio.manage` edits funds, commitments, cashflows and prepares marks;
 * `private.mark.approve` is the checker for NAV marks (not the maker; step-up MFA; evidence required).
 * Paid-in, distributions, NAV and IRR / TVPI / DPI / RVPI are derived from PAID cashflows and the latest APPROVED mark.
 */
export const privateMarketsRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('portfolio.view')];
const canManage = [...staff, requirePermission('portfolio.view'), requirePermission('portfolio.manage')];
const canApprove = [...staff, requirePermission('portfolio.view'), requirePermission('private.mark.approve')];

type FundRow = Prisma.PmFundGetPayload<object>;
type CommitRow = Prisma.PmCommitmentGetPayload<object>;
type FlowRow = Prisma.PmCashflowGetPayload<object>;
type MarkRow = Prisma.PmMarkGetPayload<object>;

async function loadFund(v: string): Promise<FundRow> {
  const r = await prisma.pmFund.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Private fund not found');
  return r;
}
async function loadCommitment(v: string): Promise<CommitRow> {
  const r = await prisma.pmCommitment.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Commitment not found');
  return r;
}
async function loadFlow(v: string): Promise<FlowRow> {
  const r = await prisma.pmCashflow.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Cashflow not found');
  return r;
}
async function loadMark(v: string): Promise<MarkRow> {
  const r = await prisma.pmMark.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Mark not found');
  return r;
}

const flowOf = (f: FlowRow): Flow => ({ kind: f.kind, amount: f.amount, date: f.paidOn ?? f.dueDate, status: f.status });

async function latestApproved(commitmentIds: string[]) {
  const out = new Map<string, MarkRow>();
  if (!commitmentIds.length) return out;
  const rows = await prisma.pmMark.findMany({ where: { commitmentId: { in: commitmentIds }, status: 'APPROVED' }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
  for (const r of rows) if (!out.has(r.commitmentId)) out.set(r.commitmentId, r);
  return out;
}

const perfView = (p: Perf) => ({
  committed: f2(p.committed),
  paidIn: f2(p.paidIn),
  calledUnpaid: f2(p.calledUnpaid),
  unfunded: f2(p.unfunded),
  distributed: f2(p.distributed),
  nav: f2(p.nav),
  navAsOf: isoDay(p.navAsOf),
  dpi: f4(p.dpi),
  rvpi: f4(p.rvpi),
  tvpi: f4(p.tvpi),
  irrPct: p.irr === null ? null : (p.irr * 100).toFixed(2),
});

async function commitmentViews(rows: CommitRow[]) {
  const ids = rows.map((r) => r.id);
  const [funds, pf, flows, marks, pending] = await Promise.all([
    prisma.pmFund.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.fundId))] } } }),
    portfolioMap(rows.map((r) => r.portfolioId)),
    ids.length ? prisma.pmCashflow.findMany({ where: { commitmentId: { in: ids }, status: { not: 'CANCELLED' } } }) : [],
    latestApproved(ids),
    ids.length ? prisma.pmMark.count({ where: { commitmentId: { in: ids }, status: 'PENDING_APPROVAL' } }) : 0,
  ]);
  const fm = new Map(funds.map((f) => [f.id, f]));
  const now = today();
  return {
    pendingMarks: pending,
    rows: rows.map((c) => {
      const mf = flows.filter((f) => f.commitmentId === c.id);
      const mark = marks.get(c.id) ?? null;
      const p = performance(c.amount, mf.map(flowOf), mark ? { nav: mark.nav, asOf: mark.asOf } : null);
      const fund = fm.get(c.fundId);
      const stale = mark ? (now.getTime() - mark.asOf.getTime()) / 86_400_000 > STALE_DAYS : c.status === 'ACTIVE';
      return {
        id: c.id,
        ref: c.ref,
        fundId: c.fundId,
        fundRef: fund?.ref ?? null,
        fundName: fund?.name ?? null,
        manager: fund?.manager ?? null,
        strategy: fund?.strategy ?? null,
        vintage: fund?.vintage ?? null,
        currency: fund?.currency ?? null,
        portfolioId: c.portfolioId,
        portfolioRef: pf.get(c.portfolioId)?.ref ?? null,
        portfolioName: pf.get(c.portfolioId)?.name ?? null,
        committedOn: isoDay(c.committedOn),
        status: c.status,
        markStale: stale,
        ...perfView(p),
      };
    }),
    perf: (id: string) => {
      const c = rows.find((r) => r.id === id)!;
      const mark = marks.get(id) ?? null;
      return { c, mark, flows: flows.filter((f) => f.commitmentId === id).map(flowOf) };
    },
  };
}

const flowView = (f: FlowRow, usr: Map<string, string>) => ({
  id: f.id,
  ref: f.ref,
  commitmentId: f.commitmentId,
  kind: f.kind,
  amount: f2(f.amount),
  noticeDate: isoDay(f.noticeDate),
  dueDate: isoDay(f.dueDate),
  paidOn: isoDay(f.paidOn),
  status: f.status,
  overdue: f.kind === 'CALL' && f.status === 'NOTICED' && f.dueDate.getTime() < today().getTime(),
  note: f.note,
  createdByName: usr.get(f.createdBy) ?? null,
  settledByName: f.settledBy ? (usr.get(f.settledBy) ?? null) : null,
});

async function markViews(rows: MarkRow[]) {
  const usr = await names(rows.flatMap((r) => [r.makerId, r.approverId]));
  const ev = rows.length ? await prisma.pmEvidence.findMany({ where: { markId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } }) : [];
  const evUsr = await names(ev.map((e) => e.addedBy));
  const cm = rows.length ? await prisma.pmCommitment.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.commitmentId))] } }, include: { fund: true } }) : [];
  const cmm = new Map(cm.map((c) => [c.id, c]));
  return rows.map((m) => {
    const c = cmm.get(m.commitmentId);
    return {
      id: m.id,
      ref: m.ref,
      commitmentId: m.commitmentId,
      commitmentRef: c?.ref ?? null,
      fundName: c?.fund.name ?? null,
      asOf: isoDay(m.asOf),
      nav: f2(m.nav),
      method: m.method,
      status: m.status,
      note: m.note,
      makerId: m.makerId,
      makerName: usr.get(m.makerId) ?? null,
      approverName: m.approverId ? (usr.get(m.approverId) ?? null) : null,
      approvedAt: iso(m.approvedAt),
      rejectReason: m.rejectReason,
      evidence: ev.filter((e) => e.markId === m.id).map((e) => ({ id: e.id, kind: e.kind, title: e.title, reference: e.reference, note: e.note, addedByName: evUsr.get(e.addedBy) ?? null, createdAt: e.createdAt.toISOString() })),
      version: m.version,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

// ================================================================ summary and performance

privateMarketsRoutes.get('/summary', ...canView, validateQuery(z.object({ portfolioId: z.string().optional() })), async (req, res) => {
  const pid = await portfolioFilter(query<{ portfolioId?: string }>(req).portfolioId);
  const commitments = await prisma.pmCommitment.findMany({ where: { status: 'ACTIVE', ...(pid ? { portfolioId: pid } : {}) }, orderBy: { ref: 'asc' } });
  const v = await commitmentViews(commitments);
  const ids = commitments.map((c) => c.id);
  const marks = await latestApproved(ids);
  const flows = ids.length ? await prisma.pmCashflow.findMany({ where: { commitmentId: { in: ids }, status: { not: 'CANCELLED' } } }) : [];
  const total = pooled(commitments.map((c) => ({ committed: c.amount, flows: flows.filter((f) => f.commitmentId === c.id).map(flowOf), mark: marks.get(c.id) ? { nav: marks.get(c.id)!.nav, asOf: marks.get(c.id)!.asOf } : null })));
  const horizon = new Date(today().getTime() + 90 * 86_400_000);
  const upcoming = flows.filter((f) => f.status === 'NOTICED' && f.dueDate.getTime() <= horizon.getTime()).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const usr = await names(upcoming.map((f) => f.createdBy));
  const cmap = new Map(v.rows.map((r) => [r.id, r]));
  const pendingMarks = ids.length ? await prisma.pmMark.count({ where: { commitmentId: { in: ids }, status: 'PENDING_APPROVAL' } }) : 0;
  const byStrategy = new Map<string, { nav: Dec; committed: Dec }>();
  for (const r of v.rows) {
    const e = byStrategy.get(r.strategy ?? 'OTHER') ?? { nav: ZERO, committed: ZERO };
    e.nav = e.nav.add(new D(r.nav ?? 0));
    e.committed = e.committed.add(new D(r.committed ?? 0));
    byStrategy.set(r.strategy ?? 'OTHER', e);
  }
  res.json({
    data: {
      totals: perfView(total),
      commitments: v.rows,
      pendingMarks,
      staleMarks: v.rows.filter((r) => r.markStale).length,
      byStrategy: [...byStrategy.entries()].map(([strategy, e]) => ({ strategy, nav: e.nav.toFixed(2), committed: e.committed.toFixed(2) })),
      upcomingCashflows: upcoming.map((f) => ({ ...flowView(f, usr), commitmentRef: cmap.get(f.commitmentId)?.ref ?? null, fundName: cmap.get(f.commitmentId)?.fundName ?? null, portfolioRef: cmap.get(f.commitmentId)?.portfolioRef ?? null })),
    },
  });
});

// ================================================================ funds

const fundBody = z
  .object({
    name: z.string().trim().min(2).max(200),
    manager: z.string().trim().min(2).max(160),
    strategy: z.enum(STRATEGIES),
    vintage: z.number().int().min(1990).max(2100),
    currency: ccy.default('USD'),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
const fundPatch = fundBody.partial().extend({ status: z.enum(['ACTIVE', 'REALISED', 'CLOSED']).optional() }).strict();

privateMarketsRoutes.get('/funds', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), q: z.string().trim().max(80).optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; q?: string }>(req);
  const where: Prisma.PmFundWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  if (f.q) where.OR = [{ name: { contains: f.q } }, { manager: { contains: f.q } }, { ref: { contains: f.q } }];
  const [rows, total] = await Promise.all([prisma.pmFund.findMany({ where, orderBy: { ref: 'asc' }, take: f.limit, skip: f.offset }), prisma.pmFund.count({ where })]);
  const commitments = rows.length ? await prisma.pmCommitment.findMany({ where: { fundId: { in: rows.map((r) => r.id) }, status: 'ACTIVE' } }) : [];
  res.json({ data: rows.map((r) => fundView(r, commitments.filter((c) => c.fundId === r.id))), total });
});

const fundView = (r: FundRow, cs: CommitRow[]) => ({ id: r.id, ref: r.ref, name: r.name, manager: r.manager, strategy: r.strategy, vintage: r.vintage, currency: r.currency, status: r.status, notes: r.notes, commitments: cs.length, committed: f2(cs.reduce((s, c) => s.add(c.amount), ZERO)) });

privateMarketsRoutes.post('/funds', ...canManage, validateBody(fundBody), idempotent('pm.fund_create'), async (req, res) => {
  const b = req.body as z.infer<typeof fundBody>;
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'pmFund');
    const f = await tx.pmFund.create({ data: { ref, ...b, notes: b.notes ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'pm.fund_created', objectType: 'pm_fund', objectId: f.id, after: { ref, name: b.name, strategy: b.strategy, vintage: b.vintage } });
    return f;
  });
  res.status(201).json({ data: fundView(row, []) });
});

privateMarketsRoutes.get('/funds/:id', ...canView, async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  const cs = await prisma.pmCommitment.findMany({ where: { fundId: f.id }, orderBy: { ref: 'asc' } });
  const v = await commitmentViews(cs);
  const flows = cs.length ? await prisma.pmCashflow.findMany({ where: { commitmentId: { in: cs.map((c) => c.id) }, status: { not: 'CANCELLED' } } }) : [];
  const marks = await latestApproved(cs.map((c) => c.id));
  const active = cs.filter((c) => c.status === 'ACTIVE');
  const total = pooled(active.map((c) => ({ committed: c.amount, flows: flows.filter((x) => x.commitmentId === c.id).map(flowOf), mark: marks.get(c.id) ? { nav: marks.get(c.id)!.nav, asOf: marks.get(c.id)!.asOf } : null })));
  res.json({ data: { ...fundView(f, active), totals: perfView(total), commitmentList: v.rows } });
});

privateMarketsRoutes.patch('/funds/:id', ...canManage, validateBody(fundPatch), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  const b = req.body as z.infer<typeof fundPatch>;
  if (b.status && b.status !== 'ACTIVE') {
    const open = await prisma.pmCashflow.count({ where: { status: 'NOTICED', commitment: { fundId: f.id } } });
    if (open) throw invalidState(`${f.ref} has ${open} open cashflow(s); settle or cancel them first`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.pmFund.update({ where: { id: f.id }, data: { ...b } });
    await writeAudit(tx, audit(req), { action: 'pm.fund_updated', objectType: 'pm_fund', objectId: f.id, before: { name: f.name, status: f.status }, after: b });
  });
  const cs = await prisma.pmCommitment.findMany({ where: { fundId: f.id, status: 'ACTIVE' } });
  res.json({ data: fundView(await loadFund(f.id), cs) });
});

// ================================================================ commitments

const commitBody = z.object({ portfolioId: z.string().trim().min(1).max(36), amount: positive, committedOn: dateStr }).strict();

privateMarketsRoutes.post('/funds/:id/commitments', ...canManage, validateBody(commitBody), idempotent('pm.commitment_create'), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  if (f.status !== 'ACTIVE') throw invalidState(`${f.ref} is ${f.status}; new commitments need an active fund`);
  const b = req.body as z.infer<typeof commitBody>;
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  if (await prisma.pmCommitment.findUnique({ where: { fundId_portfolioId: { fundId: f.id, portfolioId } } })) throw HttpError.conflict('This portfolio already has a commitment to the fund', 'duplicate_commitment');
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'pmCommitment');
    const c = await tx.pmCommitment.create({ data: { ref, fundId: f.id, portfolioId, amount: b.amount, committedOn: toDate(b.committedOn), createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'pm.commitment_created', objectType: 'pm_commitment', objectId: c.id, after: { ref, fund: f.ref, portfolioId, amount: b.amount.toFixed(2) } });
    return c;
  });
  res.status(201).json({ data: (await commitmentViews([row])).rows[0] });
});

privateMarketsRoutes.get('/commitments', ...canView, validateQuery(listPage.extend({ portfolioId: z.string().optional(), status: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { portfolioId?: string; status?: string }>(req);
  const where: Prisma.PmCommitmentWhereInput = {};
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  const st = statusIn(f.status);
  if (st) where.status = st;
  const [rows, total] = await Promise.all([prisma.pmCommitment.findMany({ where, orderBy: { ref: 'asc' }, take: f.limit, skip: f.offset }), prisma.pmCommitment.count({ where })]);
  res.json({ data: (await commitmentViews(rows)).rows, total });
});

privateMarketsRoutes.get('/commitments/:id', ...canView, async (req, res) => {
  const c = await loadCommitment(param(req, 'id'));
  const [v, flows, marks] = await Promise.all([commitmentViews([c]), prisma.pmCashflow.findMany({ where: { commitmentId: c.id }, orderBy: [{ dueDate: 'desc' }, { ref: 'desc' }] }), prisma.pmMark.findMany({ where: { commitmentId: c.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] })]);
  const usr = await names(flows.flatMap((f) => [f.createdBy, f.settledBy]));
  res.json({ data: { ...v.rows[0]!, cashflows: flows.map((f) => flowView(f, usr)), marks: await markViews(marks) } });
});

privateMarketsRoutes.post('/commitments/:id/cancel', ...canManage, validateBody(reasonSchema), async (req, res) => {
  const c = await loadCommitment(param(req, 'id'));
  if (c.status !== 'ACTIVE') throw invalidState(`${c.ref} is ${c.status}`);
  const used = await prisma.pmCashflow.count({ where: { commitmentId: c.id, status: { in: ['NOTICED', 'PAID'] } } });
  if (used) throw invalidState(`${c.ref} already has cashflows; a commitment with activity cannot be cancelled`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmCommitment.updateMany({ where: { id: c.id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.commitment_cancelled', objectType: 'pm_commitment', objectId: c.id, before: { status: 'ACTIVE' }, after: { status: 'CANCELLED' }, reason });
  });
  res.json({ data: (await commitmentViews([await loadCommitment(c.id)])).rows[0] });
});

// ================================================================ capital calls and distributions

const flowBody = z.object({ kind: z.enum(['CALL', 'DISTRIBUTION']), amount: positive, noticeDate: dateStr.optional(), dueDate: dateStr, note: z.string().trim().max(500).optional() }).strict();

privateMarketsRoutes.post('/commitments/:id/cashflows', ...canManage, validateBody(flowBody), idempotent('pm.cashflow_create'), async (req, res) => {
  const c = await loadCommitment(param(req, 'id'));
  if (c.status !== 'ACTIVE') throw invalidState(`${c.ref} is ${c.status}`);
  const b = req.body as z.infer<typeof flowBody>;
  const noticeDate = b.noticeDate ? toDate(b.noticeDate) : today();
  const dueDate = toDate(b.dueDate);
  if (dueDate.getTime() < noticeDate.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'dueDate', message: 'The due date cannot be before the notice date' }]);
  const row = await prisma.$transaction(async (tx) => {
    if (b.kind === 'CALL') {
      const g = await tx.pmCashflow.aggregate({ where: { commitmentId: c.id, kind: 'CALL', status: { in: ['NOTICED', 'PAID'] } }, _sum: { amount: true } });
      const problem = callProblem(c.amount, g._sum.amount ?? ZERO, b.amount);
      if (problem) throw new HttpError(409, 'exceeds_commitment', problem);
    }
    const ref = await nextRef(tx, 'pmCashflow');
    const f = await tx.pmCashflow.create({ data: { ref, commitmentId: c.id, kind: b.kind, amount: b.amount, noticeDate, dueDate, note: b.note ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: b.kind === 'CALL' ? 'pm.call_noticed' : 'pm.distribution_noticed', objectType: 'pm_cashflow', objectId: f.id, after: { ref, commitment: c.ref, amount: b.amount.toFixed(2), dueDate: b.dueDate } });
    if (b.kind === 'CALL') await notifyPermission(tx, 'portfolio.manage', { type: 'pm.call_noticed', title: `Capital call ${ref}: ${b.amount.toFixed(2)} due ${b.dueDate}`, link: `/ops/private-markets?commitment=${c.id}` });
    return f;
  });
  const usr = await names([row.createdBy]);
  res.status(201).json({ data: flowView(row, usr) });
});

privateMarketsRoutes.post('/cashflows/:id/pay', ...canManage, validateBody(z.object({ paidOn: dateStr.optional() }).strict()), idempotent('pm.cashflow_pay', { required: false }), async (req, res) => {
  const f = await loadFlow(param(req, 'id'));
  if (f.status !== 'NOTICED') throw invalidState(`${f.ref} is ${f.status}; only a noticed cashflow can be settled`);
  const b = req.body as { paidOn?: string };
  const paidOn = b.paidOn ? toDate(b.paidOn) : today();
  if (paidOn.getTime() < f.noticeDate.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'paidOn', message: 'Settlement cannot be before the notice date' }]);
  if (paidOn.getTime() > today().getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'paidOn', message: 'Settlement cannot be in the future' }]);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmCashflow.updateMany({ where: { id: f.id, status: 'NOTICED' }, data: { status: 'PAID', paidOn, settledBy: req.user!.id } })).count);
    await writeAudit(tx, audit(req), { action: f.kind === 'CALL' ? 'pm.call_paid' : 'pm.distribution_received', objectType: 'pm_cashflow', objectId: f.id, before: { status: 'NOTICED' }, after: { status: 'PAID', paidOn: isoDay(paidOn), amount: f.amount.toFixed(2) } });
  });
  const usr = await names([f.createdBy, req.user!.id]);
  res.json({ data: flowView(await loadFlow(f.id), usr) });
});

privateMarketsRoutes.post('/cashflows/:id/cancel', ...canManage, validateBody(reasonSchema), async (req, res) => {
  const f = await loadFlow(param(req, 'id'));
  if (f.status !== 'NOTICED') throw invalidState(`${f.ref} is ${f.status}; only a noticed cashflow can be cancelled`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmCashflow.updateMany({ where: { id: f.id, status: 'NOTICED' }, data: { status: 'CANCELLED' } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.cashflow_cancelled', objectType: 'pm_cashflow', objectId: f.id, before: { status: 'NOTICED' }, after: { status: 'CANCELLED' }, reason });
  });
  const usr = await names([f.createdBy]);
  res.json({ data: flowView(await loadFlow(f.id), usr) });
});

// ================================================================ marks, evidence, approval

const markBody = z.object({ asOf: dateStr, nav: positive.or(z.literal(0).transform(() => new D(0))), method: z.enum(MARK_METHODS), note: z.string().trim().max(500).optional() }).strict();

async function respondMark(res: Response, id: string, status = 200) {
  const m = await prisma.pmMark.findUniqueOrThrow({ where: { id } });
  res.status(status).json({ data: (await markViews([m]))[0] });
}
const assertMaker = (m: MarkRow, req: Request) => {
  if (m.makerId !== req.user!.id) throw HttpError.forbidden('Only the person who prepared this mark can change or submit it', 'not_maker');
};

privateMarketsRoutes.get('/marks', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), commitmentId: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; commitmentId?: string }>(req);
  const where: Prisma.PmMarkWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  if (f.commitmentId) where.commitmentId = UUID.test(f.commitmentId) ? f.commitmentId : ((await prisma.pmCommitment.findUnique({ where: { ref: f.commitmentId }, select: { id: true } }))?.id ?? '0');
  const [rows, total] = await Promise.all([prisma.pmMark.findMany({ where, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }), prisma.pmMark.count({ where })]);
  res.json({ data: await markViews(rows), total });
});

privateMarketsRoutes.post('/commitments/:id/marks', ...canManage, validateBody(markBody), idempotent('pm.mark_create'), async (req, res) => {
  const c = await loadCommitment(param(req, 'id'));
  if (c.status !== 'ACTIVE') throw invalidState(`${c.ref} is ${c.status}`);
  const b = req.body as z.infer<typeof markBody>;
  const asOf = toDate(b.asOf);
  if (asOf.getTime() > today().getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'asOf', message: 'A mark cannot be dated in the future' }]);
  const dup = await prisma.pmMark.findFirst({ where: { commitmentId: c.id, asOf, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } });
  if (dup) throw HttpError.conflict(`${dup.ref} already exists for ${b.asOf} (${dup.status})`, 'duplicate_mark');
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'pmMark');
    const m = await tx.pmMark.create({ data: { ref, commitmentId: c.id, asOf, nav: b.nav, method: b.method, note: b.note ?? null, makerId: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'pm.mark_created', objectType: 'pm_mark', objectId: m.id, after: { ref, commitment: c.ref, asOf: b.asOf, nav: b.nav.toFixed(2), method: b.method } });
    return m;
  });
  await respondMark(res, row.id, 201);
});

privateMarketsRoutes.get('/marks/:id', ...canView, async (req, res) => {
  await respondMark(res, (await loadMark(param(req, 'id'))).id);
});

const evidenceBody = z.object({ kind: z.enum(EVIDENCE_KINDS), title: z.string().trim().min(3).max(200), reference: z.string().trim().max(255).optional(), note: z.string().trim().max(500).optional() }).strict();

privateMarketsRoutes.post('/marks/:id/evidence', ...canManage, validateBody(evidenceBody), idempotent('pm.evidence_add', { required: false }), async (req, res) => {
  const m = await loadMark(param(req, 'id'));
  if (m.status !== 'DRAFT') throw invalidState(`${m.ref} is ${m.status}; evidence can only be added to a DRAFT mark`);
  assertMaker(m, req);
  const b = req.body as z.infer<typeof evidenceBody>;
  await prisma.$transaction(async (tx) => {
    const e = await tx.pmEvidence.create({ data: { markId: m.id, kind: b.kind, title: b.title, reference: b.reference ?? null, note: b.note ?? null, addedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'pm.evidence_added', objectType: 'pm_mark', objectId: m.id, after: { evidenceId: e.id, kind: b.kind, title: b.title } });
  });
  await respondMark(res, m.id, 201);
});

privateMarketsRoutes.post('/marks/:id/submit', ...canManage, idempotent('pm.mark_submit', { required: false }), async (req, res) => {
  const m = await loadMark(param(req, 'id'));
  if (m.status !== 'DRAFT') throw invalidState(`${m.ref} is ${m.status}; only a DRAFT can be submitted`);
  assertMaker(m, req);
  const evidence = await prisma.pmEvidence.count({ where: { markId: m.id } });
  if (!evidence) throw new HttpError(409, 'evidence_required', 'Attach at least one piece of valuation evidence before submitting the mark');
  const prev = (await latestApproved([m.commitmentId])).get(m.commitmentId);
  const move = markMovePct(prev?.nav ?? null, m.nav);
  if (move && move.abs().gt(BIG_MOVE_PCT) && !m.note) throw new HttpError(409, 'explanation_required', `NAV moves ${move.toFixed(1)}% against the last approved mark; explain the move in the note`);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmMark.updateMany({ where: { id: m.id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL' } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.mark_submitted', objectType: 'pm_mark', objectId: m.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', nav: m.nav.toFixed(2), movePct: move?.toFixed(1) ?? null, evidence } });
    await notifyPermission(tx, 'private.mark.approve', { type: 'pm.mark_pending', title: `NAV mark ${m.ref} awaits approval`, body: `${isoDay(m.asOf)} · ${m.nav.toFixed(2)}`, link: `/ops/private-markets?mark=${m.id}` });
  });
  await respondMark(res, m.id);
});

privateMarketsRoutes.post('/marks/:id/return', ...canApprove, validateBody(reasonSchema), async (req, res) => {
  const m = await loadMark(param(req, 'id'));
  if (m.status !== 'PENDING_APPROVAL') throw invalidState(`${m.ref} is ${m.status}; only a pending mark can be returned`);
  if (m.makerId === req.user!.id) throw sod('Return a mark you did not prepare');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmMark.updateMany({ where: { id: m.id, status: 'PENDING_APPROVAL' }, data: { status: 'DRAFT', rejectReason: reason } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.mark_returned', objectType: 'pm_mark', objectId: m.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'DRAFT' }, reason });
  });
  await respondMark(res, m.id);
});

privateMarketsRoutes.post('/marks/:id/reject', ...canApprove, validateBody(reasonSchema), async (req, res) => {
  const m = await loadMark(param(req, 'id'));
  if (m.status !== 'PENDING_APPROVAL') throw invalidState(`${m.ref} is ${m.status}; only a pending mark can be rejected`);
  if (m.makerId === req.user!.id) throw sod('You cannot reject a mark you prepared');
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmMark.updateMany({ where: { id: m.id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED', rejectReason: reason, approverId: req.user!.id } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.mark_rejected', objectType: 'pm_mark', objectId: m.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'REJECTED' }, reason });
  });
  await respondMark(res, m.id);
});

privateMarketsRoutes.post('/marks/:id/approve', ...canApprove, requireStepUp, idempotent('pm.mark_approve', { required: false }), async (req, res) => {
  const m = await loadMark(param(req, 'id'));
  if (m.status !== 'PENDING_APPROVAL') throw invalidState(`${m.ref} is ${m.status}; it must be PENDING_APPROVAL to approve`);
  if (m.makerId === req.user!.id) throw sod('The person who prepared a mark cannot approve it (maker-checker)');
  const evidence = await prisma.pmEvidence.count({ where: { markId: m.id } });
  if (!evidence) throw new HttpError(409, 'evidence_required', 'A mark cannot be approved without valuation evidence');
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.pmMark.updateMany({ where: { id: m.id, status: 'PENDING_APPROVAL' }, data: { status: 'APPROVED', approverId: req.user!.id, approvedAt: new Date() } })).count);
    await writeAudit(tx, audit(req), { action: 'pm.mark_approved', objectType: 'pm_mark', objectId: m.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'APPROVED', asOf: isoDay(m.asOf), nav: m.nav.toFixed(2), makerId: m.makerId, approverId: req.user!.id, evidence } });
  });
  await respondMark(res, m.id);
});

