import { Prisma, type Fund, type FundCommitment, type LpHolding } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { day } from '../lp.http';
import type { LpContext } from '../lp.context';
import { VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES, asRecord, jsonDec } from './common';

/**
 * Read-time LP positions. Capital flows come from platform records (issued call allocations,
 * payments, distribution allocations); valuation measures (NAV, IRR, multiples) are the stored
 * figures on `fund_commitments.metrics_json` / `lp_holdings` and are never estimated here.
 *
 * metrics_json keys read (all optional, decimal strings or numbers):
 *   nav | currentNav, netIrr, tvpi, dpi, rvpi, ytdReturn, portfolioCompanyCount,
 *   called, paidIn, distributions          (used only when no platform records exist)
 *   openingCalled, openingPaidIn, openingDistributions (pre-platform history added to platform sums)
 *   history: [{date, nav, paidIn, distributions}]
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

export interface FundPosition {
  fund: Fund;
  commitment: FundCommitment;
  holding: LpHolding | null;
  isOpenEnded: boolean;
  committed: Prisma.Decimal;
  called: Prisma.Decimal;
  paidIn: Prisma.Decimal;
  distributions: Prisma.Decimal;
  nav: Prisma.Decimal;
  netIrr: string | null;
  tvpi: string | null;
  dpi: string | null;
  rvpi: string | null;
  ytdReturn: string | null;
  asOfDate: string;
  valuationStatus: string;
  metrics: Record<string, unknown>;
}

function decOr(value: unknown, fallback: Prisma.Decimal): Prisma.Decimal {
  const s = jsonDec(value);
  return s === null ? fallback : D(s);
}

export function fixed(v: Prisma.Decimal | null | undefined, places = 2): string {
  return (v ?? ZERO).toFixed(places);
}

export function ratio(num: Prisma.Decimal, den: Prisma.Decimal, places = 4): string | null {
  return den.gt(0) ? num.div(den).toFixed(places) : null;
}

export async function loadPositions(ctx: LpContext, fundId?: string): Promise<FundPosition[]> {
  const fundIds = fundId ? [fundId] : ctx.fundIds;
  if (!fundIds.length) return [];
  const [commitments, holdings, calls, dists] = await Promise.all([
    prisma.fundCommitment.findMany({
      where: { clientId: ctx.client.id, fundId: { in: fundIds } },
      include: { fund: true },
      orderBy: { fund: { name: 'asc' } },
    }),
    prisma.lpHolding.findMany({ where: { clientId: ctx.client.id, fundId: { in: fundIds }, isActive: true } }),
    prisma.capitalCallAllocation.findMany({
      where: { clientId: ctx.client.id, call: { fundId: { in: fundIds }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { not: null } } },
      select: { commitmentId: true, callAmount: true, amountPaid: true, status: true },
    }),
    prisma.distributionAllocation.findMany({
      where: { clientId: ctx.client.id, distribution: { fundId: { in: fundIds }, status: { in: VISIBLE_DISTRIBUTION_STATUSES } } },
      select: { commitmentId: true, amountPaid: true, status: true },
    }),
  ]);
  return commitments.map(({ fund, ...c }) => {
    const m = asRecord(c.metricsJson);
    const ownCalls = calls.filter((a) => a.commitmentId === c.id && a.status !== 'CANCELLED');
    const ownDists = dists.filter((a) => a.commitmentId === c.id && a.status !== 'CANCELLED');
    const holding = holdings.find((h) => h.fundId === fund.id) ?? null;
    const isOpenEnded = fund.operatingModel === 'OPEN_ENDED';
    const sum = <T,>(rows: T[], f: (r: T) => Prisma.Decimal) => rows.reduce((acc, r) => acc.add(f(r)), ZERO);
    const called = ownCalls.length
      ? decOr(m.openingCalled, ZERO).add(sum(ownCalls, (a) => a.callAmount))
      : decOr(m.called, decOr(m.paidIn, ZERO));
    const paidIn = ownCalls.length ? decOr(m.openingPaidIn, ZERO).add(sum(ownCalls, (a) => a.amountPaid)) : decOr(m.paidIn, ZERO);
    const distributions = ownDists.length
      ? decOr(m.openingDistributions, ZERO).add(sum(ownDists, (a) => a.amountPaid))
      : decOr(m.distributions, ZERO);
    const nav = isOpenEnded && holding ? holding.accountValue : decOr(m.nav ?? m.currentNav, ZERO);
    return {
      fund,
      commitment: c,
      holding,
      isOpenEnded,
      committed: c.commitmentAmount,
      called,
      paidIn,
      distributions,
      nav,
      netIrr: isOpenEnded ? null : jsonDec(m.netIrr),
      tvpi: isOpenEnded ? null : jsonDec(m.tvpi),
      dpi: isOpenEnded ? null : jsonDec(m.dpi),
      rvpi: isOpenEnded ? null : jsonDec(m.rvpi),
      ytdReturn: jsonDec(m.ytdReturn),
      asOfDate: day(holding?.asOfDate ?? fund.asOfDate),
      valuationStatus: holding?.valuationStatus ?? fund.valuationStatus,
      metrics: m,
    };
  });
}

export interface Consolidated {
  committed: Prisma.Decimal;
  called: Prisma.Decimal;
  paidIn: Prisma.Decimal;
  distributions: Prisma.Decimal;
  nav: Prisma.Decimal;
  netIrr: string | null;
  tvpi: string | null;
  dpi: string | null;
  rvpi: string | null;
}

/**
 * Private-capital totals. Multiples are recomputed from the aggregates (SRD 5B #2); net IRR cannot
 * be aggregated from stored per-fund IRRs, so it is shown only when a single fund is in view.
 */
export function consolidate(positions: FundPosition[]): Consolidated {
  // A mixed portfolio reports private-capital KPIs (open-ended sits in openEndedSummary).
  // A fund-scoped open-ended view has no private-capital row, so the KPIs are that fund.
  const pc = positions.filter((p) => !p.isOpenEnded);
  const basis = pc.length ? pc : positions;
  const add = (f: (p: FundPosition) => Prisma.Decimal) => basis.reduce((acc, p) => acc.add(f(p)), ZERO);
  const paidIn = add((p) => p.paidIn);
  const distributions = add((p) => p.distributions);
  const nav = add((p) => p.nav);
  const single = basis.length === 1 ? basis[0]! : null;
  return {
    committed: add((p) => p.committed),
    called: add((p) => p.called),
    paidIn,
    distributions,
    nav,
    netIrr: single ? single.netIrr : null,
    tvpi: single?.tvpi ?? ratio(nav.add(distributions), paidIn),
    dpi: single?.dpi ?? ratio(distributions, paidIn),
    rvpi: single?.rvpi ?? ratio(nav, paidIn),
  };
}

export function latestAsOf(positions: FundPosition[]) {
  const latest = positions.map((p) => p.asOfDate).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const statuses = new Set(positions.filter((p) => p.asOfDate === latest).map((p) => p.valuationStatus));
  return { asOfDate: latest, valuationStatus: statuses.size === 1 ? [...statuses][0]! : statuses.size ? 'PROVISIONAL' : 'FINAL' };
}

/** NAV-per-unit history stored on the fund (`dealing_rules_json.navHistory`), ascending, max 24. */
export function navHistory(fund: Fund): { date: string; label: string; navPerUnit: string }[] {
  const raw = asRecord(fund.dealingRulesJson).navHistory;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => asRecord(p))
    .map((p) => ({ date: typeof p.date === 'string' ? p.date.slice(0, 10) : '', nav: jsonDec(p.navPerUnit ?? p.nav) }))
    .filter((p): p is { date: string; nav: string } => !!p.date && p.nav !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-24)
    .map((p) => ({ date: p.date, label: p.date, navPerUnit: p.nav }));
}

export async function portfolioCompanyCount(fundIds: string[]) {
  if (!fundIds.length) return 0;
  return prisma.portfolioCompany.count({ where: { fundId: { in: fundIds }, status: { notIn: ['Exited', 'Closed', 'Inactive', 'Prospect'] } } });
}
