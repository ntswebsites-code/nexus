import type { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { assertUpdated, audit } from '../ops/ops.common';
import { dateStr, D, f2, f4, invalidState, isoDay, listPage, names, reasonSchema, sod, toDate, today, UUID } from '../rp-common';
import { STRATEGIES, xirr } from './pm.engine';

/**
 * Private-markets pipeline, diligence cases and cashflow scenarios (FR-PM-002; SRD 5.A.3).
 * `portfolio.view` reads; `portfolio.manage` writes. A deal moves through SOURCED, SCREENING, DILIGENCE, IC and
 * APPROVED: it cannot reach IC without a completed diligence case, and approval is a second person's decision
 * (the owner and the creator cannot approve their own deal). A scenario is a saved set of dated calls and
 * distributions with MOIC, IRR and peak net cash derived from them; only its owner deletes it.
 */

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('portfolio.view')];
const canManage = [...staff, requirePermission('portfolio.view'), requirePermission('portfolio.manage')];

export const PIPELINE_CURRENCIES = ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP', 'BWP'] as const;
export const STAGES = ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC', 'APPROVED', 'CLOSED', 'DECLINED', 'ON_HOLD'] as const;
type Stage = (typeof STAGES)[number];
const NEXT: Record<Stage, Stage[]> = {
  SOURCED: ['SCREENING', 'DECLINED', 'ON_HOLD'],
  SCREENING: ['DILIGENCE', 'DECLINED', 'ON_HOLD'],
  DILIGENCE: ['IC', 'DECLINED', 'ON_HOLD'],
  IC: ['APPROVED', 'DILIGENCE', 'DECLINED', 'ON_HOLD'],
  APPROVED: ['CLOSED'],
  CLOSED: [],
  DECLINED: [],
  ON_HOLD: ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC'],
};
/** Template checklist for a new diligence case. */
export const CHECKLIST_TEMPLATE = [
  { key: 'sponsor', label: 'Sponsor track record and references' },
  { key: 'financials', label: 'Financial statements and quality of earnings' },
  { key: 'legal', label: 'Legal structure, documents and side letters' },
  { key: 'kyc', label: 'KYC, AML and sanctions on sponsor and investors' },
  { key: 'valuation', label: 'Valuation approach and fair-value level' },
  { key: 'esg', label: 'ESG and regulatory approvals' },
  { key: 'fees', label: 'Fees, carry and fund economics' },
  { key: 'liquidity', label: 'Liquidity, exit routes and currency exposure' },
] as const;
const ITEM_STATUS = ['OPEN', 'DONE', 'NA', 'FLAGGED'] as const;
type Item = { key: string; label: string; status: (typeof ITEM_STATUS)[number]; note: string | null };

const thisYear = () => new Date().getUTCFullYear();
const amount = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v).replace(/,/g, ''))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && new D(v).gt(0), 'Enter an amount greater than zero (up to 4 decimals)')
  .transform((v) => new D(v));

const dealBody = z
  .object({
    name: z.string().trim().min(2, 'Name the investment').max(200),
    sponsor: z.string().trim().min(2, 'Name the sponsor or manager').max(160),
    strategy: z.enum(STRATEGIES),
    vintage: z.number().int().min(1990, 'Vintage must be 1990 or later').refine((v) => v <= thisYear(), `Vintage cannot be after ${thisYear()}`),
    currency: z.enum(PIPELINE_CURRENCIES).default('USD'),
    proposedAmount: amount,
    expectedClose: dateStr.optional(),
    fairValueLevel: z.number().int().min(1, 'Fair-value level is 1, 2 or 3').max(3, 'Fair-value level is 1, 2 or 3').optional(),
    valuationDate: dateStr.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.valuationDate && toDate(b.valuationDate) > today()) ctx.addIssue({ code: 'custom', path: ['valuationDate'], message: 'The valuation date cannot be in the future' });
    if (b.fairValueLevel && !b.valuationDate) ctx.addIssue({ code: 'custom', path: ['valuationDate'], message: 'Give the date of the valuation that sets the fair-value level' });
  });
const dealPatch = z
  .object({
    name: z.string().trim().min(2).max(200),
    sponsor: z.string().trim().min(2).max(160),
    proposedAmount: amount,
    expectedClose: dateStr.nullable(),
    notes: z.string().trim().max(500).nullable(),
    ownerId: z.string().trim().max(36),
    version: z.number().int(),
  })
  .partial()
  .strict();

const stageBody = z.object({ stage: z.enum(STAGES), note: z.string().trim().max(500).optional(), fundId: z.string().trim().max(36).optional() }).strict();

const diligenceBody = z.object({ title: z.string().trim().min(3, 'Give the case a title').max(200), leadId: z.string().trim().max(36).optional() }).strict();
const diligencePatch = z
  .object({
    items: z.array(z.object({ key: z.string().trim().min(1).max(40), status: z.enum(ITEM_STATUS), note: z.string().trim().max(300).nullish() }).strict()).max(40).optional(),
    addItems: z.array(z.string().trim().min(3).max(160)).max(10).optional(),
    findings: z.string().trim().max(8000).nullable().optional(),
    recommendation: z.enum(['PROCEED', 'PROCEED_WITH_CONDITIONS', 'DECLINE']).nullable().optional(),
    version: z.number().int().optional(),
  })
  .strict();

const flowRow = z.object({ date: dateStr, kind: z.enum(['CALL', 'DISTRIBUTION']), amount }).strict();
const scenarioBody = z
  .object({
    name: z.string().trim().min(2, 'Name the scenario').max(160),
    kind: z.enum(['BASE', 'UPSIDE', 'DOWNSIDE']).default('BASE'),
    currency: z.enum(PIPELINE_CURRENCIES).default('USD'),
    dealId: z.string().trim().max(36).optional(),
    fundId: z.string().trim().max(36).optional(),
    flows: z.array(flowRow).min(2, 'A scenario needs at least a call and a distribution').max(200),
  })
  .strict();

/** MOIC, IRR and peak net cash of a dated flow list. Calls are outflows, distributions inflows. */
export function scenarioMetrics(flows: { date: string; kind: 'CALL' | 'DISTRIBUTION'; amount: Prisma.Decimal }[]) {
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  let called = new D(0);
  let distributed = new D(0);
  let cum = new D(0);
  let peak = new D(0);
  for (const f of sorted) {
    if (f.kind === 'CALL') {
      called = called.add(f.amount);
      cum = cum.sub(f.amount);
    } else {
      distributed = distributed.add(f.amount);
      cum = cum.add(f.amount);
    }
    if (cum.lt(peak)) peak = cum;
  }
  const irr = xirr(sorted.map((f) => ({ date: toDate(f.date), amount: (f.kind === 'CALL' ? -1 : 1) * Number(f.amount.toString()) })));
  return {
    called: f2(called)!,
    distributed: f2(distributed)!,
    net: f2(distributed.sub(called))!,
    moic: called.isZero() ? null : distributed.div(called).toFixed(2),
    irrPct: irr === null ? null : (irr * 100).toFixed(2),
    peakNet: f2(peak)!,
    flows: sorted.length,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted[sorted.length - 1]?.date ?? null,
  };
}

type DealRow = Prisma.PmPipelineDealGetPayload<object>;
type CaseRow = Prisma.PmDiligenceCaseGetPayload<object>;
type ScenRow = Prisma.PmCashflowScenarioGetPayload<object>;

async function loadDeal(v: string): Promise<DealRow> {
  const r = await prisma.pmPipelineDeal.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Pipeline investment not found');
  return r;
}
async function loadCase(v: string): Promise<CaseRow> {
  const r = await prisma.pmDiligenceCase.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Diligence case not found');
  return r;
}

const dealView = (d: DealRow, usr: Map<string, string>, extra: { cases?: number; scenarios?: number } = {}) => ({
  id: d.id,
  ref: d.ref,
  name: d.name,
  sponsor: d.sponsor,
  strategy: d.strategy,
  vintage: d.vintage,
  currency: d.currency,
  proposedAmount: f2(d.proposedAmount),
  expectedClose: isoDay(d.expectedClose),
  stage: d.stage,
  fairValueLevel: d.fairValueLevel,
  valuationDate: isoDay(d.valuationDate),
  fundId: d.fundId,
  ownerId: d.ownerId,
  ownerName: usr.get(d.ownerId) ?? null,
  notes: d.notes,
  decidedByName: d.decidedBy ? (usr.get(d.decidedBy) ?? null) : null,
  decidedAt: d.decidedAt?.toISOString() ?? null,
  decisionNote: d.decisionNote,
  nextStages: NEXT[d.stage as Stage] ?? [],
  diligenceCases: extra.cases ?? null,
  scenarios: extra.scenarios ?? null,
  version: d.version,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

async function caseViews(rows: CaseRow[]) {
  const usr = await names(rows.map((r) => r.leadId));
  const deals = rows.length ? await prisma.pmPipelineDeal.findMany({ where: { id: { in: rows.map((r) => r.dealId) } }, select: { id: true, ref: true, name: true } }) : [];
  const dm = new Map(deals.map((d) => [d.id, d]));
  return rows.map((c) => {
    const items = c.checklist as unknown as Item[];
    return {
      id: c.id,
      ref: c.ref,
      dealId: c.dealId,
      dealRef: dm.get(c.dealId)?.ref ?? null,
      dealName: dm.get(c.dealId)?.name ?? null,
      title: c.title,
      leadId: c.leadId,
      leadName: usr.get(c.leadId) ?? null,
      status: c.status,
      checklist: items,
      progress: { done: items.filter((i) => i.status !== 'OPEN').length, total: items.length, flagged: items.filter((i) => i.status === 'FLAGGED').length },
      findings: c.findings,
      recommendation: c.recommendation,
      completedAt: c.completedAt?.toISOString() ?? null,
      version: c.version,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}

async function scenarioViews(rows: ScenRow[], me: string) {
  const usr = await names(rows.map((r) => r.createdBy));
  const deals = rows.length ? await prisma.pmPipelineDeal.findMany({ where: { id: { in: rows.map((r) => r.dealId).filter((x): x is string => !!x) } }, select: { id: true, ref: true } }) : [];
  const funds = rows.length ? await prisma.pmFund.findMany({ where: { id: { in: rows.map((r) => r.fundId).filter((x): x is string => !!x) } }, select: { id: true, ref: true } }) : [];
  return rows.map((s) => ({
    id: s.id,
    ref: s.ref,
    name: s.name,
    kind: s.kind,
    currency: s.currency,
    dealId: s.dealId,
    dealRef: deals.find((d) => d.id === s.dealId)?.ref ?? null,
    fundId: s.fundId,
    fundRef: funds.find((f) => f.id === s.fundId)?.ref ?? null,
    flows: s.flows,
    metrics: s.metrics,
    ownerName: usr.get(s.createdBy) ?? null,
    mine: s.createdBy === me,
    createdAt: s.createdAt.toISOString(),
  }));
}

export function registerPmPipeline(r: Router) {
  // ================================================================ pipeline

  r.get('/pipeline/summary', ...canView, async (_req, res) => {
    const [by, cases] = await Promise.all([prisma.pmPipelineDeal.groupBy({ by: ['stage', 'currency'], _count: { _all: true }, _sum: { proposedAmount: true } }), prisma.pmDiligenceCase.groupBy({ by: ['status'], _count: { _all: true } })]);
    const stages = STAGES.map((s) => ({ stage: s, count: by.filter((x) => x.stage === s).reduce((a, x) => a + x._count._all, 0), amounts: by.filter((x) => x.stage === s).map((x) => ({ currency: x.currency, amount: f2(x._sum.proposedAmount ?? new D(0)) })) }));
    res.json({ data: { stages, diligence: Object.fromEntries(cases.map((c) => [c.status, c._count._all])) } });
  });

  const listQuery = listPage.extend({ stage: z.string().trim().max(60).optional(), q: z.string().trim().max(80).optional(), mine: z.enum(['1', 'true']).optional() });
  r.get('/pipeline', ...canView, validateQuery(listQuery), async (req, res) => {
    const f = query<z.infer<typeof listQuery>>(req);
    const where: Prisma.PmPipelineDealWhereInput = {};
    if (f.stage) where.stage = { in: f.stage.split(',').map((s) => s.trim().toUpperCase()) };
    if (f.q) where.OR = [{ name: { contains: f.q } }, { sponsor: { contains: f.q } }, { ref: { contains: f.q } }];
    if (f.mine) where.ownerId = req.user!.id;
    const [rows, total] = await Promise.all([prisma.pmPipelineDeal.findMany({ where, orderBy: { updatedAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.pmPipelineDeal.count({ where })]);
    const [usr, cases, scen] = await Promise.all([
      names(rows.map((d) => d.ownerId)),
      rows.length ? prisma.pmDiligenceCase.groupBy({ by: ['dealId'], where: { dealId: { in: rows.map((d) => d.id) } }, _count: { _all: true } }) : [],
      rows.length ? prisma.pmCashflowScenario.groupBy({ by: ['dealId'], where: { dealId: { in: rows.map((d) => d.id) } }, _count: { _all: true } }) : [],
    ]);
    res.json({ data: rows.map((d) => dealView(d, usr, { cases: cases.find((c) => c.dealId === d.id)?._count._all ?? 0, scenarios: scen.find((c) => c.dealId === d.id)?._count._all ?? 0 })), total });
  });

  r.post('/pipeline', ...canManage, validateBody(dealBody), idempotent('pm.pipeline_create'), async (req, res) => {
    const b = req.body as z.infer<typeof dealBody>;
    const row = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'pmPipeline');
      const d = await tx.pmPipelineDeal.create({
        data: {
          ref,
          name: b.name,
          sponsor: b.sponsor,
          strategy: b.strategy,
          vintage: b.vintage,
          currency: b.currency,
          proposedAmount: b.proposedAmount,
          expectedClose: b.expectedClose ? toDate(b.expectedClose) : null,
          fairValueLevel: b.fairValueLevel ?? null,
          valuationDate: b.valuationDate ? toDate(b.valuationDate) : null,
          notes: b.notes ?? null,
          ownerId: req.user!.id,
          createdBy: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), { action: 'pm.pipeline_created', objectType: 'pm_pipeline_deal', objectId: d.id, after: { ref, name: b.name, strategy: b.strategy, vintage: b.vintage, currency: b.currency, amount: b.proposedAmount.toString() } });
      return d;
    });
    res.status(201).json({ data: dealView(row, await names([row.ownerId])) });
  });

  r.get('/pipeline/:id', ...canView, async (req, res) => {
    const d = await loadDeal(param(req, 'id'));
    const [cases, scen, usr] = await Promise.all([prisma.pmDiligenceCase.findMany({ where: { dealId: d.id }, orderBy: { createdAt: 'desc' } }), prisma.pmCashflowScenario.findMany({ where: { dealId: d.id }, orderBy: { createdAt: 'desc' } }), names([d.ownerId, d.decidedBy])]);
    res.json({ data: { ...dealView(d, usr, { cases: cases.length, scenarios: scen.length }), diligence: await caseViews(cases), scenarioList: await scenarioViews(scen, req.user!.id) } });
  });

  r.patch('/pipeline/:id', ...canManage, validateBody(dealPatch), idempotent('private-markets.patch.pipeline_id', { required: false }), async (req, res) => {
    const d = await loadDeal(param(req, 'id'));
    expectVersion(req, d.version);
    if (['CLOSED', 'DECLINED'].includes(d.stage)) throw invalidState(`${d.ref} is ${d.stage}; it can no longer be edited`);
    const { version, ownerId, expectedClose, ...b } = req.body as z.infer<typeof dealPatch>;
    if (version !== undefined && version !== d.version) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    if (ownerId) {
      const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { isActive: true } });
      if (!u?.isActive) throw HttpError.badRequest('Validation failed', [{ path: 'ownerId', message: 'Unknown or inactive user' }]);
    }
    const data: Prisma.PmPipelineDealUpdateManyMutationInput & { ownerId?: string } = { ...b, version: { increment: 1 } };
    if (expectedClose !== undefined) data.expectedClose = expectedClose ? toDate(expectedClose) : null;
    if (ownerId) data.ownerId = ownerId;
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.pmPipelineDeal.updateMany({ where: { id: d.id, version: d.version }, data })).count);
      await writeAudit(tx, audit(req), { action: 'pm.pipeline_updated', objectType: 'pm_pipeline_deal', objectId: d.id, before: { name: d.name, amount: d.proposedAmount.toString(), ownerId: d.ownerId }, after: { ...b, ownerId, expectedClose, proposedAmount: b.proposedAmount?.toString() } });
    });
    const fresh = await prisma.pmPipelineDeal.findUniqueOrThrow({ where: { id: d.id } });
    res.json({ data: dealView(fresh, await names([fresh.ownerId])) });
  });

  r.post('/pipeline/:id/stage', ...canManage, validateBody(stageBody), idempotent('pm.pipeline_stage', { required: false }), async (req, res) => {
    const d = await loadDeal(param(req, 'id'));
    const b = req.body as z.infer<typeof stageBody>;
    if (!NEXT[d.stage as Stage]?.includes(b.stage)) throw invalidState(`${d.ref} is ${d.stage}; it cannot move to ${b.stage}`);
    if ((b.stage === 'DECLINED' || b.stage === 'ON_HOLD') && (b.note?.length ?? 0) < 5) throw HttpError.badRequest('Validation failed', [{ path: 'note', message: 'Give a reason (5+ characters)' }]);
    const cases = await prisma.pmDiligenceCase.findMany({ where: { dealId: d.id } });
    if (b.stage === 'IC' && !cases.some((c) => c.status === 'COMPLETE')) throw invalidState('Complete a diligence case before taking the investment to IC');
    const data: Prisma.PmPipelineDealUpdateManyMutationInput & { fundId?: string } = { stage: b.stage, version: { increment: 1 } };
    if (b.stage === 'APPROVED') {
      if (d.ownerId === req.user!.id || d.createdBy === req.user!.id) throw sod('The owner of the investment cannot approve it (maker-checker)');
      const latest = [...cases].filter((c) => c.status === 'COMPLETE').sort((x, y) => (y.completedAt?.getTime() ?? 0) - (x.completedAt?.getTime() ?? 0))[0];
      if (!latest) throw invalidState('Approval needs a completed diligence case');
      if (latest.recommendation === 'DECLINE') throw invalidState('The diligence recommendation is to decline; decline the investment or reopen diligence');
      data.decidedBy = req.user!.id;
      data.decidedAt = new Date();
      data.decisionNote = b.note ?? null;
    }
    if (b.stage === 'DECLINED') {
      data.decidedBy = req.user!.id;
      data.decidedAt = new Date();
      data.decisionNote = b.note ?? null;
    }
    if (b.stage === 'CLOSED' && b.fundId) {
      const f = await prisma.pmFund.findFirst({ where: UUID.test(b.fundId) ? { id: b.fundId } : { ref: b.fundId } });
      if (!f) throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown private fund' }]);
      data.fundId = f.id;
    }
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.pmPipelineDeal.updateMany({ where: { id: d.id, stage: d.stage, version: d.version }, data })).count);
      await writeAudit(tx, audit(req), { action: 'pm.pipeline_stage_changed', objectType: 'pm_pipeline_deal', objectId: d.id, before: { stage: d.stage }, after: { stage: b.stage, fundId: data.fundId ?? null }, reason: b.note });
    });
    const fresh = await prisma.pmPipelineDeal.findUniqueOrThrow({ where: { id: d.id } });
    res.json({ data: dealView(fresh, await names([fresh.ownerId, fresh.decidedBy])) });
  });

  // ================================================================ diligence cases

  const dQuery = listPage.extend({ dealId: z.string().trim().max(36).optional(), status: z.string().trim().max(40).optional() });
  r.get('/diligence', ...canView, validateQuery(dQuery), async (req, res) => {
    const f = query<z.infer<typeof dQuery>>(req);
    const where: Prisma.PmDiligenceCaseWhereInput = {};
    if (f.dealId) where.dealId = (await loadDeal(f.dealId)).id;
    if (f.status) where.status = { in: f.status.split(',').map((s) => s.trim().toUpperCase()) };
    const [rows, total] = await Promise.all([prisma.pmDiligenceCase.findMany({ where, orderBy: { updatedAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.pmDiligenceCase.count({ where })]);
    res.json({ data: await caseViews(rows), total });
  });

  r.post('/pipeline/:id/diligence', ...canManage, validateBody(diligenceBody), idempotent('pm.diligence_create'), async (req, res) => {
    const d = await loadDeal(param(req, 'id'));
    if (['CLOSED', 'DECLINED'].includes(d.stage)) throw invalidState(`${d.ref} is ${d.stage}; open a new investment instead`);
    const b = req.body as z.infer<typeof diligenceBody>;
    if (b.leadId && !(await prisma.user.findFirst({ where: { id: b.leadId, isActive: true }, select: { id: true } }))) throw HttpError.badRequest('Validation failed', [{ path: 'leadId', message: 'Unknown or inactive user' }]);
    const checklist: Item[] = CHECKLIST_TEMPLATE.map((i) => ({ ...i, status: 'OPEN', note: null }));
    const row = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'pmDiligence');
      const c = await tx.pmDiligenceCase.create({ data: { ref, dealId: d.id, title: b.title, leadId: b.leadId ?? req.user!.id, checklist: checklist as unknown as Prisma.InputJsonValue, createdBy: req.user!.id } });
      await writeAudit(tx, audit(req), { action: 'pm.diligence_opened', objectType: 'pm_diligence_case', objectId: c.id, after: { ref, deal: d.ref, title: b.title } });
      return c;
    });
    res.status(201).json({ data: (await caseViews([row]))[0] });
  });

  r.get('/diligence/:id', ...canView, async (req, res) => {
    res.json({ data: (await caseViews([await loadCase(param(req, 'id'))]))[0] });
  });

  r.patch('/diligence/:id', ...canManage, validateBody(diligencePatch), idempotent('private-markets.patch.diligence_id', { required: false }), async (req, res) => {
    const c = await loadCase(param(req, 'id'));
    expectVersion(req, c.version);
    if (c.status === 'COMPLETE' || c.status === 'CLOSED') throw invalidState(`${c.ref} is ${c.status}; reopen it to change the checklist`);
    const b = req.body as z.infer<typeof diligencePatch>;
    if (b.version !== undefined && b.version !== c.version) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    const items = [...(c.checklist as unknown as Item[])];
    for (const u of b.items ?? []) {
      const it = items.find((x) => x.key === u.key);
      if (!it) throw HttpError.badRequest('Validation failed', [{ path: 'items', message: `Unknown checklist item ${u.key}` }]);
      it.status = u.status;
      if (u.note !== undefined) it.note = u.note ?? null;
      if (u.status === 'FLAGGED' && !it.note) throw HttpError.badRequest('Validation failed', [{ path: 'items', message: `Explain why "${it.label}" is flagged` }]);
    }
    for (const label of b.addItems ?? []) items.push({ key: `x${items.length + 1}-${Date.now().toString(36)}`.slice(0, 40), label, status: 'OPEN', note: null });
    const data: Prisma.PmDiligenceCaseUpdateManyMutationInput = { checklist: items as unknown as Prisma.InputJsonValue, status: c.status === 'OPEN' ? 'IN_REVIEW' : c.status, version: { increment: 1 } };
    if (b.findings !== undefined) data.findings = b.findings;
    if (b.recommendation !== undefined) data.recommendation = b.recommendation;
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.pmDiligenceCase.updateMany({ where: { id: c.id, version: c.version }, data })).count);
      await writeAudit(tx, audit(req), { action: 'pm.diligence_updated', objectType: 'pm_diligence_case', objectId: c.id, after: { done: items.filter((i) => i.status !== 'OPEN').length, total: items.length, recommendation: b.recommendation ?? undefined } });
    });
    res.json({ data: (await caseViews([await loadCase(c.id)]))[0] });
  });

  r.post('/diligence/:id/complete', ...canManage, idempotent('pm.diligence_complete', { required: false }), async (req, res) => {
    const c = await loadCase(param(req, 'id'));
    if (c.status === 'COMPLETE' || c.status === 'CLOSED') throw invalidState(`${c.ref} is already ${c.status}`);
    const items = c.checklist as unknown as Item[];
    const open = items.filter((i) => i.status === 'OPEN');
    if (open.length) throw invalidState(`${open.length} checklist item(s) are still open: ${open.map((i) => i.label).join('; ')}`);
    if (!c.recommendation) throw invalidState('Record a recommendation before completing the case');
    if (items.some((i) => i.status === 'FLAGGED') && c.recommendation === 'PROCEED') throw invalidState('Flagged items need "proceed with conditions" or "decline" as the recommendation');
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.pmDiligenceCase.updateMany({ where: { id: c.id, status: c.status, version: c.version }, data: { status: 'COMPLETE', completedAt: new Date(), version: { increment: 1 } } })).count);
      await writeAudit(tx, audit(req), { action: 'pm.diligence_completed', objectType: 'pm_diligence_case', objectId: c.id, after: { recommendation: c.recommendation, flagged: items.filter((i) => i.status === 'FLAGGED').length } });
    });
    res.json({ data: (await caseViews([await loadCase(c.id)]))[0] });
  });

  r.post('/diligence/:id/reopen', ...canManage, validateBody(reasonSchema), idempotent('private-markets.post.diligence_id_reopen', { required: false }), async (req, res) => {
    const c = await loadCase(param(req, 'id'));
    if (c.status !== 'COMPLETE') throw invalidState(`${c.ref} is ${c.status}; only a completed case can be reopened`);
    const deal = await loadDeal(c.dealId);
    if (['IC', 'APPROVED', 'CLOSED'].includes(deal.stage)) throw invalidState(`${deal.ref} is at ${deal.stage}; send it back to diligence first`);
    const reason = (req.body as z.infer<typeof reasonSchema>).reason;
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.pmDiligenceCase.updateMany({ where: { id: c.id, status: 'COMPLETE' }, data: { status: 'IN_REVIEW', completedAt: null, version: { increment: 1 } } })).count);
      await writeAudit(tx, audit(req), { action: 'pm.diligence_reopened', objectType: 'pm_diligence_case', objectId: c.id, reason });
    });
    res.json({ data: (await caseViews([await loadCase(c.id)]))[0] });
  });

  // ================================================================ cashflow scenarios

  const sQuery = listPage.extend({ dealId: z.string().trim().max(36).optional(), fundId: z.string().trim().max(36).optional(), mine: z.enum(['1', 'true']).optional() });
  r.get('/scenarios', ...canView, validateQuery(sQuery), async (req, res) => {
    const f = query<z.infer<typeof sQuery>>(req);
    const where: Prisma.PmCashflowScenarioWhereInput = {};
    if (f.dealId) where.dealId = (await loadDeal(f.dealId)).id;
    if (f.fundId) where.fundId = (await prisma.pmFund.findFirst({ where: UUID.test(f.fundId) ? { id: f.fundId } : { ref: f.fundId } }))?.id ?? '0';
    if (f.mine) where.createdBy = req.user!.id;
    const [rows, total] = await Promise.all([prisma.pmCashflowScenario.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.pmCashflowScenario.count({ where })]);
    res.json({ data: await scenarioViews(rows, req.user!.id), total });
  });

  r.post('/scenarios', ...canManage, validateBody(scenarioBody), idempotent('pm.scenario_create'), async (req, res) => {
    const b = req.body as z.infer<typeof scenarioBody>;
    const errs: { path: string; message: string }[] = [];
    if (!b.flows.some((f) => f.kind === 'CALL')) errs.push({ path: 'flows', message: 'Add at least one capital call' });
    if (!b.flows.some((f) => f.kind === 'DISTRIBUTION')) errs.push({ path: 'flows', message: 'Add at least one distribution' });
    if (b.dealId && b.fundId) errs.push({ path: 'fundId', message: 'Link the scenario to a deal or a fund, not both' });
    if (errs.length) throw HttpError.badRequest('Validation failed', errs);
    const dealId = b.dealId ? (await loadDeal(b.dealId)).id : null;
    let fundId: string | null = null;
    if (b.fundId) {
      const f = await prisma.pmFund.findFirst({ where: UUID.test(b.fundId) ? { id: b.fundId } : { ref: b.fundId } });
      if (!f) throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown private fund' }]);
      fundId = f.id;
    }
    const metrics = scenarioMetrics(b.flows);
    const flows = b.flows.map((f) => ({ date: f.date, kind: f.kind, amount: f4(f.amount)! }));
    const row = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'pmScenario');
      const s = await tx.pmCashflowScenario.create({ data: { ref, dealId, fundId, name: b.name, kind: b.kind, currency: b.currency, flows: flows as unknown as Prisma.InputJsonValue, metrics: metrics as unknown as Prisma.InputJsonValue, createdBy: req.user!.id } });
      await writeAudit(tx, audit(req), { action: 'pm.scenario_saved', objectType: 'pm_cashflow_scenario', objectId: s.id, after: { ref, name: b.name, kind: b.kind, flows: flows.length, moic: metrics.moic, irrPct: metrics.irrPct } });
      return s;
    });
    res.status(201).json({ data: (await scenarioViews([row], req.user!.id))[0] });
  });

  r.delete('/scenarios/:id', ...canManage, async (req, res) => {
    const s = await prisma.pmCashflowScenario.findFirst({ where: UUID.test(param(req, 'id')) ? { id: param(req, 'id') } : { ref: param(req, 'id') } });
    if (!s) throw HttpError.notFound('Scenario not found');
    if (s.createdBy !== req.user!.id) throw HttpError.forbidden('Only the owner can delete a scenario', 'not_owner');
    await prisma.$transaction(async (tx) => {
      await tx.pmCashflowScenario.delete({ where: { id: s.id } });
      await writeAudit(tx, audit(req), { action: 'pm.scenario_deleted', objectType: 'pm_cashflow_scenario', objectId: s.id, before: { ref: s.ref, name: s.name } });
    });
    res.json({ data: { id: s.id, deleted: true } });
  });
}
