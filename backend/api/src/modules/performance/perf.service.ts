import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { balances } from '../cash/cash.service';
import { bookHealth, type PortfolioRow } from '../ibor/ibor.service';
import { OPEN_STATUSES } from '../recon/recon.engine';
import { bps, brinson, buildSeries, chain, pct6, type Segment } from './perf.engine';

type BenchmarkRow = Prisma.PerfBenchmarkGetPayload<{ include: { constituents: true } }>;
const D = Prisma.Decimal;
const DAY = 86_400_000;
const MAX_DAYS = 800;
const STALE_DAYS = 5;
/** A released NAV run may differ from the computed value by this percent (fees, accruals and liabilities sit in NAV). */
export const NAV_TOLERANCE_PCT = 1;
const FLOW_PURPOSES = ['CLIENT_DEPOSIT', 'CLIENT_WITHDRAWAL'];

const ds = (d: Date) => d.toISOString().slice(0, 10);
const dd = (s: string) => new Date(`${s}T00:00:00.000Z`);
const num = (v: Prisma.Decimal | null | undefined) => (v ? Number(v.toString()) : 0);

export interface ControlItem {
  key: 'ibor' | 'cash' | 'valuation' | 'composite' | 'flows';
  title: string;
  description: string;
  state: 'done' | 'warn';
  detail: string;
}

export interface Computed {
  dates: string[];
  baseCurrency: string;
  startValue: number;
  endValue: number;
  netFlows: number;
  twr: number;
  benchTwr: number | null;
  active: number | null;
  series: ReturnType<typeof buildSeries>['points'];
  attribution: {
    benchmark: { id: string; code: string; name: string } | null;
    segments: { sector: string; avgWeightPct: string; benchWeightPct: string; allocationBps: number; selectionBps: number; interactionBps: number; totalBps: number; portfolioReturnPct: string | null; benchmarkReturnPct: string | null }[];
    totals: { allocationBps: number; selectionBps: number; interactionBps: number; explainedBps: number; activeBps: number | null; unexplainedBps: number | null };
  };
  contributions: { securityId: string | null; ticker: string; name: string; sector: string; avgWeightPct: string; returnPct: string | null; contributionBps: number; benchWeightPct: string | null; startValue: string; endValue: string }[];
  issues: { missingPrice: string[]; missingFx: string[]; stale: string[]; gapDays: number };
  hash: string;
}

export async function resolveBenchmark(p: PortfolioRow, benchmarkId?: string | null): Promise<BenchmarkRow | null> {
  if (benchmarkId) {
    const b = await prisma.perfBenchmark.findUnique({ where: { id: benchmarkId }, include: { constituents: true } });
    if (!b) throw HttpError.badRequest('Validation failed', [{ path: 'benchmarkId', message: 'Unknown benchmark' }]);
    return b;
  }
  if (!p.benchmark) return null;
  const all = await prisma.perfBenchmark.findMany({ where: { status: 'ACTIVE' }, include: { constituents: true } });
  return all.find((b) => b.name.toLowerCase() === p.benchmark!.toLowerCase()) ?? null;
}

interface Px {
  at: (secId: string, date: string) => { price: number; date: string } | null;
  fx: (from: string, to: string, date: string) => number | null;
}

export async function compute(p: PortfolioRow, benchmark: BenchmarkRow | null, startS: string, endS: string): Promise<Computed> {
  const start = dd(startS);
  const end = dd(endS);
  if (end.getTime() <= start.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'periodEnd', message: 'The period end must be after the start' }]);
  const base = p.baseCurrency;

  const [positions, cashRows] = await Promise.all([
    prisma.portfolioPosition.findMany({ where: { portfolioId: p.id, asOf: { lte: end } }, orderBy: { asOf: 'asc' } }),
    prisma.portfolioCash.findMany({ where: { portfolioId: p.id, asOf: { lte: end } }, orderBy: { asOf: 'asc' } }),
  ]);
  const heldIds = [...new Set(positions.map((x) => x.securityId))];
  const benchIds = (benchmark?.constituents ?? []).map((c) => c.securityId).filter((x): x is string => !!x);
  const secIds = [...new Set([...heldIds, ...benchIds])];
  const secs = await prisma.security.findMany({ where: { id: { in: secIds } } });
  const sec = new Map(secs.map((s) => [s.id, s]));
  const prices = await prisma.securityPrice.findMany({ where: { securityId: { in: secIds }, priceDate: { gte: new Date(start.getTime() - 30 * DAY), lte: end } }, orderBy: [{ priceDate: 'asc' }, { createdAt: 'asc' }] });
  const fxRows = await prisma.fxRate.findMany({ where: { rateDate: { lte: end } }, orderBy: { rateDate: 'asc' } });

  // ---- price and fx lookups with carry-forward
  const pxBy = new Map<string, { date: string; price: number }[]>();
  for (const r of prices) {
    const a = pxBy.get(r.securityId) ?? [];
    const row = { date: ds(r.priceDate), price: num(r.price) };
    if (a.length && a[a.length - 1]!.date === row.date) a[a.length - 1] = row;
    else a.push(row);
    pxBy.set(r.securityId, a);
  }
  const fxBy = new Map<string, { date: string; rate: number }[]>();
  for (const r of fxRows) {
    const k = `${r.fromCurrency}>${r.toCurrency}`;
    const a = fxBy.get(k) ?? [];
    a.push({ date: ds(r.rateDate), rate: num(r.rate) });
    fxBy.set(k, a);
  }
  const lastLE = <T extends { date: string }>(a: T[] | undefined, date: string): T | null => {
    if (!a) return null;
    let lo = 0;
    let hi = a.length - 1;
    let ans: T | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid]!.date <= date) {
        ans = a[mid]!;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  const px: Px = {
    at: (secId, date) => {
      const r = lastLE(pxBy.get(secId), date);
      return r ? { price: r.price, date: r.date } : null;
    },
    fx: (from, to, date) => {
      if (from === to) return 1;
      const d = lastLE(fxBy.get(`${from}>${to}`), date);
      if (d) return d.rate;
      const inv = lastLE(fxBy.get(`${to}>${from}`), date);
      return inv && inv.rate !== 0 ? 1 / inv.rate : null;
    },
  };

  // ---- valuation dates
  const dateSet = new Set<string>([startS, endS]);
  for (const a of pxBy.values()) for (const r of a) if (r.date > startS && r.date < endS) dateSet.add(r.date);
  const dates = [...dateSet].sort();
  if (dates.length > MAX_DAYS) throw HttpError.badRequest('Validation failed', [{ path: 'periodEnd', message: `The period has more than ${MAX_DAYS} valuation dates; use a shorter period` }]);

  const posBy = new Map<string, { date: string; qty: number }[]>();
  for (const r of positions) {
    const a = posBy.get(r.securityId) ?? [];
    a.push({ date: ds(r.asOf), qty: num(r.quantity) });
    posBy.set(r.securityId, a);
  }
  const cashBy = new Map<string, { date: string; qty: number }[]>();
  for (const r of cashRows) {
    const a = cashBy.get(r.currency) ?? [];
    a.push({ date: ds(r.asOf), qty: num(r.available) });
    cashBy.set(r.currency, a);
  }

  const issues = { missingPrice: new Set<string>(), missingFx: new Set<string>(), stale: new Set<string>(), gapDays: 0 };
  interface Day {
    value: number;
    hold: Map<string, { qty: number; val: number; unit: number | null }>;
    cashQty: Map<string, number>;
    cashVal: number;
    cashFx: Map<string, number | null>;
  }
  const days: Day[] = dates.map((date) => {
    const hold = new Map<string, { qty: number; val: number; unit: number | null }>();
    let total = 0;
    for (const [secId, a] of posBy) {
      const qty = lastLE(a, date)?.qty ?? 0;
      if (qty === 0) continue;
      const s = sec.get(secId)!;
      const price = px.at(secId, date);
      const fx = px.fx(s.currency, base, date);
      if (!price) {
        issues.missingPrice.add(s.ticker);
        hold.set(secId, { qty, val: 0, unit: null });
        continue;
      }
      if (fx === null) {
        issues.missingFx.add(`${s.currency}/${base}`);
        hold.set(secId, { qty, val: 0, unit: null });
        continue;
      }
      if (date === endS && (dd(date).getTime() - dd(price.date).getTime()) / DAY > STALE_DAYS) issues.stale.add(`${s.ticker} (${price.date})`);
      const unit = price.price * fx;
      hold.set(secId, { qty, val: qty * unit, unit });
      total += qty * unit;
    }
    const cashQty = new Map<string, number>();
    const cashFx = new Map<string, number | null>();
    let cashVal = 0;
    for (const [ccy, a] of cashBy) {
      const qty = lastLE(a, date)?.qty ?? 0;
      cashQty.set(ccy, qty);
      const fx = px.fx(ccy, base, date);
      cashFx.set(ccy, fx);
      if (fx === null) {
        if (qty !== 0) issues.missingFx.add(`${ccy}/${base}`);
        continue;
      }
      cashVal += qty * fx;
    }
    return { value: total + cashVal, hold, cashQty, cashVal, cashFx };
  });

  // ---- external flows (posted client deposits and withdrawals), start-of-day convention
  const journals = await prisma.cashJournal.findMany({ where: { portfolioId: p.id, status: 'POSTED', purpose: { in: FLOW_PURPOSES }, entryDate: { gt: start, lte: end } }, select: { entryDate: true, purpose: true, totalDebit: true, currency: true } });
  const flows = dates.map(() => 0);
  for (const j of journals) {
    const e = ds(j.entryDate);
    let t = dates.findIndex((x) => x >= e);
    if (t <= 0) t = t === 0 ? 1 : -1;
    if (t < 0 || t >= dates.length) continue;
    const fx = px.fx(j.currency, base, e);
    if (fx === null) {
      issues.missingFx.add(`${j.currency}/${base}`);
      continue;
    }
    flows[t]! += (j.purpose === 'CLIENT_DEPOSIT' ? 1 : -1) * num(j.totalDebit) * fx;
  }

  const inputs = days.map((d, t) => ({ value: d.value, flow: flows[t]! }));

  // ---- benchmark daily returns: constant-mix target weights on constituent price returns in base currency
  const secRet = (secId: string, t: number): number | null => {
    const s = sec.get(secId);
    if (!s || t === 0) return null;
    const a = px.at(secId, dates[t - 1]!);
    const b = px.at(secId, dates[t]!);
    const f0 = px.fx(s.currency, base, dates[t - 1]!);
    const f1 = px.fx(s.currency, base, dates[t]!);
    if (!a || !b || f0 === null || f1 === null) return null;
    return (b.price * f1) / (a.price * f0) - 1;
  };
  const cons = benchmark?.constituents ?? [];
  const benchSectors = new Map<string, { w: number; daily: number[] }>();
  let benchDaily: number[] | null = null;
  if (benchmark && cons.length) {
    benchDaily = dates.map(() => 0);
    for (const c of cons) {
      const w = num(c.weightPct) / 100;
      const b = benchSectors.get(c.sector) ?? { w: 0, daily: dates.map(() => 0) };
      b.w += w;
      for (let t = 1; t < dates.length; t++) {
        const r = c.securityId ? secRet(c.securityId, t) : 0;
        if (c.securityId && r === null) issues.missingPrice.add(`${sec.get(c.securityId)?.ticker ?? c.securityId} (benchmark)`);
        const contrib = w * (r ?? 0);
        benchDaily[t]! += contrib;
        b.daily[t]! += contrib;
      }
      benchSectors.set(c.sector, b);
    }
  }
  const series = buildSeries(dates, inputs, benchDaily);
  issues.gapDays = series.gaps;

  // ---- security / sector / cash contributions from start-of-day weights
  const n = dates.length - 1;
  interface Acc {
    sector: string;
    contrib: number;
    wSum: number;
    chain: number;
    held: number;
  }
  const acc = new Map<string, Acc>();
  const sectorAcc = new Map<string, { wSum: number; contrib: number; chain: number }>();
  let cashContribTotal = 0;
  let explained = 0;
  const cashSector = { wSum: 0, contrib: 0, chain: 1 };
  for (let t = 1; t <= n; t++) {
    const prev = days[t - 1]!;
    if (!(prev.value > 0)) continue;
    const dayBySector = new Map<string, { w: number; c: number }>();
    let dayContrib = 0;
    for (const [secId, h] of prev.hold) {
      const w = h.val / prev.value;
      const r = secRet(secId, t);
      if (h.val === 0 || r === null) continue;
      const s = sec.get(secId)!;
      const a = acc.get(secId) ?? { sector: s.sector ?? 'Unclassified', contrib: 0, wSum: 0, chain: 1, held: 0 };
      a.contrib += w * r;
      a.wSum += w;
      a.chain *= 1 + r;
      a.held += 1;
      acc.set(secId, a);
      const ds0 = dayBySector.get(a.sector) ?? { w: 0, c: 0 };
      ds0.w += w;
      ds0.c += w * r;
      dayBySector.set(a.sector, ds0);
      dayContrib += w * r;
    }
    for (const [sector, v] of dayBySector) {
      const sa = sectorAcc.get(sector) ?? { wSum: 0, contrib: 0, chain: 1 };
      sa.wSum += v.w;
      sa.contrib += v.c;
      sa.chain *= 1 + v.c / v.w;
      sectorAcc.set(sector, sa);
    }
    // cash sleeve: start-of-day cash balances revalued at the new FX rate
    let cashPrev = 0;
    let cashNow = 0;
    for (const [ccy, qty] of prev.cashQty) {
      const f0 = prev.cashFx.get(ccy);
      const f1 = px.fx(ccy, base, dates[t]!);
      if (f0 && f1 !== null) {
        cashPrev += qty * f0;
        cashNow += qty * f1;
      }
    }
    if (cashPrev > 0) {
      const w = cashPrev / prev.value;
      const r = cashNow / cashPrev - 1;
      cashSector.wSum += w;
      cashSector.contrib += w * r;
      cashSector.chain *= 1 + r;
      cashContribTotal += w * r;
      dayContrib += w * r;
    }
    explained += dayContrib;
  }
  const portArith = series.points.slice(1).reduce((a, x) => a + x.ret, 0);
  const residual = portArith - explained;

  // ---- Brinson segments
  const sectors = new Set<string>([...sectorAcc.keys(), ...benchSectors.keys()]);
  if (cashSector.wSum > 0) sectors.add('Cash');
  const periods = Math.max(1, n);
  const segs: Segment[] = [...sectors].map((sector) => {
    const pa = sector === 'Cash' ? cashSector : sectorAcc.get(sector);
    const ba = benchSectors.get(sector);
    return {
      sector,
      wp: pa ? pa.wSum / periods : 0,
      rp: pa && pa.wSum > 0 ? pa.chain - 1 : null,
      wb: ba?.w ?? 0,
      rb: ba && ba.w > 0 ? chain(ba.daily.slice(1).map((c) => c / ba.w)) : null,
    };
  });
  const benchTotal = series.benchTwr ?? 0;
  const results = benchmark ? brinson(segs, benchTotal) : [];
  results.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const sum = (k: 'allocation' | 'selection' | 'interaction') => results.reduce((a, r) => a + r[k], 0);
  const explainedActive = sum('allocation') + sum('selection') + sum('interaction');
  const active = series.benchTwr === null ? null : series.twr - series.benchTwr;

  const avgTotal = (secId: string) => (acc.get(secId)?.wSum ?? 0) / periods;
  const consBy = new Map(cons.filter((c) => c.securityId).map((c) => [c.securityId!, c]));
  const contributions: Computed['contributions'] = [...new Set([...acc.keys(), ...heldIds])].map((secId) => {
    const s = sec.get(secId)!;
    const a = acc.get(secId);
    const startH = days[0]!.hold.get(secId);
    const endH = days[days.length - 1]!.hold.get(secId);
    return {
      securityId: secId,
      ticker: s.ticker,
      name: s.name,
      sector: s.sector ?? 'Unclassified',
      avgWeightPct: (avgTotal(secId) * 100).toFixed(4),
      returnPct: a && a.held > 0 ? pct6(a.chain - 1) : null,
      contributionBps: bps(a?.contrib ?? 0),
      benchWeightPct: consBy.has(secId) ? num(consBy.get(secId)!.weightPct).toFixed(4) : null,
      startValue: (startH?.val ?? 0).toFixed(2),
      endValue: (endH?.val ?? 0).toFixed(2),
    };
  });
  contributions.sort((a, b) => Math.abs(b.contributionBps) - Math.abs(a.contributionBps));
  const lastDay = days[days.length - 1]!;
  contributions.push({ securityId: null, ticker: 'CASH', name: 'Cash and FX on cash', sector: 'Cash', avgWeightPct: ((cashSector.wSum / periods) * 100).toFixed(4), returnPct: cashSector.wSum > 0 ? pct6(cashSector.chain - 1) : null, contributionBps: bps(cashContribTotal), benchWeightPct: null, startValue: days[0]!.cashVal.toFixed(2), endValue: lastDay.cashVal.toFixed(2) });
  contributions.push({ securityId: null, ticker: 'OTHER', name: 'Trading, fees and flow timing (residual)', sector: '-', avgWeightPct: '0.0000', returnPct: null, contributionBps: bps(residual), benchWeightPct: null, startValue: '0.00', endValue: '0.00' });
  contributions.push({ securityId: null, ticker: 'LINK', name: 'Compounding of daily returns', sector: '-', avgWeightPct: '0.0000', returnPct: null, contributionBps: bps(series.twr - portArith), benchWeightPct: null, startValue: '0.00', endValue: '0.00' });

  const netFlows = flows.reduce((a, b) => a + b, 0);
  const hash = createHash('sha256')
    .update(JSON.stringify({ p: p.id, startS, endS, b: benchmark ? [benchmark.id, cons.map((c) => [c.securityId, c.sector, c.weightPct.toString()])] : null, dates, v: inputs.map((i) => [i.value.toFixed(4), i.flow.toFixed(4)]) }))
    .digest('hex');

  return {
    dates,
    baseCurrency: base,
    startValue: days[0]!.value,
    endValue: lastDay.value,
    netFlows,
    twr: series.twr,
    benchTwr: series.benchTwr,
    active,
    series: series.points,
    attribution: {
      benchmark: benchmark ? { id: benchmark.id, code: benchmark.code, name: benchmark.name } : null,
      segments: results.map((r) => ({
        sector: r.sector,
        avgWeightPct: (r.wp * 100).toFixed(4),
        benchWeightPct: (r.wb * 100).toFixed(4),
        allocationBps: bps(r.allocation),
        selectionBps: bps(r.selection),
        interactionBps: bps(r.interaction),
        totalBps: bps(r.total),
        portfolioReturnPct: r.rp === null ? null : pct6(r.rp),
        benchmarkReturnPct: r.rb === null ? null : pct6(r.rb),
      })),
      totals: {
        allocationBps: bps(sum('allocation')),
        selectionBps: bps(sum('selection')),
        interactionBps: bps(sum('interaction')),
        explainedBps: bps(explainedActive),
        activeBps: active === null ? null : bps(active),
        unexplainedBps: active === null ? null : bps(active - explainedActive),
      },
    },
    contributions,
    issues: { missingPrice: [...issues.missingPrice], missingFx: [...issues.missingFx], stale: [...issues.stale], gapDays: issues.gapDays },
    hash,
  };
}

// ================================================================ controls (BR-030)

export async function evaluateControls(p: PortfolioRow, benchmark: BenchmarkRow | null, startS: string, endS: string, c: Computed) {
  const start = dd(startS);
  const end = dd(endS);
  const [health, cashBreaks, journalsPending, navRun, bal, cashNow, ledgers] = await Promise.all([
    bookHealth([p]),
    prisma.reconBreak.count({ where: { portfolioId: p.id, family: 'CASH', status: { in: OPEN_STATUSES } } }),
    prisma.cashJournal.count({ where: { portfolioId: p.id, status: { in: ['DRAFT', 'PENDING_APPROVAL'] }, entryDate: { gte: start, lte: end } } }),
    prisma.navRun.findFirst({ where: { portfolioId: p.id, navDate: end, status: 'RELEASED' }, orderBy: { version: 'desc' } }),
    balances({ portfolioId: p.id, asOf: end }),
    prisma.portfolioCash.findMany({ where: { portfolioId: p.id, asOf: { lte: end } }, orderBy: { asOf: 'desc' } }),
    prisma.cashLedger.count({ where: { portfolioId: p.id, kind: 'BANK' } }),
  ]);

  // 1. IBOR positions reconciled
  const h = (k: string) => health.items.find((i) => i.key === k)!;
  const iborOk = h('lots').ok && h('fills').ok && h('recon').ok && health.openBreaks === 0;
  const ibor: ControlItem = {
    key: 'ibor',
    title: 'IBOR positions reconciled',
    description: 'Tax lots agree with positions, all fills are booked, a holdings reconciliation has been run and no holdings break is open.',
    state: iborOk ? 'done' : 'warn',
    detail: iborOk ? `${h('recon').detail}` : [!h('lots').ok && h('lots').detail, !h('fills').ok && h('fills').detail, health.openBreaks > 0 && `${health.openBreaks} open holdings break(s).`, !h('recon').ok && health.openBreaks === 0 && h('recon').detail].filter(Boolean).join(' '),
  };

  // 2. Cash reconciled
  const latestCash = new Map<string, number>();
  for (const r of cashNow) if (!latestCash.has(r.currency)) latestCash.set(r.currency, num(r.available));
  const diffs = bal.totals.filter((t) => Math.abs(Number(t.posted) - (latestCash.get(t.currency) ?? 0)) > 0.01).map((t) => `${t.currency} ledger ${t.posted} vs book ${(latestCash.get(t.currency) ?? 0).toFixed(2)}`);
  const cashOk = cashBreaks === 0 && diffs.length === 0;
  const cash: ControlItem = {
    key: 'cash',
    title: 'Cash reconciled',
    description: 'Cash ledger balances agree with the book cash and no cash break is open.',
    state: cashOk ? 'done' : 'warn',
    detail: cashOk ? (ledgers ? 'Cash ledgers agree with the book and no cash breaks are open.' : 'No bank ledger is set up; no cash breaks are open.') : [cashBreaks > 0 && `${cashBreaks} open cash break(s).`, diffs.length > 0 && diffs.join('; ')].filter(Boolean).join(' '),
  };

  // 3. Valuation sources approved
  let navDetail = 'No released NAV run on the period end to compare.';
  let navOk = false; // no released NAV to compare is unverified, never a pass
  let navCheck: { ref: string; nav: string; computed: string; diffPct: string } | null = null;
  if (navRun) {
    const diffPct = c.endValue > 0 ? Math.abs((num(navRun.nav) - c.endValue) / c.endValue) * 100 : 100;
    navOk = diffPct <= NAV_TOLERANCE_PCT;
    navCheck = { ref: navRun.ref, nav: navRun.nav.toFixed(2), computed: c.endValue.toFixed(2), diffPct: diffPct.toFixed(4) };
    navDetail = `${navRun.ref} NAV ${navRun.nav.toFixed(2)} vs computed ${c.endValue.toFixed(2)} (${diffPct.toFixed(2)}% apart, tolerance ${NAV_TOLERANCE_PCT}%).`;
  }
  const valProblems = [c.issues.missingPrice.length > 0 && `No price: ${c.issues.missingPrice.join(', ')}.`, c.issues.missingFx.length > 0 && `No FX rate: ${c.issues.missingFx.join(', ')}.`, c.issues.stale.length > 0 && `Stale at period end: ${c.issues.stale.join(', ')}.`, !navOk && navDetail].filter(Boolean) as string[];
  const valuation: ControlItem = { key: 'valuation', title: 'Valuation sources approved', description: 'Every holding has a current price and FX rate on each valuation date, and a released NAV agrees.', state: valProblems.length ? 'warn' : 'done', detail: valProblems.length ? valProblems.join(' ') : `Prices and FX complete on ${c.dates.length} valuation dates. ${navDetail}` };

  // 4. Composite membership review
  const cons = benchmark?.constituents ?? [];
  const wsum = cons.reduce((a, x) => a + num(x.weightPct), 0);
  const compProblems = [!benchmark && 'No benchmark composition is set for this portfolio.', benchmark && benchmark.status !== 'ACTIVE' && 'The benchmark is retired.', benchmark && Math.abs(wsum - 100) > 0.0001 && `Benchmark weights total ${wsum.toFixed(4)}%, not 100%.`].filter(Boolean) as string[];
  const composite: ControlItem = { key: 'composite', title: 'Composite membership review', description: 'A benchmark composition is attached, active and totals 100%.', state: compProblems.length ? 'warn' : 'done', detail: compProblems.length ? compProblems.join(' ') : `${benchmark!.code} ${benchmark!.name}: ${cons.length} constituents totalling 100%.` };

  // 5. Fees and flows validated
  const flowProblems = [journalsPending > 0 && `${journalsPending} cash journal(s) in the period are not yet approved.`, c.issues.gapDays > 0 && `${c.issues.gapDays} valuation day(s) have no positive base value.`].filter(Boolean) as string[];
  const flows: ControlItem = { key: 'flows', title: 'Fees and flows validated', description: 'External flows come from approved cash journals and every day has a positive starting value.', state: flowProblems.length ? 'warn' : 'done', detail: flowProblems.length ? flowProblems.join(' ') : `Net external flows ${c.netFlows.toFixed(2)} ${c.baseCurrency} from approved journals.` };

  const items = [ibor, cash, valuation, composite, flows];
  return { items, pending: items.filter((i) => i.state !== 'done').length, navCheck };
}
