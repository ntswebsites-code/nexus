import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { audit } from '../ops/ops.common';
import {
  ELECTION_OPTIONS,
  applyToPosition,
  computeEntitlement,
  fractionCost,
  effectDateField,
  isElective,
  normaliseOption,
  type CaType,
  type EventParams,
} from './ca.engine';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EventRow = Prisma.CorpActionEventGetPayload<object>;
export type EntRow = Prisma.CorpActionEntitlementGetPayload<object>;

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const f2 = (v: Dec) => v.toFixed(2);

export const params = (e: EventRow): EventParams => ({ type: e.type, rate: e.rate, ratioNew: e.ratioNew, ratioOld: e.ratioOld, withholdingPct: e.withholdingPct, cilPrice: e.cashInLieu ? e.cilPrice : null });

export async function loadEvent(idOrRef: string): Promise<EventRow> {
  const e = await prisma.corpActionEvent.findFirst({ where: UUID.test(idOrRef) ? { id: idOrRef } : { ref: idOrRef.toUpperCase() } });
  if (!e) throw HttpError.notFound('Corporate action not found');
  return e;
}

async function names(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

/** The end of the election window: the deadline day itself is still open. */
export const electionOpen = (e: EventRow, now = new Date()) => !e.electionDeadline || now.getTime() < e.electionDeadline.getTime() + 24 * 3600 * 1000;

// ---------------------------------------------------------------- entitlements

/**
 * Calculates (or recalculates) the entitlements from every portfolio's position at the record date: the latest position
 * row on or before it. Elections already recorded are kept when still valid. Only for events not yet processed.
 */
export async function calculateEntitlements(req: Request, e: EventRow) {
  if (e.status !== 'ANNOUNCED' && e.status !== 'CONFIRMED') throw HttpError.conflict(`${e.ref} is ${e.status}; entitlements can only be calculated while it is ANNOUNCED or CONFIRMED`, 'invalid_state');
  if (e.recordDate.getTime() > startOfDay(new Date()).getTime()) {
    throw HttpError.conflict(`The record date ${isoDay(e.recordDate)} has not passed; positions are only known once it has`, 'record_date_not_reached');
  }
  const rows = await prisma.portfolioPosition.findMany({
    where: { securityId: e.securityId, asOf: { lte: e.recordDate }, portfolio: { status: { not: 'Closed' } } },
    orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }],
  });
  const holdings = new Map<string, Dec>();
  for (const r of rows) if (!holdings.has(r.portfolioId)) holdings.set(r.portfolioId, r.quantity);
  const held = [...holdings].filter(([, q]) => q.gt(0));

  const me = req.user!.id;
  return prisma.$transaction(async (tx) => {
    const fresh = await tx.corpActionEvent.findUniqueOrThrow({ where: { id: e.id } });
    if (fresh.status !== 'ANNOUNCED' && fresh.status !== 'CONFIRMED') throw HttpError.conflict('The event moved on; reload', 'version_conflict');
    const prior = new Map((await tx.corpActionEntitlement.findMany({ where: { eventId: e.id } })).map((p) => [p.portfolioId, p]));
    await tx.corpActionEntitlement.deleteMany({ where: { eventId: e.id } });
    let cash = ZERO;
    let shares = ZERO;
    for (const [portfolioId, qty] of held) {
      const old = prior.get(portfolioId);
      const keep = old?.elected ? old : null;
      let option: string | null = null;
      try {
        option = normaliseOption(e.type, keep?.option ?? null, e.defaultOption);
      } catch {
        option = normaliseOption(e.type, null, e.defaultOption);
      }
      const c = computeEntitlement(params(e), qty, option);
      cash = cash.add(c.cash);
      shares = shares.add(c.sharesDelta);
      await tx.corpActionEntitlement.create({
        data: {
          eventId: e.id,
          portfolioId,
          quantity: qty,
          option,
          elected: !!keep,
          electedBy: keep?.electedBy ?? null,
          electedAt: keep?.electedAt ?? null,
          grossAmount: c.gross,
          taxAmount: c.tax,
          cashAmount: c.cash,
          sharesDelta: c.sharesDelta,
          targetShares: c.targetShares,
          cashInLieu: c.cashInLieu,
          detail: { fraction: c.fraction.toString(), addedCost: c.addedCost.toString() } as Prisma.InputJsonValue,
        },
      });
    }
    await tx.corpActionEvent.update({ where: { id: e.id }, data: { entitlementsAt: new Date() } });
    await writeAudit(tx, audit(req), {
      action: 'corp_action.entitlements_calculated',
      objectType: 'corp_action',
      objectId: e.id,
      after: { ref: e.ref, recordDate: isoDay(e.recordDate), portfolios: held.length, netCash: cash.toFixed(4), sharesDelta: shares.toString(), by: me },
    });
    return { portfolios: held.length };
  });
}

/** Re-prices one entitlement for a chosen option. */
export function repriceFor(e: EventRow, qty: Dec, option: string | null) {
  const c = computeEntitlement(params(e), qty, option);
  return {
    option,
    grossAmount: c.gross,
    taxAmount: c.tax,
    cashAmount: c.cash,
    sharesDelta: c.sharesDelta,
    targetShares: c.targetShares,
    cashInLieu: c.cashInLieu,
    detail: { fraction: c.fraction.toString(), addedCost: c.addedCost.toString() } as Prisma.InputJsonValue,
  };
}

// ---------------------------------------------------------------- processing

/** Latest row on or before `day`, else null. */
async function latestPosition(tx: Prisma.TransactionClient, portfolioId: string, securityId: string, day: Date) {
  return tx.portfolioPosition.findFirst({ where: { portfolioId, securityId, asOf: { lte: day } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
}

/**
 * Applies every PENDING entitlement to the portfolio books through the same append-by-date rows Orders uses
 * (`positions`, `portfolio_cash`): the position change and the cash land on the effect date (ex-date for splits and
 * bonus issues, else pay date; never earlier than today, history is not rewritten). Unelected holders get the default
 * option. Runs inside the caller's transaction.
 */
export async function applyEntitlements(tx: Prisma.TransactionClient, e: EventRow) {
  const effective = new Date(Math.max(e[effectDateField(e.type)].getTime(), startOfDay(new Date()).getTime()));
  const ents = await tx.corpActionEntitlement.findMany({ where: { eventId: e.id, status: 'PENDING' } });
  let cash = ZERO;
  let tax = ZERO;
  let shares = ZERO;
  let target = ZERO;
  let cilTotal = ZERO;
  let applied = 0;
  let clamped = 0;
  for (const en of ents) {
    let c = en;
    if (isElective(e.type) && !en.elected) {
      const option = normaliseOption(e.type, null, e.defaultOption);
      const re = repriceFor(e, en.quantity, option);
      c = { ...en, ...re } as EntRow;
    }
    const cc = computeEntitlement(params(e), c.quantity, c.option);
    const note: Record<string, unknown> = { effectiveDate: isoDay(effective), option: c.option, defaulted: isElective(e.type) && !en.elected };

    let cilCost = ZERO;
    if (!cc.sharesDelta.eq(0) || cc.cashInLieu.gt(0)) {
      const pos = await latestPosition(tx, en.portfolioId, e.securityId, effective);
      const held = pos?.quantity ?? ZERO;
      // Book cost of a fraction sold for cash in lieu leaves the position (and is split from gain in the journal).
      cilCost = cc.cashInLieu.gt(0) ? fractionCost(params(e), c.quantity, pos?.avgCost ?? ZERO, c.option, cc) : ZERO;
      const next = applyToPosition(e, held, pos?.avgCost ?? ZERO, cc, cilCost);
      note.avgCostBefore = (pos?.avgCost ?? ZERO).toString();
      note.cilCost = cilCost.toString();
      await tx.portfolioPosition.upsert({
        where: { portfolioId_securityId_asOf: { portfolioId: en.portfolioId, securityId: e.securityId, asOf: effective } },
        create: { portfolioId: en.portfolioId, securityId: e.securityId, quantity: next.quantity, avgCost: next.avgCost, asOf: effective },
        update: { quantity: next.quantity, avgCost: next.avgCost },
      });
      note.positionBefore = held.toString();
      note.positionAfter = next.quantity.toString();
      if (next.clamped) {
        note.clamped = 'Position was smaller than the record-date holding; the change was limited to what is held';
        clamped++;
      }
      if (e.type === 'MERGER' && e.targetSecurityId && cc.targetShares.gt(0)) {
        const tpos = await latestPosition(tx, en.portfolioId, e.targetSecurityId, effective);
        const tHeld = tpos?.quantity ?? ZERO;
        const tNew = tHeld.add(cc.targetShares);
        // cost carries over from the old holding: held cost plus the existing acquirer cost, spread over all shares
        const carried = (pos?.avgCost ?? ZERO).mul(held).sub(cilCost);
        note.carriedCost = carried.toString();
        note.targetAvgBefore = (tpos?.avgCost ?? ZERO).toString();
        const tAvg = tNew.gt(0) ? tHeld.mul(tpos?.avgCost ?? ZERO).add(carried).div(tNew).toDecimalPlaces(6, D.ROUND_HALF_UP) : ZERO;
        await tx.portfolioPosition.upsert({
          where: { portfolioId_securityId_asOf: { portfolioId: en.portfolioId, securityId: e.targetSecurityId, asOf: effective } },
          create: { portfolioId: en.portfolioId, securityId: e.targetSecurityId, quantity: tNew, avgCost: tAvg, asOf: effective },
          update: { quantity: tNew, avgCost: tAvg },
        });
        note.targetPositionAfter = tNew.toString();
      }
    }
    if (!cc.cash.eq(0)) {
      const row = await tx.portfolioCash.findFirst({ where: { portfolioId: en.portfolioId, currency: e.currency, asOf: { lte: effective } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
      const before = row?.available ?? ZERO;
      const after = before.add(cc.cash).toDecimalPlaces(4, D.ROUND_HALF_UP);
      await tx.portfolioCash.upsert({
        where: { portfolioId_currency_asOf: { portfolioId: en.portfolioId, currency: e.currency, asOf: effective } },
        create: { portfolioId: en.portfolioId, currency: e.currency, available: after, asOf: effective },
        update: { available: after },
      });
      note.cashBefore = before.toFixed(4);
      note.cashAfter = after.toFixed(4);
    }
    await tx.corpActionEntitlement.update({
      where: { id: en.id },
      data: {
        option: c.option,
        grossAmount: cc.gross,
        taxAmount: cc.tax,
        cashAmount: cc.cash,
        sharesDelta: cc.sharesDelta,
        targetShares: cc.targetShares,
        cashInLieu: cc.cashInLieu,
        status: 'APPLIED',
        appliedAt: new Date(),
        detail: { ...((en.detail as object | null) ?? {}), ...note } as Prisma.InputJsonValue,
      },
    });
    cash = cash.add(cc.cash);
    tax = tax.add(cc.tax);
    shares = shares.add(cc.sharesDelta);
    target = target.add(cc.targetShares);
    cilTotal = cilTotal.add(cc.cashInLieu);
    applied++;
  }
  return { effectiveDate: isoDay(effective), applied, clamped, cashInLieu: cilTotal.toFixed(4), netCash: cash.toFixed(4), tax: tax.toFixed(4), sharesDelta: shares.toString(), targetShares: target.toString() };
}

// ---------------------------------------------------------------- reversal by adjustment

/**
 * Undoes a PROCESSED action without rewriting history: today's append-by-date rows are adjusted back (position, cost,
 * cash), each applied entitlement becomes REVERSED, and the system journals are discarded (pending) or countered by an
 * inverse pending journal (posted). Positions that moved since (for example sold) are limited to what is held and noted.
 */
export async function reverseApplied(tx: Prisma.TransactionClient, e: EventRow) {
  const today = startOfDay(new Date());
  const ents = await tx.corpActionEntitlement.findMany({ where: { eventId: e.id, status: 'APPLIED' } });
  let cash = ZERO;
  let shares = ZERO;
  let clamped = 0;
  const portfolios: string[] = [];
  for (const en of ents) {
    const d = (en.detail ?? {}) as { addedCost?: string; avgCostBefore?: string; cilCost?: string; carriedCost?: string; targetAvgBefore?: string };
    const note: Record<string, unknown> = { reversedOn: isoDay(today) };
    if (!en.sharesDelta.eq(0) || en.cashInLieu.gt(0)) {
      const pos = await latestPosition(tx, en.portfolioId, e.securityId, today);
      const cur = pos?.quantity ?? ZERO;
      let q = cur.sub(en.sharesDelta);
      if (q.lt(0)) {
        q = ZERO;
        clamped++;
        note.clamped = 'Position was smaller than the processed holding; the reversal was limited to what is held';
      }
      const cil = new D(d.cilCost ?? 0);
      const total = cur.mul(pos?.avgCost ?? ZERO).sub(new D(d.addedCost ?? 0)).add(cil);
      const avg = e.type === 'MERGER' ? new D(d.avgCostBefore ?? pos?.avgCost ?? 0) : q.gt(0) ? total.div(q).toDecimalPlaces(6, D.ROUND_HALF_UP) : (pos?.avgCost ?? ZERO);
      await tx.portfolioPosition.upsert({
        where: { portfolioId_securityId_asOf: { portfolioId: en.portfolioId, securityId: e.securityId, asOf: today } },
        create: { portfolioId: en.portfolioId, securityId: e.securityId, quantity: q, avgCost: avg, asOf: today },
        update: { quantity: q, avgCost: avg },
      });
      note.positionRestored = q.toString();
      shares = shares.add(en.sharesDelta);
      if (e.type === 'MERGER' && e.targetSecurityId && en.targetShares.gt(0)) {
        const tpos = await latestPosition(tx, en.portfolioId, e.targetSecurityId, today);
        const tCur = tpos?.quantity ?? ZERO;
        let tq = tCur.sub(en.targetShares);
        if (tq.lt(0)) {
          tq = ZERO;
          clamped++;
        }
        const carried = new D(d.carriedCost ?? 0);
        const tAvg = tq.gt(0) ? tCur.mul(tpos?.avgCost ?? ZERO).sub(carried).div(tq).toDecimalPlaces(6, D.ROUND_HALF_UP) : (tpos?.avgCost ?? ZERO);
        await tx.portfolioPosition.upsert({
          where: { portfolioId_securityId_asOf: { portfolioId: en.portfolioId, securityId: e.targetSecurityId, asOf: today } },
          create: { portfolioId: en.portfolioId, securityId: e.targetSecurityId, quantity: tq, avgCost: tAvg, asOf: today },
          update: { quantity: tq, avgCost: tAvg },
        });
        note.targetPositionRestored = tq.toString();
      }
    }
    if (!en.cashAmount.eq(0)) {
      const row = await tx.portfolioCash.findFirst({ where: { portfolioId: en.portfolioId, currency: e.currency, asOf: { lte: today } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
      const after = (row?.available ?? ZERO).sub(en.cashAmount).toDecimalPlaces(4, D.ROUND_HALF_UP);
      await tx.portfolioCash.upsert({
        where: { portfolioId_currency_asOf: { portfolioId: en.portfolioId, currency: e.currency, asOf: today } },
        create: { portfolioId: en.portfolioId, currency: e.currency, available: after, asOf: today },
        update: { available: after },
      });
      note.cashAfter = after.toFixed(4);
      cash = cash.add(en.cashAmount);
      portfolios.push(en.portfolioId);
    }
    await tx.corpActionEntitlement.update({ where: { id: en.id }, data: { status: 'REVERSED', detail: { ...((en.detail as object | null) ?? {}), ...note } as Prisma.InputJsonValue } });
  }
  return { reversed: ents.length, clamped, cashReturned: cash.toFixed(4), sharesRemoved: shares.toString(), portfolios, effectiveDate: isoDay(today) };
}

// ---------------------------------------------------------------- client level

/** Entitlements rolled up to the owning client (portfolio.clientId); portfolios with no client are grouped as "Unassigned". */
export async function clientEntitlements(eventId: string) {
  const ents = await prisma.corpActionEntitlement.findMany({ where: { eventId } });
  const pf = ents.length ? await prisma.portfolio.findMany({ where: { id: { in: ents.map((x) => x.portfolioId) } }, select: { id: true, ref: true, name: true, clientId: true } }) : [];
  const clientIds = [...new Set(pf.map((p) => p.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, ref: true, name: true } }) : [];
  const groups = new Map<string, { clientId: string | null; clientRef: string | null; clientName: string; portfolios: string[]; quantity: Dec; cash: Dec; cashInLieu: Dec; sharesDelta: Dec; targetShares: Dec; elected: number; entitlements: number }>();
  for (const x of ents) {
    const p = pf.find((y) => y.id === x.portfolioId);
    const cl = p?.clientId ? clients.find((c) => c.id === p.clientId) : undefined;
    const key = cl?.id ?? 'none';
    const g = groups.get(key) ?? { clientId: cl?.id ?? null, clientRef: cl?.ref ?? null, clientName: cl?.name ?? 'Unassigned', portfolios: [], quantity: ZERO, cash: ZERO, cashInLieu: ZERO, sharesDelta: ZERO, targetShares: ZERO, elected: 0, entitlements: 0 };
    g.portfolios.push(p?.ref ?? x.portfolioId);
    g.quantity = g.quantity.add(x.quantity);
    g.cash = g.cash.add(x.cashAmount);
    g.cashInLieu = g.cashInLieu.add(x.cashInLieu);
    g.sharesDelta = g.sharesDelta.add(x.sharesDelta);
    g.targetShares = g.targetShares.add(x.targetShares);
    g.elected += x.elected ? 1 : 0;
    g.entitlements += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.cash.abs().comparedTo(a.cash.abs())).map((g) => ({ ...g, quantity: g.quantity.toString(), cash: f2(g.cash), cashInLieu: f2(g.cashInLieu), sharesDelta: g.sharesDelta.toString(), targetShares: g.targetShares.toString() }));
}

/** Everything a client is entitled to across portfolios, newest event first. */
export async function entitlementsForClient(clientId: string) {
  const pf = await prisma.portfolio.findMany({ where: { clientId }, select: { id: true, ref: true, name: true } });
  if (!pf.length) return [];
  const ents = await prisma.corpActionEntitlement.findMany({ where: { portfolioId: { in: pf.map((p) => p.id) } }, include: { event: true }, orderBy: { createdAt: 'desc' }, take: 300 });
  return ents.map((x) => ({
    eventId: x.eventId,
    eventRef: x.event.ref,
    ticker: x.event.ticker,
    type: x.event.type,
    eventStatus: x.event.status,
    payDate: isoDay(x.event.payDate),
    portfolioRef: pf.find((p) => p.id === x.portfolioId)?.ref ?? null,
    quantity: x.quantity.toString(),
    option: x.option,
    status: x.status,
    cashAmount: f2(x.cashAmount),
    cashInLieu: f2(x.cashInLieu),
    sharesDelta: x.sharesDelta.toString(),
    currency: x.event.currency,
  }));
}

// ---------------------------------------------------------------- views

export async function eventViews(rows: EventRow[]) {
  const users = await names(rows.flatMap((r) => [r.makerId, r.confirmedBy, r.processedBy, r.reversedBy]));
  const counts = rows.length ? await prisma.corpActionEntitlement.groupBy({ by: ['eventId'], where: { eventId: { in: rows.map((r) => r.id) } }, _count: { _all: true }, _sum: { cashAmount: true } }) : [];
  const elected = rows.length ? await prisma.corpActionEntitlement.groupBy({ by: ['eventId'], where: { eventId: { in: rows.map((r) => r.id) }, elected: true }, _count: { _all: true } }) : [];
  return rows.map((r) => {
    const c = counts.find((x) => x.eventId === r.id);
    return {
      id: r.id,
      ref: r.ref,
      securityId: r.securityId,
      ticker: r.ticker,
      securityName: r.securityName,
      type: r.type,
      status: r.status,
      currency: r.currency,
      exDate: isoDay(r.exDate),
      recordDate: isoDay(r.recordDate),
      payDate: isoDay(r.payDate),
      electionDeadline: isoDay(r.electionDeadline),
      rate: r.rate ? r.rate.toString() : null,
      ratioNew: r.ratioNew ? r.ratioNew.toString() : null,
      ratioOld: r.ratioOld ? r.ratioOld.toString() : null,
      withholdingPct: r.withholdingPct.toString(),
      targetSecurityId: r.targetSecurityId,
      targetTicker: r.targetTicker,
      defaultOption: r.defaultOption,
      description: r.description,
      elective: isElective(r.type),
      options: ELECTION_OPTIONS[r.type as CaType] ?? [],
      electionOpen: isElective(r.type) && (r.status === 'ANNOUNCED' || r.status === 'CONFIRMED') && electionOpen(r),
      entitlementsAt: iso(r.entitlementsAt),
      entitlementCount: c?._count._all ?? 0,
      electedCount: elected.find((x) => x.eventId === r.id)?._count._all ?? 0,
      netCash: (c?._sum.cashAmount ?? ZERO).toFixed(2),
      makerId: r.makerId,
      makerName: users.get(r.makerId) ?? null,
      confirmedBy: r.confirmedBy,
      confirmedByName: r.confirmedBy ? (users.get(r.confirmedBy) ?? null) : null,
      confirmedAt: iso(r.confirmedAt),
      processedBy: r.processedBy,
      processedByName: r.processedBy ? (users.get(r.processedBy) ?? null) : null,
      processedAt: iso(r.processedAt),
      cancelReason: r.cancelReason,
      cancelledAt: iso(r.cancelledAt),
      cashInLieu: r.cashInLieu,
      cilPrice: r.cilPrice ? r.cilPrice.toString() : null,
      reversedBy: r.reversedBy,
      reversedByName: r.reversedBy ? (users.get(r.reversedBy) ?? null) : null,
      reversedAt: iso(r.reversedAt),
      reverseReason: r.reverseReason,
      processing: r.detail ?? null,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  });
}

export function allowedActions(e: EventRow, user: { id: string; permissions: string[] }, entCount: number) {
  const open = e.status === 'ANNOUNCED' || e.status === 'CONFIRMED';
  const recordPassed = e.recordDate.getTime() <= startOfDay(new Date()).getTime();
  let processBlocker: string | null = null;
  if (e.status === 'CONFIRMED') {
    if (!user.permissions.includes('corporate_actions.process')) processBlocker = 'You do not hold the process permission';
    else if (e.makerId === user.id) processBlocker = 'A different person from the creator must process this action';
    else if (!e.entitlementsAt) processBlocker = 'Calculate the entitlements first';
    else if (entCount === 0) processBlocker = 'No portfolio holds this security at the record date; nothing to process';
  }
  return {
    edit: e.status === 'ANNOUNCED',
    confirm: e.status === 'ANNOUNCED',
    calculate: open && recordPassed,
    calculateBlocker: open && !recordPassed ? `The record date ${isoDay(e.recordDate)} has not passed yet` : null,
    elect: open && isElective(e.type) && entCount > 0 && electionOpen(e),
    process: e.status === 'CONFIRMED' && processBlocker === null,
    processBlocker,
    cancel: open,
    reverse: e.status === 'PROCESSED' && user.permissions.includes('corporate_actions.process') && e.processedBy !== user.id,
    reverseBlocker:
      e.status !== 'PROCESSED' ? null : !user.permissions.includes('corporate_actions.process') ? 'You do not hold the process permission' : e.processedBy === user.id ? 'A different person from the processor must reverse this action' : null,
  };
}

export async function eventDetail(e: EventRow, user: { id: string; permissions: string[] }) {
  const [view] = await eventViews([e]);
  const [ents, events] = await Promise.all([
    prisma.corpActionEntitlement.findMany({ where: { eventId: e.id }, orderBy: { quantity: 'desc' } }),
    prisma.auditEvent.findMany({ where: { objectType: 'corp_action', objectId: e.id }, orderBy: { id: 'asc' }, take: 100 }),
  ]);
  const pf = await prisma.portfolio.findMany({ where: { id: { in: ents.map((x) => x.portfolioId) } }, select: { id: true, ref: true, name: true } });
  const users = await names([...ents.map((x) => x.electedBy), ...events.map((x) => x.actorId)]);
  const totals = ents.reduce(
    (t, x) => ({ quantity: t.quantity.add(x.quantity), gross: t.gross.add(x.grossAmount), tax: t.tax.add(x.taxAmount), cash: t.cash.add(x.cashAmount), shares: t.shares.add(x.sharesDelta), target: t.target.add(x.targetShares) }),
    { quantity: ZERO, gross: ZERO, tax: ZERO, cash: ZERO, shares: ZERO, target: ZERO },
  );
  return {
    ...view,
    entitlements: ents.map((x) => {
      const p = pf.find((y) => y.id === x.portfolioId);
      const d = (x.detail ?? {}) as { fraction?: string; defaulted?: boolean; clamped?: string };
      return {
        id: x.id,
        portfolioId: x.portfolioId,
        portfolioRef: p?.ref ?? null,
        portfolioName: p?.name ?? null,
        quantity: x.quantity.toString(),
        option: x.option,
        elected: x.elected,
        electedByName: x.electedBy ? (users.get(x.electedBy) ?? null) : null,
        electedAt: iso(x.electedAt),
        grossAmount: f2(x.grossAmount),
        taxAmount: f2(x.taxAmount),
        cashAmount: f2(x.cashAmount),
        cashInLieu: f2(x.cashInLieu),
        sharesDelta: x.sharesDelta.toString(),
        targetShares: x.targetShares.toString(),
        fraction: d.fraction ?? '0',
        status: x.status,
        defaulted: !!d.defaulted,
        note: d.clamped ?? null,
      };
    }),
    totals: { quantity: totals.quantity.toString(), gross: f2(totals.gross), tax: f2(totals.tax), netCash: f2(totals.cash), cashInLieu: f2(ents.reduce((s, x) => s.add(x.cashInLieu), ZERO)), sharesDelta: totals.shares.toString(), targetShares: totals.target.toString() },
    timeline: events.map((x) => ({ at: x.occurredAt, action: x.action, actor: x.actorId ? (users.get(x.actorId) ?? 'Unknown user') : 'System', reason: x.reason })),
    allowed: allowedActions(e, user, ents.length),
  };
}
