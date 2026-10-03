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
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { assertUpdated, audit, seqRef } from '../ops/ops.common';
import { getMandate, getPortfolioSnapshot, latestPrices, loadPortfolio, resolveFxRate } from '../portfolio/portfolio.service';
import { runPreTradeChecks } from '../orders/orders.checks';
import { checkLimitsForPortfolio } from '../risk/risk.service';
import { D, f4, f6, invalidState, iso, listPage, names, pct, portfolioFilter, portfolioMap, reasonSchema, resolvePortfolioId, resolveSecurity, securityMap, sod, statusIn, UUID, ZERO } from '../rp-common';
import { checkConstraints, modelProblems, proposeRebalance, type ConstraintResult, type Holding, type Proposal } from './lab.engine';

/**
 * Portfolio Construction (SRD 5.A.4 `portfolio-lab`). Admin-portal staff only, mounted at `/api/v1/portfolio-lab`.
 * `portfolio.view` reads and runs what-ifs; `portfolio.manage` edits model portfolios (a model is activated by a second
 * person), saves a rebalance proposal and discards it; creating the proposed orders also needs `orders.create`.
 * A rebalance never trades: it creates DRAFT orders, each checked against the mandate (pre-trade checks) and the
 * risk limits, that then go through normal Orders approval.
 */
export const portfolioLabRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('portfolio.view')];
const canManage = [...staff, requirePermission('portfolio.view'), requirePermission('portfolio.manage')];
const PROPOSAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ModelRow = Prisma.ModelPortfolioGetPayload<object>;
type RebalanceRow = Prisma.PlRebalanceGetPayload<object>;

async function loadModel(v: string): Promise<ModelRow> {
  const r = await prisma.modelPortfolio.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Model portfolio not found');
  return r;
}
async function loadRebalance(v: string): Promise<RebalanceRow> {
  const r = await prisma.plRebalance.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!r) throw HttpError.notFound('Rebalance not found');
  return r;
}

// ---------------------------------------------------------------- models

const weightRow = z.object({ securityId: z.string().trim().min(1).max(36), targetPct: pct }).strict();
const modelBody = z.object({ name: z.string().trim().min(2).max(160), description: z.string().trim().max(500).optional(), cashTargetPct: pct.default(new D(0)), weights: z.array(weightRow).max(100).default([]) }).strict();
const modelPatch = modelBody.partial().extend({ version: z.number().int().optional() }).strict();

async function resolveWeights(rows: z.infer<typeof weightRow>[]) {
  const out: { securityId: string; targetPct: Prisma.Decimal }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const s = await resolveSecurity(rows[i]!.securityId, `weights.${i}.securityId`);
    out.push({ securityId: s.id, targetPct: rows[i]!.targetPct });
  }
  return out;
}

async function modelDetail(m: ModelRow) {
  const [weights, usr] = await Promise.all([prisma.modelWeight.findMany({ where: { modelId: m.id } }), names([m.createdBy])]);
  const sec = await securityMap(weights.map((w) => w.securityId));
  const sum = weights.reduce((s, w) => s.add(w.targetPct), ZERO);
  return {
    id: m.id,
    ref: m.ref,
    name: m.name,
    description: m.description,
    cashTargetPct: f4(m.cashTargetPct),
    status: m.status,
    holdings: weights.length,
    totalPct: sum.add(m.cashTargetPct).toFixed(4),
    problems: modelProblems(weights, m.cashTargetPct, false),
    weights: weights
      .map((w) => ({ securityId: w.securityId, ticker: sec.get(w.securityId)?.ticker ?? null, name: sec.get(w.securityId)?.name ?? null, sector: sec.get(w.securityId)?.sector ?? null, assetClass: sec.get(w.securityId)?.assetClass ?? null, targetPct: f4(w.targetPct) }))
      .sort((a, b) => Number(b.targetPct) - Number(a.targetPct)),
    createdByName: usr.get(m.createdBy) ?? null,
    createdBy: m.createdBy,
    version: m.version,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}
async function respondModel(res: Response, id: string, status = 200) {
  res.status(status).json({ data: await modelDetail(await prisma.modelPortfolio.findUniqueOrThrow({ where: { id } })) });
}

portfolioLabRoutes.get('/models', ...canView, validateQuery(listPage.extend({ status: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string }>(req);
  const where: Prisma.ModelPortfolioWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  const [rows, total] = await Promise.all([prisma.modelPortfolio.findMany({ where, orderBy: { ref: 'asc' }, take: f.limit, skip: f.offset }), prisma.modelPortfolio.count({ where })]);
  res.json({ data: await Promise.all(rows.map(async (m) => { const d = await modelDetail(m); return { ...d, weights: undefined }; })), total });
});

portfolioLabRoutes.post('/models', ...canManage, validateBody(modelBody), idempotent('lab.model_create'), async (req, res) => {
  const b = req.body as z.infer<typeof modelBody>;
  const weights = await resolveWeights(b.weights);
  const problems = modelProblems(weights, b.cashTargetPct, false);
  if (problems.length) throw HttpError.badRequest('Validation failed', problems.map((message) => ({ path: 'weights', message })));
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'modelPortfolio');
    const m = await tx.modelPortfolio.create({ data: { ref, name: b.name, description: b.description ?? null, cashTargetPct: b.cashTargetPct, createdBy: req.user!.id, weights: { create: weights } } });
    await writeAudit(tx, audit(req), { action: 'lab.model_created', objectType: 'model_portfolio', objectId: m.id, after: { ref, name: b.name, holdings: weights.length, cashTargetPct: b.cashTargetPct.toString() } });
    return m;
  });
  await respondModel(res, row.id, 201);
});

portfolioLabRoutes.get('/models/:id', ...canView, async (req, res) => {
  res.json({ data: await modelDetail(await loadModel(param(req, 'id'))) });
});

portfolioLabRoutes.patch('/models/:id', ...canManage, validateBody(modelPatch), idempotent('portfolio-lab.patch.models_id', { required: false }), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status !== 'DRAFT') throw invalidState(`${m.ref} is ${m.status}; only a DRAFT model can be edited. Clone it to make changes.`);
  const b = req.body as z.infer<typeof modelPatch>;
  if (b.version !== undefined && b.version !== m.version) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  const weights = b.weights ? await resolveWeights(b.weights) : (await prisma.modelWeight.findMany({ where: { modelId: m.id } }));
  const problems = modelProblems(weights, b.cashTargetPct ?? m.cashTargetPct, false);
  if (problems.length) throw HttpError.badRequest('Validation failed', problems.map((message) => ({ path: 'weights', message })));
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.modelPortfolio.updateMany({ where: { id: m.id, status: 'DRAFT', version: m.version }, data: { name: b.name, description: b.description, cashTargetPct: b.cashTargetPct, version: { increment: 1 } } })).count);
    if (b.weights) {
      await tx.modelWeight.deleteMany({ where: { modelId: m.id } });
      await tx.modelWeight.createMany({ data: weights.map((w) => ({ modelId: m.id, securityId: w.securityId, targetPct: w.targetPct })) });
    }
    await writeAudit(tx, audit(req), { action: 'lab.model_updated', objectType: 'model_portfolio', objectId: m.id, before: { name: m.name, cashTargetPct: m.cashTargetPct.toString() }, after: { name: b.name, cashTargetPct: b.cashTargetPct?.toString(), holdings: b.weights?.length } });
  });
  await respondModel(res, m.id);
});

portfolioLabRoutes.post('/models/:id/activate', ...canManage, idempotent('lab.model_activate', { required: false }), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status !== 'DRAFT') throw invalidState(`${m.ref} is ${m.status}; only a DRAFT model can be activated`);
  if (m.createdBy === req.user!.id) throw sod('A model must be activated by someone other than its author (maker-checker)');
  const weights = await prisma.modelWeight.findMany({ where: { modelId: m.id } });
  const problems = modelProblems(weights, m.cashTargetPct, true);
  if (problems.length) throw HttpError.badRequest('Model cannot be activated', problems.map((message) => ({ path: 'weights', message })));
  const inactive = await prisma.security.findMany({ where: { id: { in: weights.map((w) => w.securityId) }, status: { not: 'Active' } }, select: { ticker: true } });
  if (inactive.length) throw HttpError.badRequest('Model cannot be activated', [{ path: 'weights', message: `Not tradable: ${inactive.map((s) => s.ticker).join(', ')}` }]);
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.modelPortfolio.updateMany({ where: { id: m.id, status: 'DRAFT' }, data: { status: 'ACTIVE' } })).count);
    await writeAudit(tx, audit(req), { action: 'lab.model_activated', objectType: 'model_portfolio', objectId: m.id, before: { status: 'DRAFT' }, after: { status: 'ACTIVE', author: m.createdBy, activatedBy: req.user!.id, holdings: weights.length } });
  });
  await respondModel(res, m.id);
});

portfolioLabRoutes.post('/models/:id/retire', ...canManage, validateBody(reasonSchema), idempotent('portfolio-lab.post.models_id_retire', { required: false }), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  if (m.status === 'RETIRED') throw invalidState(`${m.ref} is already retired`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.modelPortfolio.updateMany({ where: { id: m.id, status: m.status }, data: { status: 'RETIRED' } })).count);
    await writeAudit(tx, audit(req), { action: 'lab.model_retired', objectType: 'model_portfolio', objectId: m.id, before: { status: m.status }, after: { status: 'RETIRED' }, reason });
  });
  await respondModel(res, m.id);
});

portfolioLabRoutes.post('/models/:id/clone', ...canManage, idempotent('lab.model_clone'), async (req, res) => {
  const m = await loadModel(param(req, 'id'));
  const weights = await prisma.modelWeight.findMany({ where: { modelId: m.id } });
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'modelPortfolio');
    const c = await tx.modelPortfolio.create({ data: { ref, name: `${m.name} (copy)`.slice(0, 160), description: m.description, cashTargetPct: m.cashTargetPct, createdBy: req.user!.id, weights: { create: weights.map((w) => ({ securityId: w.securityId, targetPct: w.targetPct })) } } });
    await writeAudit(tx, audit(req), { action: 'lab.model_cloned', objectType: 'model_portfolio', objectId: c.id, after: { ref, from: m.ref } });
    return c;
  });
  await respondModel(res, row.id, 201);
});

// ---------------------------------------------------------------- proposals

const proposalBody = z
  .object({
    portfolioId: z.string().trim().min(1).max(36),
    modelId: z.string().trim().min(1).max(36),
    driftThresholdPct: pct.default(new D('0.5')),
    keepUnmodelled: z.boolean().default(false),
  })
  .strict();

type Worst = 'Pass' | 'Review' | 'Fail';
const worse = (a: Worst, b: Worst): Worst => (a === 'Fail' || b === 'Fail' ? 'Fail' : a === 'Review' || b === 'Review' ? 'Review' : 'Pass');

interface LineCheck {
  result: Worst;
  preTrade: { key: string; label: string; result: string; detail: string }[];
  limits: { ref: string; metric: string; state: string; value: string; threshold: string; worsened: boolean; breachAction: string }[];
}

/** Builds the proposal for a portfolio and an ACTIVE model, with line checks and whole-book constraints. Writes nothing. */
async function buildProposal(b: z.infer<typeof proposalBody>) {
  const portfolio = await loadPortfolio(await resolvePortfolioId(b.portfolioId));
  const model = await loadModel(b.modelId).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'modelId', message: 'Unknown model' }]);
  });
  if (model.status !== 'ACTIVE') throw invalidState(`${model.ref} is ${model.status}; rebalance only to an ACTIVE model`);
  if (portfolio.status !== 'Active') throw invalidState(`${portfolio.ref} is ${portfolio.status}`);
  const weights = await prisma.modelWeight.findMany({ where: { modelId: model.id } });
  const asOf = new Date();
  const snap = await getPortfolioSnapshot(portfolio.id, { asOf });
  const held = new Map(snap.lines.map((l) => [l.securityId, l]));
  const ids = [...new Set([...held.keys(), ...weights.map((w) => w.securityId)])];
  const secs = await securityMap(ids);
  const prices = await latestPrices(ids, asOf);
  const fxCache = new Map<string, Prisma.Decimal | null>();
  const fx = async (c: string) => {
    if (!fxCache.has(c)) fxCache.set(c, await resolveFxRate(c, snap.baseCurrency, asOf));
    return fxCache.get(c)!;
  };
  const holdings: Holding[] = [];
  for (const id of ids) {
    const s = secs.get(id);
    if (!s) continue;
    const l = held.get(id);
    holdings.push({ securityId: id, ticker: s.ticker, sector: s.sector, assetClass: s.assetClass, market: s.market, currency: s.currency, boardLot: s.boardLot, quantity: l ? new D(l.quantity) : ZERO, price: prices.get(id)?.latestDec ?? null, fx: await fx(s.currency) });
  }
  const cashBase = new D(snap.totals.cashBase);
  const mandate = getMandate(portfolio);
  const proposal: Proposal = proposeRebalance({
    holdings,
    targets: new Map(weights.map((w) => [w.securityId, w.targetPct])),
    cashBase,
    cashTargetPct: model.cashTargetPct,
    driftThresholdPct: b.driftThresholdPct,
    keepUnmodelled: b.keepUnmodelled,
    cashFloorPct: mandate.cashFloorPct !== undefined ? new D(mandate.cashFloorPct) : undefined,
  });
  // Block new buys of non-tradable names.
  for (const l of proposal.lines) if (l.side === 'BUY' && secs.get(l.securityId)?.status !== 'Active') proposal.warnings.push(`${l.ticker} is not active; its buy cannot be ordered`);
  const constraints: ConstraintResult[] = checkConstraints(mandate, proposal.afterWeights, proposal.cashAfterPct, proposal.lines.filter((l) => l.side === 'BUY').map((l) => l.ticker));
  // Per-line pre-trade and risk-limit checks.
  const checks = new Map<string, LineCheck>();
  const sellProceeds = proposal.lines.filter((x) => x.side === 'SELL').reduce((s, x) => s.add(x.notionalBase), ZERO);
  const buyTotal = proposal.lines.filter((x) => x.side === 'BUY').reduce((s, x) => s.add(x.notionalBase), ZERO);
  const fundedByProceeds = sellProceeds.gt(0) && cashBase.add(sellProceeds).gte(buyTotal);
  for (const l of proposal.lines) {
    const pre = await runPreTradeChecks(portfolio.id, { securityId: l.securityId, side: l.side, quantity: l.quantity, price: l.price }, { asOf });
    const lim = await checkLimitsForPortfolio(portfolio.id, { ticker: l.ticker, side: l.side, quantity: l.quantity.toString(), price: l.price.toString() }, { asOf });
    // A buy funded by the sells in this same rebalance cannot pass a cash check made on today's cash alone:
    // downgrade that one failure to Review (settle the sells first). The engine already limits buys to cash + proceeds.
    const checkRows = pre.checks.map((c) => (c.key === 'cash' && c.result === 'Fail' && l.side === 'BUY' && fundedByProceeds ? { ...c, result: 'Review' as const, detail: `${c.detail} Funded by the sale proceeds in this rebalance; the sells must settle first.` } : c));
    const rank = (r: string) => (r === 'Fail' ? 2 : r === 'Review' ? 1 : 0);
    const preWorst = checkRows.reduce((m, c) => Math.max(m, rank(c.result)), 0);
    let result: Worst = preWorst === 2 ? 'Fail' : preWorst === 1 ? 'Review' : 'Pass';
    if (lim.blocked) result = worse(result, 'Fail');
    else if (lim.evaluations.some((e) => e.worsened) || lim.warnings.length) result = worse(result, 'Review');
    checks.set(l.securityId, {
      result,
      preTrade: checkRows.filter((c) => c.result !== 'Pass').map((c) => ({ key: c.key, label: c.label, result: c.result, detail: c.detail })),
      limits: lim.evaluations.filter((e) => e.state !== 'OK' || e.worsened).map((e) => ({ ref: e.ref, metric: e.metric, state: e.state, value: e.value, threshold: e.threshold, worsened: !!e.worsened, breachAction: e.breachAction })),
    });
  }
  return { portfolio, model, proposal, constraints, checks, baseCurrency: snap.baseCurrency, secs };
}

type Built = Awaited<ReturnType<typeof buildProposal>>;

const constraintsFailed = (c: ConstraintResult[]) => c.filter((x) => x.state === 'Fail');

function previewView(p: Built) {
  return {
    portfolioId: p.portfolio.id,
    portfolioRef: p.portfolio.ref,
    portfolioName: p.portfolio.name,
    modelId: p.model.id,
    modelRef: p.model.ref,
    modelName: p.model.name,
    baseCurrency: p.baseCurrency,
    totalValueBase: p.proposal.totalValueBase.toFixed(2),
    turnoverPct: p.proposal.turnoverPct.toFixed(2),
    cashAfterPct: p.proposal.cashAfterPct.toFixed(2),
    cashAfterBase: p.proposal.cashAfterBase.toFixed(2),
    warnings: p.proposal.warnings,
    constraints: p.constraints,
    constraintsPassed: constraintsFailed(p.constraints).length === 0,
    lines: p.proposal.lines.map((l) => ({
      securityId: l.securityId,
      ticker: l.ticker,
      name: p.secs.get(l.securityId)?.name ?? null,
      side: l.side,
      quantity: l.quantity.toString(),
      price: f6(l.price),
      currency: l.currency,
      currentPct: l.currentPct.toFixed(2),
      targetPct: l.targetPct.toFixed(2),
      afterPct: l.afterPct.toFixed(2),
      notionalBase: l.notionalBase.toFixed(2),
      exit: l.exit,
      checkResult: p.checks.get(l.securityId)!.result,
      checks: p.checks.get(l.securityId)!,
    })),
  };
}

portfolioLabRoutes.post('/whatif', ...canView, validateBody(proposalBody), async (req, res) => {
  res.json({ data: previewView(await buildProposal(req.body as z.infer<typeof proposalBody>)) });
});

async function rebalanceDetail(r: RebalanceRow) {
  const [lines, pf, md, usr] = await Promise.all([prisma.plRebalanceLine.findMany({ where: { rebalanceId: r.id } }), portfolioMap([r.portfolioId]), prisma.modelPortfolio.findUnique({ where: { id: r.modelId } }), names([r.createdBy])]);
  const sec = await securityMap(lines.map((l) => l.securityId));
  const constraints = r.constraints as unknown as ConstraintResult[];
  return {
    id: r.id,
    ref: r.ref,
    status: r.status,
    portfolioId: r.portfolioId,
    portfolioRef: pf.get(r.portfolioId)?.ref ?? null,
    portfolioName: pf.get(r.portfolioId)?.name ?? null,
    modelId: r.modelId,
    modelRef: md?.ref ?? null,
    modelName: md?.name ?? null,
    baseCurrency: r.baseCurrency,
    driftThresholdPct: f4(r.driftThresholdPct),
    totalValueBase: r.totalValueBase.toFixed(2),
    turnoverPct: f4(r.turnoverPct),
    cashAfterPct: f4(r.cashAfterPct),
    constraints,
    constraintsPassed: constraintsFailed(constraints).length === 0,
    warnings: (r.warnings as string[] | null) ?? [],
    stale: Date.now() - r.createdAt.getTime() > PROPOSAL_MAX_AGE_MS,
    createdByName: usr.get(r.createdBy) ?? null,
    createdAt: r.createdAt.toISOString(),
    lines: lines
      .map((l) => ({ id: l.id, securityId: l.securityId, ticker: sec.get(l.securityId)?.ticker ?? null, name: sec.get(l.securityId)?.name ?? null, side: l.side, quantity: l.quantity.toString(), price: f6(l.price), currency: l.currency, currentPct: l.currentPct.toFixed(2), targetPct: l.targetPct.toFixed(2), afterPct: l.afterPct.toFixed(2), notionalBase: l.notionalBase.toFixed(2), checkResult: l.checkResult, checks: l.checks, orderId: l.orderId, orderRef: l.orderRef }))
      .sort((a, b) => (a.side === b.side ? (a.ticker ?? '').localeCompare(b.ticker ?? '') : a.side === 'SELL' ? -1 : 1)),
  };
}

portfolioLabRoutes.post('/rebalances', ...canManage, validateBody(proposalBody), idempotent('lab.rebalance_create'), async (req, res) => {
  const b = req.body as z.infer<typeof proposalBody>;
  const p = await buildProposal(b);
  if (!p.proposal.lines.length) throw new HttpError(409, 'nothing_to_trade', `${p.portfolio.ref} is already within ${b.driftThresholdPct.toFixed(2)}% of ${p.model.ref}; no trades are proposed`);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'rebalance');
    const r = await tx.plRebalance.create({
      data: {
        ref,
        portfolioId: p.portfolio.id,
        modelId: p.model.id,
        driftThresholdPct: b.driftThresholdPct,
        totalValueBase: p.proposal.totalValueBase,
        baseCurrency: p.baseCurrency,
        constraints: p.constraints as unknown as Prisma.InputJsonValue,
        turnoverPct: p.proposal.turnoverPct,
        cashAfterPct: p.proposal.cashAfterPct,
        warnings: p.proposal.warnings as unknown as Prisma.InputJsonValue,
        createdBy: req.user!.id,
        lines: { create: p.proposal.lines.map((l) => ({ securityId: l.securityId, side: l.side, quantity: l.quantity, price: l.price, currency: l.currency, currentPct: l.currentPct, targetPct: l.targetPct, afterPct: l.afterPct, notionalBase: l.notionalBase, checkResult: p.checks.get(l.securityId)!.result, checks: p.checks.get(l.securityId)! as unknown as Prisma.InputJsonValue })) },
      },
    });
    await writeAudit(tx, audit(req), { action: 'lab.rebalance_proposed', objectType: 'pl_rebalance', objectId: r.id, after: { ref, portfolio: p.portfolio.ref, model: p.model.ref, lines: p.proposal.lines.length, turnoverPct: p.proposal.turnoverPct.toFixed(2), constraintsFailed: constraintsFailed(p.constraints).length } });
    return r;
  });
  res.status(201).json({ data: await rebalanceDetail(row) });
});

portfolioLabRoutes.get('/rebalances', ...canView, validateQuery(listPage.extend({ status: z.string().optional(), portfolioId: z.string().optional() })), async (req, res) => {
  const f = query<z.infer<typeof listPage> & { status?: string; portfolioId?: string }>(req);
  const where: Prisma.PlRebalanceWhereInput = {};
  const st = statusIn(f.status);
  if (st) where.status = st;
  const pid = await portfolioFilter(f.portfolioId);
  if (pid) where.portfolioId = pid;
  const [rows, total] = await Promise.all([prisma.plRebalance.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.plRebalance.count({ where })]);
  const out = await Promise.all(rows.map(async (r) => { const d = await rebalanceDetail(r); return { ...d, lines: undefined, lineCount: d.lines.length, failing: d.lines.filter((l) => l.checkResult === 'Fail').length }; }));
  res.json({ data: out, total });
});

portfolioLabRoutes.get('/rebalances/:id', ...canView, async (req, res) => {
  res.json({ data: await rebalanceDetail(await loadRebalance(param(req, 'id'))) });
});

portfolioLabRoutes.post('/rebalances/:id/discard', ...canManage, validateBody(reasonSchema), idempotent('portfolio-lab.post.rebalances_id_discard', { required: false }), async (req, res) => {
  const r = await loadRebalance(param(req, 'id'));
  if (r.status !== 'PROPOSED') throw invalidState(`${r.ref} is ${r.status}; only a proposal can be discarded`);
  const reason = (req.body as z.infer<typeof reasonSchema>).reason;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.plRebalance.updateMany({ where: { id: r.id, status: 'PROPOSED' }, data: { status: 'DISCARDED' } })).count);
    await writeAudit(tx, audit(req), { action: 'lab.rebalance_discarded', objectType: 'pl_rebalance', objectId: r.id, before: { status: 'PROPOSED' }, after: { status: 'DISCARDED' }, reason });
  });
  res.json({ data: await rebalanceDetail(await loadRebalance(r.id)) });
});

/** Creates a DRAFT order per line that passed or needs review; failing lines are left out and reported. */
portfolioLabRoutes.post('/rebalances/:id/orders', ...canManage, requirePermission('orders.create'), idempotent('lab.rebalance_orders'), async (req: Request, res: Response) => {
  const r = await loadRebalance(param(req, 'id'));
  if (r.status !== 'PROPOSED') throw invalidState(`${r.ref} is ${r.status}; orders can only be created from a proposal`);
  if (Date.now() - r.createdAt.getTime() > PROPOSAL_MAX_AGE_MS) throw new HttpError(409, 'proposal_stale', `${r.ref} is more than a day old and prices have moved; run a new proposal`);
  const failed = constraintsFailed(r.constraints as unknown as ConstraintResult[]);
  if (failed.length) throw new HttpError(409, 'constraints_failed', `${r.ref} breaches the mandate after the trades: ${failed.map((c) => c.label).join(', ')}. Adjust the model or threshold and run again.`);
  const portfolio = await loadPortfolio(r.portfolioId);
  if (portfolio.status !== 'Active') throw invalidState(`${portfolio.ref} is ${portfolio.status}`);
  const lines = await prisma.plRebalanceLine.findMany({ where: { rebalanceId: r.id } });
  const eligible = lines.filter((l) => l.checkResult !== 'Fail');
  if (!eligible.length) throw new HttpError(409, 'nothing_to_order', 'Every line fails its checks; there is nothing to order');
  const secs = await securityMap(eligible.map((l) => l.securityId));
  for (const l of eligible) if (secs.get(l.securityId)?.status !== 'Active') throw HttpError.conflict(`${secs.get(l.securityId)?.ticker ?? l.securityId} is not active`, 'security_not_tradable');
  const created = await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.plRebalance.updateMany({ where: { id: r.id, status: 'PROPOSED' }, data: { status: 'ORDERS_CREATED' } })).count);
    const out: { ticker: string; orderRef: string; side: string }[] = [];
    for (const l of eligible) {
      const sec = secs.get(l.securityId)!;
      const ref = await seqRef(tx, 'order', 'ORD-', 6, 1001);
      const o = await tx.order.create({ data: { ref, portfolioId: r.portfolioId, securityId: l.securityId, side: l.side, quantity: l.quantity, orderType: 'MARKET', tif: 'DAY', urgency: 'Normal', rationale: `Rebalance ${r.ref}: ${l.currentPct.toFixed(2)}% to ${l.targetPct.toFixed(2)}%`, currency: l.currency, decisionPrice: l.price, status: 'Draft', makerId: req.user!.id } });
      await tx.plRebalanceLine.update({ where: { id: l.id }, data: { orderId: o.id, orderRef: o.ref } });
      await writeAudit(tx, audit(req), { action: 'order.created', objectType: 'order', objectId: o.id, after: { ref: o.ref, status: 'Draft', source: r.ref, portfolio: portfolio.ref, security: sec.ticker, side: l.side, quantity: l.quantity.toString() } });
      out.push({ ticker: sec.ticker, orderRef: o.ref, side: l.side });
    }
    await writeAudit(tx, audit(req), { action: 'lab.rebalance_orders_created', objectType: 'pl_rebalance', objectId: r.id, before: { status: 'PROPOSED' }, after: { status: 'ORDERS_CREATED', orders: out.map((o) => o.orderRef), skippedFailing: lines.length - eligible.length } });
    return out;
  });
  res.status(201).json({ data: { rebalance: await rebalanceDetail(await loadRebalance(r.id)), orders: created, skipped: lines.length - eligible.length } });
});

void iso;
