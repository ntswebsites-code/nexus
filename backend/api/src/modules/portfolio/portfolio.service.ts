/**
 * Portfolio foundation service (SRD 6.5 FR-PORT-*, 5.A.2, 5.A.14).
 *
 * Shared, typed read helpers for the staff Orders and Risk modules. Import from here instead of
 * re-querying the portfolio tables, so every module values a book the same way.
 *
 * EXPORTS
 *   getPortfolioSnapshot(portfolioIdOrRef: string, opts?: { asOf?: Date }): Promise<PortfolioSnapshot>
 *     Positions (latest row per security at or before asOf) valued at the latest price at or before
 *     asOf, converted to the portfolio base currency with the latest fx_rates row, plus cash,
 *     weights (percent of total value = securities + cash), concentration and the mandate limits.
 *     Throws HttpError 404 for an unknown portfolio. Lines that cannot be valued (no price or no
 *     FX rate) are listed with `marketValueBase: null`, left out of the totals and named in
 *     `warnings`, so a caller never silently under- or over-states a book.
 *   getPortfolioSummaries(filters?, opts?): Promise<PortfolioSummary[]>
 *     One snapshot-derived row per portfolio (market value, cash %, concentration) for list screens.
 *   getSecurityWithPrice(securityIdOrTicker: string, opts?: { asOf?: Date }): Promise<SecurityWithPrice>
 *     Security master row plus latest and previous price (and change). 404 if unknown.
 *   getBrokerList(opts?: { activeOnly?: boolean }): Promise<BrokerView[]>
 *     Executing brokers, active only by default.
 *   getMandate(portfolio): PortfolioMandate  - typed read of `portfolios.mandate_json`.
 *   resolveFxRate(from, to, asOf): Promise<Decimal | null>
 *
 * Conventions: money and weights are decimal STRINGS in responses (money 2 dp, price 6 dp, weight
 * 4 dp percent); dates are `YYYY-MM-DD`. Percentages in the mandate are plain numbers (10 = 10%).
 * Prices are per unit in the security's own currency; `marketValue` is in that currency and
 * `marketValueBase` in the portfolio base currency.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { businessDaysBetween } from '../../integrations/common';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const startOfDay = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
const m2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const p6 = (v: Dec) => v.toDecimalPlaces(6, D.ROUND_HALF_UP).toFixed(6);
const w4 = (v: Dec) => v.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- types

/** Limits held in `portfolios.mandate_json`. All optional; percentages are 0-100. */
export interface PortfolioMandate {
  maxSingleNamePct?: number;
  maxSectorPct?: number;
  cashFloorPct?: number;
  maxCashPct?: number;
  maxPositions?: number;
  restrictedTickers?: string[];
  /** Orders pre-trade check: when set, only these markets (ZSE, VFEX, OTC) may be traded. */
  allowedMarkets?: string[];
  /** Orders pre-trade check: when set, only these asset classes may be traded. */
  allowedAssetClasses?: string[];
  notes?: string;
}

export interface PortfolioHeader {
  id: string;
  ref: string;
  name: string;
  type: string;
  baseCurrency: string;
  clientId: string | null;
  managerUserId: string | null;
  benchmark: string | null;
  status: string;
  mandate: PortfolioMandate;
  version: number;
}

export interface SnapshotLine {
  positionId: string;
  securityId: string;
  ticker: string;
  name: string;
  market: string;
  assetClass: string;
  sector: string | null;
  currency: string;
  quantity: string;
  avgCost: string;
  positionAsOf: string;
  price: string | null;
  priceDate: string | null;
  priceSource: string | null;
  /** quantity x price, security currency. */
  marketValue: string | null;
  fxRate: string | null;
  /** Portfolio base currency; null when unpriced or no FX rate. */
  marketValueBase: string | null;
  costBase: string | null;
  unrealisedPnlBase: string | null;
  /** Percent of total portfolio value (securities + cash), 4 dp; null when not valued. */
  weightPct: string | null;
}

export interface SnapshotCash {
  currency: string;
  available: string;
  asOf: string;
  fxRate: string | null;
  availableBase: string | null;
}

export interface Breakdown {
  key: string;
  valueBase: string;
  weightPct: string;
}

export interface PortfolioSnapshot {
  portfolio: PortfolioHeader;
  asOf: string;
  baseCurrency: string;
  lines: SnapshotLine[];
  cash: SnapshotCash[];
  totals: {
    securitiesValueBase: string;
    cashBase: string;
    totalValueBase: string;
    cashPct: string;
    positionCount: number;
  };
  concentration: {
    largestPositionTicker: string | null;
    largestPositionPct: string;
    top5Pct: string;
    bySector: Breakdown[];
    byMarket: Breakdown[];
    byAssetClass: Breakdown[];
  };
  warnings: string[];
  /** Positions valued on a price older than STALE_PRICE_BUSINESS_DAYS business days (still valued; informational). */
  staleWarnings: string[];
}

/** Same threshold the market-data panel uses to flag a price stale. */
export const STALE_PRICE_BUSINESS_DAYS = 3;

export interface PortfolioSummary extends PortfolioHeader {
  asOf: string;
  marketValueBase: string;
  securitiesValueBase: string;
  cashBase: string;
  cashPct: string;
  positionCount: number;
  largestPositionTicker: string | null;
  largestPositionPct: string;
  warnings: number;
  stalePrices: number;
}

export interface SecurityView {
  id: string;
  ticker: string;
  isin: string | null;
  name: string;
  market: string;
  assetClass: string;
  currency: string;
  boardLot: number;
  sector: string | null;
  status: string;
}

export interface PriceView {
  price: string;
  priceDate: string;
  source: string;
}

export interface SecurityWithPrice extends SecurityView {
  latestPrice: PriceView | null;
  previousPrice: PriceView | null;
  /** latest - previous, 6 dp, and as percent of previous (4 dp). Null without two prices. */
  change: string | null;
  changePct: string | null;
}

export interface BrokerView {
  id: string;
  name: string;
  email: string | null;
  status: string;
}

// ---------------------------------------------------------------- mappers

export function getMandate(p: { mandateJson: Prisma.JsonValue | null }): PortfolioMandate {
  const j = p.mandateJson;
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  return j as PortfolioMandate;
}

type PortfolioRow = Prisma.PortfolioGetPayload<object>;

export function portfolioHeader(p: PortfolioRow): PortfolioHeader {
  return {
    id: p.id,
    ref: p.ref,
    name: p.name,
    type: p.type,
    baseCurrency: p.baseCurrency,
    clientId: p.clientId,
    managerUserId: p.managerUserId,
    benchmark: p.benchmark,
    status: p.status,
    mandate: getMandate(p),
    version: p.version,
  };
}

export function securityView(s: Prisma.SecurityGetPayload<object>): SecurityView {
  return {
    id: s.id,
    ticker: s.ticker,
    isin: s.isin,
    name: s.name,
    market: s.market,
    assetClass: s.assetClass,
    currency: s.currency,
    boardLot: s.boardLot,
    sector: s.sector,
    status: s.status,
  };
}

const priceView = (p: { price: Prisma.Decimal; priceDate: Date; source: string }): PriceView => ({
  price: p6(p.price),
  priceDate: isoDay(p.priceDate)!,
  source: p.source,
});

// ---------------------------------------------------------------- prices and FX

/**
 * Latest price per security at or before `asOf` (newest date wins; on the same date the most recently
 * written row wins). Returns the latest and the one before it (a different date).
 */
export async function latestPrices(securityIds: string[], asOf: Date) {
  const out = new Map<string, { latest: PriceView; previous: PriceView | null; latestDec: Dec }>();
  if (!securityIds.length) return out;
  const rows = await prisma.securityPrice.findMany({
    where: { securityId: { in: securityIds }, priceDate: { lte: startOfDay(asOf) } },
    orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }],
  });
  const seen = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = seen.get(r.securityId) ?? [];
    if (list.length < 8) list.push(r);
    seen.set(r.securityId, list);
  }
  for (const [id, list] of seen) {
    const first = list[0]!;
    const prev = list.find((r) => r.priceDate.getTime() < first.priceDate.getTime()) ?? null;
    out.set(id, { latest: priceView(first), previous: prev ? priceView(prev) : null, latestDec: first.price });
  }
  return out;
}

/** Units of `to` per one unit of `from`, from the newest fx_rates row at or before `asOf` (inverse pairs honoured). */
export async function resolveFxRate(from: string, to: string, asOf: Date): Promise<Dec | null> {
  if (from === to) return new D(1);
  const day = startOfDay(asOf);
  const direct = await prisma.fxRate.findFirst({
    where: { fromCurrency: from, toCurrency: to, rateDate: { lte: day } },
    orderBy: { rateDate: 'desc' },
  });
  if (direct) return direct.rate;
  const inverse = await prisma.fxRate.findFirst({
    where: { fromCurrency: to, toCurrency: from, rateDate: { lte: day } },
    orderBy: { rateDate: 'desc' },
  });
  return inverse && !inverse.rate.isZero() ? new D(1).div(inverse.rate) : null;
}

// ---------------------------------------------------------------- snapshot

async function buildSnapshot(p: PortfolioRow, asOf: Date): Promise<PortfolioSnapshot> {
  const day = startOfDay(asOf);
  const [positionRows, cashRows] = await Promise.all([
    prisma.portfolioPosition.findMany({
      where: { portfolioId: p.id, asOf: { lte: day } },
      include: { security: true },
      orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.portfolioCash.findMany({ where: { portfolioId: p.id, asOf: { lte: day } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] }),
  ]);

  // Latest row per security / currency; a latest row of zero quantity closes the position.
  const current = new Map<string, (typeof positionRows)[number]>();
  for (const r of positionRows) if (!current.has(r.securityId)) current.set(r.securityId, r);
  const open = [...current.values()].filter((r) => !r.quantity.isZero());
  const cashCurrent = new Map<string, (typeof cashRows)[number]>();
  for (const r of cashRows) if (!cashCurrent.has(r.currency)) cashCurrent.set(r.currency, r);

  const prices = await latestPrices(open.map((r) => r.securityId), asOf);
  const fxCache = new Map<string, Dec | null>();
  const fx = async (from: string) => {
    if (!fxCache.has(from)) fxCache.set(from, await resolveFxRate(from, p.baseCurrency, asOf));
    return fxCache.get(from)!;
  };

  const warnings: string[] = [];
  const staleWarnings: string[] = [];
  interface Work {
    line: SnapshotLine;
    valueBase: Dec | null;
  }
  const work: Work[] = [];
  for (const r of open) {
    const s = r.security;
    const price = prices.get(s.id);
    const rate = await fx(s.currency);
    const mv = price ? r.quantity.mul(price.latestDec) : null;
    const mvBase = mv && rate ? mv.mul(rate) : null;
    const costBase = rate ? r.quantity.mul(r.avgCost).mul(rate) : null;
    if (!price) warnings.push(`${s.ticker}: no price on or before ${isoDay(day)}`);
    else if (!rate) warnings.push(`${s.ticker}: no ${s.currency}/${p.baseCurrency} FX rate`);
    if (price) {
      const age = businessDaysBetween(price.latest.priceDate, isoDay(day)!);
      if (age > STALE_PRICE_BUSINESS_DAYS) staleWarnings.push(`${s.ticker}: priced ${price.latest.priceDate} (${age} business days old)`);
    }
    work.push({
      valueBase: mvBase,
      line: {
        positionId: r.id,
        securityId: s.id,
        ticker: s.ticker,
        name: s.name,
        market: s.market,
        assetClass: s.assetClass,
        sector: s.sector,
        currency: s.currency,
        quantity: r.quantity.toFixed(6),
        avgCost: p6(r.avgCost),
        positionAsOf: isoDay(r.asOf)!,
        price: price ? price.latest.price : null,
        priceDate: price ? price.latest.priceDate : null,
        priceSource: price ? price.latest.source : null,
        marketValue: mv ? m2(mv) : null,
        fxRate: rate ? rate.toDecimalPlaces(10).toString() : null,
        marketValueBase: mvBase ? m2(mvBase) : null,
        costBase: mvBase && costBase ? m2(costBase) : null,
        unrealisedPnlBase: mvBase && costBase ? m2(mvBase.sub(costBase)) : null,
        weightPct: null,
      },
    });
  }

  const cash: SnapshotCash[] = [];
  let cashBase = ZERO;
  for (const c of cashCurrent.values()) {
    const rate = await fx(c.currency);
    const base = rate ? c.available.mul(rate) : null;
    if (!rate) warnings.push(`Cash ${c.currency}: no ${c.currency}/${p.baseCurrency} FX rate`);
    if (base) cashBase = cashBase.add(base);
    cash.push({
      currency: c.currency,
      available: m2(c.available),
      asOf: isoDay(c.asOf)!,
      fxRate: rate ? rate.toDecimalPlaces(10).toString() : null,
      availableBase: base ? m2(base) : null,
    });
  }
  cash.sort((a, b) => a.currency.localeCompare(b.currency));

  const securitiesBase = work.reduce((s, w) => (w.valueBase ? s.add(w.valueBase) : s), ZERO);
  const total = securitiesBase.add(cashBase);
  const pct = (v: Dec) => (total.isZero() ? ZERO : v.div(total).mul(HUNDRED));
  for (const w of work) w.line.weightPct = w.valueBase ? w4(pct(w.valueBase)) : null;

  const lines = work
    .sort((a, b) => (b.valueBase ?? ZERO).comparedTo(a.valueBase ?? ZERO) || a.line.ticker.localeCompare(b.line.ticker))
    .map((w) => w.line);
  const valued = work.filter((w) => w.valueBase).sort((a, b) => b.valueBase!.comparedTo(a.valueBase!));

  const group = (keyOf: (w: Work) => string, includeCash?: string): Breakdown[] => {
    const acc = new Map<string, Dec>();
    for (const w of valued) acc.set(keyOf(w), (acc.get(keyOf(w)) ?? ZERO).add(w.valueBase!));
    if (includeCash && !cashBase.isZero()) acc.set(includeCash, (acc.get(includeCash) ?? ZERO).add(cashBase));
    return [...acc.entries()]
      .sort((a, b) => b[1].comparedTo(a[1]))
      .map(([key, v]) => ({ key, valueBase: m2(v), weightPct: w4(pct(v)) }));
  };

  return {
    portfolio: portfolioHeader(p),
    asOf: isoDay(day)!,
    baseCurrency: p.baseCurrency,
    lines,
    cash,
    totals: {
      securitiesValueBase: m2(securitiesBase),
      cashBase: m2(cashBase),
      totalValueBase: m2(total),
      cashPct: w4(pct(cashBase)),
      positionCount: open.length,
    },
    concentration: {
      largestPositionTicker: valued[0]?.line.ticker ?? null,
      largestPositionPct: w4(valued[0]?.valueBase ? pct(valued[0].valueBase) : ZERO),
      top5Pct: w4(pct(valued.slice(0, 5).reduce((s, w) => s.add(w.valueBase!), ZERO))),
      bySector: group((w) => w.line.sector ?? 'Unclassified'),
      byMarket: group((w) => w.line.market),
      byAssetClass: group((w) => w.line.assetClass, 'Cash'),
    },
    warnings,
    staleWarnings,
  };
}

async function loadPortfolio(idOrRef: string): Promise<PortfolioRow> {
  const p = await prisma.portfolio.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef } });
  if (!p) throw HttpError.notFound('Portfolio not found');
  return p;
}

export { loadPortfolio };

export async function getPortfolioSnapshot(portfolioIdOrRef: string, opts: { asOf?: Date } = {}): Promise<PortfolioSnapshot> {
  return buildSnapshot(await loadPortfolio(portfolioIdOrRef), opts.asOf ?? new Date());
}

export interface PortfolioFilters {
  q?: string;
  type?: string;
  currency?: string;
  status?: string;
  clientId?: string;
  managerUserId?: string;
}

export async function getPortfolioSummaries(filters: PortfolioFilters = {}, opts: { asOf?: Date } = {}): Promise<PortfolioSummary[]> {
  const where: Prisma.PortfolioWhereInput = {};
  if (filters.q) where.OR = [{ name: { contains: filters.q } }, { ref: { contains: filters.q } }, { benchmark: { contains: filters.q } }];
  if (filters.type) where.type = filters.type;
  if (filters.currency) where.baseCurrency = filters.currency;
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.managerUserId) where.managerUserId = filters.managerUserId;
  const rows = await prisma.portfolio.findMany({ where, orderBy: [{ name: 'asc' }], take: 500 });
  const asOf = opts.asOf ?? new Date();
  const out: PortfolioSummary[] = [];
  for (const p of rows) {
    const s = await buildSnapshot(p, asOf);
    out.push({
      ...s.portfolio,
      asOf: s.asOf,
      marketValueBase: s.totals.totalValueBase,
      securitiesValueBase: s.totals.securitiesValueBase,
      cashBase: s.totals.cashBase,
      cashPct: s.totals.cashPct,
      positionCount: s.totals.positionCount,
      largestPositionTicker: s.concentration.largestPositionTicker,
      largestPositionPct: s.concentration.largestPositionPct,
      warnings: s.warnings.length,
      stalePrices: s.staleWarnings.length,
    });
  }
  return out;
}

// ---------------------------------------------------------------- securities and brokers

export async function getSecurityWithPrice(securityIdOrTicker: string, opts: { asOf?: Date } = {}): Promise<SecurityWithPrice> {
  const s = await prisma.security.findFirst({
    where: UUID.test(securityIdOrTicker) ? { id: securityIdOrTicker } : { ticker: securityIdOrTicker.toUpperCase() },
  });
  if (!s) throw HttpError.notFound('Security not found');
  return withPrice(s, (await latestPrices([s.id], opts.asOf ?? new Date())).get(s.id));
}

export function withPrice(
  s: Prisma.SecurityGetPayload<object>,
  price: { latest: PriceView; previous: PriceView | null } | undefined,
): SecurityWithPrice {
  let change: string | null = null;
  let changePct: string | null = null;
  if (price?.previous) {
    const diff = new D(price.latest.price).sub(price.previous.price);
    change = p6(diff);
    changePct = new D(price.previous.price).isZero() ? null : w4(diff.div(price.previous.price).mul(HUNDRED));
  }
  return { ...securityView(s), latestPrice: price?.latest ?? null, previousPrice: price?.previous ?? null, change, changePct };
}

export async function getBrokerList(opts: { activeOnly?: boolean } = {}): Promise<BrokerView[]> {
  const rows = await prisma.broker.findMany({ where: opts.activeOnly === false ? {} : { status: 'Active' }, orderBy: { name: 'asc' } });
  return rows.map((b) => ({ id: b.id, name: b.name, email: b.email, status: b.status }));
}
