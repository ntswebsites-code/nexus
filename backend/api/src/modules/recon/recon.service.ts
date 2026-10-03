import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { seqRef, audit } from '../ops/ops.common';
import { accountRefs } from '../custodian/custodian.service';
import { getPortfolioSnapshot, resolveFxRate } from '../portfolio/portfolio.service';
import {
  DEFAULT_TOLERANCES,
  MATERIAL,
  OPEN_STATUSES,
  compareAmount,
  compareCount,
  matchTrades,
  signature,
  type Detected,
  type ExtTrade,
  type FxLookup,
  type Family,
  type IntFill,
  type Tolerances,
} from './recon.engine';
import { detectCorpActions, detectPositions, detectSettlement, receiptMissing } from './recon.families';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const dayStart = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);
export const dayEnd = (isoDate: string) => new Date(dayStart(isoDate).getTime() + 86_400_000);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => isoDay(new Date());

export function scopeKey(family: Family, date: string, counterpartyId: string | null, portfolioId: string | null) {
  return `${family}|${date}|${counterpartyId ?? '*'}|${portfolioId ?? '*'}`;
}
export const signoffScopeKey = (family: Family, date: string, counterpartyId: string | null) => `${family}|${date}|${counterpartyId ?? '*'}`;

// ---------------------------------------------------------------- scope

export interface ScopeAccount {
  counterpartyId: string;
  counterpartyRef: string;
  counterpartyName: string;
  accountRef: string;
  portfolioId: string;
  portfolioRef: string;
}

/** Mapped (counterparty account -> portfolio) pairs in scope, plus counterparty accounts nobody has mapped yet. */
export async function resolveScope(opts: { counterpartyId?: string | null; portfolioId?: string | null }) {
  const maps = await prisma.reconAccountMap.findMany({
    where: { ...(opts.counterpartyId ? { counterpartyId: opts.counterpartyId } : {}), ...(opts.portfolioId ? { portfolioId: opts.portfolioId } : {}) },
  });
  const cps = await prisma.counterparty.findMany({ where: opts.counterpartyId ? { id: opts.counterpartyId } : {} });
  const cpById = new Map(cps.map((c) => [c.id, c]));
  const pfs = await prisma.portfolio.findMany({ where: { id: { in: [...new Set(maps.map((m) => m.portfolioId))] } }, select: { id: true, ref: true } });
  const pfById = new Map(pfs.map((p) => [p.id, p]));
  const accounts: ScopeAccount[] = [];
  for (const m of maps) {
    const cp = cpById.get(m.counterpartyId) ?? (await prisma.counterparty.findUnique({ where: { id: m.counterpartyId } }));
    const pf = pfById.get(m.portfolioId);
    if (!cp || !pf) continue;
    accounts.push({ counterpartyId: cp.id, counterpartyRef: cp.ref, counterpartyName: cp.name, accountRef: m.accountRef, portfolioId: pf.id, portfolioRef: pf.ref });
  }
  const mapped = new Set(maps.map((m) => `${m.counterpartyId}|${m.accountRef}`));
  const unmapped: { counterpartyRef: string; accountRef: string }[] = [];
  if (!opts.portfolioId) {
    for (const c of cps) for (const a of accountRefs(c.accounts)) if (!mapped.has(`${c.id}|${a}`)) unmapped.push({ counterpartyRef: c.ref, accountRef: a });
  }
  return { accounts, unmapped };
}

// ---------------------------------------------------------------- detection

export interface RunInput {
  family: Family;
  asOfDate: string;
  counterpartyId: string | null;
  portfolioId: string | null;
  tolerances: Tolerances;
  /** Where each tolerance value came from (effective-dated config or run override). */
  toleranceSources?: Record<string, string>;
}

interface Detection {
  detected: Detected[];
  matchedCount: number;
  missingSources: { counterpartyRef: string; accountRef: string; reason: string }[];
  unmapped: { counterpartyRef: string; accountRef: string }[];
  exceptionExecIds: string[];
  matchedExecIds: string[];
}

async function latestDayEnd(counterpartyId: string, accountRef: string, date: string) {
  return prisma.counterpartyDayEndPackage.findFirst({
    where: { counterpartyId, accountRef, statementDate: dayStart(date), status: { not: 'Superseded' } },
    orderBy: { submittedAt: 'desc' },
  });
}

async function executionsFor(counterpartyId: string, accountRef: string, date: string) {
  return prisma.counterpartyExecution.findMany({
    where: { counterpartyId, accountRef, executionAt: { gte: dayStart(date), lt: dayEnd(date) }, status: { not: 'Superseded' } },
  });
}

async function detectTrades(input: RunInput, accounts: ScopeAccount[]): Promise<Pick<Detection, 'detected' | 'matchedCount' | 'exceptionExecIds' | 'matchedExecIds'>> {
  const tol = new D(input.tolerances.price);
  const detected: Detected[] = [];
  let matchedCount = 0;
  const exceptionExecIds: string[] = [];
  const matchedExecIds: string[] = [];
  const byPortfolio = new Map<string, ScopeAccount[]>();
  for (const a of accounts) byPortfolio.set(a.portfolioId, [...(byPortfolio.get(a.portfolioId) ?? []), a]);

  for (const [portfolioId, accs] of byPortfolio) {
    const exts: ExtTrade[] = [];
    const extIds = new Map<string, string>(); // tradeRef key -> execution id
    for (const a of accs) {
      for (const e of await executionsFor(a.counterpartyId, a.accountRef, input.asOfDate)) {
        exts.push({
          id: e.id,
          tradeRef: e.tradeRef,
          ticker: e.ticker,
          side: e.side,
          quantity: e.quantity,
          price: e.price,
          currency: e.currency,
          counterpartyId: a.counterpartyId,
          counterpartyRef: a.counterpartyRef,
          accountRef: a.accountRef,
          portfolioId,
        });
        extIds.set(`${a.counterpartyRef}:${e.tradeRef}`, e.id);
      }
    }
    const orders = await prisma.order.findMany({ where: { portfolioId }, select: { id: true, ref: true, side: true, currency: true, securityId: true } });
    const fills = orders.length
      ? await prisma.orderFill.findMany({ where: { orderId: { in: orders.map((o) => o.id) }, executedAt: { gte: dayStart(input.asOfDate), lt: dayEnd(input.asOfDate) } } })
      : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const secs = fills.length ? await prisma.security.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.securityId))] } }, select: { id: true, ticker: true } }) : [];
    const tickerById = new Map(secs.map((s) => [s.id, s.ticker]));
    const ints: IntFill[] = fills.map((f) => {
      const o = orderById.get(f.orderId)!;
      return {
        id: f.id,
        refs: [f.sourceRef, o.ref].filter((x): x is string => !!x).map((x) => x.trim().toUpperCase()),
        orderRef: o.ref,
        ticker: tickerById.get(o.securityId) ?? '',
        side: o.side,
        quantity: f.quantity,
        price: f.price,
        currency: o.currency,
        portfolioId,
      };
    });
    // FX for custodian trades reported in a currency other than the internal order's (same ticker only).
    const rates = new Map<string, Dec>();
    for (const e of exts)
      for (const i of ints) {
        if (e.currency === i.currency || i.ticker.toUpperCase() !== e.ticker.toUpperCase()) continue;
        const k = e.currency + '>' + i.currency;
        if (rates.has(k)) continue;
        const r = await resolveFxRate(e.currency, i.currency, dayStart(input.asOfDate));
        if (r) rates.set(k, r);
      }
    const fx: FxLookup = (from, to) => rates.get(from + '>' + to) ?? null;
    const res = matchTrades(exts, ints, tol, fx);
    matchedCount += res.matched.length;
    detected.push(...res.detected);
    for (const m of res.matched) matchedExecIds.push(m.id);
    for (const x of res.exceptionExts) exceptionExecIds.push(x.id);
    // Internal-only breaks belong to the counterparty of this portfolio's account when there is exactly one.
    const cpIds = [...new Set(accs.map((a) => a.counterpartyId))];
    if (cpIds.length === 1) for (const d of res.detected) if (!d.counterpartyId) d.counterpartyId = cpIds[0]!;
  }
  return { detected, matchedCount, exceptionExecIds, matchedExecIds };
}

async function internalCash(portfolioId: string, currency: string, date: string): Promise<Dec> {
  const row = await prisma.portfolioCash.findFirst({ where: { portfolioId, currency, asOf: { lte: dayStart(date) } }, orderBy: { asOf: 'desc' } });
  return row?.available ?? new D(0);
}

/** Securities market value of the portfolio expressed in `currency` (positions in other currencies converted by FX). */
async function internalHoldingsValue(portfolioId: string, currency: string, date: string) {
  const snap = await getPortfolioSnapshot(portfolioId, { asOf: dayStart(date) });
  let total = new D(0);
  const unvalued: string[] = [];
  for (const l of snap.lines) {
    if (l.marketValue === null) {
      unvalued.push(`${l.ticker} (no price)`);
      continue;
    }
    if (l.currency === currency) total = total.plus(l.marketValue);
    else {
      const fx = await resolveFxRate(l.currency, currency, dayStart(date));
      if (!fx) unvalued.push(`${l.ticker} (no ${l.currency}/${currency} rate)`);
      else total = total.plus(new D(l.marketValue).mul(fx));
    }
  }
  return { total, unvalued };
}

async function detectAmounts(input: RunInput, accounts: ScopeAccount[]): Promise<Pick<Detection, 'detected' | 'matchedCount' | 'missingSources'>> {
  const detected: Detected[] = [];
  const missingSources: Detection['missingSources'] = [];
  let matchedCount = 0;
  for (const a of accounts) {
    const pkg = await latestDayEnd(a.counterpartyId, a.accountRef, input.asOfDate);
    if (!pkg) {
      missingSources.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef, reason: `No day-end package for ${input.asOfDate}` });
      continue;
    }
    const common = { counterpartyId: a.counterpartyId, portfolioId: a.portfolioId, currency: pkg.currency };
    if (input.family === 'CASH') {
      const internal = await internalCash(a.portfolioId, pkg.currency, input.asOfDate);
      const cmp = compareAmount(internal, pkg.closingCash, { abs: new D(input.tolerances.cash) });
      if (!cmp) matchedCount += 1;
      else
        detected.push({
          ...common,
          itemKey: `CASH:${a.counterpartyRef}:${a.accountRef}:${pkg.currency}`,
          kind: 'CASH_DIFF',
          label: `${a.accountRef} closing cash ${pkg.currency}: ${internal.toFixed(2)} internal vs ${pkg.closingCash.toFixed(2)} custodian`,
          severity: cmp.severity,
          internal: { amount: internal.toFixed(2), currency: pkg.currency, portfolio: a.portfolioRef },
          external: { amount: pkg.closingCash.toFixed(2), currency: pkg.currency, account: a.accountRef, dayEnd: pkg.ref },
          difference: cmp.difference.toFixed(2),
          differencePct: cmp.pct ? cmp.pct.toFixed(4) : null,
        });
    } else if (input.family === 'HOLDINGS') {
      const { total, unvalued } = await internalHoldingsValue(a.portfolioId, pkg.currency, input.asOfDate);
      const cmp = compareAmount(total, pkg.holdingsMv, { pctOfExternal: new D(input.tolerances.holdingsPct) });
      if (!cmp && !unvalued.length) matchedCount += 1;
      else {
        const diff = pkg.holdingsMv.minus(total);
        const pct = cmp?.pct ?? null;
        detected.push({
          ...common,
          itemKey: `HOLD:${a.counterpartyRef}:${a.accountRef}`,
          kind: 'HOLDINGS_DIFF',
          label: `${a.accountRef} holdings value ${pkg.currency}: ${total.toFixed(2)} internal vs ${pkg.holdingsMv.toFixed(2)} custodian${unvalued.length ? ` (cannot value: ${unvalued.join(', ')})` : ''}`,
          severity: unvalued.length && (!cmp || cmp.severity === 'LOW' || cmp.severity === 'MEDIUM') ? 'HIGH' : cmp!.severity,
          internal: { amount: total.toFixed(2), currency: pkg.currency, portfolio: a.portfolioRef, ...(unvalued.length ? { unvalued } : {}) },
          external: { amount: pkg.holdingsMv.toFixed(2), currency: pkg.currency, account: a.accountRef, dayEnd: pkg.ref },
          difference: diff.toFixed(2),
          differencePct: pct ? pct.toFixed(4) : null,
        });
      }
    } else {
      const received = (await executionsFor(a.counterpartyId, a.accountRef, input.asOfDate)).length;
      const cmp = compareCount(pkg.tradeCount, received);
      if (!cmp) matchedCount += 1;
      else
        detected.push({
          ...common,
          itemKey: `CNT:${a.counterpartyRef}:${a.accountRef}`,
          kind: 'COUNT_DIFF',
          label: `${a.accountRef} day-end reports ${pkg.tradeCount} trades but ${received} executions were received`,
          severity: cmp.severity,
          internal: { executionsReceived: received },
          external: { tradeCount: pkg.tradeCount, account: a.accountRef, dayEnd: pkg.ref },
          difference: String(cmp.difference),
          differencePct: cmp.pct ? cmp.pct.toFixed(4) : null,
        });
    }
  }
  return { detected, matchedCount, missingSources };
}

export async function detect(input: RunInput): Promise<Detection> {
  const { accounts, unmapped } = await resolveScope({ counterpartyId: input.counterpartyId, portfolioId: input.portfolioId });
  if (!accounts.length) {
    throw HttpError.conflict('No counterparty accounts are mapped to portfolios for this scope. Map them first (PUT /recon/account-map).', 'no_account_mapping');
  }
  if (input.family === 'TRADES') {
    const r = await detectTrades(input, accounts);
    return { ...r, missingSources: [], unmapped };
  }
  const fam =
    input.family === 'POSITIONS_VS_CUSTODY'
      ? await detectPositions(input, accounts)
      : input.family === 'SETTLEMENT_FAILS'
        ? await detectSettlement(input, accounts)
        : input.family === 'CORP_ACTIONS'
          ? await detectCorpActions(input, accounts)
          : await detectAmounts(input, accounts);
  return { ...fam, unmapped, exceptionExecIds: [], matchedExecIds: [] };
}

// ---------------------------------------------------------------- persistence

const SYSTEM_NOTE = 'Matching run';

async function breakEvent(
  tx: Prisma.TransactionClient,
  breakId: string,
  action: string,
  from: string | null,
  to: string | null,
  actorId: string | null,
  note?: string | null,
  detail?: Prisma.InputJsonValue,
) {
  await tx.reconBreakEvent.create({ data: { breakId, action, fromStatus: from, toStatus: to, actorId, note: note ?? null, detail } });
}

export interface RunResult {
  runId: string;
  rerun: boolean;
}

/**
 * Executes a run and stores it. One row per family + date + counterparty + portfolio (unique `scope_key`), so a
 * re-run never duplicates breaks: items already known keep their workflow state, items that no longer differ are
 * cleared to MATCHED, a closed item whose difference changed is reopened.
 */
export async function executeRun(req: Request, input: RunInput): Promise<RunResult> {
  const det = await detect(input);
  const actorId = req.user!.id;
  const key = scopeKey(input.family, input.asOfDate, input.counterpartyId, input.portfolioId);
  const status = det.detected.length ? 'BREAKS' : det.missingSources.length ? 'SOURCE_MISSING' : 'CLEAN';
  const params = { tolerances: input.tolerances, ...(input.toleranceSources ? { toleranceSources: input.toleranceSources } : {}) } as unknown as Prisma.InputJsonValue;
  const summary = { missingSources: det.missingSources, unmappedAccounts: det.unmapped } as unknown as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    let run = await tx.reconRun.findUnique({ where: { scopeKey: key } });
    let rerun = !!run;
    if (!run) {
      const ref = await seqRef(tx, 'reconRun', 'RUN-', 5, 1);
      try {
        run = await tx.reconRun.create({
          data: {
            ref,
            scopeKey: key,
            family: input.family,
            asOfDate: dayStart(input.asOfDate),
            counterpartyId: input.counterpartyId,
            portfolioId: input.portfolioId,
            status,
            matchedCount: det.matchedCount,
            breakCount: det.detected.length,
            params,
            summary,
            runBy: actorId,
          },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
        run = await tx.reconRun.findUniqueOrThrow({ where: { scopeKey: key } });
        rerun = true;
      }
    }
    if (rerun) {
      await tx.$queryRaw`SELECT id FROM recon_runs WHERE id = ${run.id} FOR UPDATE`;
      await tx.reconRun.update({
        where: { id: run.id },
        data: { status, matchedCount: det.matchedCount, breakCount: det.detected.length, params, summary, runCount: { increment: 1 }, runBy: actorId },
      });
    }

    const existing = await tx.reconBreak.findMany({ where: { runId: run.id } });
    const byKey = new Map(existing.map((b) => [b.itemKey, b]));
    const seen = new Set<string>();
    let created = 0;
    let reopened = 0;
    let cleared = 0;
    let updated = 0;
    let sharedCount = 0;
    const critical: { ref: string; label: string; id: string }[] = [];

    for (const d of det.detected) {
      if (seen.has(d.itemKey)) continue; // defensive: keys are unique per run
      seen.add(d.itemKey);
      // An item already tracked by another run for the same date (overlapping scopes) is not duplicated: the first run owns it.
      let e = byKey.get(d.itemKey);
      if (!e) {
        const other = await tx.reconBreak.findFirst({ where: { family: input.family, itemKey: d.itemKey, runId: { not: run.id }, run: { asOfDate: dayStart(input.asOfDate) } } });
        if (other) {
          e = other;
          sharedCount += 1;
        }
      }
      const data = {
        kind: d.kind,
        label: d.label.slice(0, 255),
        severity: d.severity,
        internalValue: (d.internal ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        externalValue: (d.external ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        difference: d.difference === null ? null : new D(d.difference),
        differencePct: d.differencePct === null ? null : new D(d.differencePct),
        currency: d.currency,
        counterpartyId: d.counterpartyId,
        portfolioId: d.portfolioId,
        lastSeenAt: new Date(),
      };
      if (!e) {
        const ref = await seqRef(tx, 'reconBreak', 'REC-', 5, 1);
        const b = await tx.reconBreak.create({ data: { ref, runId: run.id, family: input.family, itemKey: d.itemKey, ...data } });
        await breakEvent(tx, b.id, 'detected', null, 'NEW', actorId, SYSTEM_NOTE, { kind: d.kind, severity: d.severity, run: run.ref });
        created += 1;
        if (d.severity === 'CRITICAL') critical.push({ ref, label: d.label, id: b.id });
        continue;
      }
      const same = signature({ kind: e.kind as Detected['kind'], internal: (e.internalValue as Record<string, unknown> | null) ?? null, external: (e.externalValue as Record<string, unknown> | null) ?? null, difference: e.difference ? e.difference.toString() : null }) === signature(d);
      if (e.status === 'MATCHED' || e.status === 'CLOSED') {
        // CLOSED was accepted by a checker: it stays closed unless the difference changed. MATCHED was cleared by an
        // earlier run (nobody accepted it), so the same difference reappearing reopens it.
        if (e.status === 'CLOSED' && same) continue;
        await tx.reconBreak.update({
          where: { id: e.id },
          data: { ...data, status: 'NEW', closedAt: null, resolvedAt: null, checkerId: null, version: { increment: 1 } },
        });
        await breakEvent(tx, e.id, 'reopened', e.status, 'NEW', actorId, 'The difference reappeared or changed in a later run', { run: run.ref });
        reopened += 1;
        if (d.severity === 'CRITICAL') critical.push({ ref: e.ref, label: d.label, id: e.id });
        continue;
      }
      if (!same || e.severity !== d.severity) {
        await tx.reconBreak.update({ where: { id: e.id }, data: { ...data, version: { increment: 1 } } });
        await breakEvent(tx, e.id, 'updated', e.status, e.status, actorId, 'Values changed in a later run', { run: run.ref });
        updated += 1;
        if (d.severity === 'CRITICAL' && e.severity !== 'CRITICAL') critical.push({ ref: e.ref, label: d.label, id: e.id });
      } else await tx.reconBreak.update({ where: { id: e.id }, data: { lastSeenAt: new Date() } });
    }
    for (const e of existing) {
      if (seen.has(e.itemKey)) continue;
      if (e.status === 'NEW' || e.status === 'ASSIGNED' || e.status === 'INVESTIGATING') {
        await tx.reconBreak.update({ where: { id: e.id }, data: { status: 'MATCHED', closedAt: new Date(), version: { increment: 1 } } });
        await breakEvent(tx, e.id, 'auto_cleared', e.status, 'MATCHED', actorId, 'Items now agree on re-run', { run: run.ref });
        cleared += 1;
      }
    }

    if (input.family === 'TRADES') {
      if (det.matchedExecIds.length)
        await tx.counterpartyExecution.updateMany({ where: { id: { in: det.matchedExecIds }, status: { in: ['Received', 'Exception', 'Matched'] } }, data: { status: 'Matched' } });
      if (det.exceptionExecIds.length)
        await tx.counterpartyExecution.updateMany({ where: { id: { in: det.exceptionExecIds }, status: { in: ['Received', 'Matched', 'Exception'] } }, data: { status: 'Exception' } });
    }

    await writeAudit(tx, audit(req), {
      action: 'recon.run_executed',
      objectType: 'recon_run',
      objectId: run.id,
      after: {
        ref: run.ref,
        family: input.family,
        asOfDate: input.asOfDate,
        counterpartyId: input.counterpartyId,
        portfolioId: input.portfolioId,
        rerun,
        status,
        matched: det.matchedCount,
        breaks: det.detected.length,
        created,
        sharedWithOtherRuns: sharedCount,
        reopened,
        cleared,
        updated,
        missingSources: det.missingSources.length,
      },
    });
    for (const c of critical) {
      await enqueue(tx, 'notify.permission', {
        permission: 'recon.signoff',
        type: 'recon.break_critical',
        title: `Critical reconciliation break ${c.ref}`,
        body: c.label,
        link: `/ops/reconciliation?break=${c.id}`,
      });
    }
    return { runId: run.id, rerun };
  });
}

// ---------------------------------------------------------------- sign-off readiness

export interface Readiness {
  family: Family;
  asOfDate: string;
  counterpartyId: string | null;
  runs: { id: string; ref: string; runBy: string; status: string }[];
  openMaterial: { id: string; ref: string; severity: string; status: string; label: string }[];
  openOther: number;
  missingSources: { counterpartyRef: string; accountRef: string }[];
  signedOff: { id: string; signedBy: string; signedAt: Date } | null;
  makerIds: string[];
  ready: boolean;
  reasons: string[];
}

export async function signoffReadiness(family: Family, date: string, counterpartyId: string | null): Promise<Readiness> {
  const runs = await prisma.reconRun.findMany({
    where: { family, asOfDate: dayStart(date), ...(counterpartyId ? { OR: [{ counterpartyId: null }, { counterpartyId }] } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  const breaks = runs.length
    ? await prisma.reconBreak.findMany({ where: { runId: { in: runs.map((r) => r.id) }, ...(counterpartyId ? { counterpartyId } : {}), status: { in: OPEN_STATUSES } } })
    : [];
  const openMaterial = breaks.filter((b) => (MATERIAL as string[]).includes(b.severity));
  const allBreaks = runs.length ? await prisma.reconBreak.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { makerId: true } }) : [];
  const missing: Readiness['missingSources'] = [];
  if (family === 'POSITIONS_VS_CUSTODY') {
    const { accounts } = await resolveScope({ counterpartyId });
    for (const a of accounts) if (await receiptMissing(a, date, 'POSITIONS')) missing.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef });
  } else if (family === 'CORP_ACTIONS') {
    // Only an account with an entitlement due on the date needs a file (see detectCorpActions).
    const { accounts } = await resolveScope({ counterpartyId });
    const events = await prisma.corpActionEvent.findMany({ where: { payDate: dayStart(date), status: { in: ['CONFIRMED', 'PROCESSED'] } }, select: { id: true } });
    for (const a of accounts) {
      const due = events.length ? await prisma.corpActionEntitlement.count({ where: { portfolioId: a.portfolioId, eventId: { in: events.map((e) => e.id) }, status: { not: 'SKIPPED' } } }) : 0;
      if (due && (await receiptMissing(a, date, 'CORP_ACTIONS'))) missing.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef });
    }
  } else if (family === 'CASH' || family === 'HOLDINGS' || family === 'DAYEND_COUNT') {
    const { accounts } = await resolveScope({ counterpartyId });
    for (const a of accounts) {
      if (!(await latestDayEnd(a.counterpartyId, a.accountRef, date))) missing.push({ counterpartyRef: a.counterpartyRef, accountRef: a.accountRef });
    }
  }
  const signed = await prisma.reconSignoff.findUnique({ where: { scopeKey: signoffScopeKey(family, date, counterpartyId) } });
  const reasons: string[] = [];
  if (!runs.length) reasons.push('No matching run exists for this family and date');
  if (openMaterial.length) reasons.push(`${openMaterial.length} Critical or High break${openMaterial.length === 1 ? ' is' : 's are'} still open`);
  if (missing.length) reasons.push(`${missing.length} scheduled source${missing.length === 1 ? ' is' : 's are'} missing`);
  if (signed) reasons.push('Already signed off');
  return {
    family,
    asOfDate: date,
    counterpartyId,
    runs: runs.map((r) => ({ id: r.id, ref: r.ref, runBy: r.runBy, status: r.status })),
    openMaterial: openMaterial.map((b) => ({ id: b.id, ref: b.ref, severity: b.severity, status: b.status, label: b.label })),
    openOther: breaks.length - openMaterial.length,
    missingSources: missing,
    signedOff: signed ? { id: signed.id, signedBy: signed.signedBy, signedAt: signed.signedAt } : null,
    makerIds: [...new Set(allBreaks.map((b) => b.makerId).filter((x): x is string => !!x))],
    ready: reasons.length === 0,
    reasons,
  };
}

export { DEFAULT_TOLERANCES };

// ---------------------------------------------------------------- effective-dated tolerances (BR-067)

export interface ResolvedTolerances {
  tolerances: Tolerances;
  /** Where each value came from: 'default', 'global from YYYY-MM-DD' or 'counterparty from YYYY-MM-DD'. */
  sources: Record<keyof Tolerances, string>;
}

/**
 * Tolerances in force for a family on a date. Per field the first non-null value wins: counterparty-specific rows
 * (newest effective date first), then global rows (newest first), then the built-in default.
 */
export async function resolveTolerances(family: Family, counterpartyId: string | null, date: string): Promise<ResolvedTolerances> {
  const rows = await prisma.reconTolerance.findMany({
    where: { family, effectiveFrom: { lte: dayStart(date) }, scope: counterpartyId ? { in: [counterpartyId, '*'] } : '*' },
    orderBy: [{ effectiveFrom: 'desc' }],
  });
  const ordered = [...rows.filter((r) => r.scope !== '*'), ...rows.filter((r) => r.scope === '*')];
  const out: Tolerances = { ...DEFAULT_TOLERANCES };
  const sources = Object.fromEntries(Object.keys(DEFAULT_TOLERANCES).map((k) => [k, 'default'])) as ResolvedTolerances['sources'];
  const fields: { key: keyof Tolerances; get: (r: (typeof rows)[number]) => unknown }[] = [
    { key: 'price', get: (r) => r.price },
    { key: 'cash', get: (r) => r.cash },
    { key: 'holdingsPct', get: (r) => r.holdingsPct },
    { key: 'positionQty', get: (r) => r.positionQty },
    { key: 'settleDays', get: (r) => r.settleDays },
    { key: 'caCash', get: (r) => r.caCash },
  ];
  for (const f of fields) {
    const hit = ordered.find((r) => f.get(r) !== null && f.get(r) !== undefined);
    if (!hit) continue;
    const v = f.get(hit);
    (out as unknown as Record<string, unknown>)[f.key] = f.key === 'settleDays' ? Number(v) : String(v);
    sources[f.key] = (hit.scope === '*' ? 'global' : 'counterparty') + ' from ' + isoDay(hit.effectiveFrom);
  }
  return { tolerances: out, sources };
}

// ---------------------------------------------------------------- close gating

/**
 * Open Critical or High breaks that must be cleared before a NAV is released or a close task is completed. Scoped to one
 * portfolio when given; only breaks from runs up to the as-of date count. The gate is on unless the policy
 * `recon_nav_gate` is set to false.
 */
export async function reconGate(opts: { portfolioId?: string | null; asOfDate?: string | null } = {}) {
  const policy = await prisma.policy.findUnique({ where: { key: 'recon_nav_gate' } });
  const enabled = policy?.value !== false;
  if (!enabled) return { enabled, blocked: false, breaks: [] as { id: string; ref: string; family: string; severity: string; status: string; label: string }[] };
  const rows = await prisma.reconBreak.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      severity: { in: MATERIAL },
      ...(opts.portfolioId ? { portfolioId: opts.portfolioId } : {}),
      ...(opts.asOfDate ? { run: { asOfDate: { lte: dayStart(opts.asOfDate) } } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, ref: true, family: true, severity: true, status: true, label: true },
  });
  return { enabled, blocked: rows.length > 0, breaks: rows };
}
