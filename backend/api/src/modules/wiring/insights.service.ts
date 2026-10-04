import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { SYSTEM_ACTOR_ID, SYSTEM_NAME } from '../../lib/system';
import { getPortfolioSnapshot, getPortfolioSummaries } from '../portfolio/portfolio.service';
import { compute, resolveBenchmark } from '../performance/perf.service';
import { PRESETS } from '../risk/risk.engine';
import { computeScenario } from '../risk/risk.service';
import { endOfDay } from './tasks';

/**
 * Read models behind the Operations calendar and workload charts and the Command Centre performance, allocation and
 * scenario panels. Everything is computed live from the book of record; nothing is stored.
 */
const D = Prisma.Decimal;
const day = (d: Date) => d.toISOString().slice(0, 10);
const dstart = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const money = (v: Prisma.Decimal) => v.toFixed(2);

export interface CalendarEvent {
  date: string;
  kind: 'TASK' | 'CORPORATE_ACTION' | 'CASH' | 'SETTLEMENT' | 'NAV' | 'CLOSE';
  title: string;
  detail: string | null;
  status: string | null;
  link: string;
  amount?: string;
  currency?: string;
}

export async function operationsCalendar(from: string, to: string) {
  const start = dstart(from);
  const endExcl = addDays(dstart(to), 1);
  const [tasks, cas, exps, execs, navs] = await Promise.all([
    prisma.opsTask.findMany({ where: { dueAt: { gte: start, lt: endExcl }, status: { not: 'CANCELLED' } }, orderBy: { dueAt: 'asc' }, take: 500 }),
    prisma.corpActionEvent.findMany({
      where: { status: { not: 'CANCELLED' }, OR: [{ exDate: { gte: start, lt: endExcl } }, { recordDate: { gte: start, lt: endExcl } }, { payDate: { gte: start, lt: endExcl } }, { electionDeadline: { gte: start, lt: endExcl } }] },
      take: 200,
    }),
    prisma.cashExpectation.findMany({ where: { expectedDate: { gte: start, lt: endExcl }, status: { in: ['EXPECTED', 'DUE'] } }, orderBy: { expectedDate: 'asc' }, take: 300 }),
    prisma.counterpartyExecution.findMany({ where: { settlementDate: { gte: start, lt: endExcl }, status: { not: 'Superseded' } }, orderBy: { settlementDate: 'asc' }, take: 300 }),
    prisma.navRun.findMany({ where: { navDate: { gte: start, lt: endExcl }, status: { not: 'SUPERSEDED' } }, orderBy: { navDate: 'asc' }, take: 200 }),
  ]);
  const ev: CalendarEvent[] = [];
  for (const t of tasks) ev.push({ date: day(t.dueAt), kind: 'TASK', title: `${t.ref} ${t.title}`, detail: t.area.replace(/_/g, ' ').toLowerCase(), status: t.status, link: t.link ?? '/ops/operations' });
  for (const c of cas) {
    const add = (d: Date | null, label: string) => {
      if (d && d >= start && d < endExcl) ev.push({ date: day(d), kind: 'CORPORATE_ACTION', title: `${c.ref} ${c.ticker} ${c.type.replace(/_/g, ' ').toLowerCase()}: ${label}`, detail: c.description, status: c.status, link: '/ops/corporate-actions' });
    };
    add(c.exDate, 'ex date');
    add(c.recordDate, 'record date');
    add(c.payDate, 'pay date');
    add(c.electionDeadline, 'election deadline');
  }
  for (const e of exps) ev.push({ date: day(e.expectedDate), kind: 'CASH', title: `${e.ref} ${e.direction === 'IN' ? 'receipt' : 'payment'} ${e.kind.replace(/_/g, ' ').toLowerCase()}`, detail: e.source ?? e.note, status: e.status, link: '/ops/cash', amount: e.amount.toFixed(2), currency: e.currency });
  for (const x of execs) if (x.settlementDate) ev.push({ date: day(x.settlementDate), kind: 'SETTLEMENT', title: `Settle ${x.side} ${x.quantity.toString()} ${x.ticker}`, detail: `${x.tradeRef} on ${x.accountRef}`, status: x.status, link: '/ops/orders', amount: x.quantity.mul(x.price).toFixed(2), currency: x.currency });
  for (const n of navs) ev.push({ date: day(n.navDate), kind: 'NAV', title: `NAV ${n.ref}`, detail: n.stage.replace(/_/g, ' ').toLowerCase(), status: n.status, link: `/ops/nav/${n.id}` });
  // Month ends in range are the accounting close markers.
  for (let d = start; d < endExcl; d = addDays(d, 1)) {
    if (addDays(d, 1).getUTCDate() === 1) ev.push({ date: day(d), kind: 'CLOSE', title: 'Month end: accounting and cash period close', detail: null, status: null, link: '/ops/accounting' });
  }
  ev.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const byDay: Record<string, number> = {};
  for (const e of ev) byDay[e.date] = (byDay[e.date] ?? 0) + 1;
  return { from, to, events: ev, byDay, total: ev.length };
}

export async function operationsWorkload(now = new Date()) {
  const live = ['OPEN', 'IN_PROGRESS', 'BLOCKED'];
  const today = dstart(day(now));
  const horizon = 7;
  const [open, cashDue, breaks] = await Promise.all([
    prisma.opsTask.findMany({ where: { status: { in: live } }, select: { id: true, area: true, status: true, ownerId: true, dueAt: true, dependsOnId: true } }),
    prisma.cashExpectation.findMany({ where: { status: { in: ['EXPECTED', 'DUE'] }, expectedDate: { lt: addDays(today, horizon + 1) } }, select: { expectedDate: true, amount: true, currency: true, direction: true } }),
    prisma.reconBreak.groupBy({ by: ['ownerUserId'], where: { status: { in: ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER'] } }, _count: { _all: true } }),
  ]);
  const ownerIds = [...new Set([...open.map((t) => t.ownerId), ...breaks.map((b) => b.ownerUserId)].filter((x): x is string => !!x && x !== SYSTEM_ACTOR_ID))];
  const users = ownerIds.length ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name || u.email]));
  name.set(SYSTEM_ACTOR_ID, SYSTEM_NAME);
  const eod = endOfDay(now);

  const byOwner = new Map<string, { ownerId: string | null; owner: string; open: number; dueToday: number; overdue: number; blocked: number; breaks: number }>();
  const slot = (id: string | null) => {
    const k = id ?? '-';
    if (!byOwner.has(k)) byOwner.set(k, { ownerId: id, owner: id ? (name.get(id) ?? 'Unknown') : 'Unassigned', open: 0, dueToday: 0, overdue: 0, blocked: 0, breaks: 0 });
    return byOwner.get(k)!;
  };
  const byArea: Record<string, { open: number; blocked: number; overdue: number }> = {};
  const days: { date: string; label: string; tasks: number; overdue?: number }[] = [];
  for (let i = 0; i <= horizon; i++) days.push({ date: day(addDays(today, i)), label: i === 0 ? 'Today' : day(addDays(today, i)).slice(5), tasks: 0 });
  let overdue = 0;
  for (const t of open) {
    const o = slot(t.ownerId);
    o.open++;
    if (t.status === 'BLOCKED') o.blocked++;
    const a = (byArea[t.area] ??= { open: 0, blocked: 0, overdue: 0 });
    a.open++;
    if (t.status === 'BLOCKED') a.blocked++;
    if (t.dueAt < today) {
      o.overdue++;
      a.overdue++;
      overdue++;
    } else if (t.dueAt <= eod) o.dueToday++;
    const d = days.find((x) => x.date === day(t.dueAt));
    if (d) d.tasks++;
    else if (t.dueAt < today) days[0]!.tasks++;
  }
  for (const b of breaks) slot(b.ownerUserId).breaks += b._count._all;

  const cashDays = days.map((d) => ({ date: d.date, label: d.label, in: new D(0), out: new D(0), count: 0, currencies: new Set<string>() }));
  for (const e of cashDue) {
    const dt = day(e.expectedDate) < days[0]!.date ? days[0]!.date : day(e.expectedDate);
    const slotD = cashDays.find((c) => c.date === dt);
    if (!slotD) continue;
    slotD.count++;
    slotD.currencies.add(e.currency);
    if (e.direction === 'IN') slotD.in = slotD.in.add(e.amount);
    else slotD.out = slotD.out.add(e.amount);
  }
  return {
    asOf: now.toISOString(),
    openTasks: open.length,
    overdue,
    byOwner: [...byOwner.values()].sort((a, b) => b.open - a.open),
    byArea: Object.entries(byArea).map(([area, v]) => ({ area, ...v })).sort((a, b) => b.open - a.open),
    dueByDay: days,
    cashByDay: cashDays.map((c) => ({ date: c.date, label: c.label, count: c.count, in: money(c.in), out: money(c.out), mixedCurrency: c.currencies.size > 1, currency: c.currencies.size === 1 ? [...c.currencies][0]! : null })),
  };
}

// ---------------------------------------------------------------- Command Centre panels

const downsample = <T>(rows: T[], max: number) => {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]!);
};

async function performancePanel() {
  const top = (await getPortfolioSummaries({ status: 'Active' })).sort((a, b) => Number(b.marketValueBase) - Number(a.marketValueBase)).slice(0, 5);
  const out = [];
  for (const s of top) {
    try {
      const p = await prisma.portfolio.findUniqueOrThrow({ where: { id: s.id } });
      const pos = await prisma.portfolioPosition.findMany({ where: { portfolioId: p.id }, select: { securityId: true } });
      const g = await prisma.securityPrice.aggregate({ where: { securityId: { in: [...new Set(pos.map((x) => x.securityId))] } }, _min: { priceDate: true }, _max: { priceDate: true } });
      const end = g._max.priceDate ? day(g._max.priceDate) : day(new Date());
      const floor = day(addDays(dstart(end), -90));
      const startRaw = g._min.priceDate ? day(g._min.priceDate) : floor;
      let start = startRaw > floor ? startRaw : floor;
      if (start >= end) start = day(addDays(dstart(end), -1));
      const c = await compute(p, await resolveBenchmark(p), start, end);
      out.push({
        portfolioId: p.id,
        ref: p.ref,
        name: p.name,
        currency: c.baseCurrency,
        periodStart: start,
        periodEnd: end,
        twrPct: Number((c.twr * 100).toFixed(4)),
        benchmarkPct: c.benchTwr === null ? null : Number((c.benchTwr * 100).toFixed(4)),
        activePct: c.active === null ? null : Number((c.active * 100).toFixed(4)),
        benchmarkName: c.attribution.benchmark?.name ?? null,
        series: downsample(c.series, 45).map((x) => ({ date: x.date, cumPct: Number((x.cum * 100).toFixed(4)), benchCumPct: x.benchCum === null ? null : Number((x.benchCum * 100).toFixed(4)) })),
        issues: c.issues,
      });
    } catch (e) {
      out.push({ portfolioId: s.id, ref: s.ref, name: s.name, error: e instanceof Error ? e.message : 'Could not compute' });
    }
  }
  return out;
}

async function allocationPanel() {
  const top = (await getPortfolioSummaries({ status: 'Active' })).slice(0, 25);
  const by = new Map<string, { total: Prisma.Decimal; assetClass: Map<string, Prisma.Decimal>; sector: Map<string, Prisma.Decimal>; market: Map<string, Prisma.Decimal>; portfolios: number }>();
  for (const s of top) {
    const snap = await getPortfolioSnapshot(s.id);
    const cur = snap.baseCurrency;
    const e = by.get(cur) ?? { total: new D(0), assetClass: new Map(), sector: new Map(), market: new Map(), portfolios: 0 };
    e.portfolios++;
    e.total = e.total.add(snap.totals.totalValueBase);
    const add = (m: Map<string, Prisma.Decimal>, k: string, v: Prisma.Decimal.Value) => m.set(k, (m.get(k) ?? new D(0)).add(v));
    for (const b of snap.concentration.byAssetClass) add(e.assetClass, b.key, b.valueBase);
    for (const b of snap.concentration.bySector) add(e.sector, b.key, b.valueBase);
    for (const b of snap.concentration.byMarket) add(e.market, b.key, b.valueBase);
    // snap.concentration.byAssetClass already carries the cash row; adding it again double-counted cash (weights summed past 100%).
    by.set(cur, e);
  }
  const rows = (m: Map<string, Prisma.Decimal>, total: Prisma.Decimal) =>
    [...m.entries()]
      .map(([key, v]) => ({ key, valueBase: money(v), weightPct: total.isZero() ? '0.00' : v.div(total).mul(100).toFixed(2) }))
      .sort((a, b) => Number(b.valueBase) - Number(a.valueBase));
  return [...by.entries()].map(([currency, e]) => ({ currency, portfolios: e.portfolios, total: money(e.total), byAssetClass: rows(e.assetClass, e.total), bySector: rows(e.sector, e.total).slice(0, 8), byMarket: rows(e.market, e.total) }));
}

async function scenarioPanel() {
  const top = (await getPortfolioSummaries({ status: 'Active' })).sort((a, b) => Number(b.marketValueBase) - Number(a.marketValueBase)).slice(0, 8);
  const rank = { Escalate: 3, Review: 2, Within: 1 } as const;
  const presets = [];
  for (const preset of PRESETS) {
    const results = [];
    let worst: keyof typeof rank = 'Within';
    for (const s of top) {
      try {
        const { result } = await computeScenario(s.id, preset.shocks);
        if (rank[result.status] > rank[worst]) worst = result.status;
        results.push({ portfolioId: s.id, ref: s.ref, name: s.name, currency: result.baseCurrency, nav: result.nav, lossPct: result.lossPct, loss: result.loss, status: result.status, coverage: result.liquidity.coverage, reasons: result.reasons.slice(0, 2) });
      } catch (e) {
        results.push({ portfolioId: s.id, ref: s.ref, name: s.name, error: e instanceof Error ? e.message : 'Could not compute' });
      }
    }
    presets.push({ key: preset.key, name: preset.name, description: preset.description, worst, results });
  }
  return presets;
}

/** GET /dashboard/panels: sections the caller lacks permission for are null. */
export async function dashboardPanels(perms: string[], now = new Date()) {
  const can = (p: string) => perms.includes(p);
  const book = can('portfolio.view') || can('dashboard.view');
  const [performance, allocation, scenario] = await Promise.all([book ? performancePanel() : null, book ? allocationPanel() : null, can('risk.view') ? scenarioPanel() : null]);
  return { asOf: now.toISOString(), performance, allocation, scenario };
}
