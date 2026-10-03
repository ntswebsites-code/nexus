import { Prisma } from '@prisma/client';

/**
 * IBOR pure rules: settlement dates, first-in first-out lot consumption, available-to-trade and the settlement ladder
 * bucket. No database access here, so the rules are unit-testable.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

/** Business days from trade to settlement by market (T+3 on the ZSE, VFEX and OTC placeholders; configurable here). */
export const SETTLEMENT_DAYS: Record<string, number> = { ZSE: 3, VFEX: 3, OTC: 1 };
export const settlementDaysFor = (market: string) => SETTLEMENT_DAYS[market] ?? 3;

/** Order statuses whose remaining quantity still commits the position (pending sales). */
export const OPEN_ORDER_STATUSES = ['Validated', 'AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled'];
/** Order statuses whose fills have not settled yet. */
export const UNSETTLED_ORDER_STATUSES = ['PartiallyFilled', 'Filled'];

export const LADDER_BUCKETS = ['OVERDUE', 'TODAY', 'T+1', 'T+2', 'T+3', 'LATER'] as const;
export type LadderBucket = (typeof LADDER_BUCKETS)[number];

const DAY = 86_400_000;
export const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Adds `n` business days (Monday to Friday) to a date. */
export function addBusinessDays(from: Date, n: number): Date {
  let d = utcDay(from);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return d;
}

export const settlementDate = (executedAt: Date, market: string) => addBusinessDays(executedAt, settlementDaysFor(market));

/** Bucket of a settlement date relative to today: how many business days away it is. */
export function ladderBucket(settleOn: Date, today: Date): LadderBucket {
  const s = utcDay(settleOn).getTime();
  const t = utcDay(today).getTime();
  if (s < t) return 'OVERDUE';
  if (s === t) return 'TODAY';
  for (let n = 1; n <= 3; n++) if (s <= addBusinessDays(today, n).getTime()) return `T+${n}` as LadderBucket;
  return 'LATER';
}

export interface LotLike {
  id: string;
  remainingQty: Dec;
  unitCost: Dec;
  openedOn: Date;
}

export interface Consumption {
  lotId: string;
  quantity: Dec;
  remainingAfter: Dec;
  unitCost: Dec;
}

/** Consumes `qty` from lots oldest first. Returns the draws and any quantity the lots could not cover. */
export function consumeFifo(lots: LotLike[], qty: Dec): { draws: Consumption[]; shortfall: Dec } {
  const ordered = [...lots].filter((l) => l.remainingQty.gt(0)).sort((a, b) => a.openedOn.getTime() - b.openedOn.getTime() || a.id.localeCompare(b.id));
  const draws: Consumption[] = [];
  let left = qty;
  for (const l of ordered) {
    if (left.lte(0)) break;
    const take = Prisma.Decimal.min(l.remainingQty, left);
    draws.push({ lotId: l.id, quantity: take, remainingAfter: l.remainingQty.sub(take), unitCost: l.unitCost });
    left = left.sub(take);
  }
  return { draws, shortfall: left.gt(0) ? left : ZERO };
}

/**
 * Available to trade (SRD 5.A.14 element 24): settled quantity less pending sales. Settled = held quantity less
 * unsettled buys plus unsettled sells (a sell still on the position until it settles). Pending sales are the unsettled
 * sells already filled plus the unfilled remainder of open sell orders. Private assets are restricted.
 */
export function availableToTrade(p: { quantity: Dec; unsettledBuys: Dec; unsettledSells: Dec; openSellRemaining: Dec; assetClass: string }) {
  const settled = p.quantity.sub(p.unsettledBuys).add(p.unsettledSells);
  const available = settled.sub(p.unsettledSells).sub(p.openSellRemaining);
  return {
    settled,
    restricted: p.assetClass === 'Private',
    available: available.lt(0) ? ZERO : available,
  };
}

/** Weighted average unit cost of the open lots (null when none). */
export function lotAverageCost(lots: { remainingQty: Dec; unitCost: Dec }[]): Dec | null {
  const qty = lots.reduce((a, l) => a.add(l.remainingQty), ZERO);
  if (qty.lte(0)) return null;
  return lots.reduce((a, l) => a.add(l.remainingQty.mul(l.unitCost)), ZERO).div(qty).toDecimalPlaces(6, D.ROUND_HALF_UP);
}
