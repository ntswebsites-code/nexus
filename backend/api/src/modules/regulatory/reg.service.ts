import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { isoDay, type Payload } from './reg.engine';

const D = Prisma.Decimal;
const f2 = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const LIMIT = 2000;

/** Inclusive date range [start, end] as a half-open [start, end + 1 day) for timestamp columns. */
const range = (start: Date, end: Date) => ({ gte: start, lt: new Date(end.getTime() + 86_400_000) });

async function secZQuarterly(start: Date, end: Date): Promise<Payload> {
  const portfolios = await prisma.portfolio.findMany({ where: { status: { not: 'Closed' } }, select: { id: true, ref: true, name: true, baseCurrency: true }, orderBy: { ref: 'asc' } });
  const aumRows: (string | number | null)[][] = [];
  const byCcy = new Map<string, Prisma.Decimal>();
  const missing: string[] = [];
  for (const p of portfolios) {
    const run = await prisma.navRun.findFirst({ where: { portfolioId: p.id, status: 'RELEASED', navDate: { lte: end } }, orderBy: [{ navDate: 'desc' }, { version: 'desc' }] });
    if (!run) {
      missing.push(p.ref);
      continue;
    }
    aumRows.push([p.ref, p.name, run.baseCurrency, run.ref, isoDay(run.navDate), f2(run.nav)]);
    byCcy.set(run.baseCurrency, (byCcy.get(run.baseCurrency) ?? new D(0)).add(run.nav));
  }
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { type: true, kycStatus: true, accreditedInvestor: true } });
  const tally = <K extends string>(rows: typeof clients, k: (c: (typeof clients)[number]) => K) => {
    const m = new Map<K, number>();
    for (const c of rows) m.set(k(c), (m.get(k(c)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([a, n]) => [a, n] as (string | number)[]);
  };
  const orderGroups = await prisma.order.groupBy({ by: ['status'], where: { createdAt: range(start, end) }, _count: { _all: true } });
  const fills = await prisma.orderFill.findMany({ where: { executedAt: range(start, end) }, select: { quantity: true, price: true, fees: true, order: { select: { side: true, currency: true } } } });
  const traded = new Map<string, { buy: Prisma.Decimal; sell: Prisma.Decimal; fees: Prisma.Decimal; n: number }>();
  for (const f of fills) {
    const t = traded.get(f.order.currency) ?? { buy: new D(0), sell: new D(0), fees: new D(0), n: 0 };
    const gross = f.quantity.mul(f.price);
    if (f.order.side === 'BUY') t.buy = t.buy.add(gross);
    else t.sell = t.sell.add(gross);
    t.fees = t.fees.add(f.fees);
    t.n++;
    traded.set(f.order.currency, t);
  }
  const breaches = await prisma.riskBreach.groupBy({ by: ['status'], where: { detectedOn: range(start, end) }, _count: { _all: true } });
  const notes: string[] = [];
  if (missing.length) notes.push(`No released NAV on or before the period end for: ${missing.join(', ')}. They are excluded from AUM.`);
  return {
    template: 'SECZ quarterly return (asset manager)',
    period: { start: isoDay(start)!, end: isoDay(end)! },
    figures: [
      { label: 'Portfolios reported', value: String(aumRows.length) },
      { label: 'Active clients', value: String(clients.length) },
      { label: 'Accredited investors', value: String(clients.filter((c) => c.accreditedInvestor).length) },
      { label: 'Order fills in period', value: String(fills.length) },
      ...[...byCcy.entries()].map(([c, v]) => ({ label: `AUM (${c})`, value: v.toFixed(2) })),
    ],
    tables: [
      { name: 'Assets under management by portfolio (latest released NAV)', columns: ['Portfolio', 'Name', 'Currency', 'NAV run', 'NAV date', 'NAV'], rows: aumRows },
      { name: 'Clients by type', columns: ['Type', 'Clients'], rows: tally(clients, (c) => c.type) },
      { name: 'Clients by KYC status', columns: ['KYC status', 'Clients'], rows: tally(clients, (c) => c.kycStatus) },
      { name: 'Orders created in period by status', columns: ['Status', 'Orders'], rows: orderGroups.map((g) => [g.status, g._count._all]) },
      { name: 'Executed value by currency', columns: ['Currency', 'Fills', 'Bought', 'Sold', 'Fees'], rows: [...traded.entries()].map(([c, t]) => [c, t.n, t.buy.toFixed(2), t.sell.toFixed(2), t.fees.toFixed(2)]) },
      { name: 'Risk limit breaches detected in period', columns: ['Status', 'Breaches'], rows: breaches.map((b) => [b.status, b._count._all]) },
    ],
    notes,
  };
}

async function secZAnnualAum(start: Date, end: Date): Promise<Payload> {
  const funds = await prisma.fund.findMany({ orderBy: { ref: 'asc' } });
  const commits = await prisma.fundCommitment.groupBy({ by: ['fundId'], where: { status: 'ACTIVE' }, _count: { _all: true }, _sum: { commitmentAmount: true } });
  const by = new Map(commits.map((c) => [c.fundId, c]));
  const notes: string[] = [];
  const stale = funds.filter((f) => f.asOfDate && f.asOfDate.getTime() < end.getTime() - 100 * 86_400_000).map((f) => f.ref);
  if (stale.length) notes.push(`Latest valuation is more than 100 days before the period end for: ${stale.join(', ')}.`);
  const totals = new Map<string, Prisma.Decimal>();
  for (const f of funds) if (f.totalNav) totals.set(f.currency, (totals.get(f.currency) ?? new D(0)).add(f.totalNav));
  return {
    template: 'SECZ annual funds under management schedule',
    period: { start: isoDay(start)!, end: isoDay(end)! },
    figures: [{ label: 'Funds', value: String(funds.length) }, ...[...totals.entries()].map(([c, v]) => ({ label: `Total NAV (${c})`, value: v.toFixed(2) }))],
    tables: [
      {
        name: 'Funds',
        columns: ['Fund', 'Name', 'Model', 'Currency', 'Status', 'Valuation status', 'Valuation date', 'Total NAV', 'Investors', 'Active commitments'],
        rows: funds.map((f) => [f.ref, f.name, f.operatingModel, f.currency, f.status, f.valuationStatus, isoDay(f.asOfDate), f2(f.totalNav), by.get(f.id)?._count._all ?? 0, f2(by.get(f.id)?._sum.commitmentAmount ?? new D(0))]),
      },
    ],
    notes,
  };
}

async function fiuCtr(start: Date, end: Date): Promise<Payload> {
  const pol = await prisma.policy.findUnique({ where: { key: 'reg.fiu_ctr_threshold' } });
  const n = pol ? Number(pol.value) : NaN;
  const threshold = new D(Number.isFinite(n) && n > 0 ? n : 10000);
  const journals = await prisma.cashJournal.findMany({
    where: { status: 'POSTED', purpose: { in: ['CLIENT_DEPOSIT', 'CLIENT_WITHDRAWAL'] }, entryDate: { gte: start, lte: end }, totalDebit: { gte: threshold } },
    orderBy: [{ entryDate: 'asc' }, { ref: 'asc' }],
    take: LIMIT,
  });
  const pf = new Map((await prisma.portfolio.findMany({ where: { id: { in: [...new Set(journals.map((j) => j.portfolioId))] } }, select: { id: true, ref: true, name: true, clientId: true } })).map((p) => [p.id, p]));
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: [...new Set([...pf.values()].map((p) => p.clientId).filter((x): x is string => !!x))] } }, select: { id: true, ref: true, name: true } })).map((c) => [c.id, c]));
  const sum = new Map<string, Prisma.Decimal>();
  for (const j of journals) sum.set(j.currency, (sum.get(j.currency) ?? new D(0)).add(j.totalDebit));
  return {
    template: 'FIU large cash transaction report',
    period: { start: isoDay(start)!, end: isoDay(end)! },
    figures: [{ label: 'Reporting threshold', value: threshold.toFixed(2) }, { label: 'Reportable transactions', value: String(journals.length) }, ...[...sum.entries()].map(([c, v]) => ({ label: `Total (${c})`, value: v.toFixed(2) }))],
    tables: [
      {
        name: 'Reportable cash transactions',
        columns: ['Date', 'Journal', 'Direction', 'Currency', 'Amount', 'Portfolio', 'Client', 'Client name', 'Source reference'],
        rows: journals.map((j) => {
          const p = pf.get(j.portfolioId);
          const c = p?.clientId ? clients.get(p.clientId) : undefined;
          return [isoDay(j.entryDate), j.ref, j.purpose === 'CLIENT_DEPOSIT' ? 'IN' : 'OUT', j.currency, j.totalDebit.toFixed(2), p?.ref ?? null, c?.ref ?? null, c?.name ?? null, j.sourceRef];
        }),
      },
    ],
    notes: [`The threshold is applied to the face amount in each journal's own currency; no FX conversion is made.${journals.length >= LIMIT ? ` Output limited to ${LIMIT} rows.` : ''}`],
  };
}

async function fiuKycRisk(start: Date, end: Date): Promise<Payload> {
  const clients = await prisma.client.findMany({ where: { archivedAt: null }, select: { ref: true, name: true, riskRating: true, kycStatus: true, nextReviewDate: true, country: true } });
  const tally = (k: (c: (typeof clients)[number]) => string) => {
    const m = new Map<string, number>();
    for (const c of clients) m.set(k(c), (m.get(k(c)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([a, n]) => [a, n] as (string | number)[]);
  };
  const overdue = clients.filter((c) => c.nextReviewDate && c.nextReviewDate.getTime() < end.getTime());
  const highCases = await prisma.kycCase.findMany({ where: { risk: 'High', createdAt: { lt: new Date(end.getTime() + 86_400_000) } }, select: { ref: true, stage: true, risk: true, decision: true, createdAt: true }, orderBy: { ref: 'asc' }, take: LIMIT });
  const screening = await prisma.screeningResult.findMany({ where: { outcome: { in: ['Match', 'Review'] }, receivedAt: range(start, end) }, include: { kycCase: { select: { ref: true } } }, orderBy: { receivedAt: 'asc' }, take: LIMIT });
  return {
    template: 'FIU client risk and screening summary',
    period: { start: isoDay(start)!, end: isoDay(end)! },
    figures: [
      { label: 'Active clients', value: String(clients.length) },
      { label: 'High-risk cases', value: String(highCases.length) },
      { label: 'Screening matches and reviews in period', value: String(screening.length) },
      { label: 'KYC reviews overdue at period end', value: String(overdue.length) },
    ],
    tables: [
      { name: 'Clients by risk rating', columns: ['Risk rating', 'Clients'], rows: tally((c) => c.riskRating) },
      { name: 'Clients by KYC status', columns: ['KYC status', 'Clients'], rows: tally((c) => c.kycStatus) },
      { name: 'High-risk KYC cases', columns: ['Case', 'Stage', 'Decision', 'Opened'], rows: highCases.map((c) => [c.ref, c.stage, c.decision, isoDay(c.createdAt)]) },
      { name: 'Screening matches and reviews', columns: ['Received', 'Case', 'Provider', 'Type', 'Outcome', 'Score'], rows: screening.map((s) => [isoDay(s.receivedAt), s.kycCase.ref, s.provider, s.type, s.outcome, s.score]) },
      { name: 'Overdue KYC reviews', columns: ['Client', 'Name', 'Risk', 'Review due'], rows: overdue.map((c) => [c.ref, c.name, c.riskRating, isoDay(c.nextReviewDate)]) },
    ],
    notes: [],
  };
}

export async function buildPayload(templateKey: string, start: Date, end: Date): Promise<Payload> {
  switch (templateKey) {
    case 'SECZ_QUARTERLY':
      return secZQuarterly(start, end);
    case 'SECZ_ANNUAL_AUM':
      return secZAnnualAum(start, end);
    case 'FIU_CTR':
      return fiuCtr(start, end);
    case 'FIU_KYC_RISK':
      return fiuKycRisk(start, end);
    default:
      throw HttpError.badRequest(`No builder for template ${templateKey}`);
  }
}
