import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { audit } from '../ops/ops.common';
import { getPortfolioSnapshot, latestPrices, loadPortfolio } from '../portfolio/portfolio.service';
import {
  NAV_EXTERNAL_TOL_DEFAULT,
  NAV_EXTERNAL_TOL_KEY,
  NAV_SETTING_DEFAULTS,
  NAV_SETTING_KEYS,
  NAV_STAGES,
  businessDaysBetween,
  daysBetween,
  externalVariance,
  isMaterial,
  isStale,
  movePct,
  priceCoverage,
  stageFor,
  totalsFor,
  type ExceptionDraft,
  type NavSettings,
} from './nav.engine';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunRow = Prisma.NavRunGetPayload<object>;
export const EDITABLE = ['DRAFT', 'EXCEPTIONS_OPEN'] as const;
/** Statuses a recalculation may replace. */
export const REPLACEABLE = ['DRAFT', 'EXCEPTIONS_OPEN', 'MAKER_REVIEWED'] as const;

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const f2 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));

// ---------------------------------------------------------------- settings

export async function loadSettings(): Promise<NavSettings> {
  const rows = await prisma.policy.findMany({ where: { key: { in: Object.values(NAV_SETTING_KEYS) } } });
  const out: NavSettings = { ...NAV_SETTING_DEFAULTS };
  for (const [field, key] of Object.entries(NAV_SETTING_KEYS) as [keyof NavSettings, string][]) {
    const row = rows.find((r) => r.key === key);
    const v = row ? Number(row.value) : NaN;
    if (Number.isFinite(v) && v >= 0) out[field] = v;
  }
  return out;
}

export async function loadExternalTolerance(): Promise<number> {
  const row = await prisma.policy.findUnique({ where: { key: NAV_EXTERNAL_TOL_KEY } });
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : NAV_EXTERNAL_TOL_DEFAULT;
}

/** The external NAV block of a run: the administrator figure, ABOR (this run's NAV), variance and state; null until one is recorded. */
export function externalView(r: RunRow, tolerance: number, names?: Map<string, string>) {
  if (!r.externalNav) return null;
  const v = externalVariance(r.nav, r.externalNav, new D(tolerance));
  return {
    nav: r.externalNav.toFixed(2),
    abor: r.nav.toFixed(2),
    variance: v.variance.toFixed(2),
    variancePct: r.nav.isZero() ? null : v.variance.div(r.nav).mul(100).toDecimalPlaces(4).toFixed(4),
    tolerance: tolerance.toFixed(2),
    state: v.state,
    source: r.externalNavSource,
    note: r.externalNavNote,
    recordedBy: r.externalNavBy,
    recordedByName: r.externalNavBy ? (names?.get(r.externalNavBy) ?? null) : null,
    recordedAt: iso(r.externalNavAt),
  };
}

// ---------------------------------------------------------------- calculation

interface LineDraft {
  securityId: string;
  ticker: string;
  name: string;
  currency: string;
  quantity: Dec;
  price: Dec | null;
  priceSource: string | null;
  priceDate: Date | null;
  fxRate: Dec | null;
  valueLocal: Dec | null;
  valueBase: Dec | null;
  flags: string[];
}

export interface Valuation {
  baseCurrency: string;
  marketValue: Dec;
  cash: Dec;
  coverage: Dec;
  positionCount: number;
  lines: LineDraft[];
  exceptions: ExceptionDraft[];
  cashDetail: { currency: string; available: string; fxRate: string | null; availableBase: string | null }[];
}

/** The price a security carried in the most recent earlier run of this portfolio (released first), else the market's previous price. */
async function previousPrices(portfolioId: string, navDate: Date, securityIds: string[]): Promise<Map<string, Dec>> {
  const out = new Map<string, Dec>();
  if (!securityIds.length) return out;
  const prior =
    (await prisma.navRun.findFirst({ where: { portfolioId, navDate: { lt: navDate }, status: 'RELEASED' }, orderBy: [{ navDate: 'desc' }, { version: 'desc' }], select: { id: true } })) ??
    (await prisma.navRun.findFirst({ where: { portfolioId, navDate: { lt: navDate }, status: { not: 'SUPERSEDED' } }, orderBy: [{ navDate: 'desc' }, { version: 'desc' }], select: { id: true } }));
  if (prior) {
    const lines = await prisma.navRunLine.findMany({ where: { runId: prior.id, securityId: { in: securityIds }, price: { not: null } }, select: { securityId: true, price: true } });
    for (const l of lines) if (l.price) out.set(l.securityId, l.price);
  }
  const missing = securityIds.filter((id) => !out.has(id));
  if (missing.length) {
    const market = await latestPrices(missing, navDate);
    for (const [id, p] of market) if (p.previous) out.set(id, new D(p.previous.price));
  }
  return out;
}

/** Values the portfolio at `navDate` from the portfolio snapshot and raises the valuation exceptions. Pure read. */
export async function calculateValuation(portfolioId: string, navDate: Date, s: NavSettings): Promise<Valuation> {
  const snap = await getPortfolioSnapshot(portfolioId, { asOf: navDate });
  const prev = await previousPrices(portfolioId, navDate, snap.lines.map((l) => l.securityId));
  const lines: LineDraft[] = [];
  const exceptions: ExceptionDraft[] = [];
  let valued = ZERO;
  let unvaluedRef = ZERO;

  for (const l of snap.lines) {
    const qty = new D(l.quantity);
    const price = l.price ? new D(l.price) : null;
    const fx = l.fxRate ? new D(l.fxRate) : null;
    const valueLocal = l.marketValue ? new D(l.marketValue) : null;
    const valueBase = l.marketValueBase ? new D(l.marketValueBase) : null;
    const priceDate = l.priceDate ? new Date(`${l.priceDate}T00:00:00.000Z`) : null;
    const flags: string[] = [];
    const add = (e: Omit<ExceptionDraft, 'securityId' | 'ticker'>) => exceptions.push({ ...e, securityId: l.securityId, ticker: l.ticker });

    if (!price) {
      flags.push('MISSING_PRICE');
      const ref = fx ? qty.mul(new D(l.avgCost)).mul(fx) : null;
      add({ type: 'MISSING_PRICE', detail: `${l.ticker}: no price on or before ${isoDay(navDate)}`, currentValue: null, referenceValue: ref, difference: null, material: true });
      unvaluedRef = unvaluedRef.add(ref ?? qty.mul(new D(l.avgCost)));
    } else if (!valueBase) {
      flags.push('MISSING_FX');
      add({ type: 'MISSING_FX', detail: `${l.ticker}: no ${l.currency}/${snap.baseCurrency} FX rate on or before ${isoDay(navDate)}`, currentValue: null, referenceValue: valueLocal, difference: null, material: true });
      unvaluedRef = unvaluedRef.add(valueLocal ?? ZERO);
    } else {
      valued = valued.add(valueBase);
      if (priceDate && isStale(priceDate, navDate, s.staleDays)) {
        flags.push('STALE_PRICE');
        const age = businessDaysBetween(priceDate, navDate);
        add({
          type: 'STALE_PRICE',
          detail: `${l.ticker}: price dated ${isoDay(priceDate)} is ${age} business days old (limit ${s.staleDays})`,
          currentValue: valueBase,
          referenceValue: valueBase,
          difference: ZERO,
          material: false,
        });
      }
      const before = prev.get(l.securityId);
      const mv = price && before ? movePct(price, before) : null;
      if (mv && mv.abs().gt(s.priceMovePct) && fx) {
        flags.push('TOLERANCE');
        const ref = qty.mul(before!).mul(fx).toDecimalPlaces(2, D.ROUND_HALF_UP);
        const diff = valueBase.sub(ref);
        add({
          type: 'TOLERANCE',
          detail: `${l.ticker}: price moved ${mv.toFixed(2)}% (${before!.toFixed(6)} to ${price.toFixed(6)}), limit ${s.priceMovePct}%`,
          currentValue: valueBase,
          referenceValue: ref,
          difference: diff,
          material: isMaterial(diff, valueBase, s),
        });
      }
    }
    lines.push({
      securityId: l.securityId,
      ticker: l.ticker,
      name: l.name,
      currency: l.currency,
      quantity: qty,
      price,
      priceSource: l.priceSource,
      priceDate,
      fxRate: fx,
      valueLocal,
      valueBase,
      flags,
    });
  }

  let cashNegative = false;
  for (const c of snap.cash) {
    if (new D(c.available).lt(0)) {
      cashNegative = true;
      exceptions.push({
        type: 'NEGATIVE_CASH',
        securityId: null,
        ticker: null,
        detail: `Cash ${c.currency} is negative (${c.available})`,
        currentValue: c.availableBase ? new D(c.availableBase) : new D(c.available),
        referenceValue: ZERO,
        difference: c.availableBase ? new D(c.availableBase) : new D(c.available),
        material: true,
      });
    }
    if (!c.availableBase) {
      exceptions.push({
        type: 'MISSING_FX',
        securityId: null,
        ticker: null,
        detail: `Cash ${c.currency}: no ${c.currency}/${snap.baseCurrency} FX rate on or before ${isoDay(navDate)}`,
        currentValue: null,
        referenceValue: new D(c.available),
        difference: null,
        material: true,
      });
    }
  }
  void cashNegative;

  return {
    baseCurrency: snap.baseCurrency,
    // Use the portfolio's own total (sum of unrounded line values, rounded once) so NAV and the Portfolio page agree to the cent.
    marketValue: new D(snap.totals.securitiesValueBase), // the snapshot total already covers valued lines only, so this holds with unvalued lines too
    cash: new D(snap.totals.cashBase),
    coverage: priceCoverage(valued, unvaluedRef),
    positionCount: snap.lines.length,
    lines,
    exceptions,
    cashDetail: snap.cash.map((c) => ({ currency: c.currency, available: c.available, fxRate: c.fxRate, availableBase: c.availableBase })),
  };
}

// ---------------------------------------------------------------- inputs and fund link

export interface Inputs {
  accruals?: Dec;
  fees?: Dec;
  liabilities?: Dec;
  feeRatePct?: Dec | null;
  units?: Dec | null;
  notes?: string | null;
}

/** The fund backed by a portfolio (first Active one by creation), or null. */
export async function fundForPortfolio(portfolioId: string) {
  return prisma.fund.findFirst({ where: { portfolioId, status: { not: 'Closed' } }, orderBy: { createdAt: 'asc' } });
}

async function defaultUnits(portfolioId: string, fund: { totalNav: Dec | null; navPerUnit: Dec | null } | null): Promise<Dec | null> {
  const prior = await prisma.navRun.findFirst({ where: { portfolioId, units: { not: null }, status: { not: 'SUPERSEDED' } }, orderBy: [{ navDate: 'desc' }, { version: 'desc' }], select: { units: true } });
  if (prior?.units) return prior.units;
  const anyPrior = await prisma.navRun.findFirst({ where: { portfolioId, units: { not: null } }, orderBy: { createdAt: 'desc' }, select: { units: true } });
  if (anyPrior?.units) return anyPrior.units;
  if (fund?.totalNav && fund.navPerUnit && fund.navPerUnit.gt(0)) return fund.totalNav.div(fund.navPerUnit).toDecimalPlaces(6, D.ROUND_HALF_UP);
  return null;
}

// ---------------------------------------------------------------- create a version

/**
 * Creates the next version of the run for a portfolio and date: values the book, raises exceptions, supersedes every
 * unreleased earlier version, carries over resolved exceptions that did not change, and audits it.
 * Inputs not supplied are carried over from the latest unreleased version, then the latest run for the portfolio.
 */
export async function createVersion(
  req: Request,
  p: { portfolioId: string; navDate: Date; inputs: Inputs; from?: RunRow | null; action: 'nav.run_created' | 'nav.run_recalculated' },
): Promise<RunRow> {
  const portfolio = await loadPortfolio(p.portfolioId);
  const settings = await loadSettings();
  const fund = await fundForPortfolio(portfolio.id);
  if (fund && fund.currency !== portfolio.baseCurrency) {
    throw HttpError.conflict(`Fund ${fund.ref} reports in ${fund.currency} but portfolio ${portfolio.ref} is in ${portfolio.baseCurrency}`, 'currency_mismatch');
  }
  const val = await calculateValuation(portfolio.id, p.navDate, settings);
  const me = req.user!.id;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM portfolios WHERE id = ${portfolio.id} FOR UPDATE`;
    const sameDay = await tx.navRun.findMany({ where: { portfolioId: portfolio.id, navDate: p.navDate }, orderBy: { version: 'desc' } });
    const latestOpen = p.from ?? sameDay.find((r) => (REPLACEABLE as readonly string[]).includes(r.status)) ?? null;
    const carry = latestOpen ?? sameDay[0] ?? null;
    const units =
      p.inputs.units !== undefined
        ? p.inputs.units
        : carry
          ? carry.units
          : await defaultUnits(portfolio.id, fund);
    const feeRatePct = p.inputs.feeRatePct !== undefined ? p.inputs.feeRatePct : (carry?.feeRatePct ?? null);
    const accruals = p.inputs.accruals ?? carry?.accruals ?? ZERO;
    const liabilities = p.inputs.liabilities ?? carry?.liabilities ?? ZERO;
    const manualFees = p.inputs.fees ?? carry?.fees ?? ZERO;
    const t = totalsFor({ marketValue: val.marketValue, cash: val.cash, accruals, fees: manualFees, liabilities, feeRatePct, units });
    const inputsTouched = Object.values(p.inputs).some((v) => v !== undefined) || !!(carry?.detail && (carry.detail as { inputsTouched?: boolean }).inputsTouched);

    const ref = await nextRef(tx, 'navRun');
    const version = (sameDay[0]?.version ?? 0) + 1;
    const openPrice = val.exceptions.filter((e) => e.type !== 'NEGATIVE_CASH').length;
    const status = val.exceptions.length ? 'EXCEPTIONS_OPEN' : 'DRAFT';

    const run = await tx.navRun.create({
      data: {
        ref,
        portfolioId: portfolio.id,
        fundId: fund?.id ?? null,
        navDate: p.navDate,
        version,
        stage: stageFor({ status, openPriceExceptions: openPrice, openCashExceptions: val.exceptions.length - openPrice, inputsTouched, units }),
        baseCurrency: val.baseCurrency,
        marketValue: val.marketValue,
        cash: val.cash,
        accruals,
        fees: t.fees,
        liabilities,
        feeRatePct,
        nav: t.nav,
        units,
        navPerUnit: t.navPerUnit,
        priceCoverage: val.coverage,
        positionCount: val.positionCount,
        status,
        makerId: me,
        notes: p.inputs.notes !== undefined ? p.inputs.notes : (carry?.notes ?? null),
        detail: { cash: val.cashDetail, settings, inputsTouched } as unknown as Prisma.InputJsonValue,
      },
    });
    if (val.lines.length) {
      await tx.navRunLine.createMany({
        data: val.lines.map((l) => ({
          runId: run.id,
          securityId: l.securityId,
          ticker: l.ticker,
          name: l.name,
          currency: l.currency,
          quantity: l.quantity,
          price: l.price,
          priceSource: l.priceSource,
          priceDate: l.priceDate,
          fxRate: l.fxRate,
          valueLocal: l.valueLocal,
          valueBase: l.valueBase,
          flags: l.flags as unknown as Prisma.InputJsonValue,
        })),
      });
    }
    // carry over resolutions that still apply (same type, security and value)
    const earlier = carry ? await tx.navException.findMany({ where: { runId: carry.id, status: 'RESOLVED' } }) : [];
    let carried = 0;
    for (const e of val.exceptions) {
      const hit = earlier.find((x) => x.type === e.type && (x.securityId ?? null) === e.securityId && (x.currentValue?.toFixed(2) ?? null) === (e.currentValue?.toFixed(2) ?? null));
      if (hit) carried++;
      await tx.navException.create({
        data: {
          runId: run.id,
          type: e.type,
          securityId: e.securityId,
          ticker: e.ticker,
          detail: e.detail,
          currentValue: e.currentValue,
          referenceValue: e.referenceValue,
          difference: e.difference,
          material: e.material,
          ...(hit ? { status: 'RESOLVED', resolution: hit.resolution, evidenceRef: hit.evidenceRef, resolvedBy: hit.resolvedBy, resolvedAt: hit.resolvedAt } : {}),
        },
      });
    }
    const stillOpen = val.exceptions.length - carried;
    const finalStatus = stillOpen > 0 ? 'EXCEPTIONS_OPEN' : 'DRAFT';
    if (finalStatus !== status) {
      await tx.navRun.update({ where: { id: run.id }, data: { status: finalStatus, stage: stageFor({ status: finalStatus, openPriceExceptions: 0, openCashExceptions: 0, inputsTouched, units }) } });
    } else {
      const open = await tx.navException.findMany({ where: { runId: run.id, status: 'OPEN' }, select: { type: true } });
      const priceOpen = open.filter((e) => e.type !== 'NEGATIVE_CASH').length;
      await tx.navRun.update({ where: { id: run.id }, data: { stage: stageFor({ status, openPriceExceptions: priceOpen, openCashExceptions: open.length - priceOpen, inputsTouched, units }) } });
    }

    // supersede every unreleased earlier version of this portfolio and date
    for (const old of sameDay.filter((r) => (REPLACEABLE as readonly string[]).includes(r.status))) {
      await tx.navRun.update({ where: { id: old.id }, data: { status: 'SUPERSEDED' } });
      await writeAudit(tx, audit(req), { action: 'nav.run_superseded', objectType: 'nav_run', objectId: old.id, before: { status: old.status }, after: { status: 'SUPERSEDED', supersededBy: ref } });
    }
    await writeAudit(tx, audit(req), {
      action: p.action,
      objectType: 'nav_run',
      objectId: run.id,
      before: p.from ? { ref: p.from.ref, version: p.from.version, status: p.from.status } : undefined,
      after: { ref, portfolio: portfolio.ref, navDate: isoDay(p.navDate), version, status: finalStatus, nav: t.nav.toFixed(2), navPerUnit: t.navPerUnit?.toFixed(4) ?? null, coverage: val.coverage.toFixed(4), exceptions: val.exceptions.length, carriedResolutions: carried },
    });
    return tx.navRun.findUniqueOrThrow({ where: { id: run.id } });
  });
}

// ---------------------------------------------------------------- loading and views

export async function loadRun(idOrRef: string): Promise<RunRow> {
  const r = await prisma.navRun.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!r) throw HttpError.notFound('NAV run not found');
  return r;
}

async function names(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

export async function runViews(rows: RunRow[]) {
  const users = await names(rows.flatMap((r) => [r.makerId, r.reviewerId, r.checkerId, r.externalNavBy]));
  const extTol = await loadExternalTolerance();
  const pf = await prisma.portfolio.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.portfolioId))] } }, select: { id: true, ref: true, name: true } });
  const funds = await prisma.fund.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.fundId).filter((x): x is string => !!x))] } }, select: { id: true, ref: true, name: true } });
  const exc = rows.length
    ? await prisma.navException.groupBy({ by: ['runId', 'status', 'material'], where: { runId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    : [];
  return rows.map((r) => {
    const mine = exc.filter((e) => e.runId === r.id);
    const count = (f: (e: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((s, e) => s + e._count._all, 0);
    const p = pf.find((x) => x.id === r.portfolioId);
    const fund = funds.find((x) => x.id === r.fundId);
    return {
      id: r.id,
      ref: r.ref,
      portfolioId: r.portfolioId,
      portfolioRef: p?.ref ?? null,
      portfolioName: p?.name ?? null,
      fundId: r.fundId,
      fundRef: fund?.ref ?? null,
      fundName: fund?.name ?? null,
      navDate: isoDay(r.navDate),
      version: r.version,
      stage: r.stage,
      status: r.status,
      baseCurrency: r.baseCurrency,
      marketValue: f2(r.marketValue),
      cash: f2(r.cash),
      accruals: f2(r.accruals),
      fees: f2(r.fees),
      liabilities: f2(r.liabilities),
      feeRatePct: r.feeRatePct ? r.feeRatePct.toFixed(4) : null,
      nav: f2(r.nav),
      units: r.units ? r.units.toFixed(6) : null,
      navPerUnit: r.navPerUnit ? r.navPerUnit.toFixed(4) : null,
      priceCoverage: r.priceCoverage.toFixed(4),
      positionCount: r.positionCount,
      external: externalView(r, extTol, users),
      openExceptions: count((e) => e.status === 'OPEN'),
      openMaterialExceptions: count((e) => e.status === 'OPEN' && e.material),
      totalExceptions: count(() => true),
      makerId: r.makerId,
      makerName: users.get(r.makerId) ?? null,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewerId ? (users.get(r.reviewerId) ?? null) : null,
      reviewedAt: iso(r.reviewedAt),
      checkerId: r.checkerId,
      checkerName: r.checkerId ? (users.get(r.checkerId) ?? null) : null,
      releasedAt: iso(r.releasedAt),
      notes: r.notes,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  });
}

export function bridge(r: RunRow) {
  return [
    { key: 'marketValue', label: 'Market value of positions', sign: 1, amount: r.marketValue.toFixed(2) },
    { key: 'cash', label: 'Cash', sign: 1, amount: r.cash.toFixed(2) },
    { key: 'accruals', label: 'Accruals', sign: 1, amount: r.accruals.toFixed(2) },
    { key: 'fees', label: 'Fees', sign: -1, amount: r.fees.toFixed(2) },
    { key: 'liabilities', label: 'Liabilities', sign: -1, amount: r.liabilities.toFixed(2) },
    { key: 'nav', label: 'Net asset value', sign: 0, amount: r.nav.toFixed(2) },
  ];
}

export async function openCounts(runId: string) {
  const open = await prisma.navException.findMany({ where: { runId, status: 'OPEN' }, select: { type: true, material: true } });
  return { open: open.length, material: open.filter((e) => e.material).length };
}

/** FR-VAL-009: the tooltip for an action the user's roles do not allow ("Not permitted for <Role>"). */
export function notPermitted(user: { roles?: { portal: string; label: string }[] }): string {
  const role = user.roles?.find((x) => x.portal === 'admin')?.label ?? user.roles?.[0]?.label ?? 'your role';
  return `Not permitted for ${role}`;
}

export function allowedActions(r: RunRow, c: { open: number; material: number }, user: { id: string; permissions: string[]; roles?: { portal: string; label: string }[] }) {
  const editable = (EDITABLE as readonly string[]).includes(r.status);
  const replaceable = (REPLACEABLE as readonly string[]).includes(r.status);
  const canRun = user.permissions.includes('valuation.run');
  const canMaker = user.permissions.includes('valuation.maker');
  const blockers: string[] = [];
  if (c.material > 0) blockers.push(`${c.material} material exception${c.material === 1 ? '' : 's'} still open`);
  if (r.fundId && !(r.units && r.units.gt(0))) blockers.push('Units are required for a fund NAV');
  return {
    recalculate: replaceable && canRun,
    editInputs: editable && canRun,
    resolve: editable && canRun,
    makerReview: editable && blockers.length === 0 && canMaker,
    makerReviewBlockers: editable ? (canMaker ? blockers : [notPermitted(user), ...blockers]) : [],
    runBlocker: canRun ? null : notPermitted(user),
    makerBlocker: canMaker ? null : notPermitted(user),
    recordExternal: r.status !== 'SUPERSEDED' && canRun,
    release: r.status === 'MAKER_REVIEWED' && user.permissions.includes('valuation.release') && r.reviewerId !== user.id,
    releaseBlocker:
      r.status !== 'MAKER_REVIEWED'
        ? null
        : !user.permissions.includes('valuation.release')
          ? notPermitted(user)
          : r.reviewerId === user.id
            ? 'A different person from the maker reviewer must release'
            : null,
  };
}

export const stageBar = (stage: string, status: string) => {
  const idx = stage === 'DONE' ? NAV_STAGES.length : NAV_STAGES.indexOf(stage as (typeof NAV_STAGES)[number]);
  const labels: Record<string, string> = { POSITIONS: 'Positions', CASH: 'Cash', PRICES: 'Prices & FX', FEES: 'Fees', UNITS: 'Units', MAKER_REVIEW: 'Maker review', RELEASE: 'Release' };
  return NAV_STAGES.map((k, i) => ({ key: k, label: labels[k], state: status === 'SUPERSEDED' ? 'skipped' : i < idx ? 'done' : i === idx ? 'current' : 'todo' }));
};

export async function runDetail(r: RunRow, user: { id: string; permissions: string[]; roles?: { portal: string; label: string }[] }) {
  const [view] = await runViews([r]);
  const [lines, exceptions, counts, versions, events] = await Promise.all([
    prisma.navRunLine.findMany({ where: { runId: r.id }, orderBy: { ticker: 'asc' } }),
    prisma.navException.findMany({ where: { runId: r.id }, orderBy: [{ status: 'asc' }, { material: 'desc' }, { createdAt: 'asc' }] }),
    openCounts(r.id),
    prisma.navRun.findMany({ where: { portfolioId: r.portfolioId, navDate: r.navDate }, orderBy: { version: 'desc' }, select: { id: true, ref: true, version: true, status: true } }),
    prisma.auditEvent.findMany({ where: { objectType: 'nav_run', objectId: r.id }, orderBy: { id: 'asc' }, take: 100 }),
  ]);
  const users = await names([...exceptions.map((e) => e.resolvedBy), ...events.map((e) => e.actorId)]);
  const detail = (r.detail ?? {}) as { cash?: unknown; settings?: NavSettings };
  return {
    ...view,
    stageBar: stageBar(r.stage, r.status),
    bridge: bridge(r),
    cashDetail: detail.cash ?? [],
    settings: detail.settings ?? null,
    lines: [...lines]
      .sort((a, b) => (b.valueBase ?? ZERO).comparedTo(a.valueBase ?? ZERO) || a.ticker.localeCompare(b.ticker))
      .map((l) => ({
      id: l.id,
      securityId: l.securityId,
      ticker: l.ticker,
      name: l.name,
      currency: l.currency,
      quantity: l.quantity.toFixed(6),
      price: l.price ? l.price.toFixed(6) : null,
      priceSource: l.priceSource,
      priceDate: isoDay(l.priceDate),
      fxRate: l.fxRate ? l.fxRate.toDecimalPlaces(10).toString() : null,
      valueLocal: f2(l.valueLocal),
      valueBase: f2(l.valueBase),
      flags: (l.flags as string[] | null) ?? [],
    })),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      type: e.type,
      securityId: e.securityId,
      ticker: e.ticker,
      detail: e.detail,
      currentValue: f2(e.currentValue),
      referenceValue: f2(e.referenceValue),
      difference: f2(e.difference),
      material: e.material,
      status: e.status,
      resolution: e.resolution,
      evidenceRef: e.evidenceRef,
      resolvedBy: e.resolvedBy,
      resolvedByName: e.resolvedBy ? (users.get(e.resolvedBy) ?? null) : null,
      resolvedAt: iso(e.resolvedAt),
    })),
    versions,
    timeline: events.map((e) => ({ at: e.occurredAt, action: e.action, actor: e.actorId ? (users.get(e.actorId) ?? 'Unknown user') : 'System', reason: e.reason, detail: e.after })),
    allowed: allowedActions(r, counts, user),
  };
}

/** Recomputes nav, fees and nav per unit from the stored valuation and the current inputs. */
export function recomputeTotals(r: RunRow, patch: Partial<Pick<RunRow, 'accruals' | 'fees' | 'liabilities' | 'feeRatePct' | 'units'>>) {
  const merged = {
    marketValue: r.marketValue,
    cash: r.cash,
    accruals: patch.accruals ?? r.accruals,
    fees: patch.fees ?? r.fees,
    liabilities: patch.liabilities ?? r.liabilities,
    feeRatePct: patch.feeRatePct !== undefined ? patch.feeRatePct : r.feeRatePct,
    units: patch.units !== undefined ? patch.units : r.units,
  };
  return { ...merged, ...totalsFor(merged) };
}
