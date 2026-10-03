import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { postNavJournals } from '../wiring/autojournals';
import { ensureTask } from '../wiring/tasks';
import { stageFor } from './nav.engine';
import {
  EDITABLE,
  REPLACEABLE,
  allowedActions,
  createVersion,
  isoDay,
  loadRun,
  openCounts,
  recomputeTotals,
  runDetail,
  runViews,
  startOfDay,
  type RunRow,
} from './nav.service';

/**
 * NAV & Valuation (SRD 11.3 `/nav/*`, 5.A.18, 6.11 FR-VAL-001..005, 7.8). Admin-portal staff only; auth per route.
 * `valuation.view` reads and prepares (create, recalculate, edit inputs, resolve exceptions, maker review);
 * `valuation.release` + step-up MFA releases, and the releaser must differ from the maker reviewer (BR-001).
 * A released run is immutable and updates the linked fund (NAV per unit, NAV date, valuation status FINAL).
 * Mounted at `/api/v1/nav`.
 */
export const navRoutes = Router();

const D = Prisma.Decimal;
const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('valuation.view')];
const canRelease = [...staff, requirePermission('valuation.view'), requirePermission('valuation.release')];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => startOfDay(new Date());
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const amount = (max = 4) =>
  z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => new RegExp(`^\\d+(\\.\\d{1,${max}})?$`).test(v), `Enter a non-negative amount (up to ${max} decimals)`)
    .transform((v) => new D(v));

const inputFields = {
  accruals: amount(4),
  fees: amount(4),
  liabilities: amount(4),
  feeRatePct: amount(4).refine((v) => v.lte(100), 'Fee rate is a percent per year, 0 to 100').nullable(),
  units: amount(6).refine((v) => v.gt(0), 'Units must be above zero').nullable(),
  notes: z.string().trim().max(2000).nullable(),
};

const createSchema = z
  .object({ portfolioId: z.string().trim().min(1).max(36), navDate: dateStr })
  .extend(Object.fromEntries(Object.entries(inputFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof inputFields]: z.ZodOptional<(typeof inputFields)[K]> })
  .strict();

const patchSchema = z
  .object(inputFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
  .refine((b) => !(b.fees !== undefined && b.feeRatePct), 'Set either fees or a fee rate, not both');

const resolveSchema = z.object({ resolution: z.string().trim().min(5, 'Give a rationale (5+ characters)').max(1000), evidenceRef: z.string().trim().max(200).nullable().optional() }).strict();

const listQuery = z.object({
  portfolioId: z.string().trim().max(36).optional(),
  fundId: z.string().trim().max(36).optional(),
  status: z.string().trim().max(120).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

async function resolvePortfolioId(v: string): Promise<string> {
  return (await loadPortfolio(v).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  })).id;
}

function assertNotImmutable(r: RunRow, action: string) {
  if (r.status === 'RELEASED' || r.status === 'SUPERSEDED') {
    throw new HttpError(409, 'run_immutable', `${r.ref} is ${r.status} and cannot be ${action}. Create a new NAV run for the date instead.`);
  }
}

async function respond(res: import('express').Response, req: import('express').Request, id: string, status = 200) {
  res.status(status).json({ data: await runDetail(await loadRun(id), req.user!) });
}

// ================================================================ list and read

navRoutes.get('/runs', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const where: Prisma.NavRunWhereInput = {};
  if (f.portfolioId) where.portfolioId = UUID.test(f.portfolioId) ? f.portfolioId : ((await prisma.portfolio.findUnique({ where: { ref: f.portfolioId }, select: { id: true } }))?.id ?? '0');
  if (f.fundId) where.fundId = UUID.test(f.fundId) ? f.fundId : ((await prisma.fund.findUnique({ where: { ref: f.fundId }, select: { id: true } }))?.id ?? '0');
  if (f.status) where.status = { in: f.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) };
  if (f.from || f.to) where.navDate = { ...(f.from ? { gte: toDate(f.from) } : {}), ...(f.to ? { lte: toDate(f.to) } : {}) };
  if (f.q) where.ref = { contains: f.q.toUpperCase() };
  const [total, rows, grouped] = await Promise.all([
    prisma.navRun.count({ where }),
    prisma.navRun.findMany({ where, orderBy: [{ navDate: 'desc' }, { createdAt: 'desc' }], take: f.limit, skip: f.offset }),
    prisma.navRun.groupBy({ by: ['status'], where, _count: { _all: true } }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  res.json({ data: await runViews(rows), total, summary: { byStatus, awaitingRelease: byStatus.MAKER_REVIEWED ?? 0, openExceptions: byStatus.EXCEPTIONS_OPEN ?? 0, released: byStatus.RELEASED ?? 0 } });
});

navRoutes.get('/runs/:id', ...canView, async (req, res) => {
  await respond(res, req, param(req, 'id'));
});

/** JSON summary suitable for a printable preview of the run (FR-VAL pack). */
navRoutes.get('/runs/:id/pack', ...canView, async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  const d = await runDetail(r, req.user!);
  const fund = r.fundId ? await prisma.fund.findUnique({ where: { id: r.fundId } }) : null;
  const priced = d.lines.filter((l) => l.valueBase);
  res.json({
    data: {
      generatedAt: new Date().toISOString(),
      draft: r.status !== 'RELEASED',
      title: `NAV pack ${d.ref} v${d.version}`,
      ref: d.ref,
      version: d.version,
      status: d.status,
      navDate: d.navDate,
      baseCurrency: d.baseCurrency,
      portfolio: { id: d.portfolioId, ref: d.portfolioRef, name: d.portfolioName },
      fund: d.fundId ? { id: d.fundId, ref: d.fundRef, name: d.fundName, currentNavPerUnit: fund?.navPerUnit?.toFixed(4) ?? null, currentAsOfDate: isoDay(fund?.asOfDate), currentStatus: fund?.valuationStatus ?? null } : null,
      kpis: { nav: d.nav, navPerUnit: d.navPerUnit, units: d.units, priceCoverage: d.priceCoverage, positionCount: d.positionCount },
      bridge: d.bridge,
      topPositions: priced.slice(0, 10).map((l) => ({ ticker: l.ticker, name: l.name, quantity: l.quantity, price: l.price, priceDate: l.priceDate, priceSource: l.priceSource, valueBase: l.valueBase })),
      exceptions: { open: d.openExceptions, material: d.openMaterialExceptions, total: d.totalExceptions, items: d.exceptions.map((e) => ({ type: e.type, ticker: e.ticker, detail: e.detail, material: e.material, status: e.status, resolution: e.resolution, evidenceRef: e.evidenceRef })) },
      approvals: {
        preparedBy: d.makerName,
        preparedAt: d.createdAt,
        reviewedBy: d.reviewerName,
        reviewedAt: d.reviewedAt,
        releasedBy: d.checkerName,
        releasedAt: d.releasedAt,
      },
      notes: d.notes,
      settings: d.settings,
    },
  });
});

// ================================================================ create / recalculate

navRoutes.post('/runs', ...canView, validateBody(createSchema), idempotent('nav.create'), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const navDate = toDate(b.navDate);
  if (navDate.getTime() > today().getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'navDate', message: 'The NAV date cannot be in the future' }]);
  if (b.fees !== undefined && b.feeRatePct) throw HttpError.badRequest('Validation failed', [{ path: 'fees', message: 'Set either fees or a fee rate, not both' }]);
  const portfolioId = await resolvePortfolioId(b.portfolioId);
  const { portfolioId: _p, navDate: _d, ...inputs } = b;
  void _p;
  void _d;
  const run = await createVersion(req, { portfolioId, navDate, inputs, action: 'nav.run_created' });
  await respond(res, req, run.id, 201);
});

navRoutes.post('/runs/:id/recalculate', ...canView, idempotent('nav.recalculate', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  assertNotImmutable(r, 'recalculated');
  const run = await createVersion(req, { portfolioId: r.portfolioId, navDate: r.navDate, inputs: {}, from: r, action: 'nav.run_recalculated' });
  await respond(res, req, run.id, 201);
});

// ================================================================ inputs and exceptions

navRoutes.patch('/runs/:id/inputs', ...canView, validateBody(patchSchema), idempotent('nav.patch.runs_id_inputs', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  assertNotImmutable(r, 'edited');
  if (!(EDITABLE as readonly string[]).includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}; inputs can only be edited in DRAFT or EXCEPTIONS_OPEN`, 'run_not_editable');
  const b = req.body as z.infer<typeof patchSchema>;
  const t = recomputeTotals(r, {
    accruals: b.accruals,
    // a manual fee switches the fee rate off; a rate recomputes the fee
    fees: b.fees,
    liabilities: b.liabilities,
    feeRatePct: b.feeRatePct !== undefined ? b.feeRatePct : b.fees !== undefined ? null : undefined,
    units: b.units,
  });
  const counts = await openCounts(r.id);
  const open = await prisma.navException.findMany({ where: { runId: r.id, status: 'OPEN' }, select: { type: true } });
  const priceOpen = open.filter((e) => e.type !== 'NEGATIVE_CASH').length;
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (
        await tx.navRun.updateMany({
          where: { id: r.id, status: r.status },
          data: {
            accruals: t.accruals,
            fees: t.fees,
            liabilities: t.liabilities,
            feeRatePct: t.feeRatePct,
            units: t.units,
            nav: t.nav,
            navPerUnit: t.navPerUnit,
            ...(b.notes !== undefined ? { notes: b.notes } : {}),
            stage: stageFor({ status: r.status, openPriceExceptions: priceOpen, openCashExceptions: counts.open - priceOpen, inputsTouched: true, units: t.units }),
            detail: { ...((r.detail as object | null) ?? {}), inputsTouched: true } as Prisma.InputJsonValue,
          },
        })
      ).count,
    );
    await writeAudit(tx, audit(req), {
      action: 'nav.inputs_updated',
      objectType: 'nav_run',
      objectId: r.id,
      before: { accruals: r.accruals.toFixed(2), fees: r.fees.toFixed(2), liabilities: r.liabilities.toFixed(2), feeRatePct: r.feeRatePct?.toFixed(4) ?? null, units: r.units?.toFixed(6) ?? null, nav: r.nav.toFixed(2), navPerUnit: r.navPerUnit?.toFixed(4) ?? null },
      after: { accruals: t.accruals.toFixed(2), fees: t.fees.toFixed(2), liabilities: t.liabilities.toFixed(2), feeRatePct: t.feeRatePct?.toFixed(4) ?? null, units: t.units?.toFixed(6) ?? null, nav: t.nav.toFixed(2), navPerUnit: t.navPerUnit?.toFixed(4) ?? null },
    });
  });
  await respond(res, req, r.id);
});

navRoutes.patch('/runs/:id/exceptions/:exId', ...canView, validateBody(resolveSchema), idempotent('nav.patch.runs_id_exceptions_exid', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  assertNotImmutable(r, 'changed');
  if (!(EDITABLE as readonly string[]).includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}; exceptions can only be resolved in DRAFT or EXCEPTIONS_OPEN`, 'run_not_editable');
  const ex = await prisma.navException.findFirst({ where: { id: param(req, 'exId'), runId: r.id } });
  if (!ex) throw HttpError.notFound('Exception not found');
  if (ex.status !== 'OPEN') throw HttpError.conflict('This exception is already resolved', 'already_resolved');
  const b = req.body as z.infer<typeof resolveSchema>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.navException.updateMany({ where: { id: ex.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolution: b.resolution, evidenceRef: b.evidenceRef ?? null, resolvedBy: req.user!.id, resolvedAt: new Date() } })).count);
    const open = await tx.navException.findMany({ where: { runId: r.id, status: 'OPEN' }, select: { type: true } });
    const priceOpen = open.filter((e) => e.type !== 'NEGATIVE_CASH').length;
    const detail = (r.detail ?? {}) as { inputsTouched?: boolean };
    const status = open.length ? 'EXCEPTIONS_OPEN' : 'DRAFT';
    await tx.navRun.update({ where: { id: r.id }, data: { status, stage: stageFor({ status, openPriceExceptions: priceOpen, openCashExceptions: open.length - priceOpen, inputsTouched: !!detail.inputsTouched, units: r.units }) } });
    await writeAudit(tx, audit(req), {
      action: 'nav.exception_resolved',
      objectType: 'nav_run',
      objectId: r.id,
      before: { exceptionId: ex.id, status: 'OPEN' },
      after: { exceptionId: ex.id, type: ex.type, ticker: ex.ticker, material: ex.material, status: 'RESOLVED', evidenceRef: b.evidenceRef ?? null, runStatus: status },
      reason: b.resolution,
    });
  });
  await respond(res, req, r.id);
});

// ================================================================ maker review and release

navRoutes.post('/runs/:id/maker-review', ...canView, idempotent('nav.maker_review', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  assertNotImmutable(r, 'reviewed');
  if (!(EDITABLE as readonly string[]).includes(r.status)) throw HttpError.conflict(`${r.ref} is ${r.status}; it must be DRAFT or EXCEPTIONS_OPEN for maker review`, 'invalid_state');
  const counts = await openCounts(r.id);
  if (counts.material > 0) throw HttpError.conflict(`${counts.material} material exception${counts.material === 1 ? ' is' : 's are'} still open. Resolve them before maker review.`, 'material_exceptions_open');
  if (r.fundId && !(r.units && r.units.gt(0))) throw HttpError.conflict('Enter the fund units before maker review', 'units_required');
  await prisma.$transaction(async (tx) => {
    assertUpdated(
      (await tx.navRun.updateMany({ where: { id: r.id, status: r.status }, data: { status: 'MAKER_REVIEWED', stage: 'RELEASE', reviewerId: req.user!.id, reviewedAt: new Date() } })).count,
    );
    await writeAudit(tx, audit(req), {
      action: 'nav.maker_reviewed',
      objectType: 'nav_run',
      objectId: r.id,
      before: { status: r.status },
      after: { status: 'MAKER_REVIEWED', reviewerId: req.user!.id, nav: r.nav.toFixed(2), navPerUnit: r.navPerUnit?.toFixed(4) ?? null, openNonMaterialExceptions: counts.open },
    });
    await notifyPermission(tx, 'valuation.release', {
      type: 'nav.ready_for_release',
      title: `NAV ${r.ref} is ready for release`,
      body: `${isoDay(r.navDate)} NAV ${r.nav.toFixed(2)} ${r.baseCurrency}, maker review done.`,
      link: `/ops/nav/${r.id}`,
    });
  });
  await respond(res, req, r.id);
});

navRoutes.post('/runs/:id/release', ...canRelease, requireStepUp, idempotent('nav.release', { required: false }), async (req, res) => {
  const r = await loadRun(param(req, 'id'));
  assertNotImmutable(r, 'released again');
  if (r.status !== 'MAKER_REVIEWED') throw HttpError.conflict(`${r.ref} is ${r.status}; it must be MAKER_REVIEWED to release`, 'invalid_state');
  if (r.reviewerId === req.user!.id) throw HttpError.forbidden('The maker reviewer cannot release the same NAV (maker-checker)', 'segregation_of_duties');
  if (r.fundId && !r.navPerUnit) throw HttpError.conflict('The fund NAV needs units; enter them and review again', 'units_required');
  const counts = await openCounts(r.id);
  if (counts.material > 0) throw HttpError.conflict('A material exception is open', 'material_exceptions_open');

  const out = await prisma.$transaction(async (tx) => {
    assertUpdated(
      (await tx.navRun.updateMany({ where: { id: r.id, status: 'MAKER_REVIEWED' }, data: { status: 'RELEASED', stage: 'DONE', checkerId: req.user!.id, releasedAt: new Date() } })).count,
    );
    // the previous released version for the same portfolio and date is superseded
    const prior = await tx.navRun.findMany({ where: { portfolioId: r.portfolioId, navDate: r.navDate, status: 'RELEASED', id: { not: r.id } } });
    const supersededRuns: { ref: string; fees: Prisma.Decimal; accruals: Prisma.Decimal }[] = [];
    for (const old of prior) {
      supersededRuns.push({ ref: old.ref, fees: old.fees, accruals: old.accruals });
      await tx.navRun.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } });
      await writeAudit(tx, audit(req), { action: 'nav.run_superseded', objectType: 'nav_run', objectId: old.id, before: { status: 'RELEASED' }, after: { status: 'SUPERSEDED', supersededBy: r.ref } });
    }

    let fundAfter: Record<string, unknown> | null = null;
    let fundBefore: Record<string, unknown> | null = null;
    if (r.fundId && r.navPerUnit) {
      const fund = await tx.fund.findUnique({ where: { id: r.fundId } });
      if (fund) {
        fundBefore = { navPerUnit: fund.navPerUnit?.toFixed(4) ?? null, totalNav: fund.totalNav?.toFixed(2) ?? null, asOfDate: isoDay(fund.asOfDate), valuationStatus: fund.valuationStatus };
        const rules = (fund.dealingRulesJson && typeof fund.dealingRulesJson === 'object' && !Array.isArray(fund.dealingRulesJson) ? fund.dealingRulesJson : {}) as Record<string, unknown>;
        const history = (Array.isArray(rules.navHistory) ? (rules.navHistory as { date?: string; navPerUnit?: string }[]) : []).filter((h) => h.date?.slice(0, 10) !== isoDay(r.navDate));
        history.push({ date: isoDay(r.navDate)!, navPerUnit: r.navPerUnit.toFixed(4) });
        history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const newest = !fund.asOfDate || r.navDate.getTime() >= fund.asOfDate.getTime();
        await tx.fund.update({
          where: { id: fund.id },
          data: {
            dealingRulesJson: { ...rules, navHistory: history.slice(-24) } as Prisma.InputJsonValue,
            ...(newest ? { navPerUnit: r.navPerUnit, totalNav: r.nav, asOfDate: r.navDate, valuationStatus: 'FINAL', version: { increment: 1 } } : {}),
          },
        });
        if (newest) {
          const holdings = await tx.lpHolding.findMany({ where: { fundId: fund.id, isActive: true } });
          for (const h of holdings) {
            await tx.lpHolding.update({ where: { id: h.id }, data: { navPerUnit: r.navPerUnit, accountValue: h.units.mul(r.navPerUnit).toDecimalPlaces(4), asOfDate: r.navDate, valuationStatus: 'FINAL' } });
          }
        }
        fundAfter = newest ? { navPerUnit: r.navPerUnit.toFixed(4), totalNav: r.nav.toFixed(2), asOfDate: isoDay(r.navDate), valuationStatus: 'FINAL' } : { skipped: 'NAV date is older than the fund as-of date; only the NAV history was updated' };
      }
    }
    // Fee and income accruals for the period: a PENDING_APPROVAL accounting journal made by the system actor (idempotent per run).
    const journal = await postNavJournals(tx, r, supersededRuns);
    if (journal?.skipped === 'period_closed') {
      await ensureTask(tx, { area: 'CLOSE', title: `Book fee and accrual journal for ${r.ref}`, detail: journal.detail ?? 'The accounting period is closed; reopen it or book the journal manually.', dueAt: new Date(), sourceRef: `NAV:${r.ref}:JOURNAL`, link: `/ops/nav/${r.id}` });
    }
    await writeAudit(tx, audit(req), {
      action: 'nav.released',
      objectType: 'nav_run',
      objectId: r.id,
      before: { status: 'MAKER_REVIEWED' },
      after: { status: 'RELEASED', ref: r.ref, version: r.version, navDate: isoDay(r.navDate), nav: r.nav.toFixed(2), navPerUnit: r.navPerUnit?.toFixed(4) ?? null, checkerId: req.user!.id, reviewerId: r.reviewerId, supersededVersions: prior.map((p) => p.version), fundBefore, fundAfter, accountingJournal: journal ? (journal.ref ?? journal.skipped ?? null) : null },
    });
    return { fundAfter, journal };
  });
  const detail = await runDetail(await loadRun(r.id), req.user!);
  res.json({ data: { ...detail, fundUpdate: out.fundAfter, accountingJournal: out.journal ? { ref: out.journal.ref ?? null, created: out.journal.created, skipped: out.journal.skipped ?? null } : null } });
});

export { allowedActions, REPLACEABLE };
