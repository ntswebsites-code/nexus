import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { SYSTEM_ACTOR_ID, systemCtx } from '../../lib/system';
import { closePrecheck } from '../cash/cash.service';
import { getPortfolioSummaries } from '../portfolio/portfolio.service';
import { countUnrecordedExceedances } from '../risk/risk.service';
import { endOfDay, ensureTask, linkDependency, resolveTaskBySource } from './tasks';
import { FAMILY_LABEL, FAMILIES, type Family } from '../recon/recon.engine';

/**
 * Live aggregation behind Operations Control (`/operations/status`) and the Command Centre (`/dashboard/today`).
 * Everything is read from the book of record at request time; nothing here is stored except the runbook tasks.
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const pct = (num: number, den: number) => (den <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((num / den) * 100))));
const OPEN_BREAK = ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER'];
// Same definition as the Orders page: Working = approved, routing or partly filled. Awaiting approval is reported separately.
const WORKING_ORDERS = ['Approved', 'Routing', 'PartiallyFilled'];

const money = (v: Dec) => v.toFixed(2);

async function reconSummary() {
  const [open, bySeverity, pendingChecker, oldest] = await Promise.all([
    prisma.reconBreak.count({ where: { status: { in: OPEN_BREAK } } }),
    prisma.reconBreak.groupBy({ by: ['severity'], where: { status: { in: OPEN_BREAK } }, _count: { _all: true } }),
    prisma.reconBreak.count({ where: { status: 'PENDING_CHECKER' } }),
    prisma.reconBreak.findFirst({ where: { status: { in: OPEN_BREAK } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  const sev = Object.fromEntries(bySeverity.map((s) => [s.severity, s._count._all]));
  return { open, pendingChecker, bySeverity: sev, high: (sev.HIGH ?? 0) + (sev.CRITICAL ?? 0), oldestDays: oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 86_400_000) : 0 };
}

async function cashSummary(now: Date) {
  const periodEnd = day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
  const portfolios = await prisma.portfolio.findMany({ where: { status: 'Active' }, select: { id: true, ref: true, name: true }, orderBy: { ref: 'asc' }, take: 25 });
  const closes = await prisma.cashPeriodClose.findMany({ where: { periodEnd, portfolioId: { in: portfolios.map((p) => p.id) } } });
  const cmap = new Map(closes.map((c) => [c.portfolioId, c]));
  const rows = [];
  let blockers = 0;
  let items = 0;
  let passing = 0;
  for (const p of portfolios) {
    const close = cmap.get(p.id) ?? null;
    const pre = await closePrecheck(p.id, periodEnd, close);
    const bl = pre.blockers.length;
    blockers += bl;
    items += pre.items.length;
    passing += pre.items.filter((i) => i.ok).length;
    rows.push({ portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, closeStatus: close?.status ?? 'NOT_PREPARED', blockers: bl, failing: pre.items.filter((i) => !i.ok).map((i) => i.label), canClose: pre.canClose });
  }
  const today = day(now);
  const [dueExp, stagedImports, pendingJournals, systemJournals] = await Promise.all([
    prisma.cashExpectation.findMany({ where: { status: 'EXPECTED', expectedDate: { lte: today } }, select: { direction: true, amount: true, currency: true } }),
    prisma.cashStatementImport.count({ where: { status: 'STAGED' } }),
    prisma.cashJournal.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.cashJournal.count({ where: { status: 'PENDING_APPROVAL', makerId: SYSTEM_ACTOR_ID } }),
  ]);
  const gross = dueExp.reduce((s, e) => s.add(e.amount), ZERO);
  return { periodEnd: iso(periodEnd), blockers, readinessPct: pct(passing, items), portfolios: rows, dueExpectations: dueExp.length, dueGross: money(gross), stagedImports, pendingJournals, systemJournals };
}

async function navSummary(now: Date) {
  const since = addDays(day(now), -7);
  const [byStatus, open] = await Promise.all([
    prisma.navRun.groupBy({ by: ['status'], where: { navDate: { gte: since } }, _count: { _all: true } }),
    prisma.navRun.findMany({ where: { status: { in: ['DRAFT', 'EXCEPTIONS_OPEN', 'MAKER_REVIEWED'] } }, orderBy: { navDate: 'desc' }, take: 10, include: { exceptions: { where: { status: 'OPEN' }, select: { material: true } } } }),
  ]);
  const pf = await prisma.portfolio.findMany({ where: { id: { in: open.map((r) => r.portfolioId) } }, select: { id: true, ref: true, name: true } });
  const pmap = new Map(pf.map((p) => [p.id, p]));
  const [active, releasedRecent] = await Promise.all([prisma.portfolio.count({ where: { status: 'Active' } }), prisma.navRun.findMany({ where: { status: 'RELEASED', navDate: { gte: since } }, distinct: ['portfolioId'], select: { portfolioId: true } })]);
  return {
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    unreleased: open.map((r) => ({ id: r.id, ref: r.ref, portfolioRef: pmap.get(r.portfolioId)?.ref ?? null, portfolioName: pmap.get(r.portfolioId)?.name ?? null, navDate: iso(r.navDate), status: r.status, openExceptions: r.exceptions.length, materialExceptions: r.exceptions.filter((e) => e.material).length })),
    blockers: open.reduce((s, r) => s + r.exceptions.filter((e) => e.material).length, 0),
    readinessPct: pct(releasedRecent.length, active),
    portfoliosReleased: releasedRecent.length,
    portfolios: active,
  };
}

async function accountingSummary(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [periods, pending, postedMonth, active] = await Promise.all([
    prisma.accPeriod.findMany({ where: { periodStart: { gte: prevStart } }, select: { status: true, portfolioId: true, periodStart: true } }),
    prisma.accJournal.count({ where: { status: 'PENDING_APPROVAL' } }),
    prisma.accJournal.count({ where: { status: 'POSTED', entryDate: { gte: start } } }),
    prisma.portfolio.count({ where: { status: 'Active' } }),
  ]);
  const by: Record<string, number> = {};
  for (const p of periods) by[p.status] = (by[p.status] ?? 0) + 1;
  const prevClosed = periods.filter((p) => p.periodStart.getTime() === prevStart.getTime() && p.status === 'CLOSED').length;
  const system = await prisma.accJournal.count({ where: { status: 'PENDING_APPROVAL', sourceRef: { not: null } } });
  return { periodsByStatus: by, pendingJournals: pending, systemJournals: system, postedThisMonth: postedMonth, previousPeriodClosed: prevClosed, portfolios: active, readinessPct: Math.round((pct(prevClosed, active) + pct(postedMonth, postedMonth + pending)) / 2) };
}

async function corpSummary(now: Date) {
  const today = day(now);
  const horizon = addDays(today, 7);
  const open = await prisma.corpActionEvent.findMany({
    where: { status: { in: ['ANNOUNCED', 'CONFIRMED'] }, OR: [{ exDate: { lte: horizon } }, { payDate: { lte: horizon } }, { electionDeadline: { lte: horizon } }] },
    orderBy: { payDate: 'asc' },
    take: 25,
  });
  const due = open.map((e) => ({
    id: e.id,
    ref: e.ref,
    ticker: e.ticker,
    type: e.type,
    status: e.status,
    exDate: iso(e.exDate),
    payDate: iso(e.payDate),
    electionDeadline: iso(e.electionDeadline),
    overdue: e.payDate.getTime() < today.getTime(),
    electionDue: !!e.electionDeadline && e.electionDeadline.getTime() >= today.getTime() && e.electionDeadline.getTime() <= addDays(today, 3).getTime(),
    needsProcessing: e.status === 'CONFIRMED' && !!e.entitlementsAt,
  }));
  return { due, count: due.length, electionsDue: due.filter((d) => d.electionDue).length, overdue: due.filter((d) => d.overdue).length, awaitingProcessing: due.filter((d) => d.needsProcessing).length };
}

async function settlementSummary(now: Date) {
  const since = addDays(day(now), -30);
  const [filled, settledRecent, filledRecent] = await Promise.all([
    prisma.order.findMany({ where: { status: 'Filled' }, select: { currency: true, quantity: true, avgPrice: true } }),
    prisma.order.count({ where: { status: 'Settled', updatedAt: { gte: since } } }),
    prisma.order.count({ where: { status: 'Filled', updatedAt: { gte: since } } }),
  ]);
  const by = new Map<string, Dec>();
  for (const o of filled) by.set(o.currency, (by.get(o.currency) ?? ZERO).add(o.quantity.mul(o.avgPrice ?? ZERO)));
  return { unsettled: filled.length, exposure: [...by.entries()].map(([currency, v]) => ({ currency, amount: money(v) })), readinessPct: pct(settledRecent, settledRecent + filledRecent) };
}

async function health() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { database: 'ok' as const };
  } catch {
    return { database: 'down' as const };
  }
}

/** GET /operations/status */
export async function operationsStatus(now = new Date()) {
  const [recon, cash, nav, accounting, corp, settlement, svc, taskCounts, riskOpen] = await Promise.all([
    reconSummary(),
    cashSummary(now),
    navSummary(now),
    accountingSummary(now),
    corpSummary(now),
    settlementSummary(now),
    health(),
    prisma.opsTask.groupBy({ by: ['status'], where: { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] }, dueAt: { lte: endOfDay(now) } }, _count: { _all: true } }),
    prisma.riskBreach.count({ where: { status: 'OPEN' } }),
  ]);
  const dueToday = taskCounts.reduce((s, t) => s + t._count._all, 0);
  const blockedTasks = taskCounts.find((t) => t.status === 'BLOCKED')?._count._all ?? 0;
  const closeBlockers = cash.blockers + nav.blockers + (recon.high > 0 ? recon.high : 0);
  return {
    asOf: now.toISOString(),
    kpis: {
      dueToday,
      blockedTasks,
      settlementExposure: settlement.exposure,
      unsettledOrders: settlement.unsettled,
      cashDeadlines: cash.dueExpectations,
      cashGross: cash.dueGross,
      corporateActions: corp.count,
      electionsDue: corp.electionsDue,
      closeBlockers,
      serviceHealth: svc.database === 'ok' ? 'ok' : 'degraded',
    },
    dependencies: [
      { key: 'settlement', label: 'Settlement', readinessPct: Math.min(settlement.readinessPct, recon.high ? 80 : 100), detail: `${recon.open} open recon break${recon.open === 1 ? '' : 's'}, ${settlement.unsettled} unsettled order${settlement.unsettled === 1 ? '' : 's'}`, link: '/ops/reconciliation' },
      { key: 'cash', label: 'Cash', readinessPct: cash.readinessPct, detail: `${cash.blockers} close blocker${cash.blockers === 1 ? '' : 's'} for ${cash.periodEnd}`, link: '/ops/cash' },
      { key: 'valuation', label: 'Valuation', readinessPct: nav.readinessPct, detail: `${nav.portfoliosReleased} of ${nav.portfolios} portfolios have a released NAV this week`, link: '/ops/nav' },
      { key: 'accounting', label: 'Accounting', readinessPct: accounting.readinessPct, detail: `${accounting.pendingJournals} journal${accounting.pendingJournals === 1 ? '' : 's'} awaiting approval`, link: '/ops/accounting' },
    ],
    recon,
    cash,
    nav,
    accounting,
    corporateActions: corp,
    settlement,
    risk: { openBreaches: riskOpen },
    health: svc,
  };
}

/**
 * Builds today's runbook from live conditions. One task per condition (unique source ref); a task whose condition has
 * cleared is completed by the system. Safe to call repeatedly.
 */
export async function generateRunbook(now = new Date()) {
  const s = await operationsStatus(now);
  const due = endOfDay(now);
  const today = new Date(`${iso(now)}T00:00:00.000Z`);
  const [runs, signoffs, material] = await Promise.all([
    prisma.reconRun.findMany({ where: { asOfDate: today }, select: { family: true } }),
    prisma.reconSignoff.findMany({ where: { asOfDate: today }, select: { family: true } }),
    prisma.reconBreak.count({ where: { status: { in: OPEN_BREAK }, severity: { in: ['HIGH', 'CRITICAL'] } } }),
  ]);
  const result = { created: 0, resolved: 0 };
  await prisma.$transaction(async (tx) => {
    const sync = async (cond: boolean, key: string, t: { area: 'SETTLEMENT' | 'CASH' | 'CORPORATE_ACTIONS' | 'VALUATION' | 'CLOSE' | 'REPORTING' | 'RISK' | 'OTHER'; title: string; detail: string; link: string; dueAt?: Date }) => {
      const sourceRef = `${key}:${iso(now)}`;
      if (cond) {
        const r = await ensureTask(tx, { ...t, dueAt: t.dueAt ?? due, sourceRef });
        if (r.created) result.created++;
      } else if (await resolveTaskBySource(tx, sourceRef, 'Condition cleared')) result.resolved++;
    };
    // Gate: valuation and close tasks wait for this one (see linkDependency below and the completion check).
    await sync(material > 0, 'RECON:MATERIAL', { area: 'CLOSE', title: `Clear ${material} Critical or High reconciliation break${material === 1 ? '' : 's'} before close`, detail: 'NAV release and the close tasks are blocked while these are open.', link: '/ops/reconciliation' });
    for (const f of FAMILIES) {
      const family: Family = f;
      await sync(runs.some((r) => r.family === family) && !signoffs.some((x) => x.family === family), `RECON:SIGNOFF:${family}`, { area: 'SETTLEMENT', title: `Sign off ${FAMILY_LABEL[family].toLowerCase()} reconciliation for ${iso(now)}`, detail: 'A run exists for today and has not been signed off by an independent checker.', link: '/ops/reconciliation' });
    }
    await sync(s.recon.open > 0, 'RECON:BREAKS', { area: 'SETTLEMENT', title: `Work ${s.recon.open} open reconciliation break${s.recon.open === 1 ? '' : 's'}`, detail: `${s.recon.high} high severity, ${s.recon.pendingChecker} awaiting a checker, oldest ${s.recon.oldestDays} day(s).`, link: '/ops/reconciliation' });
    await sync(s.settlement.unsettled > 0, 'ORDERS:SETTLE', { area: 'SETTLEMENT', title: `Settle ${s.settlement.unsettled} filled order${s.settlement.unsettled === 1 ? '' : 's'}`, detail: 'Filled orders generate their trade journals when settled.', link: '/ops/orders' });
    await sync(s.cash.blockers > 0, 'CASH:CLOSE', { area: 'CASH', title: `Clear ${s.cash.blockers} cash close blocker${s.cash.blockers === 1 ? '' : 's'} for ${s.cash.periodEnd}`, detail: s.cash.portfolios.filter((p) => p.blockers).slice(0, 5).map((p) => `${p.portfolioRef}: ${p.blockers}`).join('; '), link: '/ops/cash' });
    await sync(s.cash.pendingJournals > 0, 'CASH:JOURNALS', { area: 'CASH', title: `Approve ${s.cash.pendingJournals} pending cash journal${s.cash.pendingJournals === 1 ? '' : 's'}`, detail: `${s.cash.systemJournals} created by the system from orders and corporate actions.`, link: '/ops/cash' });
    await sync(s.nav.unreleased.length > 0, 'NAV:RELEASE', { area: 'VALUATION', title: `Release ${s.nav.unreleased.length} NAV run${s.nav.unreleased.length === 1 ? '' : 's'}`, detail: `${s.nav.blockers} material exception(s) open.`, link: '/ops/nav' });
    await sync(s.accounting.pendingJournals > 0, 'ACC:JOURNALS', { area: 'CLOSE', title: `Approve ${s.accounting.pendingJournals} pending accounting journal${s.accounting.pendingJournals === 1 ? '' : 's'}`, detail: `${s.accounting.systemJournals} created by the system.`, link: '/ops/accounting' });
    await sync(s.corporateActions.awaitingProcessing > 0 || s.corporateActions.electionsDue > 0, 'CA:DUE', { area: 'CORPORATE_ACTIONS', title: `${s.corporateActions.count} corporate action${s.corporateActions.count === 1 ? '' : 's'} due`, detail: `${s.corporateActions.electionsDue} election(s) due, ${s.corporateActions.awaitingProcessing} ready to process.`, link: '/ops/corporate-actions' });
    await sync(s.risk.openBreaches > 0, 'RISK:BREACHES', { area: 'RISK', title: `Review ${s.risk.openBreaches} open risk breach${s.risk.openBreaches === 1 ? '' : 'es'}`, detail: 'Each open breach has a risk case with an owner.', link: '/ops/risk' });
    for (const child of ['NAV:RELEASE', 'CASH:CLOSE', 'ACC:JOURNALS']) await linkDependency(tx, `${child}:${iso(now)}`, `RECON:MATERIAL:${iso(now)}`);
    if (result.created || result.resolved) await writeAudit(tx, systemCtx(), { action: 'operations.runbook_generated', objectType: 'ops_runbook', objectId: iso(now)!, after: { ...result } });
  });
  return result;
}

/** GET /dashboard/today: KPIs for the Command Centre. Sections the caller lacks permission for are returned as null. */
export async function dashboardToday(perms: string[], now = new Date()) {
  const can = (p: string) => perms.includes(p);
  const [portfolios, working, approvals, recon, cash, nav, risk, tasks, unrecordedBreaches] = await Promise.all([
    can('portfolio.view') || can('dashboard.view') ? getPortfolioSummaries({ status: 'Active' }) : Promise.resolve(null),
    can('orders.view') ? prisma.order.groupBy({ by: ['status'], where: { status: { in: [...WORKING_ORDERS, 'AwaitingApproval'] } }, _count: { _all: true } }) : Promise.resolve(null),
    approvalQueue(perms),
    can('operations.view') ? reconSummary() : Promise.resolve(null),
    can('cash.view') ? cashPosition() : Promise.resolve(null),
    can('valuation.view') ? navStatus(now) : Promise.resolve(null),
    can('risk.view') ? prisma.riskBreach.groupBy({ by: ['status'], where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } }) : Promise.resolve(null),
    can('operations.view') ? prisma.opsTask.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] }, dueAt: { lte: endOfDay(now) } } }) : Promise.resolve(null),
    can('risk.view') ? countUnrecordedExceedances(now).catch(() => 0) : Promise.resolve(null),
  ]);
  const aum = portfolios
    ? Object.entries(
        portfolios.reduce<Record<string, Dec>>((m, p) => {
          m[p.baseCurrency] = (m[p.baseCurrency] ?? ZERO).add(new D(p.marketValueBase));
          return m;
        }, {}),
      ).map(([currency, v]) => ({ currency, amount: money(v) }))
    : null;
  return {
    asOf: now.toISOString(),
    aum: portfolios ? { byCurrency: aum, portfolios: portfolios.length, positions: portfolios.reduce((s, p) => s + p.positionCount, 0), cashPct: portfolios.length ? portfolios.reduce((s, p) => s.add(new D(p.cashPct)), ZERO).div(portfolios.length).toFixed(2) : '0.00', warnings: portfolios.reduce((s, p) => s + p.warnings, 0) } : null,
    ordersWorking: working ? { total: working.filter((w) => WORKING_ORDERS.includes(w.status)).reduce((s, w) => s + w._count._all, 0), awaitingApproval: working.find((w) => w.status === 'AwaitingApproval')?._count._all ?? 0, byStatus: Object.fromEntries(working.filter((w) => WORKING_ORDERS.includes(w.status)).map((w) => [w.status, w._count._all])) } : null,
    breaks: recon ? { open: recon.open, high: recon.high, pendingChecker: recon.pendingChecker } : null,
    approvals,
    cash,
    nav,
    risk: risk ? { open: risk.find((r) => r.status === 'OPEN')?._count._all ?? 0, acknowledged: risk.find((r) => r.status === 'ACKNOWLEDGED')?._count._all ?? 0, unrecorded: unrecordedBreaches ?? 0 } : null,
    runbookDueToday: tasks,
  };
}

/** Items waiting on a checker, each counted only when the caller holds the permission to act on it. */
async function approvalQueue(perms: string[]) {
  const can = (p: string) => perms.includes(p);
  const items: { key: string; label: string; count: number; link: string }[] = [];
  const add = async (cond: boolean, key: string, label: string, link: string, f: () => Promise<number>) => {
    if (!cond) return;
    items.push({ key, label, link, count: await f() });
  };
  await add(can('orders.approve'), 'orders', 'Orders awaiting approval', '/ops/orders', () => prisma.order.count({ where: { status: 'AwaitingApproval' } }));
  await add(can('valuation.release'), 'nav', 'NAV runs ready for release', '/ops/nav', () => prisma.navRun.count({ where: { status: 'MAKER_REVIEWED' } }));
  await add(can('accounting.post'), 'accounting', 'Accounting journals to post', '/ops/accounting', () => prisma.accJournal.count({ where: { status: 'PENDING_APPROVAL' } }));
  await add(can('cash.journal.approve'), 'cash', 'Cash journals and imports to approve', '/ops/cash', async () => (await prisma.cashJournal.count({ where: { status: 'PENDING_APPROVAL' } })) + (await prisma.cashStatementImport.count({ where: { status: 'STAGED' } })));
  await add(can('corporate_actions.process'), 'corporateActions', 'Corporate actions to process', '/ops/corporate-actions', () => prisma.corpActionEvent.count({ where: { status: 'CONFIRMED', entitlementsAt: { not: null } } }));
  await add(can('recon.signoff'), 'recon', 'Reconciliation breaks awaiting a checker', '/ops/reconciliation', () => prisma.reconBreak.count({ where: { status: 'PENDING_CHECKER' } }));
  return { total: items.reduce((s, i) => s + i.count, 0), items };
}

async function cashPosition() {
  const ledgers = await prisma.cashLedger.findMany({ where: { kind: 'BANK', status: 'ACTIVE' }, select: { id: true, currency: true, minBuffer: true } });
  const ids = ledgers.map((l) => l.id);
  if (!ids.length) return { byCurrency: [] as { currency: string; posted: string; reserved: string; available: string }[], ledgers: 0 };
  const [posted, reserved] = await Promise.all([
    prisma.cashJournalLine.groupBy({ by: ['ledgerId'], where: { ledgerId: { in: ids }, journal: { status: { in: ['POSTED', 'REVERSED'] } } }, _sum: { debit: true, credit: true } }),
    prisma.cashReservation.groupBy({ by: ['ledgerId'], where: { ledgerId: { in: ids }, status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } }, _sum: { amount: true, consumed: true } }),
  ]);
  const p = new Map(posted.map((r) => [r.ledgerId, (r._sum.debit ?? ZERO).sub(r._sum.credit ?? ZERO)]));
  const r = new Map(reserved.map((x) => [x.ledgerId, (x._sum.amount ?? ZERO).sub(x._sum.consumed ?? ZERO)]));
  const by = new Map<string, { posted: Dec; reserved: Dec; available: Dec }>();
  for (const l of ledgers) {
    const po = p.get(l.id) ?? ZERO;
    const re = r.get(l.id) ?? ZERO;
    const av = po.sub(re).sub(l.minBuffer);
    const t = by.get(l.currency) ?? { posted: ZERO, reserved: ZERO, available: ZERO };
    by.set(l.currency, { posted: t.posted.add(po), reserved: t.reserved.add(re), available: t.available.add(av.gt(0) ? av : ZERO) });
  }
  return { ledgers: ledgers.length, byCurrency: [...by.entries()].map(([currency, t]) => ({ currency, posted: money(t.posted), reserved: money(t.reserved), available: money(t.available) })) };
}

async function navStatus(now: Date) {
  const [latest, inProgress, active] = await Promise.all([
    prisma.navRun.findFirst({ where: { status: 'RELEASED' }, orderBy: [{ navDate: 'desc' }, { releasedAt: 'desc' }] }),
    prisma.navRun.groupBy({ by: ['status'], where: { status: { in: ['DRAFT', 'EXCEPTIONS_OPEN', 'MAKER_REVIEWED'] } }, _count: { _all: true } }),
    prisma.portfolio.count({ where: { status: 'Active' } }),
  ]);
  const released = await prisma.navRun.findMany({ where: { status: 'RELEASED', navDate: { gte: addDays(day(now), -7) } }, distinct: ['portfolioId'], select: { portfolioId: true } });
  return { latestReleasedDate: iso(latest?.navDate), latestReleasedRef: latest?.ref ?? null, inProgress: Object.fromEntries(inProgress.map((s) => [s.status, s._count._all])), portfoliosReleasedThisWeek: released.length, portfolios: active };
}
