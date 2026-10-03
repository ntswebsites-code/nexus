import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { nextRef } from '../../lib/refs';
import { writeAudit } from '../../lib/audit';
import { audit } from '../ops/ops.common';
import { getPortfolioSnapshot, resolveFxRate, type SnapshotLine } from '../portfolio/portfolio.service';
import { DEFAULT_TOLERANCES, executeRun } from '../recon/recon.service';
import { OPEN_STATUSES } from '../recon/recon.engine';
import { LIVE_RESERVATION } from '../cash/cash.engine';
import {
  OPEN_ORDER_STATUSES,
  UNSETTLED_ORDER_STATUSES,
  LADDER_BUCKETS,
  availableToTrade,
  consumeFifo,
  ladderBucket,
  lotAverageCost,
  settlementDate,
  utcDay,
  type LadderBucket,
} from './ibor.engine';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const m2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);

export type PortfolioRow = Prisma.PortfolioGetPayload<object>;

export async function scope(idOrRef?: string): Promise<PortfolioRow[]> {
  if (idOrRef) {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const p = await prisma.portfolio.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef } });
    return p ? [p] : [];
  }
  return prisma.portfolio.findMany({ where: { status: { not: 'Closed' } }, orderBy: { name: 'asc' }, take: 500 });
}

// ================================================================ position view

export interface PositionRow {
  portfolioId: string;
  portfolioRef: string;
  portfolioName: string;
  securityId: string;
  ticker: string;
  name: string;
  market: string;
  assetClass: string;
  sector: string | null;
  currency: string;
  baseCurrency: string;
  quantity: string;
  settled: string;
  unsettled: string;
  unsettledBuys: string;
  unsettledSells: string;
  openSellRemaining: string;
  price: string | null;
  priceSource: string | null;
  marketValueLocal: string | null;
  marketValueBase: string | null;
  costBase: string | null;
  avgCost: string;
  accrued: string | null;
  available: string | null;
  restricted: boolean;
  lotCount: number;
  lotQuantity: string;
  drift: string;
  state: 'Current' | 'Review';
  reasons: string[];
}

/** Positions valued as of a date, with unsettled activity, available-to-trade, lots and book state per line. */
export async function positionRows(portfolios: PortfolioRow[], asOf: Date): Promise<{ rows: PositionRow[]; cash: Map<string, { available: Dec; reserved: Dec; currency: string }[]> }> {
  const ids = portfolios.map((p) => p.id);
  const day = utcDay(asOf);
  const [fills, openSells, lots, entitlements, reservations, breaks] = await Promise.all([
    prisma.orderFill.findMany({
      where: { order: { portfolioId: { in: ids }, status: { in: UNSETTLED_ORDER_STATUSES } }, executedAt: { lt: new Date(day.getTime() + 86_400_000) } },
      include: { order: { select: { portfolioId: true, securityId: true, side: true } } },
    }),
    prisma.order.findMany({ where: { portfolioId: { in: ids }, side: 'SELL', status: { in: OPEN_ORDER_STATUSES } }, select: { portfolioId: true, securityId: true, quantity: true, filledQty: true } }),
    prisma.iborLot.findMany({ where: { portfolioId: { in: ids }, status: 'OPEN' }, select: { portfolioId: true, securityId: true, remainingQty: true } }),
    prisma.corpActionEntitlement.findMany({ where: { portfolioId: { in: ids }, status: 'PENDING', event: { status: 'CONFIRMED', payDate: { gte: day } } }, select: { portfolioId: true, cashAmount: true, event: { select: { securityId: true } } } }),
    prisma.cashReservation.findMany({ where: { portfolioId: { in: ids }, status: { in: LIVE_RESERVATION }, OR: [{ expiresOn: null }, { expiresOn: { gte: day } }] }, select: { portfolioId: true, currency: true, amount: true, consumed: true } }),
    prisma.reconBreak.groupBy({ by: ['portfolioId'], where: { portfolioId: { in: ids }, family: 'HOLDINGS', status: { in: OPEN_STATUSES } }, _count: { _all: true } }),
  ]);
  const key = (p: string, s: string) => `${p}|${s}`;
  const buys = new Map<string, Dec>();
  const sells = new Map<string, Dec>();
  for (const f of fills) {
    const k = key(f.order.portfolioId, f.order.securityId);
    const m = f.order.side === 'BUY' ? buys : sells;
    m.set(k, (m.get(k) ?? ZERO).add(f.quantity));
  }
  const openSell = new Map<string, Dec>();
  for (const o of openSells) openSell.set(key(o.portfolioId, o.securityId), (openSell.get(key(o.portfolioId, o.securityId)) ?? ZERO).add(o.quantity.sub(o.filledQty)));
  const lotSum = new Map<string, { n: number; q: Dec }>();
  for (const l of lots) {
    const k = key(l.portfolioId, l.securityId);
    const c = lotSum.get(k) ?? { n: 0, q: ZERO };
    lotSum.set(k, { n: c.n + 1, q: c.q.add(l.remainingQty) });
  }
  const accrued = new Map<string, Dec>();
  for (const e of entitlements) accrued.set(key(e.portfolioId, e.event.securityId), (accrued.get(key(e.portfolioId, e.event.securityId)) ?? ZERO).add(e.cashAmount));
  const breakCount = new Map(breaks.map((b) => [b.portfolioId ?? '', b._count._all]));

  const rows: PositionRow[] = [];
  const cash = new Map<string, { available: Dec; reserved: Dec; currency: string }[]>();
  for (const p of portfolios) {
    const snap = await getPortfolioSnapshot(p.id, { asOf: day });
    const reserved = new Map<string, Dec>();
    for (const r of reservations.filter((x) => x.portfolioId === p.id)) reserved.set(r.currency, (reserved.get(r.currency) ?? ZERO).add(r.amount.sub(r.consumed)));
    cash.set(
      p.id,
      snap.cash.map((c) => ({ available: new D(c.availableBase ?? 0), reserved: reserved.get(c.currency) ?? ZERO, currency: c.currency })),
    );
    for (const l of snap.lines as SnapshotLine[]) {
      const k = key(p.id, l.securityId);
      const qty = new D(l.quantity);
      const ub = buys.get(k) ?? ZERO;
      const us = sells.get(k) ?? ZERO;
      const os = openSell.get(k) ?? ZERO;
      const att = availableToTrade({ quantity: qty, unsettledBuys: ub, unsettledSells: us, openSellRemaining: os, assetClass: l.assetClass });
      const lot = lotSum.get(k) ?? { n: 0, q: ZERO };
      const drift = qty.sub(lot.q);
      const reasons: string[] = [];
      if (l.marketValueBase === null) reasons.push(l.price === null ? 'No price' : 'No FX rate');
      if (lot.n === 0) reasons.push('No tax lots: refresh IBOR');
      else if (!drift.isZero()) reasons.push(`Lots differ from the position by ${drift.toString()}`);
      if ((breakCount.get(p.id) ?? 0) > 0) reasons.push('Open holdings reconciliation break');
      rows.push({
        portfolioId: p.id,
        portfolioRef: p.ref,
        portfolioName: p.name,
        securityId: l.securityId,
        ticker: l.ticker,
        name: l.name,
        market: l.market,
        assetClass: l.assetClass,
        sector: l.sector,
        currency: l.currency,
        baseCurrency: p.baseCurrency,
        quantity: qty.toFixed(6),
        settled: att.settled.toFixed(6),
        unsettled: ub.sub(us).toFixed(6),
        unsettledBuys: ub.toFixed(6),
        unsettledSells: us.toFixed(6),
        openSellRemaining: os.toFixed(6),
        price: l.price,
        priceSource: l.priceSource,
        marketValueLocal: l.marketValue,
        marketValueBase: l.marketValueBase,
        costBase: l.costBase,
        avgCost: l.avgCost,
        accrued: accrued.has(k) ? m2(accrued.get(k)!) : null,
        available: att.restricted ? null : att.available.toFixed(6),
        restricted: att.restricted,
        lotCount: lot.n,
        lotQuantity: lot.q.toFixed(6),
        drift: drift.toFixed(6),
        state: reasons.length ? 'Review' : 'Current',
        reasons,
      });
    }
  }
  return { rows, cash };
}

export async function overview(portfolios: PortfolioRow[], asOf: Date) {
  const { rows, cash } = await positionRows(portfolios, asOf);
  const day = utcDay(asOf);
  const byPortfolio = new Map<string, PortfolioRow>(portfolios.map((p) => [p.id, p]));
  let mv = ZERO;
  let availableCash = ZERO;
  let unsettledBuys = ZERO;
  let accrued = ZERO;
  // One reporting currency for every headline figure: the portfolio base when the scope has a
  // single base currency, otherwise USD. Per-portfolio base amounts are converted into it so the
  // totals never add USD to ZWG (ADB-003).
  const bases = new Set(portfolios.map((p) => p.baseCurrency));
  const reporting = bases.size === 1 ? [...bases][0]! : 'USD';
  const toReporting = async (amount: Dec, from: string): Promise<Dec> => {
    if (from === reporting) return amount;
    const fx = await resolveFxRate(from, reporting, day);
    return amount.mul(fx ?? 0);
  };
  for (const r of rows) {
    if (r.marketValueBase) mv = mv.add(await toReporting(new D(r.marketValueBase), r.baseCurrency));
    if (r.accrued) accrued = accrued.add(await toReporting(new D(r.accrued), r.baseCurrency));
  }
  for (const [pid, list] of cash) {
    const base = byPortfolio.get(pid)!.baseCurrency;
    for (const c of list) {
      const fx = c.currency === base ? new D(1) : await resolveFxRate(c.currency, base, day);
      availableCash = availableCash.add(await toReporting(c.available.sub(c.reserved).mul(fx ?? 0), base));
    }
  }
  const fills = await prisma.orderFill.findMany({
    where: { order: { portfolioId: { in: portfolios.map((p) => p.id) }, side: 'BUY', status: { in: UNSETTLED_ORDER_STATUSES } } },
    select: { quantity: true, price: true, fees: true, order: { select: { portfolioId: true, currency: true } } },
  });
  let liveInstructions = 0;
  for (const f of fills) {
    const base = byPortfolio.get(f.order.portfolioId)!.baseCurrency;
    const fx = f.order.currency === base ? new D(1) : await resolveFxRate(f.order.currency, base, day);
    unsettledBuys = unsettledBuys.add(await toReporting(f.quantity.mul(f.price).add(f.fees).mul(fx ?? 0), base));
    liveInstructions += 1;
  }
  const health = await bookHealth(portfolios, rows);
  const last = await prisma.iborEvent.findFirst({ where: { portfolioId: { in: portfolios.map((p) => p.id) } }, orderBy: { ref: 'desc' } });
  const snap = await prisma.iborSnapshot.findFirst({ where: portfolios.length === 1 ? { OR: [{ portfolioId: portfolios[0]!.id }, { portfolioId: null }] } : {}, orderBy: { createdAt: 'desc' } });
  const exceptions = rows.filter((r) => r.state === 'Review').length;
  return {
    asOf: iso(day),
    kpis: {
      currency: reporting,
      marketValueBase: m2(mv),
      positions: rows.length,
      portfolios: portfolios.length,
      availableCash: m2(availableCash),
      unsettledBuys: m2(unsettledBuys),
      unsettledBuyCount: liveInstructions,
      accruedIncome: m2(accrued),
      exceptions,
      materialExceptions: rows.filter((r) => r.reasons.some((x) => x.startsWith('No price') || x.startsWith('Lots differ') || x.startsWith('Open holdings'))).length,
    },
    control: {
      bookState: health.items.every((i) => i.ok) ? 'Current' : 'Review',
      lastEvent: last ? { ref: last.ref, type: last.eventType, summary: last.summary, at: last.createdAt.toISOString() } : null,
      lastRefresh: snap ? { ref: snap.ref, at: snap.createdAt.toISOString(), status: snap.status, durationMs: snap.durationMs } : null,
      refreshAgeSeconds: snap ? Math.max(0, Math.round((Date.now() - snap.createdAt.getTime()) / 1000)) : null,
    },
    health,
  };
}

// ================================================================ health

export async function bookHealth(portfolios: PortfolioRow[], rows?: PositionRow[]) {
  const ids = portfolios.map((p) => p.id);
  const day = utcDay(new Date());
  const pos = rows ?? (await positionRows(portfolios, day)).rows;
  const [fillCount, fillEvents, run, openBreaks] = await Promise.all([
    prisma.orderFill.count({ where: { order: { portfolioId: { in: ids } } } }),
    prisma.iborEvent.count({ where: { portfolioId: { in: ids }, sourceType: 'ORDER_FILL' } }),
    prisma.reconRun.findFirst({ where: { family: 'HOLDINGS', portfolioId: { in: ids } }, orderBy: { updatedAt: 'desc' } }),
    prisma.reconBreak.count({ where: { portfolioId: { in: ids }, family: 'HOLDINGS', status: { in: OPEN_STATUSES } } }),
  ]);
  const drift = pos.filter((r) => r.lotCount === 0 || !new D(r.drift).isZero()).length;
  const unpriced = pos.filter((r) => r.marketValueBase === null).length;
  const unprocessed = Math.max(0, fillCount - fillEvents);
  const items = [
    { key: 'lots', title: 'Tax lots agree with positions', ok: drift === 0, detail: drift === 0 ? 'Every position is backed by open lots.' : `${drift} position(s) without matching lots. Run Refresh IBOR.` },
    { key: 'fills', title: 'All fills ingested', ok: unprocessed === 0, detail: unprocessed === 0 ? 'No fills waiting to be booked to lots.' : `${unprocessed} fill(s) not yet booked. Run Refresh IBOR.` },
    { key: 'prices', title: 'Positions priced', ok: unpriced === 0, detail: unpriced === 0 ? 'Every position has a price and FX rate.' : `${unpriced} position(s) cannot be valued.` },
    {
      key: 'recon',
      title: 'Holdings reconciled to the custodian',
      ok: openBreaks === 0 && !!run && run.status !== 'SOURCE_MISSING',
      detail: !run ? 'No holdings reconciliation has been run for this scope.' : openBreaks > 0 ? `${openBreaks} open holdings break(s) in ${run.ref}.` : run.status === 'SOURCE_MISSING' ? `${run.ref}: custodian day-end source missing.` : `${run.ref} (${iso(run.asOfDate)}): ${run.status.toLowerCase()}.`,
    },
  ];
  return { items, openBreaks, latestRun: run ? { id: run.id, ref: run.ref, status: run.status, asOfDate: iso(run.asOfDate), breakCount: run.breakCount } : null };
}

// ================================================================ settlement ladder

export async function settlementLadder(portfolios: PortfolioRow[], today: Date) {
  const ids = portfolios.map((p) => p.id);
  const fills = await prisma.orderFill.findMany({
    where: { order: { portfolioId: { in: ids }, status: { in: UNSETTLED_ORDER_STATUSES } } },
    include: { order: { select: { ref: true, side: true, portfolioId: true, securityId: true, currency: true } } },
    orderBy: { executedAt: 'asc' },
  });
  const secs = await prisma.security.findMany({ where: { id: { in: [...new Set(fills.map((f) => f.order.securityId))] } }, select: { id: true, ticker: true, market: true } });
  const sec = new Map(secs.map((s) => [s.id, s]));
  const name = new Map(portfolios.map((p) => [p.id, p.name]));
  type Cell = { cash: Dec; buys: number; sells: number };
  const grid = new Map<string, Cell>();
  const items = fills.map((f) => {
    const s = sec.get(f.order.securityId);
    const settleOn = settlementDate(f.executedAt, s?.market ?? 'ZSE');
    const bucket = ladderBucket(settleOn, today);
    const gross = f.quantity.mul(f.price);
    const net = f.order.side === 'BUY' ? gross.add(f.fees).neg() : gross.sub(f.fees);
    const k = `${bucket}|${f.order.currency}`;
    const c = grid.get(k) ?? { cash: ZERO, buys: 0, sells: 0 };
    c.cash = c.cash.add(net);
    if (f.order.side === 'BUY') c.buys += 1;
    else c.sells += 1;
    grid.set(k, c);
    return {
      fillId: f.id,
      orderId: f.orderId,
      orderRef: f.order.ref,
      portfolioId: f.order.portfolioId,
      portfolioName: name.get(f.order.portfolioId) ?? null,
      ticker: s?.ticker ?? null,
      side: f.order.side,
      quantity: f.quantity.toString(),
      price: f.price.toString(),
      currency: f.order.currency,
      netCash: m2(net),
      executedOn: iso(f.executedAt),
      settlesOn: iso(settleOn),
      bucket,
    };
  });
  const buckets = LADDER_BUCKETS.map((b: LadderBucket) => ({
    bucket: b,
    flows: [...grid.entries()]
      .filter(([k]) => k.startsWith(`${b}|`))
      .map(([k, c]) => ({ currency: k.split('|')[1]!, netCash: m2(c.cash), buys: c.buys, sells: c.sells })),
  }));
  return { asOf: iso(utcDay(today)), buckets, items };
}

// ================================================================ lots

export async function lotViews(portfolioId: string, securityId?: string, status?: string) {
  const lots = await prisma.iborLot.findMany({ where: { portfolioId, ...(securityId ? { securityId } : {}), ...(status ? { status } : {}) }, orderBy: [{ openedOn: 'asc' }, { createdAt: 'asc' }], take: 1000 });
  const secs = await prisma.security.findMany({ where: { id: { in: [...new Set(lots.map((l) => l.securityId))] } }, select: { id: true, ticker: true, name: true } });
  const sec = new Map(secs.map((s) => [s.id, s]));
  const open = lots.filter((l) => l.status === 'OPEN');
  return {
    data: lots.map((l) => ({
      id: l.id,
      securityId: l.securityId,
      ticker: sec.get(l.securityId)?.ticker ?? null,
      name: sec.get(l.securityId)?.name ?? null,
      openedOn: iso(l.openedOn),
      originalQty: l.originalQty.toString(),
      remainingQty: l.remainingQty.toString(),
      unitCost: l.unitCost.toString(),
      costRemaining: m2(l.remainingQty.mul(l.unitCost)),
      currency: l.currency,
      sourceType: l.sourceType,
      sourceId: l.sourceId,
      status: l.status,
      closedOn: iso(l.closedOn),
    })),
    summary: { openLots: open.length, openQuantity: open.reduce((a, l) => a.add(l.remainingQty), ZERO).toString(), averageCost: lotAverageCost(open)?.toString() ?? null },
  };
}

// ================================================================ refresh (lots from fills, drift booked)

export interface RefreshResult {
  portfolios: number;
  positions: number;
  eventsIngested: number;
  lotsOpened: number;
  adjustments: number;
  exceptions: { portfolio: string; ticker: string; issue: string }[];
}

export async function refreshBook(req: Request, portfolios: PortfolioRow[], asOf: Date) {
  const started = Date.now();
  const actor = req.user!.id;
  const result: RefreshResult = { portfolios: portfolios.length, positions: 0, eventsIngested: 0, lotsOpened: 0, adjustments: 0, exceptions: [] };
  const today = utcDay(asOf);

  for (const p of portfolios) {
    await prisma.$transaction(
      async (tx) => {
        const positions = await tx.portfolioPosition.findMany({ where: { portfolioId: p.id, asOf: { lte: today } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
        const current = new Map<string, (typeof positions)[number]>();
        const firstSeen = new Map<string, Date>();
        for (const r of positions) {
          if (!current.has(r.securityId)) current.set(r.securityId, r);
          firstSeen.set(r.securityId, r.asOf);
        }
        const secIds = [...current.keys()];
        const secs = await tx.security.findMany({ where: { id: { in: secIds } }, select: { id: true, ticker: true, currency: true } });
        const sec = new Map(secs.map((s) => [s.id, s]));
        const fills = await tx.orderFill.findMany({ where: { order: { portfolioId: p.id } }, include: { order: { select: { side: true, securityId: true, ref: true } } }, orderBy: [{ executedAt: 'asc' }, { createdAt: 'asc' }] });
        const done = new Set((await tx.iborEvent.findMany({ where: { portfolioId: p.id, sourceType: 'ORDER_FILL' }, select: { sourceId: true } })).map((e) => e.sourceId));
        const todo = fills.filter((f) => !done.has(f.id));
        const lots = await tx.iborLot.findMany({ where: { portfolioId: p.id } });
        const pf = (txt: string) => `${p.ref} ${txt}`;
        const event = async (data: Omit<Prisma.IborEventUncheckedCreateInput, 'ref' | 'portfolioId' | 'createdBy'>) => {
          const ref = await nextRef(tx, 'iborEvent');
          return tx.iborEvent.create({ data: { ...data, ref, portfolioId: p.id, createdBy: actor } });
        };

        for (const secId of new Set([...secIds, ...todo.map((f) => f.order.securityId)])) {
          const s = sec.get(secId);
          const ticker = s?.ticker ?? secId.slice(0, 8);
          const currency = s?.currency ?? p.baseCurrency;
          const pos = current.get(secId);
          const posQty = pos?.quantity ?? ZERO;
          const mine = todo.filter((f) => f.order.securityId === secId);
          const net = mine.reduce((a, f) => (f.order.side === 'BUY' ? a.add(f.quantity) : a.sub(f.quantity)), ZERO);
          const own = lots.filter((l) => l.securityId === secId);
          result.positions += 1;

          if (own.length === 0 && pos) {
            const baseline = posQty.sub(net);
            if (baseline.gt(0)) {
              const opened = firstSeen.get(secId) ?? today;
              const e = await event({ securityId: secId, eventType: 'OPENING', quantityDelta: baseline, price: pos.avgCost, effectiveDate: opened, sourceType: 'OPENING', sourceId: `${p.id}:${secId}`, summary: pf(`${ticker}: opening lot of ${baseline.toString()} from the position record`), detail: { positionId: pos.id, avgCost: pos.avgCost.toString() } });
              own.push(await tx.iborLot.create({ data: { portfolioId: p.id, securityId: secId, openedOn: opened, originalQty: baseline, remainingQty: baseline, unitCost: pos.avgCost, currency, sourceType: 'OPENING', sourceId: e.ref } }));
              result.lotsOpened += 1;
              result.eventsIngested += 1;
            }
          }

          for (const f of mine) {
            const buy = f.order.side === 'BUY';
            if (buy) {
              const unit = f.quantity.mul(f.price).add(f.fees).div(f.quantity).toDecimalPlaces(6, D.ROUND_HALF_UP);
              await event({ securityId: secId, eventType: 'FILL', quantityDelta: f.quantity, price: f.price, effectiveDate: utcDay(f.executedAt), sourceType: 'ORDER_FILL', sourceId: f.id, summary: pf(`${ticker}: bought ${f.quantity.toString()} @ ${f.price.toString()} (${f.order.ref})`), detail: { orderId: f.orderId, fees: f.fees.toString(), unitCost: unit.toString() } });
              own.push(await tx.iborLot.create({ data: { portfolioId: p.id, securityId: secId, openedOn: utcDay(f.executedAt), originalQty: f.quantity, remainingQty: f.quantity, unitCost: unit, currency, sourceType: 'FILL', sourceId: f.id } }));
              result.lotsOpened += 1;
            } else {
              const { draws, shortfall } = consumeFifo(own.filter((l) => l.status === 'OPEN'), f.quantity);
              for (const d of draws) {
                const l = own.find((x) => x.id === d.lotId)!;
                const closed = d.remainingAfter.isZero();
                const upd = await tx.iborLot.update({ where: { id: l.id }, data: { remainingQty: d.remainingAfter, status: closed ? 'CLOSED' : 'OPEN', closedOn: closed ? utcDay(f.executedAt) : null } });
                own[own.indexOf(l)] = upd;
              }
              if (shortfall.gt(0)) result.exceptions.push({ portfolio: p.ref, ticker, issue: `Sell fill ${f.id.slice(0, 8)} exceeds open lots by ${shortfall.toString()}` });
              await event({ securityId: secId, eventType: 'FILL', quantityDelta: f.quantity.neg(), price: f.price, effectiveDate: utcDay(f.executedAt), sourceType: 'ORDER_FILL', sourceId: f.id, summary: pf(`${ticker}: sold ${f.quantity.toString()} @ ${f.price.toString()} (${f.order.ref})`), detail: { orderId: f.orderId, fees: f.fees.toString(), lotsConsumed: draws.map((d) => ({ lotId: d.lotId, quantity: d.quantity.toString(), unitCost: d.unitCost.toString() })), shortfall: shortfall.toString() } });
            }
            result.eventsIngested += 1;
          }

          // Drift: anything the position record holds that the lots do not (corporate actions, manual corrections).
          const lotQty = own.filter((l) => l.status === 'OPEN').reduce((a, l) => a.add(l.remainingQty), ZERO);
          const drift = posQty.sub(lotQty);
          if (!drift.isZero() && pos) {
            const e = await event({ securityId: secId, eventType: 'ADJUSTMENT', quantityDelta: drift, price: pos.avgCost, effectiveDate: today, summary: pf(`${ticker}: booked drift of ${drift.toString()} to match the position record`), detail: { positionQty: posQty.toString(), lotQtyBefore: lotQty.toString(), reason: 'Quantity changed outside order fills (corporate action or correction)' } });
            if (drift.gt(0)) {
              own.push(await tx.iborLot.create({ data: { portfolioId: p.id, securityId: secId, openedOn: today, originalQty: drift, remainingQty: drift, unitCost: pos.avgCost, currency, sourceType: 'ADJUSTMENT', sourceId: e.ref } }));
              result.lotsOpened += 1;
            } else {
              const { draws } = consumeFifo(own.filter((l) => l.status === 'OPEN'), drift.neg());
              for (const d of draws) {
                const l = own.find((x) => x.id === d.lotId)!;
                const closed = d.remainingAfter.isZero();
                own[own.indexOf(l)] = await tx.iborLot.update({ where: { id: l.id }, data: { remainingQty: d.remainingAfter, status: closed ? 'CLOSED' : 'OPEN', closedOn: closed ? today : null } });
              }
            }
            result.adjustments += 1;
            result.eventsIngested += 1;
          }
          lots.push(...own.filter((l) => !lots.some((x) => x.id === l.id)));
        }
        await event({ eventType: 'REFRESH', effectiveDate: today, summary: pf(`IBOR refreshed: ${todo.length} fill(s) ingested`), detail: { fills: todo.length } });
      },
      { timeout: 60_000 },
    );
  }

  const { rows } = await positionRows(portfolios, today);
  let mv = ZERO;
  for (const r of rows) if (r.marketValueBase) mv = mv.add(r.marketValueBase);
  const unpriced = rows.filter((r) => r.marketValueBase === null);
  for (const r of unpriced) result.exceptions.push({ portfolio: r.portfolioRef, ticker: r.ticker, issue: r.reasons[0] ?? 'Not valued' });
  const snapshot = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'iborSnapshot');
    const row = await tx.iborSnapshot.create({
      data: {
        ref,
        portfolioId: portfolios.length === 1 ? portfolios[0]!.id : null,
        asOf: today,
        status: result.exceptions.length ? 'EXCEPTIONS' : 'CURRENT',
        positionCount: rows.length,
        marketValueBase: mv.toDecimalPlaces(4),
        eventsIngested: result.eventsIngested,
        lotsOpened: result.lotsOpened,
        adjustments: result.adjustments,
        exceptionCount: result.exceptions.length,
        summary: { exceptions: result.exceptions } as unknown as Prisma.InputJsonValue,
        durationMs: Date.now() - started,
        createdBy: actor,
      },
    });
    await writeAudit(tx, audit(req), { action: 'ibor.refreshed', objectType: 'ibor_snapshot', objectId: row.id, after: { ref, portfolios: portfolios.map((p) => p.ref), eventsIngested: result.eventsIngested, lotsOpened: result.lotsOpened, adjustments: result.adjustments, exceptions: result.exceptions.length } });
    return row;
  });
  return { snapshot, result };
}

// ================================================================ reconciliation hook

/** Runs the Reconciliations module's HOLDINGS family for the portfolio and records the outcome in the book lineage. */
export async function reconcilePositions(req: Request, portfolio: PortfolioRow, asOfDate: string) {
  const out = await executeRun(req, { family: 'HOLDINGS', asOfDate, counterpartyId: null, portfolioId: portfolio.id, tolerances: DEFAULT_TOLERANCES });
  const run = await prisma.reconRun.findUniqueOrThrow({ where: { id: out.runId } });
  await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'iborEvent');
    await tx.iborEvent.create({
      data: { ref, portfolioId: portfolio.id, eventType: 'RECON', effectiveDate: new Date(`${asOfDate}T00:00:00.000Z`), summary: `${portfolio.ref} holdings reconciliation ${run.ref}: ${run.status}, ${run.breakCount} break(s)`, detail: { runId: run.id, runRef: run.ref, status: run.status, matched: run.matchedCount, breaks: run.breakCount, rerun: out.rerun }, createdBy: req.user!.id },
    });
    await writeAudit(tx, audit(req), { action: 'ibor.reconcile_requested', objectType: 'portfolio', objectId: portfolio.id, after: { runRef: run.ref, status: run.status, breaks: run.breakCount, asOfDate } });
  });
  return { run: { id: run.id, ref: run.ref, status: run.status, asOfDate: iso(run.asOfDate), matched: run.matchedCount, breaks: run.breakCount, rerun: out.rerun } };
}

