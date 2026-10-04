/**
 * Risk & Compliance service (SRD 5.A.7, 6.8 FR-RSK-001..005, BR-001, BR-014).
 *
 * EXPORTS FOR OTHER MODULES (Orders pre-trade checks)
 *   checkLimitsForPortfolio(portfolioIdOrRef, hypothetical?, opts?): Promise<LimitCheckResult>
 *     Pure read: evaluates every ACTIVE limit that applies to the portfolio (FIRM scope, or PORTFOLIO scope with
 *     this portfolio) on the current book, or on the book as it would be AFTER a hypothetical trade. Records
 *     nothing. `result.breaches` / `result.warnings` list the limits that would be breached / within 10% of the
 *     limit; `result.blocked` is true when a limit with breach action BLOCK would be newly breached or made worse.
 *   runScenarioMaths (risk.engine.ts): the deterministic stress calculation.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { enqueue } from '../../lib/outbox';
import { getPortfolioSnapshot, getSecurityWithPrice, resolveFxRate, loadPortfolio, type PortfolioSnapshot } from '../portfolio/portfolio.service';
import {
  bookFromSnapshot,
  cashTotal,
  evaluateMeasure,
  measureBook,
  runScenarioMaths,
  SCENARIO_THRESHOLD_DEFAULTS,
  type ScenarioThresholds,
  severityFor,
  type Book,
  type Evaluation,
  type LimitState,
  type RiskMetric,
  type ScenarioResult,
  type Shocks,
} from './risk.engine';

const D = Prisma.Decimal;
const ZERO = new D(0);
const startOfDay = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type LimitRow = Prisma.RiskLimitGetPayload<object>;

/** ACTIVE limits that apply to a portfolio: FIRM scope, or PORTFOLIO scope naming it. */
export async function activeLimitsFor(portfolioId: string): Promise<LimitRow[]> {
  return prisma.riskLimit.findMany({
    where: { status: 'ACTIVE', OR: [{ scopeType: 'FIRM' }, { scopeType: 'PORTFOLIO', scopeId: portfolioId }] },
    orderBy: { ref: 'asc' },
  });
}

// ---------------------------------------------------------------- hypothetical trade

export interface Hypothetical {
  /** Security ticker or id. */
  ticker: string;
  side: 'BUY' | 'SELL';
  /** Units, positive. */
  quantity: number | string;
  /** Price in the security currency; defaults to the latest price. */
  price?: number | string;
}

export interface AppliedHypothetical {
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  /** Trade value in the portfolio base currency (2 dp). */
  valueBase: string;
}

/** Buy adds to the holding and takes the same value out of cash (of the security currency); sell does the reverse. */
async function applyHypothetical(book: Book, h: Hypothetical, asOf: Date): Promise<{ book: Book; applied: AppliedHypothetical }> {
  const qty = new D(h.quantity);
  if (!qty.gt(ZERO)) throw HttpError.badRequest('Validation failed', [{ path: 'hypothetical.quantity', message: 'Quantity must be positive' }]);
  const sec = await getSecurityWithPrice(h.ticker, { asOf });
  const price = h.price !== undefined ? new D(h.price) : sec.latestPrice ? new D(sec.latestPrice.price) : null;
  if (!price || !price.gt(ZERO)) throw HttpError.badRequest('Validation failed', [{ path: 'hypothetical.price', message: `No price available for ${sec.ticker}` }]);
  const rate = await resolveFxRate(sec.currency, book.baseCurrency, asOf);
  if (!rate) throw HttpError.badRequest('Validation failed', [{ path: 'hypothetical.ticker', message: `No ${sec.currency}/${book.baseCurrency} FX rate` }]);
  let value = qty.mul(price).mul(rate);

  const items = book.items.map((i) => ({ ...i }));
  const cash = book.cash.map((c) => ({ ...c }));
  const held = items.find((i) => i.ticker === sec.ticker);
  const sign = h.side === 'BUY' ? 1 : -1;
  if (h.side === 'SELL') value = held ? D.min(value, held.valueBase) : ZERO;
  if (held) held.valueBase = held.valueBase.add(value.mul(sign));
  else items.push({ ticker: sec.ticker, sector: sec.sector, assetClass: sec.assetClass, currency: sec.currency, valueBase: value });
  const c = cash.find((x) => x.currency === sec.currency);
  if (c) c.valueBase = c.valueBase.sub(value.mul(sign));
  else cash.push({ currency: sec.currency, valueBase: value.mul(-sign) });

  return {
    book: { baseCurrency: book.baseCurrency, items: items.filter((i) => i.valueBase.gt(ZERO)), cash },
    applied: {
      ticker: sec.ticker,
      side: h.side,
      quantity: qty.toString(),
      price: price.toString(),
      currency: sec.currency,
      valueBase: value.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    },
  };
}

// ---------------------------------------------------------------- checkLimitsForPortfolio

export interface LimitEvaluationView {
  limitId: string;
  ref: string;
  metric: RiskMetric;
  scopeType: string;
  breachAction: string;
  /** Percent, 4 dp. */
  threshold: string;
  value: string;
  state: LimitState;
  /** Value on the current book when a hypothetical trade was applied. */
  valueBefore?: string;
  stateBefore?: LimitState;
  /** True when the hypothetical trade creates the breach or makes an existing one worse. */
  worsened?: boolean;
  detail: Record<string, unknown>;
}

export interface LimitCheckResult {
  portfolioId: string;
  portfolioRef: string;
  asOf: string;
  hypothetical: AppliedHypothetical | null;
  evaluations: LimitEvaluationView[];
  breaches: LimitEvaluationView[];
  warnings: LimitEvaluationView[];
  /** A BLOCK limit is newly breached or made worse by the hypothetical trade (always false without one). */
  blocked: boolean;
  /** Cash after the hypothetical trade, base currency (2 dp). */
  cashBase: string;
  /** Unpriced lines etc. from the snapshot: the book could not be fully valued. */
  valuationWarnings: string[];
}

function evaluateAll(book: Book, limits: LimitRow[]): Map<string, Evaluation> {
  const out = new Map<string, Evaluation>();
  const m = measureBook(book);
  if (!m) return out;
  for (const l of limits) out.set(l.id, evaluateMeasure(l.metric as RiskMetric, l.threshold, m[l.metric as RiskMetric]));
  return out;
}

const view = (l: LimitRow, ev: Evaluation): LimitEvaluationView => ({
  limitId: l.id,
  ref: l.ref,
  metric: l.metric as RiskMetric,
  scopeType: l.scopeType,
  breachAction: l.breachAction,
  threshold: ev.threshold.toFixed(4),
  value: ev.value.toFixed(4),
  state: ev.state,
  detail: ev.detail,
});

function checkWithSnapshot(snap: PortfolioSnapshot, limits: LimitRow[], current: Book, after: Book | null, applied: AppliedHypothetical | null): LimitCheckResult {
  const book = after ?? current;
  const now = evaluateAll(book, limits);
  const before = after ? evaluateAll(current, limits) : null;
  const evaluations: LimitEvaluationView[] = [];
  let blocked = false;
  for (const l of limits) {
    const ev = now.get(l.id);
    if (!ev) continue;
    const v = view(l, ev);
    const b = before?.get(l.id);
    if (b) {
      v.valueBefore = b.value.toFixed(4);
      v.stateBefore = b.state;
      const floor = l.metric === 'CASH_FLOOR_PCT';
      const worse = floor ? ev.value.lt(b.value) : ev.value.gt(b.value);
      v.worsened = ev.state === 'BREACH' && (b.state !== 'BREACH' || worse);
      if (v.worsened && l.breachAction === 'BLOCK') blocked = true;
    }
    evaluations.push(v);
  }
  return {
    portfolioId: snap.portfolio.id,
    portfolioRef: snap.portfolio.ref,
    asOf: snap.asOf,
    hypothetical: applied,
    evaluations,
    breaches: evaluations.filter((e) => e.state === 'BREACH'),
    warnings: evaluations.filter((e) => e.state === 'WARNING'),
    blocked,
    cashBase: cashTotal(book).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
    valuationWarnings: snap.warnings,
  };
}

export async function checkLimitsForPortfolio(portfolioIdOrRef: string, hypothetical?: Hypothetical | null, opts: { asOf?: Date } = {}): Promise<LimitCheckResult> {
  const asOf = opts.asOf ?? new Date();
  const snap = await getPortfolioSnapshot(portfolioIdOrRef, { asOf });
  const limits = await activeLimitsFor(snap.portfolio.id);
  const current = bookFromSnapshot(snap);
  if (!hypothetical) return checkWithSnapshot(snap, limits, current, null, null);
  const { book, applied } = await applyHypothetical(current, hypothetical, asOf);
  return checkWithSnapshot(snap, limits, current, book, applied);
}

/**
 * Read-only: how many (limit, portfolio) pairs are over their limit RIGHT NOW but have no breach recorded for today
 * (the monitor has not run yet). Used by the Today dashboard so a seeded limit breach is never reported as "0".
 */
export async function countUnrecordedExceedances(asOf: Date = new Date()): Promise<number> {
  const detectedOn = startOfDay(asOf);
  // One query each for limits, portfolios and today's recorded breaches (no per-limit lookups); a snapshot is only
  // built for portfolios that actually have an active limit.
  const [limits, portfolios, recorded] = await Promise.all([
    prisma.riskLimit.findMany({ where: { status: 'ACTIVE' }, orderBy: { ref: 'asc' } }),
    prisma.portfolio.findMany({ where: { status: 'Active' }, select: { id: true }, take: 1000 }),
    prisma.riskBreach.findMany({ where: { detectedOn }, select: { limitId: true, portfolioId: true } }),
  ]);
  if (!limits.length) return 0;
  const done = new Set(recorded.map((x) => `${x.limitId}:${x.portfolioId}`));
  const firm = limits.filter((l) => l.scopeType === 'FIRM');
  let n = 0;
  for (const p of portfolios) {
    const applicable = [...firm, ...limits.filter((l) => l.scopeType === 'PORTFOLIO' && l.scopeId === p.id)];
    if (!applicable.length) continue;
    const snap = await getPortfolioSnapshot(p.id, { asOf });
    const measures = measureBook(bookFromSnapshot(snap));
    if (!measures) continue;
    for (const l of applicable) {
      const ev = evaluateMeasure(l.metric as RiskMetric, l.threshold, measures[l.metric as RiskMetric]);
      if (ev.state === 'BREACH' && !done.has(`${l.id}:${p.id}`)) n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------- monitor

export interface MonitorSummary {
  detectedOn: string;
  portfoliosChecked: number;
  limitsEvaluated: number;
  newBreaches: { breachId: string; caseRef: string; limitRef: string; portfolioRef: string; value: string; threshold: string; severity: string }[];
  alreadyRecorded: number;
  warnings: number;
}

/**
 * Evaluates every ACTIVE limit for every Active portfolio (or one) and records breaches. Idempotent per day: the
 * (limit, portfolio, date) unique key means a re-run records nothing twice. Each new breach opens a case
 * (severity from how far past the limit) and queues a notification to the limit owner.
 */
export async function runMonitor(actx: AuditContext, opts: { portfolioId?: string } = {}): Promise<MonitorSummary> {
  const now = new Date();
  const detectedOn = startOfDay(now);
  const portfolios = opts.portfolioId
    ? [await loadPortfolio(opts.portfolioId)]
    : await prisma.portfolio.findMany({ where: { status: 'Active' }, orderBy: { ref: 'asc' }, take: 1000 });
  const summary: MonitorSummary = { detectedOn: isoDay(detectedOn), portfoliosChecked: 0, limitsEvaluated: 0, newBreaches: [], alreadyRecorded: 0, warnings: 0 };

  for (const p of portfolios) {
    const limits = await activeLimitsFor(p.id);
    summary.portfoliosChecked += 1;
    if (!limits.length) continue;
    const snap = await getPortfolioSnapshot(p.id, { asOf: now });
    const measures = measureBook(bookFromSnapshot(snap));
    if (!measures) continue;
    for (const l of limits) {
      const ev = evaluateMeasure(l.metric as RiskMetric, l.threshold, measures[l.metric as RiskMetric]);
      summary.limitsEvaluated += 1;
      if (ev.state === 'WARNING') summary.warnings += 1;
      if (ev.state !== 'BREACH') continue;
      const existing = await prisma.riskBreach.findUnique({ where: { limitId_portfolioId_detectedOn: { limitId: l.id, portfolioId: p.id, detectedOn } }, select: { id: true } });
      if (existing) {
        summary.alreadyRecorded += 1;
        continue;
      }
      const severity = severityFor(ev.excessRatio);
      try {
        const created = await prisma.$transaction(async (tx) => {
          const breach = await tx.riskBreach.create({
            data: {
              limitId: l.id,
              portfolioId: p.id,
              detectedOn,
              value: ev.value,
              threshold: ev.threshold,
              detail: { ...ev.detail, excessRatio: ev.excessRatio.toFixed(4), asOf: snap.asOf, severity } as Prisma.InputJsonValue,
            },
          });
          const caseRef = await nextRef(tx, 'riskCase');
          const sign = l.metric === 'CASH_FLOOR_PCT' ? 'below the floor of' : 'above the limit of';
          const rc = await tx.riskCase.create({
            data: {
              ref: caseRef,
              type: 'LIMIT_BREACH',
              description: `${l.ref} ${l.metric}: ${p.name} (${p.ref}) is at ${ev.value.toFixed(2)}%, ${sign} ${ev.threshold.toFixed(2)}%.`,
              severity,
              ownerUserId: l.ownerUserId,
              sourceBreachId: breach.id,
              portfolioId: p.id,
              createdBy: actx.actorId ?? null,
            },
          });
          await tx.riskBreach.update({ where: { id: breach.id }, data: { caseId: rc.id } });
          await writeAudit(tx, actx, {
            action: 'risk.breach_detected',
            objectType: 'risk_breach',
            objectId: breach.id,
            after: { limit: l.ref, portfolio: p.ref, detectedOn: summary.detectedOn, value: ev.value.toFixed(4), threshold: ev.threshold.toFixed(4), severity, case: caseRef },
          });
          await writeAudit(tx, actx, {
            action: 'risk.case_created',
            objectType: 'risk_case',
            objectId: rc.id,
            after: { ref: caseRef, type: 'LIMIT_BREACH', severity, owner: l.ownerUserId, sourceBreach: breach.id },
          });
          await enqueue(tx, 'notify.users', {
            userIds: [l.ownerUserId],
            type: 'risk.breach',
            title: `Limit ${l.ref} breached: ${p.name}`,
            body: `${l.metric} is ${ev.value.toFixed(2)}% against a limit of ${ev.threshold.toFixed(2)}%. Case ${caseRef} opened (${severity}).`,
            link: '/ops/risk',
          });
          return { breach, caseRef };
        });
        summary.newBreaches.push({
          breachId: created.breach.id,
          caseRef: created.caseRef,
          limitRef: l.ref,
          portfolioRef: p.ref,
          value: ev.value.toFixed(4),
          threshold: ev.threshold.toFixed(4),
          severity,
        });
      } catch (err) {
        // A concurrent monitor run recorded it first.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') summary.alreadyRecorded += 1;
        else throw err;
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------- scenarios

/** Policy keys for the BR-029 scenario thresholds. A missing or invalid row falls back to the default. */
export const SCENARIO_THRESHOLD_KEYS = {
  liquidityEscalate: 'scenario_liq_escalate',
  liquidityReview: 'scenario_liq_review',
  lossEscalatePct: 'scenario_loss_escalate_pct',
  lossReviewPct: 'scenario_loss_review_pct',
} as const;

export async function loadScenarioThresholds(): Promise<ScenarioThresholds> {
  const rows = await prisma.policy.findMany({ where: { key: { in: Object.values(SCENARIO_THRESHOLD_KEYS) } } });
  const out: ScenarioThresholds = { ...SCENARIO_THRESHOLD_DEFAULTS };
  for (const [field, key] of Object.entries(SCENARIO_THRESHOLD_KEYS) as [keyof ScenarioThresholds, string][]) {
    const row = rows.find((r) => r.key === key);
    if (!row) continue;
    if (row.value === null && (field === 'lossEscalatePct' || field === 'lossReviewPct')) {
      out[field] = null;
      continue;
    }
    const v = Number(row.value);
    if (Number.isFinite(v) && v >= 0) out[field] = v;
  }
  return out;
}

/** Runs scenario maths for one portfolio against the ACTIVE limits that apply to it. Stores nothing. */
export async function computeScenario(portfolioIdOrRef: string, shocks: Partial<Shocks>, asOf?: Date): Promise<{ portfolioId: string; result: ScenarioResult }> {
  const date = asOf ?? new Date();
  const snap = await getPortfolioSnapshot(portfolioIdOrRef, { asOf: date });
  const limits = await activeLimitsFor(snap.portfolio.id);
  const result = runScenarioMaths(
    bookFromSnapshot(snap),
    shocks,
    limits.map((l) => ({ ref: l.ref, metric: l.metric as RiskMetric, threshold: l.threshold, breachAction: l.breachAction })),
    { asOf: snap.asOf, warnings: snap.warnings, thresholds: await loadScenarioThresholds() },
  );
  return { portfolioId: snap.portfolio.id, result };
}
