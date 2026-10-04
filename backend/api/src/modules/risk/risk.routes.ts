import { Router } from 'express';
import { pageEnvelope, sqlPage } from '../../middleware/paginate';
import { assertModelUsable, logModelUse } from '../model-governance/mg.usage';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { sendTable } from '../../lib/tabular';
import { nextRef } from '../../lib/refs';
import { expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { PRESETS, RISK_METRICS, DEFAULT_SHOCKS, METRIC_LABEL, SCENARIO_THRESHOLD_DEFAULTS } from './risk.engine';
import { SCENARIO_THRESHOLD_KEYS, checkLimitsForPortfolio, computeScenario, loadScenarioThresholds, runMonitor } from './risk.service';
import { computeVar } from './risk.var';

/**
 * Risk & Compliance (SRD 11.3 `/risk/*`, 5.A.7, 6.8). Admin-portal staff only: `risk.view` reads, `risk.manage`
 * writes. Limit approval needs step-up MFA and a different user from the maker (BR-001). Every write is audited
 * inside its transaction. Mounted at `/api/v1/risk`; auth is applied per route.
 */
export const riskRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('risk.view')];
const canManage = [...staff, requirePermission('risk.manage')];

const D = Prisma.Decimal;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const id36 = z.string().trim().min(1).max(36);

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

async function portfolioNames(ids: (string | null | undefined)[]): Promise<Map<string, { ref: string; name: string }>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await prisma.portfolio.findMany({ where: { id: { in: uniq } }, select: { id: true, ref: true, name: true } });
  return new Map(rows.map((p) => [p.id, { ref: p.ref, name: p.name }]));
}

async function assertActiveUser(userId: string, path: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!u?.isActive) throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown or inactive user' }]);
}

/** Active admin-portal staff, for owner / assignee pickers (read-only, id and name only). */
riskRoutes.get('/users', ...canView, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true },
    take: 500,
  });
  res.json({ data: rows.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email })), total: rows.length });
});

// ================================================================ limits

type LimitRow = Prisma.RiskLimitGetPayload<object>;

async function limitViews(rows: LimitRow[]) {
  const users = await userNames(rows.flatMap((r) => [r.ownerUserId, r.makerId, r.checkerId]));
  const pfs = await portfolioNames(rows.map((r) => r.scopeId));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    metric: r.metric,
    metricLabel: METRIC_LABEL[r.metric as keyof typeof METRIC_LABEL] ?? r.metric,
    scopeType: r.scopeType,
    scopeId: r.scopeId,
    scopeName: r.scopeType === 'FIRM' ? 'All portfolios' : (r.scopeId && pfs.get(r.scopeId)?.name) || null,
    scopeRef: r.scopeId ? pfs.get(r.scopeId)?.ref ?? null : null,
    threshold: r.threshold.toFixed(4),
    unit: r.unit,
    breachAction: r.breachAction,
    description: r.description,
    ownerUserId: r.ownerUserId,
    ownerName: users.get(r.ownerUserId) ?? null,
    status: r.status,
    makerId: r.makerId,
    makerName: users.get(r.makerId) ?? null,
    checkerId: r.checkerId,
    checkerName: r.checkerId ? users.get(r.checkerId) ?? null : null,
    approvedAt: iso(r.approvedAt),
    retiredAt: iso(r.retiredAt),
    version: r.version,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  }));
}

async function loadLimit(idOrRef: string): Promise<LimitRow> {
  const l = await prisma.riskLimit.findFirst({ where: /^[0-9a-f-]{36}$/i.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!l) throw HttpError.notFound('Limit not found');
  return l;
}

const limitFields = {
  metric: z.enum(RISK_METRICS),
  scopeType: z.enum(['PORTFOLIO', 'FIRM']),
  scopeId: id36.nullable(),
  threshold: z.number().gt(0).max(100),
  breachAction: z.enum(['ALERT', 'ESCALATE', 'BLOCK']),
  ownerUserId: id36,
  description: z.string().trim().max(500).nullable(),
};

const limitCreate = z
  .object({
    ...limitFields,
    scopeType: limitFields.scopeType.default('PORTFOLIO'),
    scopeId: limitFields.scopeId.optional(),
    breachAction: limitFields.breachAction.default('ALERT'),
    ownerUserId: limitFields.ownerUserId.optional(),
    description: limitFields.description.optional(),
  })
  .strict();

const limitPatch = z.object({ ...limitFields, version: z.number().int() }).partial().strict();

/** PORTFOLIO scope needs an existing portfolio (id or ref, stored as id); FIRM scope has none. */
async function normaliseScope(scopeType: string, scopeId: string | null | undefined): Promise<string | null> {
  if (scopeType === 'FIRM') {
    if (scopeId) throw HttpError.badRequest('Validation failed', [{ path: 'scopeId', message: 'A firm-wide limit has no scope id' }]);
    return null;
  }
  if (!scopeId) throw HttpError.badRequest('Validation failed', [{ path: 'scopeId', message: 'Choose the portfolio this limit applies to' }]);
  return (await loadPortfolio(scopeId).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'scopeId', message: 'Unknown portfolio' }]);
  })).id;
}

const limitListQuery = z.object({
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'RETIRED']).optional(),
  metric: z.enum(RISK_METRICS).optional(),
  portfolioId: id36.optional(),
  q: z.string().trim().max(100).optional(),
});

riskRoutes.get('/limits', ...canView, validateQuery(limitListQuery), async (req, res) => {
  const f = query<z.infer<typeof limitListQuery>>(req);
  const where: Prisma.RiskLimitWhereInput = { status: f.status, metric: f.metric };
  if (f.portfolioId) where.OR = [{ scopeType: 'FIRM' }, { scopeType: 'PORTFOLIO', scopeId: f.portfolioId }];
  if (f.q) where.AND = [{ OR: [{ ref: { contains: f.q } }, { description: { contains: f.q } }] }];
  const rows = await prisma.riskLimit.findMany({ where, orderBy: { ref: 'desc' }, take: 500 });
  res.json({ data: await limitViews(rows), total: rows.length, metrics: RISK_METRICS.map((m) => ({ key: m, label: METRIC_LABEL[m] })) });
});

riskRoutes.get('/limits/:id', ...canView, async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  res.json({ data: (await limitViews([l]))[0] });
});

riskRoutes.post('/limits', ...canManage, validateBody(limitCreate), idempotent('risk.limit.create'), async (req, res) => {
  const b = req.body as z.infer<typeof limitCreate>;
  const scopeId = await normaliseScope(b.scopeType, b.scopeId);
  const owner = b.ownerUserId ?? req.user!.id;
  await assertActiveUser(owner, 'ownerUserId');
  const created = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'riskLimit');
    const l = await tx.riskLimit.create({
      data: {
        ref,
        metric: b.metric,
        scopeType: b.scopeType,
        scopeId,
        threshold: new D(String(b.threshold)),
        breachAction: b.breachAction,
        description: b.description ?? null,
        ownerUserId: owner,
        makerId: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'risk.limit_created',
      objectType: 'risk_limit',
      objectId: l.id,
      after: { ref, metric: b.metric, scopeType: b.scopeType, scopeId, threshold: b.threshold, breachAction: b.breachAction, owner },
    });
    return l;
  });
  res.status(201).json({ data: (await limitViews([created]))[0] });
});

riskRoutes.patch('/limits/:id', ...canManage, validateBody(limitPatch), idempotent('risk.patch.limits_id', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  expectVersion(req, l.version);
  if (l.status !== 'DRAFT') throw HttpError.conflict('Only a DRAFT limit can be edited. Retire it and create a new one.', 'limit_not_editable');
  const b = req.body as z.infer<typeof limitPatch>;
  const data: Prisma.RiskLimitUpdateManyMutationInput = { version: { increment: 1 } };
  const scopeType = b.scopeType ?? l.scopeType;
  let scopeId: string | null = l.scopeId;
  if (b.scopeType !== undefined || b.scopeId !== undefined) {
    scopeId = await normaliseScope(scopeType, b.scopeType === 'FIRM' ? null : b.scopeId !== undefined ? b.scopeId : l.scopeId);
  }
  if (b.metric !== undefined) data.metric = b.metric;
  if (b.threshold !== undefined) data.threshold = new D(String(b.threshold));
  if (b.breachAction !== undefined) data.breachAction = b.breachAction;
  if (b.description !== undefined) data.description = b.description;
  if (b.ownerUserId !== undefined) {
    await assertActiveUser(b.ownerUserId, 'ownerUserId');
    data.ownerUserId = b.ownerUserId;
  }
  data.scopeType = scopeType;
  const { version: _v, ...changed } = b;
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.riskLimit.updateMany({ where: { id: l.id, version: l.version, status: 'DRAFT' }, data: { ...data, scopeId } });
    if (r.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'risk.limit_updated',
      objectType: 'risk_limit',
      objectId: l.id,
      before: { metric: l.metric, scopeType: l.scopeType, scopeId: l.scopeId, threshold: l.threshold.toFixed(4), breachAction: l.breachAction, owner: l.ownerUserId },
      after: { ...changed, scopeType, scopeId },
    });
    return tx.riskLimit.findUniqueOrThrow({ where: { id: l.id } });
  });
  res.json({ data: (await limitViews([updated]))[0] });
});

riskRoutes.delete('/limits/:id', ...canManage, idempotent('risk.delete.limits_id', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  if (l.status !== 'DRAFT') throw HttpError.conflict('Only a DRAFT limit can be deleted. Retire an active limit instead.', 'limit_not_deletable');
  await prisma.$transaction(async (tx) => {
    const r = await tx.riskLimit.deleteMany({ where: { id: l.id, status: 'DRAFT' } });
    if (r.count !== 1) throw HttpError.conflict('This limit changed state. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), { action: 'risk.limit_deleted', objectType: 'risk_limit', objectId: l.id, before: { ref: l.ref, metric: l.metric, threshold: l.threshold.toFixed(4) } });
  });
  res.json({ data: { id: l.id, deleted: true } });
});

/** Moves a limit between states with an optimistic guard on the current status. */
async function transitionLimit(
  req: import('express').Request,
  l: LimitRow,
  from: string,
  to: string,
  action: string,
  extra: Prisma.RiskLimitUpdateManyMutationInput = {},
  reason?: string,
) {
  if (l.status !== from) throw HttpError.conflict(`The limit is ${l.status}; it must be ${from} for this action.`, 'invalid_state');
  return prisma.$transaction(async (tx) => {
    const r = await tx.riskLimit.updateMany({ where: { id: l.id, status: from }, data: { status: to, version: { increment: 1 }, ...extra } });
    if (r.count !== 1) throw HttpError.conflict('This limit changed state. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action,
      objectType: 'risk_limit',
      objectId: l.id,
      before: { status: from },
      after: { ref: l.ref, status: to, ...(extra.checkerId ? { checker: extra.checkerId } : {}) },
      reason: reason ?? null,
    });
    return tx.riskLimit.findUniqueOrThrow({ where: { id: l.id } });
  });
}

riskRoutes.post('/limits/:id/submit', ...canManage, idempotent('risk.post.limits_id_submit', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  res.json({ data: (await limitViews([await transitionLimit(req, l, 'DRAFT', 'PENDING_APPROVAL', 'risk.limit_submitted')]))[0] });
});

riskRoutes.post('/limits/:id/approve', ...canManage, requireStepUp, idempotent('risk.post.limits_id_approve', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  if (l.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`The limit is ${l.status}; it must be PENDING_APPROVAL to approve.`, 'invalid_state');
  if (l.makerId === req.user!.id) throw HttpError.forbidden('The person who created a limit cannot approve it (maker-checker)', 'sod_violation');
  const clash = await prisma.riskLimit.findFirst({
    where: { id: { not: l.id }, status: 'ACTIVE', metric: l.metric, scopeType: l.scopeType, scopeId: l.scopeId },
    select: { ref: true },
  });
  if (clash) throw HttpError.conflict(`${clash.ref} is already ACTIVE for this metric and scope. Retire it first.`, 'limit_exists');
  const updated = await transitionLimit(req, l, 'PENDING_APPROVAL', 'ACTIVE', 'risk.limit_approved', { checkerId: req.user!.id, approvedAt: new Date() });
  res.json({ data: (await limitViews([updated]))[0] });
});

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

riskRoutes.post('/limits/:id/reject', ...canManage, validateBody(reasonBody), idempotent('risk.post.limits_id_reject', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  const updated = await transitionLimit(req, l, 'PENDING_APPROVAL', 'DRAFT', 'risk.limit_rejected', {}, (req.body as z.infer<typeof reasonBody>).reason);
  res.json({ data: (await limitViews([updated]))[0] });
});

riskRoutes.post('/limits/:id/retire', ...canManage, validateBody(reasonBody), idempotent('risk.post.limits_id_retire', { required: false }), async (req, res) => {
  const l = await loadLimit(param(req, 'id'));
  const updated = await transitionLimit(req, l, 'ACTIVE', 'RETIRED', 'risk.limit_retired', { retiredAt: new Date() }, (req.body as z.infer<typeof reasonBody>).reason);
  res.json({ data: (await limitViews([updated]))[0] });
});

// ================================================================ monitor

const monitorBody = z.object({ portfolioId: id36.optional() }).strict();

riskRoutes.post('/monitor', ...canManage, validateBody(monitorBody), idempotent('risk.monitor', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof monitorBody>;
  await assertModelUsable('RISK_LIMIT');
  const summary = await runMonitor(audit(req), { portfolioId: b.portfolioId });
  await logModelUse('RISK_LIMIT', { context: 'Limit monitor run', objectRef: summary.detectedOn, userId: req.user!.id, audit: audit(req), inputs: { portfolioId: b.portfolioId ?? 'all' }, outputs: { portfoliosChecked: summary.portfoliosChecked, limitsEvaluated: summary.limitsEvaluated, newBreaches: summary.newBreaches.length, warnings: summary.warnings } });
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), {
      action: 'risk.monitor_run',
      objectType: 'risk_monitor',
      objectId: summary.detectedOn,
      after: { portfoliosChecked: summary.portfoliosChecked, limitsEvaluated: summary.limitsEvaluated, newBreaches: summary.newBreaches.length, alreadyRecorded: summary.alreadyRecorded },
    }),
  );
  res.json({ data: summary });
});

/** Read-only: every ACTIVE limit that applies to a portfolio, judged by the same engine the monitor uses (no model-use log). */
riskRoutes.get('/portfolios/:portfolioId/limits', ...canView, async (req, res) => {
  const result = await checkLimitsForPortfolio(param(req, 'portfolioId'));
  res.json({ data: { asOf: result.asOf, evaluations: result.evaluations } });
});

// ================================================================ compliance report (FR-RSK-013)

const reportQuery = z.object({ asOf: dateStr.optional(), portfolioId: id36.optional(), format: z.enum(['json', 'csv', 'xlsx']).default('json') });

/**
 * The limit book against live positions as of a date: every ACTIVE limit that applies to each portfolio with its measured
 * value, headroom and state, plus any breach recorded for it that day. Read from the same evaluation the pre-trade check
 * and the monitor use, so the figures equal the limit book at that time. JSON feeds the on-screen/printed report; CSV and
 * XLSX are the download. Every generation is audited.
 */
riskRoutes.get('/compliance-report', ...canView, validateQuery(reportQuery), async (req, res) => {
  const f = query<z.infer<typeof reportQuery>>(req);
  const asOfDay = f.asOf ?? new Date().toISOString().slice(0, 10);
  if (asOfDay > new Date().toISOString().slice(0, 10)) throw HttpError.badRequest('Validation failed', [{ path: 'asOf', message: 'The as-of date cannot be in the future' }]);
  const asOf = f.asOf ? new Date(`${f.asOf}T23:59:59.000Z`) : new Date();
  const portfolios = f.portfolioId ? [await loadPortfolio(f.portfolioId)] : await prisma.portfolio.findMany({ where: { status: 'Active' }, orderBy: { ref: 'asc' }, take: 200 });
  const lines: { portfolioRef: string; portfolioName: string; limitRef: string; metric: string; metricLabel: string; scope: string; breachAction: string; threshold: string; value: string; headroom: string; state: string; recordedBreach: string | null }[] = [];
  const problems: string[] = [];
  for (const p of portfolios) {
    const r = await checkLimitsForPortfolio(p.id, null, { asOf });
    r.valuationWarnings.forEach((w) => problems.push(`${p.ref}: ${w}`));
    const recorded = await prisma.riskBreach.findMany({ where: { portfolioId: p.id, detectedOn: toDate(asOfDay) }, select: { limitId: true, status: true } });
    for (const e of r.evaluations) {
      const floor = e.metric === 'CASH_FLOOR_PCT';
      const headroom = floor ? new D(e.value).sub(e.threshold) : new D(e.threshold).sub(e.value);
      lines.push({ portfolioRef: p.ref, portfolioName: p.name, limitRef: e.ref, metric: e.metric, metricLabel: METRIC_LABEL[e.metric], scope: e.scopeType, breachAction: e.breachAction, threshold: e.threshold, value: e.value, headroom: headroom.toFixed(4), state: e.state, recordedBreach: recorded.find((b) => b.limitId === e.limitId)?.status ?? null });
    }
  }
  const summary = { portfolios: portfolios.length, limitsChecked: lines.length, breaches: lines.filter((l) => l.state === 'BREACH').length, warnings: lines.filter((l) => l.state === 'WARNING').length };
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'risk.compliance_report', objectType: 'compliance_report', objectId: f.portfolioId ?? 'all', after: { asOf: asOfDay, format: f.format, ...summary } }));
  if (f.format === 'json') {
    res.json({ data: { asOf: asOfDay, generatedAt: new Date().toISOString(), portfolioId: f.portfolioId ?? null, summary, lines, problems } });
    return;
  }
  const head = ['As of', 'Portfolio', 'Portfolio name', 'Limit', 'Metric', 'Scope', 'Breach action', 'Threshold %', 'Measured %', 'Headroom %', 'State', 'Recorded breach'];
  sendTable(res, f.format, `compliance-report-${asOfDay}`, head, lines.map((l) => [asOfDay, l.portfolioRef, l.portfolioName, l.limitRef, l.metricLabel, l.scope, l.breachAction, l.threshold, l.value, l.headroom, l.state, l.recordedBreach ?? '']), 'Compliance report');
});

// ================================================================ pre-trade check (read only)

const checkBody = z
  .object({
    portfolioId: id36,
    asOf: dateStr.optional(),
    hypothetical: z
      .object({
        ticker: z.string().trim().min(1).max(36),
        side: z.enum(['BUY', 'SELL']),
        quantity: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,6})?$/)]),
        price: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,6})?$/)]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** What the ACTIVE limits say about a portfolio now, or after a hypothetical trade. Records nothing. */
riskRoutes.post('/check', ...canView, validateBody(checkBody), async (req, res) => {
  const b = req.body as z.infer<typeof checkBody>;
  await assertModelUsable('RISK_LIMIT');
  const result = await checkLimitsForPortfolio(b.portfolioId, b.hypothetical, { asOf: b.asOf ? toDate(b.asOf) : undefined });
  await logModelUse('RISK_LIMIT', { context: b.hypothetical ? 'Pre-trade limit check' : 'Limit check', objectRef: b.portfolioId.slice(0, 8), userId: req.user!.id, audit: audit(req), inputs: { portfolioId: b.portfolioId, asOf: b.asOf, hypothetical: b.hypothetical }, outputs: { breaches: result.breaches.length, warnings: result.warnings.length, blocked: result.blocked } });
  res.json({ data: result });
});

// ================================================================ value at risk (governed model RISK_VAR)

const varBody = z.object({ portfolioId: id36, confidence: z.union([z.literal(0.95), z.literal(0.99)]).default(0.95), horizonDays: z.number().int().min(1).max(10).default(1), lookbackDays: z.number().int().min(30).max(500).default(250) }).strict();

/** Historical-simulation VaR on the current book from stored daily prices. Read only; logged against the bound RISK_VAR model. */
riskRoutes.post('/var', ...canView, validateBody(varBody), async (req, res) => {
  const b = req.body as z.infer<typeof varBody>;
  await assertModelUsable('RISK_VAR');
  const result = await computeVar(b.portfolioId, b.confidence, b.horizonDays, b.lookbackDays);
  const use = await logModelUse('RISK_VAR', { context: `VaR ${b.confidence * 100}% ${b.horizonDays}d`, objectRef: result.portfolioRef, userId: req.user!.id, audit: audit(req), inputs: b, outputs: { observations: result.observations, varAmount: result.varAmount, varPct: result.varPct, coveragePct: result.coveragePct } });
  res.json({ data: result, ...(use.warning ? { warning: use.warning } : {}) });
});

// ================================================================ breaches

type BreachRow = Prisma.RiskBreachGetPayload<{ include: { limit: true } }>;

async function breachViews(rows: BreachRow[]) {
  const pfs = await portfolioNames(rows.map((r) => r.portfolioId));
  const cases = await prisma.riskCase.findMany({ where: { id: { in: rows.map((r) => r.caseId).filter((x): x is string => !!x) } }, select: { id: true, ref: true, status: true } });
  const cm = new Map(cases.map((c) => [c.id, c]));
  const users = await userNames(rows.map((r) => r.ackBy));
  return rows.map((r) => ({
    id: r.id,
    limitId: r.limitId,
    limitRef: r.limit.ref,
    metric: r.limit.metric,
    breachAction: r.limit.breachAction,
    portfolioId: r.portfolioId,
    portfolioRef: pfs.get(r.portfolioId)?.ref ?? null,
    portfolioName: pfs.get(r.portfolioId)?.name ?? null,
    detectedOn: day(r.detectedOn),
    value: r.value.toFixed(4),
    threshold: r.threshold.toFixed(4),
    detail: r.detail,
    status: r.status,
    caseId: r.caseId,
    caseRef: r.caseId ? cm.get(r.caseId)?.ref ?? null : null,
    caseStatus: r.caseId ? cm.get(r.caseId)?.status ?? null : null,
    ackBy: r.ackBy,
    ackByName: r.ackBy ? users.get(r.ackBy) ?? null : null,
    ackAt: iso(r.ackAt),
    ackNote: r.ackNote,
  }));
}

const breachQuery = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  limitId: id36.optional(),
  portfolioId: id36.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

riskRoutes.get('/breaches', ...canView, validateQuery(breachQuery), async (req, res) => {
  const f = query<z.infer<typeof breachQuery>>(req);
  const pg = sqlPage(req, f.limit);
  const where: Prisma.RiskBreachWhereInput = {
    status: f.status,
    limitId: f.limitId,
    portfolioId: f.portfolioId,
    detectedOn: { gte: f.from ? toDate(f.from) : undefined, lte: f.to ? toDate(f.to) : undefined },
  };
  const [rows, total] = await Promise.all([
    prisma.riskBreach.findMany({ where, include: { limit: true }, orderBy: [{ detectedOn: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.riskBreach.count({ where }),
  ]);
  res.json(pageEnvelope(pg, await breachViews(rows), total));
});

const ackBody = z.object({ note: z.string().trim().max(500).optional() }).strict();

riskRoutes.post('/breaches/:id/acknowledge', ...canManage, validateBody(ackBody), idempotent('risk.post.breaches_id_acknowledge', { required: false }), async (req, res) => {
  const b = await prisma.riskBreach.findUnique({ where: { id: param(req, 'id') }, include: { limit: true } });
  if (!b) throw HttpError.notFound('Breach not found');
  if (b.status !== 'OPEN') throw HttpError.conflict(`The breach is ${b.status}; only an OPEN breach can be acknowledged.`, 'invalid_state');
  const note = (req.body as z.infer<typeof ackBody>).note ?? null;
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.riskBreach.updateMany({ where: { id: b.id, status: 'OPEN' }, data: { status: 'ACKNOWLEDGED', ackBy: req.user!.id, ackAt: new Date(), ackNote: note } });
    if (r.count !== 1) throw HttpError.conflict('This breach changed state. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'risk.breach_acknowledged',
      objectType: 'risk_breach',
      objectId: b.id,
      before: { status: 'OPEN' },
      after: { status: 'ACKNOWLEDGED', limit: b.limit.ref, note },
    });
    return tx.riskBreach.findUniqueOrThrow({ where: { id: b.id }, include: { limit: true } });
  });
  res.json({ data: (await breachViews([updated]))[0] });
});

// ================================================================ scenarios

const shockSchema = z
  .object({
    equityPct: z.number().min(-100).max(100),
    fxPct: z.number().min(-50).max(99),
    ratePctPoints: z.number().min(-20).max(50),
    durationYears: z.number().min(0).max(30),
    redemptionPct: z.number().min(0).max(100),
  })
  .partial()
  .strict();

const shocksFull = (s: z.infer<typeof shockSchema>) => ({ ...DEFAULT_SHOCKS, ...s });

type ScenarioRow = Prisma.RiskScenarioGetPayload<object>;

async function scenarioViews(rows: ScenarioRow[]) {
  const users = await userNames(rows.map((r) => r.createdBy));
  const counts = await prisma.riskScenarioRun.groupBy({ by: ['scenarioId'], where: { scenarioId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
  const cm = new Map(counts.map((c) => [c.scenarioId, c._count._all]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shocks: r.shocks,
    preset: r.preset,
    createdBy: r.createdBy,
    createdByName: r.createdBy ? users.get(r.createdBy) ?? null : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    runCount: cm.get(r.id) ?? 0,
  }));
}

async function loadScenario(idOrName: string) {
  const s = await prisma.riskScenario.findFirst({ where: /^[0-9a-f-]{36}$/i.test(idOrName) ? { id: idOrName } : { name: idOrName } });
  if (!s) throw HttpError.notFound('Scenario not found');
  return s;
}

riskRoutes.get('/scenarios', ...canView, async (_req, res) => {
  const rows = await prisma.riskScenario.findMany({ orderBy: [{ preset: 'asc' }, { name: 'asc' }], take: 500 });
  res.json({ data: await scenarioViews(rows), total: rows.length, presets: PRESETS });
});

const scenarioCreate = z
  .object({ name: z.string().trim().min(2).max(120), shocks: shockSchema, preset: z.enum(['liquidity', 'equity', 'fx']).optional() })
  .strict();

const scenarioPatch = z.object({ name: z.string().trim().min(2).max(120), shocks: shockSchema }).partial().strict();

riskRoutes.post('/scenarios', ...canManage, validateBody(scenarioCreate), idempotent('risk.scenario.create'), async (req, res) => {
  const b = req.body as z.infer<typeof scenarioCreate>;
  if (await prisma.riskScenario.findUnique({ where: { name: b.name }, select: { id: true } })) {
    throw HttpError.conflict('A scenario with this name already exists', 'scenario_exists');
  }
  const shocks = shocksFull(b.shocks);
  const s = await prisma.$transaction(async (tx) => {
    const row = await tx.riskScenario.create({ data: { name: b.name, shocks, preset: b.preset ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'risk.scenario_created', objectType: 'risk_scenario', objectId: row.id, after: { name: b.name, shocks, preset: b.preset ?? null } });
    return row;
  });
  res.status(201).json({ data: (await scenarioViews([s]))[0] });
});

riskRoutes.get('/scenarios/:id', ...canView, async (req, res) => {
  res.json({ data: (await scenarioViews([await loadScenario(param(req, 'id'))]))[0] });
});

riskRoutes.patch('/scenarios/:id', ...canManage, validateBody(scenarioPatch), idempotent('risk.patch.scenarios_id', { required: false }), async (req, res) => {
  const s = await loadScenario(param(req, 'id'));
  if (s.preset) throw HttpError.conflict('Built-in preset scenarios cannot be edited. Save a copy under a new name.', 'preset_locked');
  const b = req.body as z.infer<typeof scenarioPatch>;
  if (b.name && b.name !== s.name && (await prisma.riskScenario.findUnique({ where: { name: b.name }, select: { id: true } }))) {
    throw HttpError.conflict('A scenario with this name already exists', 'scenario_exists');
  }
  const shocks = b.shocks ? { ...(s.shocks as object), ...b.shocks } : undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.riskScenario.update({ where: { id: s.id }, data: { name: b.name, shocks } });
    await writeAudit(tx, audit(req), { action: 'risk.scenario_updated', objectType: 'risk_scenario', objectId: s.id, before: { name: s.name, shocks: s.shocks }, after: { name: row.name, shocks: row.shocks } });
    return row;
  });
  res.json({ data: (await scenarioViews([updated]))[0] });
});

riskRoutes.delete('/scenarios/:id', ...canManage, idempotent('risk.delete.scenarios_id', { required: false }), async (req, res) => {
  const s = await loadScenario(param(req, 'id'));
  if (s.preset) throw HttpError.conflict('Built-in preset scenarios cannot be deleted', 'preset_locked');
  if (await prisma.riskScenarioRun.count({ where: { scenarioId: s.id } })) {
    throw HttpError.conflict('This scenario has stored runs and cannot be deleted (runs are part of the record)', 'scenario_has_runs');
  }
  await prisma.$transaction(async (tx) => {
    await tx.riskScenario.delete({ where: { id: s.id } });
    await writeAudit(tx, audit(req), { action: 'risk.scenario_deleted', objectType: 'risk_scenario', objectId: s.id, before: { name: s.name, shocks: s.shocks } });
  });
  res.json({ data: { id: s.id, deleted: true } });
});

// ---- BR-029: scenario state thresholds as policy parameters

const thresholdView = async () => ({
  thresholds: await loadScenarioThresholds(),
  defaults: SCENARIO_THRESHOLD_DEFAULTS,
  reference: { liquidityEscalate: 1.25, liquidityReview: 1.5, lossEscalatePct: 8, lossReviewPct: 5, note: 'SRD BR-029 reference values; set them here to adopt them.' },
  canEdit: false,
});

riskRoutes.get('/scenario-thresholds', ...canView, async (req, res) => {
  res.json({ data: { ...(await thresholdView()), canEdit: req.user!.permissions.includes('risk.manage') } });
});

const thresholdBody = z
  .object({
    liquidityEscalate: z.number().min(0.1).max(10).optional(),
    liquidityReview: z.number().min(0.1).max(10).optional(),
    lossEscalatePct: z.number().gt(0).max(100).nullable().optional(),
    lossReviewPct: z.number().gt(0).max(100).nullable().optional(),
    reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(300),
  })
  .strict()
  .refine((b) => ['liquidityEscalate', 'liquidityReview', 'lossEscalatePct', 'lossReviewPct'].some((k) => (b as Record<string, unknown>)[k] !== undefined), 'Change at least one threshold');

riskRoutes.put('/scenario-thresholds', ...canManage, requireStepUp, validateBody(thresholdBody), idempotent('risk.scenario_thresholds', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof thresholdBody>;
  const before = await loadScenarioThresholds();
  const next = { ...before };
  for (const k of ['liquidityEscalate', 'liquidityReview'] as const) if (b[k] !== undefined) next[k] = b[k]!;
  for (const k of ['lossEscalatePct', 'lossReviewPct'] as const) if (b[k] !== undefined) next[k] = b[k]!;
  const problems: { path: string; message: string }[] = [];
  if (next.liquidityEscalate > next.liquidityReview) problems.push({ path: 'liquidityEscalate', message: 'The escalation coverage must not be above the review coverage (escalate is the lower, worse level)' });
  if (next.lossEscalatePct !== null && next.lossReviewPct !== null && next.lossReviewPct > next.lossEscalatePct) problems.push({ path: 'lossReviewPct', message: 'The review loss must not be above the escalation loss' });
  if (next.lossEscalatePct === null && next.lossReviewPct !== null && b.lossEscalatePct !== undefined) problems.push({ path: 'lossEscalatePct', message: 'Set an escalation loss as well as a review loss, or clear both' });
  if (problems.length) throw HttpError.badRequest('Validation failed', problems);
  await prisma.$transaction(async (tx) => {
    for (const k of Object.keys(SCENARIO_THRESHOLD_KEYS) as (keyof typeof SCENARIO_THRESHOLD_KEYS)[]) {
      if (b[k] === undefined) continue;
      const key = SCENARIO_THRESHOLD_KEYS[k];
      const v = next[k];
      if (v === null) await tx.policy.deleteMany({ where: { key } });
      else await tx.policy.upsert({ where: { key }, create: { key, value: v, updatedBy: req.user!.id }, update: { value: v, updatedBy: req.user!.id } });
    }
    await writeAudit(tx, audit(req), { action: 'risk.scenario_thresholds_updated', objectType: 'risk_policy', objectId: 'scenario_thresholds', before, after: next, reason: b.reason });
  });
  res.json({ data: { ...(await thresholdView()), canEdit: true } });
});

const runBody = z.object({ portfolioId: id36, asOf: dateStr.optional() }).strict();
const previewBody = z.object({ portfolioId: id36, shocks: shockSchema, asOf: dateStr.optional() }).strict();

/** Runs shocks on a portfolio without saving anything (what-if). */
riskRoutes.post('/scenarios/preview', ...canView, validateBody(previewBody), async (req, res) => {
  const b = req.body as z.infer<typeof previewBody>;
  const { portfolioId, result } = await computeScenario(b.portfolioId, shocksFull(b.shocks), b.asOf ? toDate(b.asOf) : undefined);
  res.json({ data: { portfolioId, results: result } });
});

type RunRow = Prisma.RiskScenarioRunGetPayload<{ include: { scenario: true } }>;

async function runViews(rows: RunRow[]) {
  const users = await userNames(rows.map((r) => r.runBy));
  const pfs = await portfolioNames(rows.map((r) => r.portfolioId));
  return rows.map((r) => ({
    id: r.id,
    scenarioId: r.scenarioId,
    scenarioName: r.scenario.name,
    portfolioId: r.portfolioId,
    portfolioRef: pfs.get(r.portfolioId)?.ref ?? null,
    portfolioName: pfs.get(r.portfolioId)?.name ?? null,
    asOf: day(r.asOf),
    results: r.results,
    runBy: r.runBy,
    runByName: r.runBy ? users.get(r.runBy) ?? null : null,
    createdAt: iso(r.createdAt),
  }));
}

riskRoutes.post('/scenarios/:id/run', ...canManage, validateBody(runBody), idempotent('risk.scenario.run', { required: false }), async (req, res) => {
  const s = await loadScenario(param(req, 'id'));
  const b = req.body as z.infer<typeof runBody>;
  await assertModelUsable('RISK_SCENARIO');
  const { portfolioId, result } = await computeScenario(b.portfolioId, s.shocks as object, b.asOf ? toDate(b.asOf) : undefined);
  const run = await prisma.$transaction(async (tx) => {
    const row = await tx.riskScenarioRun.create({
      data: { scenarioId: s.id, portfolioId, asOf: toDate(result.asOf), results: result as unknown as Prisma.InputJsonValue, runBy: req.user!.id },
      include: { scenario: true },
    });
    await writeAudit(tx, audit(req), {
      action: 'risk.scenario_run',
      objectType: 'risk_scenario_run',
      objectId: row.id,
      after: { scenario: s.name, portfolioId, asOf: result.asOf, status: result.status, loss: result.loss, lossPct: result.lossPct },
    });
    return row;
  });
  await logModelUse('RISK_SCENARIO', { context: `Scenario run: ${s.name}`, objectRef: run.id.slice(0, 8), userId: req.user!.id, audit: audit(req), inputs: { scenario: s.name, portfolioId, asOf: result.asOf, shocks: result.shocks }, outputs: { nav: result.nav, postShockValue: result.postShockValue, loss: result.loss, lossPct: result.lossPct, status: result.status } });
  res.status(201).json({ data: (await runViews([run]))[0] });
});

const runQuery = z.object({ scenarioId: id36.optional(), portfolioId: id36.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

riskRoutes.get('/runs', ...canView, validateQuery(runQuery), async (req, res) => {
  const f = query<z.infer<typeof runQuery>>(req);
  const pg = sqlPage(req, f.limit);
  const where: Prisma.RiskScenarioRunWhereInput = { scenarioId: f.scenarioId, portfolioId: f.portfolioId };
  const [rows, total] = await Promise.all([
    prisma.riskScenarioRun.findMany({ where, include: { scenario: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.riskScenarioRun.count({ where }),
  ]);
  res.json(pageEnvelope(pg, await runViews(rows), total));
});

riskRoutes.get('/runs/:id', ...canView, async (req, res) => {
  const r = await prisma.riskScenarioRun.findUnique({ where: { id: param(req, 'id') }, include: { scenario: true } });
  if (!r) throw HttpError.notFound('Run not found');
  res.json({ data: (await runViews([r]))[0] });
});

// ================================================================ cases

type CaseRow = Prisma.RiskCaseGetPayload<object>;

async function caseViews(rows: CaseRow[]) {
  const users = await userNames(rows.flatMap((r) => [r.ownerUserId, r.createdBy]));
  const pfs = await portfolioNames(rows.map((r) => r.portfolioId));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    type: r.type,
    description: r.description,
    severity: r.severity,
    status: r.status,
    ownerUserId: r.ownerUserId,
    ownerName: r.ownerUserId ? users.get(r.ownerUserId) ?? null : null,
    sourceBreachId: r.sourceBreachId,
    portfolioId: r.portfolioId,
    portfolioRef: r.portfolioId ? pfs.get(r.portfolioId)?.ref ?? null : null,
    portfolioName: r.portfolioId ? pfs.get(r.portfolioId)?.name ?? null : null,
    resolutionNote: r.resolutionNote,
    resolvedAt: iso(r.resolvedAt),
    createdBy: r.createdBy,
    createdByName: r.createdBy ? users.get(r.createdBy) ?? null : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    version: r.version,
  }));
}

async function loadCase(idOrRef: string): Promise<CaseRow> {
  const c = await prisma.riskCase.findFirst({ where: /^[0-9a-f-]{36}$/i.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!c) throw HttpError.notFound('Case not found');
  return c;
}

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const CASE_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'] as const;
/** OPEN -> INVESTIGATING -> RESOLVED | CLOSED, and RESOLVED -> CLOSED. */
const NEXT: Record<string, string[]> = { OPEN: ['INVESTIGATING'], INVESTIGATING: ['RESOLVED', 'CLOSED'], RESOLVED: ['CLOSED'], CLOSED: [] };

const caseQuery = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  ownerId: id36.optional(),
  mine: z.enum(['1', 'true']).optional(),
  open: z.enum(['1', 'true']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

riskRoutes.get('/cases', ...canView, validateQuery(caseQuery), async (req, res) => {
  const f = query<z.infer<typeof caseQuery>>(req);
  const where: Prisma.RiskCaseWhereInput = { severity: f.severity, ownerUserId: f.mine ? req.user!.id : f.ownerId };
  if (f.status) where.status = f.status;
  else if (f.open) where.status = { in: ['OPEN', 'INVESTIGATING'] };
  if (f.q) where.OR = [{ ref: { contains: f.q } }, { description: { contains: f.q } }, { type: { contains: f.q } }];
  const pg = sqlPage(req, f.limit);
  const [rows, total] = await Promise.all([prisma.riskCase.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }), prisma.riskCase.count({ where })]);
  res.json(pageEnvelope(pg, await caseViews(rows), total));
});

riskRoutes.get('/cases/:id', ...canView, async (req, res) => {
  res.json({ data: (await caseViews([await loadCase(param(req, 'id'))]))[0] });
});

const caseCreate = z
  .object({
    type: z.string().trim().min(1).max(40).default('MANUAL'),
    description: z.string().trim().min(3, 'Describe the case').max(2000),
    severity: z.enum(SEVERITIES).default('MEDIUM'),
    ownerUserId: id36.optional(),
    portfolioId: id36.optional(),
    sourceBreachId: id36.optional(),
  })
  .strict();

riskRoutes.post('/cases', ...canManage, validateBody(caseCreate), idempotent('risk.case.create'), async (req, res) => {
  const b = req.body as z.infer<typeof caseCreate>;
  if (b.ownerUserId) await assertActiveUser(b.ownerUserId, 'ownerUserId');
  let portfolioId: string | null = null;
  if (b.portfolioId) {
    portfolioId = (await loadPortfolio(b.portfolioId).catch(() => {
      throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
    })).id;
  }
  const breach = b.sourceBreachId ? await prisma.riskBreach.findUnique({ where: { id: b.sourceBreachId } }) : null;
  if (b.sourceBreachId && !breach) throw HttpError.badRequest('Validation failed', [{ path: 'sourceBreachId', message: 'Unknown breach' }]);
  if (breach?.caseId) throw HttpError.conflict('This breach already has a case', 'breach_has_case');
  const created = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'riskCase');
    const c = await tx.riskCase.create({
      data: {
        ref,
        type: b.type,
        description: b.description,
        severity: b.severity,
        ownerUserId: b.ownerUserId ?? req.user!.id,
        sourceBreachId: b.sourceBreachId ?? null,
        portfolioId: portfolioId ?? breach?.portfolioId ?? null,
        createdBy: req.user!.id,
      },
    });
    if (breach) await tx.riskBreach.update({ where: { id: breach.id }, data: { caseId: c.id } });
    await writeAudit(tx, audit(req), {
      action: 'risk.case_created',
      objectType: 'risk_case',
      objectId: c.id,
      after: { ref, type: b.type, severity: b.severity, owner: c.ownerUserId, sourceBreach: b.sourceBreachId ?? null },
    });
    return c;
  });
  res.status(201).json({ data: (await caseViews([created]))[0] });
});

const casePatch = z
  .object({ type: z.string().trim().min(1).max(40), description: z.string().trim().min(3).max(2000), severity: z.enum(SEVERITIES), version: z.number().int() })
  .partial()
  .strict();

riskRoutes.patch('/cases/:id', ...canManage, validateBody(casePatch), idempotent('risk.patch.cases_id', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  expectVersion(req, c.version);
  if (c.status === 'CLOSED') throw HttpError.conflict('A closed case cannot be edited', 'invalid_state');
  const b = req.body as z.infer<typeof casePatch>;
  const { version: _v, ...changed } = b;
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.riskCase.updateMany({ where: { id: c.id, version: c.version }, data: { ...changed, version: { increment: 1 } } });
    if (r.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'risk.case_updated',
      objectType: 'risk_case',
      objectId: c.id,
      before: { type: c.type, description: c.description, severity: c.severity },
      after: changed,
    });
    return tx.riskCase.findUniqueOrThrow({ where: { id: c.id } });
  });
  res.json({ data: (await caseViews([updated]))[0] });
});

const assignBody = z.object({ ownerUserId: id36 }).strict();

riskRoutes.post('/cases/:id/assign', ...canManage, validateBody(assignBody), idempotent('risk.post.cases_id_assign', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status === 'CLOSED') throw HttpError.conflict('A closed case cannot be reassigned', 'invalid_state');
  const { ownerUserId } = req.body as z.infer<typeof assignBody>;
  await assertActiveUser(ownerUserId, 'ownerUserId');
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.riskCase.update({ where: { id: c.id }, data: { ownerUserId, version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'risk.case_assigned', objectType: 'risk_case', objectId: c.id, before: { owner: c.ownerUserId }, after: { ref: c.ref, owner: ownerUserId } });
    return row;
  });
  res.json({ data: (await caseViews([updated]))[0] });
});

const transitionBody = z.object({ status: z.enum(['INVESTIGATING', 'RESOLVED', 'CLOSED']), note: z.string().trim().max(2000).optional() }).strict();

riskRoutes.post('/cases/:id/transition', ...canManage, validateBody(transitionBody), idempotent('risk.post.cases_id_transition', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const b = req.body as z.infer<typeof transitionBody>;
  if (!NEXT[c.status]?.includes(b.status)) {
    throw HttpError.conflict(`A ${c.status} case cannot move to ${b.status}. Allowed: ${NEXT[c.status]?.join(', ') || 'none'}.`, 'invalid_transition');
  }
  const needsNote = b.status === 'RESOLVED' || (b.status === 'CLOSED' && !c.resolutionNote);
  if (needsNote && (!b.note || b.note.length < 3)) {
    throw HttpError.badRequest('Validation failed', [{ path: 'note', message: 'A resolution note is required' }]);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.riskCase.updateMany({
      where: { id: c.id, status: c.status },
      data: {
        status: b.status,
        version: { increment: 1 },
        ...(b.note ? { resolutionNote: b.note } : {}),
        ...(b.status === 'RESOLVED' || b.status === 'CLOSED' ? { resolvedAt: c.resolvedAt ?? new Date() } : {}),
      },
    });
    if (r.count !== 1) throw HttpError.conflict('This case changed state. Reload and try again.', 'version_conflict');
    if ((b.status === 'RESOLVED' || b.status === 'CLOSED') && c.sourceBreachId) {
      await tx.riskBreach.updateMany({ where: { id: c.sourceBreachId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED' } });
    }
    await writeAudit(tx, audit(req), {
      action: 'risk.case_transitioned',
      objectType: 'risk_case',
      objectId: c.id,
      before: { status: c.status },
      after: { ref: c.ref, status: b.status },
      reason: b.note ?? null,
    });
    return tx.riskCase.findUniqueOrThrow({ where: { id: c.id } });
  });
  res.json({ data: (await caseViews([updated]))[0] });
});

riskRoutes.delete('/cases/:id', ...canManage, idempotent('risk.delete.cases_id', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (c.status !== 'OPEN' || c.sourceBreachId) throw HttpError.conflict('Only an OPEN, manually created case can be deleted', 'case_not_deletable');
  await prisma.$transaction(async (tx) => {
    await tx.riskCase.delete({ where: { id: c.id } });
    await writeAudit(tx, audit(req), { action: 'risk.case_deleted', objectType: 'risk_case', objectId: c.id, before: { ref: c.ref, type: c.type, description: c.description } });
  });
  res.json({ data: { id: c.id, deleted: true } });
});
