import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { dateErrors, isElective, needsRate, needsRatio, CA_TYPES } from '../corporate-actions/ca.engine';
import type { CorporateActionAnnouncement } from '../../integrations/market-data/types';

/** Pure rules for the trading feeds: no database, no config. */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** One inbound line is identified by source, broker and the broker's own reference; the same line is never applied twice. */
export const lineDedupeKey = (source: string, brokerId: string | null | undefined, externalRef: string) => sha256(`${source}|${brokerId ?? ''}|${externalRef.trim()}`);

export const BREAK_REASONS = ['NO_ORDER', 'TICKER_MISMATCH', 'SIDE_MISMATCH', 'ORDER_NOT_WORKING', 'OVERFILL', 'LIMIT_BREACH', 'PRICE_DEVIATION', 'INSUFFICIENT_POSITION', 'APPLY_FAILED'] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export interface OrderFacts {
  status: string;
  side: string;
  ticker: string;
  quantity: Dec;
  filledQty: Dec;
  orderType: string;
  limitPrice: Dec | null;
  decisionPrice: Dec;
}
export interface LineFacts {
  ticker: string;
  side: string;
  quantity: Dec;
  price: Dec;
}

/** A market-order fill further than this from the decision price is a break (fat finger or a bad note). */
export const PRICE_DEVIATION_PCT = 25;

const WORKING = ['Routing', 'PartiallyFilled'];

/** Why a line cannot be applied to the order, or null when it can. `force` skips only the price-deviation check. */
export function checkMatch(o: OrderFacts, l: LineFacts, opts: { force?: boolean } = {}): { reason: BreakReason; detail: string } | null {
  if (o.ticker.toUpperCase() !== l.ticker.toUpperCase()) return { reason: 'TICKER_MISMATCH', detail: `The line is for ${l.ticker} but the order is for ${o.ticker}` };
  if (o.side !== l.side) return { reason: 'SIDE_MISMATCH', detail: `The line is a ${l.side} but the order is a ${o.side}` };
  if (!WORKING.includes(o.status)) return { reason: 'ORDER_NOT_WORKING', detail: `The order is ${o.status}; only Routing or PartiallyFilled orders take fills` };
  const remaining = o.quantity.sub(o.filledQty);
  if (l.quantity.gt(remaining)) return { reason: 'OVERFILL', detail: `The line fills ${l.quantity.toString()} but only ${remaining.toString()} remains on the order` };
  if ((o.orderType === 'LIMIT' || o.orderType === 'STOP_LIMIT') && o.limitPrice) {
    const breach = o.side === 'BUY' ? l.price.gt(o.limitPrice) : l.price.lt(o.limitPrice);
    if (breach) return { reason: 'LIMIT_BREACH', detail: `The price ${l.price.toString()} is outside the ${o.limitPrice.toString()} limit` };
  }
  if (!opts.force && o.orderType === 'MARKET' && o.decisionPrice.gt(0)) {
    const dev = l.price.sub(o.decisionPrice).abs().div(o.decisionPrice).mul(100);
    if (dev.gt(PRICE_DEVIATION_PCT)) return { reason: 'PRICE_DEVIATION', detail: `The price ${l.price.toString()} is ${dev.toFixed(1)}% away from the decision price ${o.decisionPrice.toString()}` };
  }
  return null;
}

/** HttpError code from applyFillTx -> break reason. */
export function reasonForApplyError(code: string | undefined): BreakReason {
  switch (code) {
    case 'overfill':
      return 'OVERFILL';
    case 'limit_breach':
      return 'LIMIT_BREACH';
    case 'insufficient_position':
      return 'INSUFFICIENT_POSITION';
    case 'invalid_transition':
      return 'ORDER_NOT_WORKING';
    default:
      return 'APPLY_FAILED';
  }
}

// ---------------------------------------------------------------- settlement

/** Business days from trade date to settlement by market. Assumption: ZSE T+3, VFEX T+2, OTC T+3 (confirm with the custodian). */
export const SETTLEMENT_DAYS: Record<string, number> = { ZSE: 3, VFEX: 2, OTC: 3 };

export function addBusinessDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export const settleDateFor = (market: string, tradeDate: string) => addBusinessDays(tradeDate, SETTLEMENT_DAYS[market] ?? 3);

export interface SettlementAmounts {
  gross: Dec;
  fees: Dec;
  net: Dec;
}
/** BUY pays gross + fees (RVP), SELL receives gross - fees (DVP). */
export function settlementAmounts(side: string, fills: { quantity: Dec; price: Dec; fees: Dec }[]): SettlementAmounts {
  const gross = fills.reduce((s, f) => s.add(f.quantity.mul(f.price)), new D(0)).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const fees = fills.reduce((s, f) => s.add(f.fees), new D(0)).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { gross, fees, net: side === 'BUY' ? gross.add(fees) : gross.sub(fees) };
}

// ---------------------------------------------------------------- corporate-action announcements

/** Same announcement, same key: source, ticker, type, ex-date and the economic terms. */
export const announcementKey = (a: Pick<CorporateActionAnnouncement, 'source' | 'ticker' | 'type' | 'exDate' | 'rate' | 'ratioNew' | 'ratioOld'>) =>
  sha256([a.source, a.ticker.toUpperCase(), a.type, a.exDate, a.rate ?? '', `${a.ratioNew ?? ''}:${a.ratioOld ?? ''}`].join('|'));

const DEC = (max: number) => new RegExp(`^\\d+(\\.\\d{1,${max}})?$`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Validation of a feed announcement against the corporate-action rules; returns messages (empty when it can be drafted). */
export function announcementErrors(a: CorporateActionAnnouncement): string[] {
  const errs: string[] = [];
  if (!(CA_TYPES as readonly string[]).includes(a.type)) return [`Unsupported action type ${a.type}`];
  for (const k of ['exDate', 'recordDate', 'payDate'] as const) if (!DAY.test(a[k] ?? '')) errs.push(`${k} must be YYYY-MM-DD`);
  if (a.electionDeadline && !DAY.test(a.electionDeadline)) errs.push('electionDeadline must be YYYY-MM-DD');
  if (errs.length) return errs;
  const t = (v: string) => new Date(`${v}T00:00:00.000Z`);
  for (const e of dateErrors(a.type, { exDate: t(a.exDate), recordDate: t(a.recordDate), payDate: t(a.payDate), electionDeadline: a.electionDeadline ? t(a.electionDeadline) : null })) errs.push(e.message);
  const rate = a.rate ? new D(a.rate) : null;
  if (a.rate && !DEC(8).test(a.rate)) errs.push('rate is not a decimal with up to 8 places');
  if (needsRate(a.type) && !(rate && rate.gt(0))) errs.push('The rate (cash per share or subscription price) is required');
  if (needsRatio(a.type)) {
    const ok = [a.ratioNew, a.ratioOld].every((r) => r && DEC(6).test(r) && new D(r).gt(0));
    if (!ok) errs.push('Both sides of the ratio (new : old) must be above zero');
  }
  if (a.type === 'MERGER' && !a.targetTicker) errs.push('The acquirer ticker is required for a merger');
  if (a.withholdingPct && !(DEC(4).test(a.withholdingPct) && new D(a.withholdingPct).lte(100))) errs.push('withholdingPct must be 0 to 100');
  if (isElective(a.type) && !a.electionDeadline) errs.push('An election deadline is required for this action');
  return errs;
}
