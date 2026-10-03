import { Router } from 'express';
import { sqlPage } from '../../middleware/paginate';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { enqueue } from '../../lib/outbox';
import { expectVersion, hasPermission, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, assertUpdated, audit } from '../ops/ops.common';
import { accountRefs } from '../custodian/custodian.service';
import { loadPortfolio } from '../portfolio/portfolio.service';
import {
  CAUSES,
  DEFAULT_TOLERANCES,
  FAMILIES,
  FAMILY_LABEL,
  OPEN_STATUSES,
  SEVERITIES,
  SLA_DAYS,
  BREAK_STATUSES,
  type BreakStatus,
  type Family,
} from './recon.engine';
import { dayStart, executeRun, isoDay, resolveTolerances, signoffReadiness, signoffScopeKey, todayIso } from './recon.service';
import { reconExtRoutes } from './recon.ext.routes';

/**
 * Reconciliations (SRD 5.A.17, 6.10 FR-OPS-002..005, 7.7, 11.3 `/recon/*`). Admin-portal staff only.
 * `operations.view` reads. `recon.manage` runs matching and works breaks (maker). `recon.signoff` approves or
 * rejects a resolution and signs the day off (checker; step-up MFA, never the maker). Every write audits inside its
 * transaction. Mounted at `/api/v1/recon`; auth is applied per route.
 */
export const reconRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'recon.manage')];
const canSignoff = [...staff, requirePermission('operations.view', 'recon.signoff')];

// Tolerance config, custodian feeds, evidence, queries, escalations and reopen. Mounted first so literal paths win over `/breaks/:id`.
reconRoutes.use(reconExtRoutes);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const familySchema = z.string().transform((v) => v.trim().toUpperCase().replace('-', '_')).pipe(z.enum(FAMILIES));
const id36 = z.string().trim().min(1).max(36);
const uuidLike = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------- lookups

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

async function counterpartyMap(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, { id: string; ref: string; name: string }>();
  const rows = await prisma.counterparty.findMany({ where: { id: { in: uniq } }, select: { id: true, ref: true, name: true } });
  return new Map(rows.map((c) => [c.id, c]));
}

async function portfolioMap(ids: (string | null | undefined)[]) {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map<string, { id: string; ref: string; name: string }>();
  const rows = await prisma.portfolio.findMany({ where: { id: { in: uniq } }, select: { id: true, ref: true, name: true } });
  return new Map(rows.map((p) => [p.id, p]));
}

async function resolveCounterparty(v: string | null | undefined) {
  if (!v) return null;
  const c = await prisma.counterparty.findFirst({ where: uuidLike(v) ? { id: v } : { ref: v } });
  if (!c) throw HttpError.badRequest('Validation failed', [{ path: 'counterpartyId', message: 'Unknown counterparty' }]);
  return c;
}

async function resolvePortfolio(v: string | null | undefined) {
  if (!v) return null;
  return loadPortfolio(v).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  });
}

async function assertActiveStaff(userId: string, path: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true } });
  if (!u) throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown, inactive or non-staff user' }]);
}

const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------- views

type BreakRow = Prisma.ReconBreakGetPayload<object>;
type RunRow = Prisma.ReconRunGetPayload<object>;

function ageOf(b: BreakRow) {
  const end = b.closedAt && !OPEN_STATUSES.includes(b.status as BreakStatus) ? b.closedAt.getTime() : Date.now();
  const hours = Math.max(0, Math.floor((end - b.createdAt.getTime()) / 3_600_000));
  return { ageHours: hours, ageDays: Math.floor(hours / 24) };
}

function allowedFor(b: BreakRow, req: Request) {
  const uid = req.user!.id;
  const open = (['NEW', 'ASSIGNED', 'INVESTIGATING'] as string[]).includes(b.status);
  const manage = hasPermission(req, 'recon.manage');
  const signoff = hasPermission(req, 'recon.signoff');
  const pending = b.status === 'PENDING_CHECKER';
  const isMaker = b.makerId === uid;
  return {
    assign: manage && open,
    investigate: manage && open,
    resolve: manage && open,
    approve: signoff && pending && !isMaker,
    reject: signoff && pending && !isMaker,
    reopen: signoff && (b.status === 'MATCHED' || b.status === 'CLOSED'),
    query: manage && (open || pending),
    escalate: manage && (open || pending),
    attachEvidence: manage && (open || pending),
    approveBlockedReason: signoff && pending && isMaker ? 'You resolved this break, so a different person must approve it (maker-checker).' : null,
  };
}

async function breakViews(rows: BreakRow[], req: Request, withRun = true) {
  const users = await userNames(rows.flatMap((r) => [r.ownerUserId, r.makerId, r.checkerId]));
  const cps = await counterpartyMap(rows.map((r) => r.counterpartyId));
  const pfs = await portfolioMap(rows.map((r) => r.portfolioId));
  const runs = withRun ? await prisma.reconRun.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.runId))] } }, select: { id: true, ref: true, asOfDate: true } }) : [];
  const runById = new Map(runs.map((r) => [r.id, r]));
  return rows.map((r) => {
    const age = ageOf(r);
    const open = OPEN_STATUSES.includes(r.status as BreakStatus);
    const run = runById.get(r.runId);
    return {
      id: r.id,
      ref: r.ref,
      runId: r.runId,
      runRef: run?.ref ?? null,
      asOfDate: run ? isoDay(run.asOfDate) : null,
      family: r.family,
      familyLabel: FAMILY_LABEL[r.family as Family] ?? r.family,
      itemKey: r.itemKey,
      kind: r.kind,
      label: r.label,
      internalValue: r.internalValue,
      externalValue: r.externalValue,
      difference: r.difference ? r.difference.toString() : null,
      differencePct: r.differencePct ? r.differencePct.toString() : null,
      currency: r.currency,
      cause: r.cause,
      severity: r.severity,
      status: r.status,
      ownerUserId: r.ownerUserId,
      ownerName: r.ownerUserId ? users.get(r.ownerUserId) ?? null : null,
      counterparty: r.counterpartyId ? cps.get(r.counterpartyId) ?? null : null,
      portfolio: r.portfolioId ? pfs.get(r.portfolioId) ?? null : null,
      resolutionNote: r.resolutionNote,
      evidenceRef: r.evidenceRef,
      makerId: r.makerId,
      makerName: r.makerId ? users.get(r.makerId) ?? null : null,
      checkerId: r.checkerId,
      checkerName: r.checkerId ? users.get(r.checkerId) ?? null : null,
      resolvedAt: iso(r.resolvedAt),
      closedAt: iso(r.closedAt),
      ageHours: age.ageHours,
      ageDays: age.ageDays,
      overdue: open && (r.severity === 'CRITICAL' || age.ageDays >= SLA_DAYS),
      version: r.version,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  });
}

async function runViews(rows: RunRow[]) {
  const users = await userNames(rows.map((r) => r.runBy));
  const cps = await counterpartyMap(rows.map((r) => r.counterpartyId));
  const pfs = await portfolioMap(rows.map((r) => r.portfolioId));
  const open = rows.length
    ? await prisma.reconBreak.groupBy({ by: ['runId'], where: { runId: { in: rows.map((r) => r.id) }, status: { in: OPEN_STATUSES } }, _count: { _all: true } })
    : [];
  const openBy = new Map(open.map((o) => [o.runId, o._count._all]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    family: r.family,
    familyLabel: FAMILY_LABEL[r.family as Family] ?? r.family,
    asOfDate: isoDay(r.asOfDate),
    counterparty: r.counterpartyId ? cps.get(r.counterpartyId) ?? null : null,
    portfolio: r.portfolioId ? pfs.get(r.portfolioId) ?? null : null,
    status: r.status,
    matchedCount: r.matchedCount,
    breakCount: r.breakCount,
    openBreaks: openBy.get(r.id) ?? 0,
    matchRate: r.matchedCount + r.breakCount ? Number(((r.matchedCount / (r.matchedCount + r.breakCount)) * 100).toFixed(2)) : null,
    params: r.params,
    summary: r.summary,
    runCount: r.runCount,
    runBy: r.runBy,
    runByName: users.get(r.runBy) ?? null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  }));
}

async function loadBreak(idOrRef: string): Promise<BreakRow> {
  const b = await prisma.reconBreak.findFirst({ where: uuidLike(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!b) throw HttpError.notFound('Break not found');
  return b;
}

async function loadRun(idOrRef: string): Promise<RunRow> {
  const r = await prisma.reconRun.findFirst({ where: uuidLike(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!r) throw HttpError.notFound('Run not found');
  return r;
}

// ---------------------------------------------------------------- users, account map

reconRoutes.get('/users', ...canView, async (_req, res) => {
  const rows = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true },
    take: 500,
  });
  res.json({ data: rows.map((u) => ({ id: u.id, name: u.name || u.email, email: u.email })), total: rows.length });
});

reconRoutes.get('/counterparties', ...canView, async (_req, res) => {
  const rows = await prisma.counterparty.findMany({ orderBy: { name: 'asc' } });
  res.json({ data: rows.map((c) => ({ id: c.id, ref: c.ref, name: c.name, type: c.type, status: c.status, accounts: accountRefs(c.accounts) })) });
});

reconRoutes.get('/account-map', ...canView, async (_req, res) => {
  const rows = await prisma.reconAccountMap.findMany({ orderBy: [{ counterpartyId: 'asc' }, { accountRef: 'asc' }] });
  const cps = await counterpartyMap(rows.map((r) => r.counterpartyId));
  const pfs = await portfolioMap(rows.map((r) => r.portfolioId));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      counterparty: cps.get(r.counterpartyId) ?? { id: r.counterpartyId, ref: '', name: '' },
      accountRef: r.accountRef,
      portfolio: pfs.get(r.portfolioId) ?? { id: r.portfolioId, ref: '', name: '' },
      createdAt: iso(r.createdAt),
    })),
  });
});

const mapSchema = z.object({ counterpartyId: id36, accountRef: z.string().trim().min(1).max(64), portfolioId: id36 }).strict();

reconRoutes.put('/account-map', ...canManage, validateBody(mapSchema), idempotent('recon.put.account_map', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof mapSchema>;
  const cp = await resolveCounterparty(b.counterpartyId);
  const pf = await resolvePortfolio(b.portfolioId);
  const known = accountRefs(cp!.accounts);
  if (known.length && !known.includes(b.accountRef)) {
    throw HttpError.badRequest('Validation failed', [{ path: 'accountRef', message: `Not one of ${cp!.name}'s accounts (${known.join(', ')})` }]);
  }
  const row = await prisma.$transaction(async (tx) => {
    const before = await tx.reconAccountMap.findUnique({ where: { counterpartyId_accountRef: { counterpartyId: cp!.id, accountRef: b.accountRef } } });
    const saved = await tx.reconAccountMap.upsert({
      where: { counterpartyId_accountRef: { counterpartyId: cp!.id, accountRef: b.accountRef } },
      update: { portfolioId: pf!.id },
      create: { counterpartyId: cp!.id, accountRef: b.accountRef, portfolioId: pf!.id, createdBy: req.user!.id },
    });
    await writeAudit(tx, audit(req), {
      action: 'recon.account_mapped',
      objectType: 'recon_account_map',
      objectId: saved.id,
      before: before ? { portfolioId: before.portfolioId } : null,
      after: { counterparty: cp!.ref, accountRef: b.accountRef, portfolio: pf!.ref },
    });
    return saved;
  });
  res.json({ data: { id: row.id, counterpartyId: row.counterpartyId, accountRef: row.accountRef, portfolioId: row.portfolioId } });
});

reconRoutes.delete('/account-map/:id', ...canManage, idempotent('recon.delete.account_map_id', { required: false }), async (req, res) => {
  const row = await prisma.reconAccountMap.findUnique({ where: { id: param(req, 'id') } });
  if (!row) throw HttpError.notFound('Mapping not found');
  await prisma.$transaction(async (tx) => {
    await tx.reconAccountMap.delete({ where: { id: row.id } });
    await writeAudit(tx, audit(req), { action: 'recon.account_unmapped', objectType: 'recon_account_map', objectId: row.id, before: { counterpartyId: row.counterpartyId, accountRef: row.accountRef, portfolioId: row.portfolioId } });
  });
  res.json({ data: { id: row.id, deleted: true } });
});

// ---------------------------------------------------------------- runs

const tolNum = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) <= max, `Enter a number from 0 to ${max}`);
const runSchema = z
  .object({
    family: familySchema,
    asOfDate: dateStr,
    counterpartyId: id36.nullish(),
    portfolioId: id36.nullish(),
    tolerances: z
      .object({ price: tolNum(1000).optional(), cash: tolNum(1_000_000).optional(), holdingsPct: tolNum(100).optional(), positionQty: tolNum(1_000_000_000).optional(), settleDays: z.coerce.number().int().min(0).max(30).optional(), caCash: tolNum(1_000_000).optional() })
      .strict()
      .optional(),
  })
  .strict();

reconRoutes.post('/runs', ...canManage, validateBody(runSchema), idempotent('recon.run'), async (req, res) => {
  const b = req.body as z.infer<typeof runSchema>;
  if (b.asOfDate > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'asOfDate', message: 'The date cannot be in the future' }]);
  const cp = await resolveCounterparty(b.counterpartyId);
  const pf = await resolvePortfolio(b.portfolioId);
  // Effective-dated configuration (BR-067) unless the caller overrides a value for this run.
  const eff = await resolveTolerances(b.family, cp?.id ?? null, b.asOfDate);
  const overrides = (b.tolerances ?? {}) as Record<string, unknown>;
  const sources: Record<string, string> = { ...eff.sources };
  for (const k of Object.keys(overrides)) sources[k] = 'run override';
  const result = await executeRun(req, {
    family: b.family,
    asOfDate: b.asOfDate,
    counterpartyId: cp?.id ?? null,
    portfolioId: pf?.id ?? null,
    tolerances: { ...eff.tolerances, ...(b.tolerances ?? {}) } as typeof DEFAULT_TOLERANCES,
    toleranceSources: sources,
  });
  const run = await prisma.reconRun.findUniqueOrThrow({ where: { id: result.runId } });
  const breaks = await prisma.reconBreak.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'asc' }, take: 500 });
  res.status(result.rerun ? 200 : 201).json({ data: (await runViews([run]))[0], breaks: await breakViews(breaks, req), rerun: result.rerun });
});

const runsQuery = z.object({
  family: familySchema.optional(),
  asOf: dateStr.optional(),
  counterpartyId: z.string().optional(),
  portfolioId: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

reconRoutes.get('/runs', ...canView, validateQuery(runsQuery), async (req, res) => {
  const q = query<z.infer<typeof runsQuery>>(req);
  const cp = q.counterpartyId ? await resolveCounterparty(q.counterpartyId) : null;
  const pf = q.portfolioId ? await resolvePortfolio(q.portfolioId) : null;
  const where: Prisma.ReconRunWhereInput = {
    ...(q.family ? { family: q.family } : {}),
    ...(q.asOf ? { asOfDate: dayStart(q.asOf) } : {}),
    ...(cp ? { counterpartyId: cp.id } : {}),
    ...(pf ? { portfolioId: pf.id } : {}),
    ...(q.status ? { status: { in: csv(q.status) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.reconRun.findMany({ where, orderBy: [{ asOfDate: 'desc' }, { updatedAt: 'desc' }], take: q.limit, skip: q.offset }),
    prisma.reconRun.count({ where }),
  ]);
  res.json({ data: await runViews(rows), total });
});

reconRoutes.get('/runs/:id', ...canView, async (req, res) => {
  const run = await loadRun(param(req, 'id'));
  const breaks = await prisma.reconBreak.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'asc' }, take: 500 });
  res.json({ data: (await runViews([run]))[0], breaks: await breakViews(breaks, req) });
});

// ---------------------------------------------------------------- breaks

const breaksQuery = z.object({
  family: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  ownerId: z.string().optional(),
  mine: z.enum(['1', 'true']).optional(),
  counterpartyId: z.string().optional(),
  portfolioId: z.string().optional(),
  runId: z.string().optional(),
  asOf: dateStr.optional(),
  /** Minimum age in days. */
  ageDays: z.coerce.number().int().min(0).max(3650).optional(),
  overdue: z.enum(['1', 'true']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  format: z.enum(['json', 'csv']).default('json'),
});

reconRoutes.get('/breaks', ...canView, validateQuery(breaksQuery), async (req, res) => {
  const q = query<z.infer<typeof breaksQuery>>(req);
  const families = csv(q.family).map((f) => f.toUpperCase().replace('-', '_'));
  const bad = families.find((f) => !(FAMILIES as readonly string[]).includes(f));
  if (bad) throw HttpError.badRequest('Validation failed', [{ path: 'family', message: `Unknown family ${bad}` }]);
  const sevs = csv(q.severity).map((s) => s.toUpperCase());
  if (sevs.some((s) => !(SEVERITIES as readonly string[]).includes(s))) throw HttpError.badRequest('Validation failed', [{ path: 'severity', message: 'Unknown severity' }]);
  const statuses = csv(q.status).flatMap((s) => (s.toLowerCase() === 'open' ? OPEN_STATUSES : s.toLowerCase() === 'resolved' ? ['MATCHED', 'CLOSED'] : [s.toUpperCase()]));
  if (statuses.some((s) => !(BREAK_STATUSES as readonly string[]).includes(s))) throw HttpError.badRequest('Validation failed', [{ path: 'status', message: 'Unknown status' }]);
  const cp = q.counterpartyId ? await resolveCounterparty(q.counterpartyId) : null;
  const pf = q.portfolioId ? await resolvePortfolio(q.portfolioId) : null;
  const run = q.runId ? await loadRun(q.runId) : null;
  const owner = q.mine ? req.user!.id : q.ownerId === 'me' ? req.user!.id : q.ownerId;

  const base: Prisma.ReconBreakWhereInput = {
    ...(families.length ? { family: { in: families } } : {}),
    ...(sevs.length ? { severity: { in: sevs } } : {}),
    ...(owner ? { ownerUserId: owner } : {}),
    ...(cp ? { counterpartyId: cp.id } : {}),
    ...(pf ? { portfolioId: pf.id } : {}),
    ...(run ? { runId: run.id } : {}),
    ...(q.asOf ? { run: { asOfDate: dayStart(q.asOf) } } : {}),
    ...(q.ageDays ? { createdAt: { lte: new Date(Date.now() - q.ageDays * 86_400_000) } } : {}),
    ...(q.q ? { OR: [{ ref: { contains: q.q } }, { label: { contains: q.q } }, { itemKey: { contains: q.q } }] } : {}),
  };
  const overdueCut = new Date(Date.now() - SLA_DAYS * 86_400_000);
  const overdueWhere: Prisma.ReconBreakWhereInput = { status: { in: OPEN_STATUSES }, OR: [{ severity: 'CRITICAL' }, { createdAt: { lte: overdueCut } }] };
  const where: Prisma.ReconBreakWhereInput = {
    AND: [base, statuses.length ? { status: { in: statuses } } : {}, q.overdue ? overdueWhere : {}],
  };
  const [rows, total, byStatus, bySeverity, byFamily, overdue] = await Promise.all([
    prisma.reconBreak.findMany({ where, orderBy: [{ createdAt: 'asc' }], take: q.format === 'csv' ? 5000 : q.limit, skip: q.format === 'csv' ? 0 : q.offset }),
    prisma.reconBreak.count({ where }),
    prisma.reconBreak.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.reconBreak.groupBy({ by: ['severity'], where: { AND: [base, { status: { in: OPEN_STATUSES } }] }, _count: { _all: true } }),
    prisma.reconBreak.groupBy({ by: ['family'], where: { AND: [base, { status: { in: OPEN_STATUSES } }] }, _count: { _all: true } }),
    prisma.reconBreak.count({ where: { AND: [base, overdueWhere] } }),
  ]);
  const count = <K extends string>(rowsIn: ({ _count: { _all: number } } & Record<K, string>)[], key: K) => Object.fromEntries(rowsIn.map((r) => [r[key], r._count._all]));
  if (q.format === 'csv') {
    const views = await breakViews(rows, req);
    // Cells that start with a formula character are prefixed so a spreadsheet never evaluates them.
    const esc = (v: unknown) => {
      const t = String(v ?? '');
      return '"' + (/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""') + '"';
    };
    const head = ['ref', 'run', 'as_of', 'family', 'kind', 'severity', 'status', 'counterparty', 'portfolio', 'currency', 'difference', 'difference_pct', 'owner', 'cause', 'age_days', 'overdue', 'evidence_ref', 'label'];
    const lines = views.map((v) => [v.ref, v.runRef, v.asOfDate, v.familyLabel, v.kind, v.severity, v.status, v.counterparty?.name, v.portfolio?.ref, v.currency, v.difference, v.differencePct, v.ownerName, v.cause, v.ageDays, v.overdue ? 'yes' : 'no', v.evidenceRef, v.label].map(esc).join(','));
    await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'recon.breaks_exported', objectType: 'recon_break', objectId: 'export', after: { rows: views.length, filters: { family: q.family ?? null, status: q.status ?? null, severity: q.severity ?? null, asOf: q.asOf ?? null } } }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="recon-breaks.csv"');
    res.send([head.join(','), ...lines].join('\n'));
    return;
  }
  const sevCounts = count(bySeverity, 'severity') as Record<string, number>;
  const stCounts = count(byStatus, 'status') as Record<string, number>;
  res.json({
    data: await breakViews(rows, req),
    total,
    summary: {
      open: OPEN_STATUSES.reduce((n, s) => n + (stCounts[s] ?? 0), 0),
      overdue,
      byStatus: stCounts,
      openBySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, sevCounts[s] ?? 0])),
      openByFamily: count(byFamily, 'family'),
    },
  });
});

reconRoutes.get('/breaks/:id', ...canView, async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  const events = await prisma.reconBreakEvent.findMany({ where: { breakId: b.id }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(events.map((e) => e.actorId));
  const [view] = await breakViews([b], req);
  res.json({
    data: view,
    allowed: allowedFor(b, req),
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      actorName: e.actorId ? names.get(e.actorId) ?? null : null,
      note: e.note,
      detail: e.detail,
      at: iso(e.createdAt),
    })),
  });
});

/** State- and version-guarded transition with an event and audit entry in one transaction. */
async function transition(
  req: Request,
  b: BreakRow,
  to: BreakStatus,
  opts: { action: string; note?: string | null; data?: Prisma.ReconBreakUncheckedUpdateManyInput; after?: object; notify?: (tx: Prisma.TransactionClient) => Promise<void> },
) {
  await prisma.$transaction(async (tx) => {
    const n = await tx.reconBreak.updateMany({ where: { id: b.id, version: b.version, status: b.status }, data: { ...(opts.data ?? {}), status: to, version: { increment: 1 } } });
    assertUpdated(n.count);
    await tx.reconBreakEvent.create({ data: { breakId: b.id, action: opts.action, fromStatus: b.status, toStatus: to, actorId: req.user!.id, note: opts.note ?? null } });
    await writeAudit(tx, audit(req), {
      action: `recon.break_${opts.action}`,
      objectType: 'recon_break',
      objectId: b.id,
      before: { status: b.status, ref: b.ref },
      after: { status: to, ref: b.ref, family: b.family, severity: b.severity, ...(opts.after ?? {}) },
      reason: opts.note ?? null,
    });
    if (opts.notify) await opts.notify(tx);
  });
}

async function reply(req: Request, res: Response, id: string) {
  const b = await loadBreak(id);
  const events = await prisma.reconBreakEvent.findMany({ where: { breakId: b.id }, orderBy: { createdAt: 'asc' } });
  const names = await userNames(events.map((e) => e.actorId));
  const [view] = await breakViews([b], req);
  res.json({
    data: view,
    allowed: allowedFor(b, req),
    events: events.map((e) => ({ id: e.id, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus, actorId: e.actorId, actorName: e.actorId ? names.get(e.actorId) ?? null : null, note: e.note, detail: e.detail, at: iso(e.createdAt) })),
  });
}

const noteField = z.string().trim().min(3, 'Add a short note').max(2000);
const assignSchema = z.object({ ownerUserId: id36, note: noteField.optional(), version: z.number().int().optional() }).strict();
const investigateSchema = z.object({ note: noteField, version: z.number().int().optional() }).strict();
const resolveSchema = z
  .object({
    cause: z.enum(CAUSES),
    rationale: z.string().trim().min(10, 'Explain the resolution in at least 10 characters').max(2000),
    /** A reference, or attach at least one evidence file to the break first. */
    evidenceRef: z.string().trim().min(3, 'An evidence reference is required').max(255).optional(),
    version: z.number().int().optional(),
  })
  .strict();
const approveSchema = z.object({ note: z.string().trim().max(2000).optional(), version: z.number().int().optional() }).strict();
const rejectSchema = z.object({ reason: noteField, version: z.number().int().optional() }).strict();

function assertOpen(b: BreakRow, what: string) {
  if (!(['NEW', 'ASSIGNED', 'INVESTIGATING'] as string[]).includes(b.status)) {
    throw HttpError.conflict(`Break ${b.ref} is ${b.status}; it cannot be ${what}`, 'invalid_transition');
  }
}

reconRoutes.post('/breaks/:id/assign', ...canManage, validateBody(assignSchema), idempotent('recon.post.breaks_id_assign', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  assertOpen(b, 'assigned');
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof assignSchema>;
  await assertActiveStaff(body.ownerUserId, 'ownerUserId');
  await transition(req, b, b.status === 'NEW' ? 'ASSIGNED' : (b.status as BreakStatus), {
    action: 'assigned',
    note: body.note ?? null,
    data: { ownerUserId: body.ownerUserId },
    after: { ownerUserId: body.ownerUserId },
    notify: async (tx) => {
      if (body.ownerUserId !== req.user!.id) {
        await enqueue(tx, 'notify.users', { userIds: [body.ownerUserId], type: 'recon.break_assigned', title: `Reconciliation break ${b.ref} assigned to you`, body: b.label, link: `/ops/reconciliation?break=${b.id}` });
      }
    },
  });
  await reply(req, res, b.id);
});

reconRoutes.post('/breaks/:id/investigate', ...canManage, validateBody(investigateSchema), idempotent('recon.post.breaks_id_investigate', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  assertOpen(b, 'investigated');
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof investigateSchema>;
  await transition(req, b, 'INVESTIGATING', { action: 'investigating', note: body.note, data: b.ownerUserId ? {} : { ownerUserId: req.user!.id } });
  await reply(req, res, b.id);
});

reconRoutes.post('/breaks/:id/resolve', ...canManage, validateBody(resolveSchema), idempotent('recon.post.breaks_id_resolve', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  assertOpen(b, 'resolved');
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof resolveSchema>;
  const files = await prisma.reconBreakEvidence.findMany({ where: { breakId: b.id }, select: { name: true } });
  if (!body.evidenceRef && !files.length) throw HttpError.badRequest('Validation failed', [{ path: 'evidenceRef', message: 'Give an evidence reference or attach an evidence file first' }]);
  const evidenceRef = body.evidenceRef ?? `${files.length} attached file${files.length === 1 ? '' : 's'}: ${files.map((f) => f.name).join(', ')}`.slice(0, 255);
  await transition(req, b, 'PENDING_CHECKER', {
    action: 'resolved',
    note: body.rationale,
    data: { cause: body.cause, resolutionNote: body.rationale, evidenceRef, makerId: req.user!.id, resolvedAt: new Date(), checkerId: null },
    after: { cause: body.cause, evidenceRef, evidenceFiles: files.length },
    notify: async (tx) => {
      await enqueue(tx, 'notify.permission', { permission: 'recon.signoff', type: 'recon.break_pending_checker', title: `Break ${b.ref} is ready for your approval`, body: b.label, link: `/ops/reconciliation?break=${b.id}` });
    },
  });
  await reply(req, res, b.id);
});

reconRoutes.post('/breaks/:id/approve', ...canSignoff, requireStepUp, validateBody(approveSchema), idempotent('recon.post.breaks_id_approve', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (b.status !== 'PENDING_CHECKER') throw HttpError.conflict(`Break ${b.ref} is ${b.status}; only a break pending the checker can be approved`, 'invalid_transition');
  assertSegregation(req.user!.id, b.makerId);
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof approveSchema>;
  await transition(req, b, 'CLOSED', {
    action: 'approved',
    note: body.note ?? null,
    data: { checkerId: req.user!.id, closedAt: new Date() },
    after: { makerId: b.makerId, checkerId: req.user!.id },
    notify: async (tx) => {
      if (b.makerId) await enqueue(tx, 'notify.users', { userIds: [b.makerId], type: 'recon.break_closed', title: `Break ${b.ref} was approved and closed`, link: `/ops/reconciliation?break=${b.id}` });
    },
  });
  await reply(req, res, b.id);
});

reconRoutes.post('/breaks/:id/reject', ...canSignoff, validateBody(rejectSchema), idempotent('recon.post.breaks_id_reject', { required: false }), async (req, res) => {
  const b = await loadBreak(param(req, 'id'));
  if (b.status !== 'PENDING_CHECKER') throw HttpError.conflict(`Break ${b.ref} is ${b.status}; only a break pending the checker can be returned`, 'invalid_transition');
  assertSegregation(req.user!.id, b.makerId);
  expectVersion(req, b.version);
  const body = req.body as z.infer<typeof rejectSchema>;
  await transition(req, b, 'INVESTIGATING', {
    action: 'rejected',
    note: body.reason,
    data: { checkerId: null, resolvedAt: null },
    after: { returnedTo: b.makerId },
    notify: async (tx) => {
      if (b.makerId) await enqueue(tx, 'notify.users', { userIds: [b.makerId], type: 'recon.break_returned', title: `Break ${b.ref} was returned to you`, body: body.reason, link: `/ops/reconciliation?break=${b.id}` });
    },
  });
  await reply(req, res, b.id);
});

// ---------------------------------------------------------------- sources

const asOfQuery = z.object({ asOf: dateStr.optional() });

reconRoutes.get('/sources', ...canView, validateQuery(asOfQuery), async (req, res) => {
  const date = query<z.infer<typeof asOfQuery>>(req).asOf ?? todayIso();
  const [cps, maps] = await Promise.all([prisma.counterparty.findMany({ orderBy: { name: 'asc' } }), prisma.reconAccountMap.findMany()]);
  const pfs = await portfolioMap(maps.map((m) => m.portfolioId));
  const start = dayStart(date);
  const end = new Date(start.getTime() + 86_400_000);
  const data = [];
  for (const c of cps) {
    const mapByAccount = new Map(maps.filter((m) => m.counterpartyId === c.id).map((m) => [m.accountRef, m]));
    const refs = [...new Set([...accountRefs(c.accounts), ...mapByAccount.keys()])];
    const last = await prisma.counterpartyDayEndPackage.findFirst({ where: { counterpartyId: c.id, status: { not: 'Superseded' } }, orderBy: [{ statementDate: 'desc' }, { submittedAt: 'desc' }] });
    const execs = await prisma.counterpartyExecution.groupBy({
      by: ['accountRef'],
      where: { counterpartyId: c.id, executionAt: { gte: start, lt: end }, status: { not: 'Superseded' } },
      _count: { _all: true },
    });
    const execBy = new Map(execs.map((e) => [e.accountRef, e._count._all]));
    const accounts = [];
    for (const a of refs) {
      const pkg = await prisma.counterpartyDayEndPackage.findFirst({ where: { counterpartyId: c.id, accountRef: a, statementDate: start, status: { not: 'Superseded' } }, orderBy: { submittedAt: 'desc' } });
      const m = mapByAccount.get(a);
      accounts.push({
        accountRef: a,
        portfolio: m ? pfs.get(m.portfolioId) ?? null : null,
        mapped: !!m,
        dayEndReceived: !!pkg,
        dayEnd: pkg ? { ref: pkg.ref, status: pkg.status, tradeCount: pkg.tradeCount, receivedAt: iso(pkg.submittedAt), sha256: pkg.sha256 } : null,
        executions: execBy.get(a) ?? 0,
      });
    }
    data.push({
      counterpartyId: c.id,
      ref: c.ref,
      name: c.name,
      type: c.type,
      status: c.status,
      asOfDate: date,
      lastDayEnd: last ? { ref: last.ref, statementDate: isoDay(last.statementDate), receivedAt: iso(last.submittedAt), status: last.status } : null,
      executionsToday: accounts.reduce((n, a) => n + a.executions, 0),
      missingSource: c.status === 'ACTIVE' && accounts.some((a) => !a.dayEndReceived),
      unmappedAccounts: accounts.filter((a) => !a.mapped).map((a) => a.accountRef),
      accounts,
    });
  }
  res.json({ data, asOfDate: date });
});

// ---------------------------------------------------------------- overview

reconRoutes.get('/overview', ...canView, validateQuery(asOfQuery), async (req, res) => {
  const requested = query<z.infer<typeof asOfQuery>>(req).asOf;
  const latest = requested ? null : await prisma.reconRun.findFirst({ orderBy: { asOfDate: 'desc' }, select: { asOfDate: true } });
  const date = requested ?? (latest ? isoDay(latest.asOfDate) : todayIso());
  const runs = await prisma.reconRun.findMany({ where: { asOfDate: dayStart(date) } });
  const signoffs = await prisma.reconSignoff.findMany({ where: { asOfDate: dayStart(date) } });
  const openRows = await prisma.reconBreak.groupBy({ by: ['family', 'severity'], where: { status: { in: OPEN_STATUSES } }, _count: { _all: true } });
  const overdue = await prisma.reconBreak.count({
    where: { status: { in: OPEN_STATUSES }, OR: [{ severity: 'CRITICAL' }, { createdAt: { lte: new Date(Date.now() - SLA_DAYS * 86_400_000) } }] },
  });
  const openBySeverity: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const r of openRows) openBySeverity[r.severity] = (openBySeverity[r.severity] ?? 0) + r._count._all;
  const families = FAMILIES.map((f) => {
    const fr = runs.filter((r) => r.family === f);
    const matched = fr.reduce((n, r) => n + r.matchedCount, 0);
    const breaks = fr.reduce((n, r) => n + r.breakCount, 0);
    return {
      family: f,
      label: FAMILY_LABEL[f],
      runs: fr.length,
      matched,
      breaks,
      matchRate: matched + breaks ? Number(((matched / (matched + breaks)) * 100).toFixed(2)) : null,
      openBreaks: openRows.filter((r) => r.family === f).reduce((n, r) => n + r._count._all, 0),
      signedOff: signoffs.some((s) => s.family === f),
      sourceMissing: fr.some((r) => r.status === 'SOURCE_MISSING'),
    };
  });
  res.json({ data: { asOfDate: date, families, openBySeverity, openTotal: Object.values(openBySeverity).reduce((a, b) => a + b, 0), overdue } });
});

// ---------------------------------------------------------------- sign-offs

const signoffBody = z.object({ family: familySchema, asOfDate: dateStr, counterpartyId: id36.nullish(), note: z.string().trim().max(1000).optional() }).strict();
const readinessQuery = z.object({ family: familySchema, asOf: dateStr, counterpartyId: z.string().optional() });

async function readinessView(r: Awaited<ReturnType<typeof signoffReadiness>>) {
  const names = await userNames([...r.runs.map((x) => x.runBy), r.signedOff?.signedBy]);
  return {
    family: r.family,
    asOfDate: r.asOfDate,
    counterpartyId: r.counterpartyId,
    runs: r.runs.map((x) => ({ id: x.id, ref: x.ref, status: x.status, runByName: names.get(x.runBy) ?? null })),
    openMaterial: r.openMaterial,
    openOther: r.openOther,
    missingSources: r.missingSources,
    signedOff: r.signedOff ? { id: r.signedOff.id, signedByName: names.get(r.signedOff.signedBy) ?? null, signedAt: iso(r.signedOff.signedAt) } : null,
    ready: r.ready,
    reasons: r.reasons,
  };
}

reconRoutes.get('/signoffs/readiness', ...canView, validateQuery(readinessQuery), async (req, res) => {
  const q = query<z.infer<typeof readinessQuery>>(req);
  const cp = q.counterpartyId ? await resolveCounterparty(q.counterpartyId) : null;
  const r = await signoffReadiness(q.family, q.asOf, cp?.id ?? null);
  const view = await readinessView(r);
  const uid = req.user!.id;
  res.json({
    data: {
      ...view,
      canSign: hasPermission(req, 'recon.signoff') && r.ready && !r.runs.some((x) => x.runBy === uid) && !r.makerIds.includes(uid),
      independent: !r.runs.some((x) => x.runBy === uid) && !r.makerIds.includes(uid),
    },
  });
});

reconRoutes.post('/signoffs', ...canSignoff, requireStepUp, validateBody(signoffBody), idempotent('recon.post.signoffs', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof signoffBody>;
  if (b.asOfDate > todayIso()) throw HttpError.badRequest('Validation failed', [{ path: 'asOfDate', message: 'The date cannot be in the future' }]);
  const cp = await resolveCounterparty(b.counterpartyId);
  const r = await signoffReadiness(b.family, b.asOfDate, cp?.id ?? null);
  if (r.signedOff) throw HttpError.conflict('This family and date is already signed off', 'already_signed_off');
  if (!r.runs.length) throw HttpError.conflict('Run matching for this family and date before signing off', 'no_run');
  if (r.openMaterial.length) {
    throw new HttpError(409, 'open_material_breaks', `${r.openMaterial.length} Critical or High break(s) must be closed before sign-off`, { breaks: r.openMaterial.map((x) => ({ ref: x.ref, severity: x.severity, status: x.status })) });
  }
  if (r.missingSources.length) throw new HttpError(409, 'source_missing', 'A scheduled counterparty source is missing for this date', { sources: r.missingSources });
  assertSegregation(req.user!.id, ...r.runs.map((x) => x.runBy), ...r.makerIds);
  const summary = { runs: r.runs.map((x) => x.ref), openOther: r.openOther };
  try {
    const row = await prisma.$transaction(async (tx) => {
      const s = await tx.reconSignoff.create({
        data: { scopeKey: signoffScopeKey(b.family, b.asOfDate, cp?.id ?? null), family: b.family, asOfDate: dayStart(b.asOfDate), counterpartyId: cp?.id ?? null, signedBy: req.user!.id, note: b.note ?? null, summary },
      });
      await writeAudit(tx, audit(req), {
        action: 'recon.signoff_recorded',
        objectType: 'recon_signoff',
        objectId: s.id,
        after: { family: b.family, asOfDate: b.asOfDate, counterpartyId: cp?.id ?? null, ...summary },
        reason: b.note ?? null,
      });
      return s;
    });
    res.status(201).json({ data: { id: row.id, family: row.family, asOfDate: b.asOfDate, counterpartyId: row.counterpartyId, signedBy: row.signedBy, signedAt: iso(row.signedAt), note: row.note, summary } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw HttpError.conflict('This family and date is already signed off', 'already_signed_off');
    throw err;
  }
});

const signoffsQuery = z.object({ family: familySchema.optional(), from: dateStr.optional(), to: dateStr.optional(), counterpartyId: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

reconRoutes.get('/signoffs', ...canView, validateQuery(signoffsQuery), async (req, res) => {
  const q = query<z.infer<typeof signoffsQuery>>(req);
  const cp = q.counterpartyId ? await resolveCounterparty(q.counterpartyId) : null;
  const pg = sqlPage(req, q.limit);
  const soWhere: Prisma.ReconSignoffWhereInput = {
    ...(q.family ? { family: q.family } : {}),
    ...(cp ? { counterpartyId: cp.id } : {}),
    ...(q.from || q.to ? { asOfDate: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lte: dayStart(q.to) } : {}) } } : {}),
  };
  const soTotal = await prisma.reconSignoff.count({ where: soWhere });
  const rows = await prisma.reconSignoff.findMany({
    where: soWhere,
    orderBy: [{ asOfDate: 'desc' }, { signedAt: 'desc' }, { id: 'asc' }],
    skip: pg.skip,
    take: pg.take,
  });
  const names = await userNames(rows.map((r) => r.signedBy));
  const cps = await counterpartyMap(rows.map((r) => r.counterpartyId));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      family: r.family,
      familyLabel: FAMILY_LABEL[r.family as Family] ?? r.family,
      asOfDate: isoDay(r.asOfDate),
      counterparty: r.counterpartyId ? cps.get(r.counterpartyId) ?? null : null,
      signedBy: r.signedBy,
      signedByName: names.get(r.signedBy) ?? null,
      signedAt: iso(r.signedAt),
      note: r.note,
      summary: r.summary,
    })),
    page: pg.page,
    pageSize: pg.pageSize,
    total: soTotal,
  });
});

