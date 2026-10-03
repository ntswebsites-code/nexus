/**
 * Pre-trade checks (SRD 6.6 FR-OMS-003 / FR-OMS-017).
 *
 * `runPreTradeChecks(portfolioId, { securityId, side, quantity, price })` returns one result per control
 * (Pass / Review / Fail) and an overall Within / Review / Blocked. It reads the portfolio through
 * `getPortfolioSnapshot` and never writes, so Risk can call it for what-if trades.
 *
 * Controls
 *   mandate        portfolio and security tradable, not restricted, market / asset class allowed, single-name
 *                  limit after the trade, position count, cash floor
 *   cash           buys: notional + estimated fee <= cash available minus cash reserved by other open buys
 *   position       sells: quantity <= held minus quantity already committed to other open sells
 *   concentration  post-trade weight of the name and of its sector against maxSectorPct (soft cap when no limit)
 *   liquidity      board lot multiple, size against average daily volume (Review above 10 %, Fail above 25 %)
 *   price          reference price against the latest price (Review beyond 10 %)
 *
 * Overall: any Fail -> Blocked; else any Review -> Review; else Within.
 * Money is evaluated in the security currency; weights in the portfolio base currency. A book that cannot be
 * fully valued (missing price or FX) never passes silently: the affected controls go to Review.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { orderCashView } from '../cash/cash.orders';
import { getPortfolioSnapshot, loadPortfolio, resolveFxRate, latestPrices } from '../portfolio/portfolio.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

/** Estimated brokerage, levies and taxes as a percent of notional (reserved on buys, shown on the ticket). */
export const FEE_ESTIMATE_PCT = 0.75;
/** Orders in these states hold cash (buys) or shares (sells) against the portfolio. */
export const RESERVING_STATUSES = ['AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled'] as const;

export type CheckResult = 'Pass' | 'Review' | 'Fail';
export type PreTradeOverall = 'Within' | 'Review' | 'Blocked';

export interface PreTradeCheck {
  key: 'mandate' | 'cash' | 'position' | 'concentration' | 'liquidity' | 'price';
  label: string;
  result: CheckResult;
  detail: string;
  metrics?: Record<string, string | number | null>;
}

export interface PreTradeInput {
  securityId: string;
  side: 'BUY' | 'SELL';
  quantity: string | number | Dec;
  /** Reference price in the security currency (limit price, or the latest price for a market order). */
  price: string | number | Dec;
  /** Leave this order's own reservation out (re-checking an order that is already open). */
  excludeOrderId?: string;
}

export interface PreTradeResult {
  overall: PreTradeOverall;
  checks: PreTradeCheck[];
  portfolioId: string;
  securityId: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  notional: string;
  estimatedFee: string;
  asOf: string;
  warnings: string[];
}

const m2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const w2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const q6 = (v: Dec) => v.toDecimalPlaces(6, D.ROUND_HALF_UP).toString();

export function estimateFee(notional: Dec): Dec {
  return notional.mul(FEE_ESTIMATE_PCT).div(HUNDRED).toDecimalPlaces(4, D.ROUND_HALF_UP);
}

export async function runPreTradeChecks(portfolioIdOrRef: string, input: PreTradeInput, opts: { asOf?: Date } = {}): Promise<PreTradeResult> {
  const asOf = opts.asOf ?? new Date();
  const portfolioRow = await loadPortfolio(portfolioIdOrRef);
  const security = await prisma.security.findUnique({ where: { id: input.securityId } });
  if (!security) throw HttpError.notFound('Security not found');

  const qty = new D(input.quantity);
  const price = new D(input.price);
  if (!qty.gt(0)) throw HttpError.badRequest('Quantity must be positive');
  if (!price.gt(0)) throw HttpError.badRequest('Price must be positive');

  const snapshot = await getPortfolioSnapshot(portfolioRow.id, { asOf });
  const mandate = snapshot.portfolio.mandate;
  const base = snapshot.baseCurrency;
  const buy = input.side === 'BUY';
  const notional = qty.mul(price);
  const fee = estimateFee(notional);
  const fx = await resolveFxRate(security.currency, base, asOf);
  const notionalBase = fx ? notional.mul(fx) : null;
  const feeBase = fx ? fee.mul(fx) : null;
  const total = new D(snapshot.totals.totalValueBase);
  const cashBase = new D(snapshot.totals.cashBase);
  const line = snapshot.lines.find((l) => l.securityId === security.id);
  const lineUnvalued = !!line && line.marketValueBase === null;
  const curBase = line?.marketValueBase ? new D(line.marketValueBase) : ZERO;
  const heldQty = line ? new D(line.quantity) : ZERO;
  const pct = (v: Dec) => (total.isZero() ? ZERO : v.div(total).mul(HUNDRED));

  // Why the weights cannot be trusted (an empty list means they can).
  const cannotValue: string[] = [];
  if (!fx) cannotValue.push(`no ${security.currency}/${base} FX rate`);
  if (snapshot.warnings.length) cannotValue.push(`${snapshot.warnings.length} holding(s) cannot be valued`);
  if (lineUnvalued) cannotValue.push(`${security.ticker} has no price on file for the current holding`);
  if (total.isZero()) cannotValue.push('the portfolio has no value');
  const valueNote = cannotValue.length ? ` Weights are indicative: ${cannotValue.join('; ')}.` : '';

  let postWeight: Dec | null = null;
  if (notionalBase && !total.isZero()) {
    const post = buy ? curBase.add(notionalBase) : Dec0(curBase.sub(notionalBase));
    postWeight = pct(post);
  }
  const curWeight = pct(curBase);

  const checks: PreTradeCheck[] = [];

  // ---------------------------------------------------------------- mandate
  {
    const fails: string[] = [];
    const reviews: string[] = [];
    const goods: string[] = [];
    if (portfolioRow.status !== 'Active') fails.push(`Portfolio is ${portfolioRow.status}`);
    if (security.status !== 'Active') fails.push(`${security.ticker} is ${security.status} and cannot be ordered`);
    const restricted = (mandate.restrictedTickers ?? []).map((t) => t.toUpperCase());
    if (restricted.includes(security.ticker.toUpperCase())) fails.push(`${security.ticker} is on the portfolio restricted list`);
    if (mandate.allowedMarkets?.length && !mandate.allowedMarkets.map((m) => m.toUpperCase()).includes(security.market.toUpperCase())) {
      fails.push(`Market ${security.market} is not allowed by the mandate (${mandate.allowedMarkets.join(', ')})`);
    }
    if (mandate.allowedAssetClasses?.length && !mandate.allowedAssetClasses.map((c) => c.toLowerCase()).includes(security.assetClass.toLowerCase())) {
      fails.push(`Asset class ${security.assetClass} is not allowed by the mandate (${mandate.allowedAssetClasses.join(', ')})`);
    }
    if (buy && mandate.maxSingleNamePct !== undefined) {
      if (postWeight === null) reviews.push(`Single-name limit ${mandate.maxSingleNamePct}% cannot be tested`);
      else if (postWeight.gt(mandate.maxSingleNamePct)) fails.push(`Post-trade weight ${w2(postWeight)}% exceeds the ${mandate.maxSingleNamePct}% single-name limit`);
      else if (postWeight.gt(new D(mandate.maxSingleNamePct).mul(0.95))) reviews.push(`Post-trade weight ${w2(postWeight)}% is within 5% of the ${mandate.maxSingleNamePct}% single-name limit`);
      else goods.push(`weight ${w2(postWeight)}% <= ${mandate.maxSingleNamePct}% single-name limit`);
    }
    if (buy && mandate.maxPositions !== undefined && !line && snapshot.totals.positionCount + 1 > mandate.maxPositions) {
      fails.push(`A new position would exceed the ${mandate.maxPositions}-position limit`);
    }
    if (buy && mandate.cashFloorPct !== undefined && notionalBase && feeBase && !total.isZero()) {
      const postCash = pct(cashBase.sub(notionalBase).sub(feeBase));
      if (postCash.lt(mandate.cashFloorPct)) reviews.push(`Post-trade cash ${w2(postCash)}% is below the ${mandate.cashFloorPct}% cash floor`);
    }
    if (!buy && mandate.maxCashPct !== undefined && notionalBase && !total.isZero()) {
      const postCash = pct(cashBase.add(notionalBase));
      if (postCash.gt(mandate.maxCashPct)) reviews.push(`Post-trade cash ${w2(postCash)}% is above the ${mandate.maxCashPct}% maximum cash limit`);
    }
    const result: CheckResult = fails.length ? 'Fail' : reviews.length ? 'Review' : 'Pass';
    checks.push({
      key: 'mandate',
      label: 'Mandate',
      result,
      detail: [...fails, ...reviews].join('. ') || `Within the mandate${goods.length ? ` (${goods.join('; ')})` : ''}.`,
      metrics: {
        postTradeWeightPct: postWeight ? w2(postWeight) : null,
        maxSingleNamePct: mandate.maxSingleNamePct ?? null,
        market: security.market,
        assetClass: security.assetClass,
      },
    });
  }

  // ---------------------------------------------------------------- cash
  {
    if (!buy) {
      checks.push({ key: 'cash', label: 'Cash', result: 'Pass', detail: 'Not applicable to a sell order.' });
    } else {
      const cashRow = snapshot.cash.find((c) => c.currency === security.currency);
      // The cash ledger (posted balance less buffer and every hold) is the book of record once the portfolio has a bank ledger.
      const ledgerView = await orderCashView(portfolioRow.id, security.currency, input.excludeOrderId);
      const available = ledgerView ? ledgerView.available : cashRow ? new D(cashRow.available) : ZERO;
      const reserved = ledgerView ? ledgerView.reserved : await reservedCash(portfolioRow.id, security.currency, input.excludeOrderId);
      const free = available.sub(reserved);
      const need = notional.add(fee);
      const ok = need.lte(free);
      checks.push({
        key: 'cash',
        label: 'Cash',
        result: ok ? 'Pass' : 'Fail',
        detail: ok
          ? `Needs ${security.currency} ${m2(need)} (notional ${m2(notional)} + estimated fee ${m2(fee)}); ${m2(free)} is free after ${m2(reserved)} reserved by other open buys.`
          : `Needs ${security.currency} ${m2(need)} (notional ${m2(notional)} + estimated fee ${m2(fee)}) but only ${m2(free)} is free (${m2(available)} available less ${m2(reserved)} reserved by other open buys).`,
        metrics: { available: m2(available), reserved: m2(reserved), free: m2(free), required: m2(need), currency: security.currency, source: ledgerView ? `cash ledger ${ledgerView.ledgerRef}` : 'portfolio cash' },
      });
    }
  }

  // ---------------------------------------------------------------- position
  {
    if (buy) {
      checks.push({ key: 'position', label: 'Position', result: 'Pass', detail: 'Not applicable to a buy order.' });
    } else {
      const committed = await committedShares(portfolioRow.id, security.id, input.excludeOrderId);
      const free = heldQty.sub(committed);
      const ok = qty.lte(free);
      checks.push({
        key: 'position',
        label: 'Position',
        result: ok ? 'Pass' : 'Fail',
        detail: ok
          ? `Selling ${q6(qty)} of ${q6(heldQty)} held (${q6(committed)} already committed to other open sells).`
          : `Selling ${q6(qty)} but only ${q6(free)} is free (${q6(heldQty)} held, ${q6(committed)} committed to other open sells).`,
        metrics: { held: q6(heldQty), committed: q6(committed), free: q6(free) },
      });
    }
  }

  // ---------------------------------------------------------------- concentration
  {
    const bits: string[] = [];
    let result: CheckResult = 'Pass';
    if (postWeight === null) {
      result = 'Review';
      bits.push(`Post-trade concentration cannot be computed.${valueNote}`);
    } else {
      bits.push(`${security.ticker} moves from ${w2(curWeight)}% to ${w2(postWeight)}% of the portfolio.`);
      if (cannotValue.length) result = 'Review';
      const sectorKey = security.sector ?? 'Unclassified';
      const sectorNow = snapshot.concentration.bySector.find((s) => s.key === sectorKey);
      const sectorValue = sectorNow ? new D(sectorNow.valueBase) : ZERO;
      const sectorPost = pct(buy ? sectorValue.add(notionalBase!) : Dec0(sectorValue.sub(notionalBase!)));
      bits.push(`${sectorKey} sector ${w2(sectorPost)}%.`);
      if (mandate.maxSectorPct !== undefined && buy) {
        if (sectorPost.gt(mandate.maxSectorPct)) {
          result = 'Fail';
          bits.push(`Exceeds the ${mandate.maxSectorPct}% sector limit.`);
        } else if (sectorPost.gt(new D(mandate.maxSectorPct).mul(0.95)) && result === 'Pass') {
          result = 'Review';
          bits.push(`Within 5% of the ${mandate.maxSectorPct}% sector limit.`);
        }
      } else if (buy && mandate.maxSingleNamePct === undefined && postWeight.gt(25) && result === 'Pass') {
        result = 'Review';
        bits.push('No single-name limit is set and the weight is above the 25% soft cap.');
      }
      if (cannotValue.length) bits.push(valueNote.trim());
    }
    checks.push({
      key: 'concentration',
      label: 'Concentration',
      result,
      detail: bits.join(' '),
      metrics: { currentWeightPct: w2(curWeight), postTradeWeightPct: postWeight ? w2(postWeight) : null, top5Pct: snapshot.concentration.top5Pct },
    });
  }

  // ---------------------------------------------------------------- liquidity
  {
    const bits: string[] = [];
    let result: CheckResult = 'Pass';
    const lot = security.boardLot > 0 ? security.boardLot : 1;
    if (!qty.mod(lot).isZero()) {
      result = 'Fail';
      bits.push(`Quantity ${q6(qty)} is not a multiple of the board lot (${lot}).`);
    }
    const adv = security.averageDailyVolume;
    let advPct: Dec | null = null;
    if (adv && adv.gt(0)) {
      advPct = qty.div(adv).mul(HUNDRED);
      if (advPct.gt(25)) {
        result = 'Fail';
        bits.push(`Order is ${w2(advPct)}% of average daily volume (limit 25%).`);
      } else if (advPct.gt(10)) {
        if (result === 'Pass') result = 'Review';
        bits.push(`Order is ${w2(advPct)}% of average daily volume (review above 10%).`);
      } else {
        bits.push(`Order is ${w2(advPct)}% of average daily volume.`);
      }
    } else {
      bits.push('No average daily volume on file; only the board lot was checked.');
    }
    if (result === 'Pass' && !bits[0]?.startsWith('Quantity')) bits.unshift(`Board lot ${lot} respected.`);
    checks.push({ key: 'liquidity', label: 'Liquidity', result, detail: bits.join(' '), metrics: { boardLot: lot, averageDailyVolume: adv ? adv.toString() : null, pctOfAdv: advPct ? w2(advPct) : null } });
  }

  // ---------------------------------------------------------------- price
  {
    const last = (await latestPrices([security.id], asOf)).get(security.id);
    if (!last) {
      checks.push({ key: 'price', label: 'Price', result: 'Fail', detail: `${security.ticker} has no price on file.` });
    } else {
      const dev = price.sub(last.latestDec).div(last.latestDec).mul(HUNDRED);
      const far = dev.abs().gt(10);
      checks.push({
        key: 'price',
        label: 'Price',
        result: far ? 'Review' : 'Pass',
        detail: far
          ? `Reference price ${price.toString()} is ${w2(dev)}% from the last price ${last.latest.price} (${last.latest.priceDate}); beyond +/-10%.`
          : `Reference price ${price.toString()} is within 10% of the last price ${last.latest.price} (${last.latest.priceDate}).`,
        metrics: { lastPrice: last.latest.price, priceDate: last.latest.priceDate, deviationPct: w2(dev) },
      });
    }
  }

  const overall: PreTradeOverall = checks.some((c) => c.result === 'Fail') ? 'Blocked' : checks.some((c) => c.result === 'Review') ? 'Review' : 'Within';
  return {
    overall,
    checks,
    portfolioId: portfolioRow.id,
    securityId: security.id,
    side: input.side,
    quantity: q6(qty),
    price: price.toString(),
    currency: security.currency,
    notional: m2(notional),
    estimatedFee: m2(fee),
    asOf: snapshot.asOf,
    warnings: snapshot.warnings,
  };
}

function Dec0(v: Dec): Dec {
  return v.lt(0) ? ZERO : v;
}

/** Cash held back by open buys in a currency (optionally leaving one order out). */
export async function reservedCash(portfolioId: string, currency: string, excludeOrderId?: string): Promise<Dec> {
  const agg = await prisma.order.aggregate({
    _sum: { reservedAmount: true },
    where: {
      portfolioId,
      currency,
      side: 'BUY',
      status: { in: [...RESERVING_STATUSES] },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
  });
  return agg._sum.reservedAmount ?? ZERO;
}

/** Shares of a security already committed to open sells (remaining quantity). */
export async function committedShares(portfolioId: string, securityId: string, excludeOrderId?: string): Promise<Dec> {
  const rows = await prisma.order.findMany({
    where: {
      portfolioId,
      securityId,
      side: 'SELL',
      status: { in: [...RESERVING_STATUSES] },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { quantity: true, filledQty: true },
  });
  return rows.reduce((s, r) => s.add(r.quantity.sub(r.filledQty)), ZERO);
}
