import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getPortfolioSnapshot } from '../portfolio/portfolio.service';
import {
  DEFAULT_SETTLE_OFFSET_DAYS,
  addDaysIso,
  detectSettlementFails,
  matchCorpActions,
  matchPositions,
  type CustodyNotice,
  type Detected,
  type IntEntitlement,
  type SettleTrade,
  type Tolerances,
} from './recon.engine';
import type { RunInput, ScopeAccount } from './recon.service';

/**
 * Detection for the families that need data beyond the day-end package: positions vs custody quantities, settlement
 * fails and corporate-action entitlements. Same contract as the other families: a missing source is reported, never
 * raised as a break (BR-065).
 */
const D = Prisma.Decimal;
const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface FamilyResult {
  detected: Detected[];
  matchedCount: number;
  missingSources: { counterpartyRef: string; accountRef: string; reason: string }[];
}

function byPortfolio(accounts: ScopeAccount[]) {
  const m = new Map<string, ScopeAccount[]>();
  for (const a of accounts) m.set(a.portfolioId, [...(m.get(a.portfolioId) ?? []), a]);
  return m;
}

const hasReceipt = (a: ScopeAccount, date: string, feed: 'POSITIONS' | 'CORP_ACTIONS') =>
  prisma.reconSourceReceipt.findUnique({ where: { counterpartyId_accountRef_asOfDate_feed: { counterpartyId: a.counterpartyId, accountRef: a.accountRef, asOfDate: dayStart(date), feed } } });

/** Source health for the two file-fed families; used by sign-off readiness too. */
export async function receiptMissing(a: { counterpartyId: string; accountRef: string }, date: string, feed: 'POSITIONS' | 'CORP_ACTIONS') {
  return !(await prisma.reconSourceReceipt.findUnique({ where: { counterpartyId_accountRef_asOfDate_feed: { counterpartyId: a.counterpartyId, accountRef: a.accountRef, asOfDate: dayStart(date), feed } }, select: { id: true } }));
}

export async function detectPositions(input: RunInput, accounts: ScopeAccount[]): Promise<FamilyResult> {
  const tol = new D(input.tolerances.positionQty);
  const out: FamilyResult = { detected: [], matchedCount: 0, missingSources: [] };
  for (const [portfolioId, accs] of byPortfolio(accounts)) {
    const ready: ScopeAccount[] = [];
    for (const a of accs) {
      if (await hasReceipt(a, input.asOfDate, 'POSITIONS')) ready.push(a);
      else out.missingSources.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef, reason: `No custody position file for ${input.asOfDate}` });
    }
    if (!ready.length) continue;
    const snap = await getPortfolioSnapshot(portfolioId, { asOf: dayStart(input.asOfDate) });
    const rows = await prisma.reconCustodyPosition.findMany({
      where: { asOfDate: dayStart(input.asOfDate), OR: ready.map((a) => ({ counterpartyId: a.counterpartyId, accountRef: a.accountRef })) },
    });
    const cps = [...new Set(ready.map((a) => a.counterpartyId))];
    const first = ready[0]!;
    const r = matchPositions(
      snap.lines.map((l) => ({ ticker: l.ticker, quantity: new D(l.quantity) })),
      rows.map((x) => ({ ticker: x.ticker, quantity: x.quantity })),
      tol,
      {
        counterpartyId: cps.length === 1 ? cps[0]! : first.counterpartyId,
        counterpartyRef: cps.length === 1 ? first.counterpartyRef : 'MULTI',
        accountRef: ready.map((a) => a.accountRef).join('+').slice(0, 60),
        portfolioId,
        portfolioRef: first.portfolioRef,
      },
    );
    out.matchedCount += r.matched;
    out.detected.push(...r.detected);
  }
  return out;
}

export async function detectSettlement(input: RunInput, accounts: ScopeAccount[]): Promise<FamilyResult> {
  const out: FamilyResult = { detected: [], matchedCount: 0, missingSources: [] };
  const asOfEnd = dayEnd(input.asOfDate);
  for (const [portfolioId, accs] of byPortfolio(accounts)) {
    const orders = await prisma.order.findMany({
      where: { portfolioId, OR: [{ status: 'Filled' }, { status: 'Settled', updatedAt: { gte: asOfEnd } }] },
      select: { id: true, ref: true, side: true, currency: true, securityId: true, filledQty: true, quantity: true },
    });
    if (!orders.length) continue;
    const fills = await prisma.orderFill.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, executedAt: { lt: asOfEnd } }, orderBy: { executedAt: 'asc' } });
    const secs = await prisma.security.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.securityId))] } }, select: { id: true, ticker: true } });
    const ticker = new Map(secs.map((s) => [s.id, s.ticker]));
    const refsByOrder = new Map<string, string[]>();
    const lastFill = new Map<string, Date>();
    for (const f of fills) {
      lastFill.set(f.orderId, f.executedAt);
      if (f.sourceRef) refsByOrder.set(f.orderId, [...(refsByOrder.get(f.orderId) ?? []), f.sourceRef]);
    }
    const allRefs = orders.flatMap((o) => [o.ref, ...(refsByOrder.get(o.id) ?? [])]);
    const execs = await prisma.counterpartyExecution.findMany({
      where: { status: { not: 'Superseded' }, tradeRef: { in: allRefs }, OR: accs.map((a) => ({ counterpartyId: a.counterpartyId, accountRef: a.accountRef })) },
    });
    const trades: SettleTrade[] = [];
    for (const o of orders) {
      const lf = lastFill.get(o.id);
      if (!lf) continue; // no fill on or before the date: nothing to settle yet
      const refs = new Set([o.ref, ...(refsByOrder.get(o.id) ?? [])].map((r) => r.trim().toUpperCase()));
      const ex = execs.find((e) => refs.has(e.tradeRef.trim().toUpperCase()) && e.settlementDate);
      const tradeDate = isoDay(lf);
      const cp = ex ? accs.find((a) => a.counterpartyId === ex.counterpartyId) : accs[0];
      trades.push({
        orderRef: o.ref,
        ticker: ticker.get(o.securityId) ?? '',
        side: o.side,
        quantity: o.filledQty.isZero() ? o.quantity : o.filledQty,
        currency: o.currency,
        portfolioId,
        tradeDate,
        expectedSettle: ex?.settlementDate ? isoDay(ex.settlementDate) : addDaysIso(tradeDate, DEFAULT_SETTLE_OFFSET_DAYS),
        settleSource: ex?.settlementDate ? 'CUSTODIAN' : 'DEFAULT',
        counterpartyId: cp?.counterpartyId ?? null,
        counterpartyRef: cp?.counterpartyRef ?? null,
        accountRef: ex?.accountRef ?? cp?.accountRef ?? null,
        settled: false,
      });
    }
    // Trades settled inside the recent window count as matched (they were examined and are fine).
    const recentlySettled = await prisma.order.count({ where: { portfolioId, status: 'Settled', updatedAt: { gte: new Date(asOfEnd.getTime() - 30 * 86_400_000), lt: asOfEnd } } });
    const r = detectSettlementFails(trades, input.asOfDate, input.tolerances.settleDays);
    out.matchedCount += r.matched + recentlySettled;
    out.detected.push(...r.detected);
  }
  return out;
}

export async function detectCorpActions(input: RunInput, accounts: ScopeAccount[]): Promise<FamilyResult> {
  const cashTol = new D(input.tolerances.caCash);
  const out: FamilyResult = { detected: [], matchedCount: 0, missingSources: [] };
  const pay = dayStart(input.asOfDate);
  const events = await prisma.corpActionEvent.findMany({ where: { payDate: pay, status: { in: ['CONFIRMED', 'PROCESSED'] } } });
  for (const [portfolioId, accs] of byPortfolio(accounts)) {
    const ents = events.length ? await prisma.corpActionEntitlement.findMany({ where: { portfolioId, eventId: { in: events.map((e) => e.id) }, status: { not: 'SKIPPED' } } }) : [];
    const evById = new Map(events.map((e) => [e.id, e]));
    const internal: IntEntitlement[] = ents.map((x) => {
      const e = evById.get(x.eventId)!;
      return { eventRef: e.ref, ticker: e.ticker, type: e.type, exDate: isoDay(e.exDate), portfolioId, quantity: x.quantity, cashAmount: x.cashAmount, currency: e.currency };
    });
    const ready: ScopeAccount[] = [];
    for (const a of accs) {
      if (await hasReceipt(a, input.asOfDate, 'CORP_ACTIONS')) ready.push(a);
      else if (internal.length) out.missingSources.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef, reason: `No custodian corporate-action file for ${input.asOfDate}` });
    }
    if (!ready.length) continue;
    const notices = await prisma.reconCustodyCaNotice.findMany({ where: { payDate: pay, OR: ready.map((a) => ({ counterpartyId: a.counterpartyId, accountRef: a.accountRef })) } });
    const custody: CustodyNotice[] = notices.map((n) => ({ ticker: n.ticker, exDate: isoDay(n.exDate), quantity: n.quantity, cashAmount: n.cashAmount, currency: n.currency, externalRef: n.externalRef }));
    const first = ready[0]!;
    const cps = [...new Set(ready.map((a) => a.counterpartyId))];
    const r = matchCorpActions(internal, custody, cashTol, {
      counterpartyId: first.counterpartyId,
      counterpartyRef: cps.length === 1 ? first.counterpartyRef : 'MULTI',
      accountRef: ready.map((a) => a.accountRef).join('+').slice(0, 60),
      portfolioId,
      portfolioRef: first.portfolioRef,
    });
    out.matchedCount += r.matched;
    out.detected.push(...r.detected);
  }
  return out;
}

export type { Tolerances };
