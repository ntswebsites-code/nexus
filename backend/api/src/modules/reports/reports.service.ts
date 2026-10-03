import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { storeFile } from '../../lib/storage';
import { sha256Hex } from '../../lib/crypto';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { calculateValuation, loadSettings } from '../nav/nav.service';
import { balances } from '../cash/cash.service';
import {
  FORMAT_META,
  nextRunAfter,
  render,
  rowCount,
  safeName,
  type Cell,
  type Frequency,
  type ReportData,
  type ReportFormat,
  type ReportKey,
} from './reports.engine';

const D = Prisma.Decimal;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const f2 = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- catalogue

interface ParamSpec {
  name: string;
  label: string;
  type: 'portfolio' | 'fund' | 'date';
  required: boolean;
}

export const CATALOGUE: { key: ReportKey; name: string; description: string; category: string; paramSpec: ParamSpec[] }[] = [
  {
    key: 'FACT_SHEET',
    name: 'Fund fact sheet',
    description: 'Fund profile, latest NAV, commitments by status and the largest holdings of the linked portfolio.',
    category: 'Investor',
    paramSpec: [
      { name: 'fundId', label: 'Fund', type: 'fund', required: true },
      { name: 'asOf', label: 'As of', type: 'date', required: false },
    ],
  },
  {
    key: 'HOLDINGS',
    name: 'Holdings report',
    description: 'Positions with price, FX and base-currency value for one portfolio, with weights and cash.',
    category: 'Portfolio',
    paramSpec: [
      { name: 'portfolioId', label: 'Portfolio', type: 'portfolio', required: true },
      { name: 'asOf', label: 'As of', type: 'date', required: false },
    ],
  },
  {
    key: 'TRANSACTIONS',
    name: 'Transactions report',
    description: 'Order fills and posted cash journals in a date range, for one portfolio or all.',
    category: 'Portfolio',
    paramSpec: [
      { name: 'portfolioId', label: 'Portfolio', type: 'portfolio', required: false },
      { name: 'from', label: 'From', type: 'date', required: true },
      { name: 'to', label: 'To', type: 'date', required: true },
    ],
  },
  {
    key: 'NAV_PACK',
    name: 'NAV pack',
    description: 'Released NAV runs in a date range with the bridge from market value to NAV, and the lines of the latest run.',
    category: 'Valuation',
    paramSpec: [
      { name: 'portfolioId', label: 'Portfolio', type: 'portfolio', required: true },
      { name: 'from', label: 'From', type: 'date', required: true },
      { name: 'to', label: 'To', type: 'date', required: true },
    ],
  },
  {
    key: 'CASH',
    name: 'Cash report',
    description: 'Derived cash balances per ledger and totals per portfolio and currency.',
    category: 'Cash',
    paramSpec: [
      { name: 'portfolioId', label: 'Portfolio', type: 'portfolio', required: false },
      { name: 'asOf', label: 'As of', type: 'date', required: false },
    ],
  },
];

export async function ensureCatalogue() {
  for (const c of CATALOGUE) {
    await prisma.reportDefinition.upsert({
      where: { key: c.key },
      update: { name: c.name, description: c.description, category: c.category, paramSpec: c.paramSpec as unknown as Prisma.InputJsonValue },
      create: { key: c.key, name: c.name, description: c.description, category: c.category, paramSpec: c.paramSpec as unknown as Prisma.InputJsonValue, formats: ['CSV', 'JSON', 'HTML'] },
    });
  }
}

// ---------------------------------------------------------------- parameters

const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());
const idStr = z.string().trim().min(1).max(36);

export const PARAM_SCHEMAS: Record<ReportKey, z.ZodTypeAny> = {
  FACT_SHEET: z.object({ fundId: idStr, asOf: opt(dateStr) }).strict(),
  HOLDINGS: z.object({ portfolioId: idStr, asOf: opt(dateStr) }).strict(),
  TRANSACTIONS: z.object({ portfolioId: opt(idStr), from: dateStr, to: dateStr }).strict(),
  NAV_PACK: z.object({ portfolioId: idStr, from: dateStr, to: dateStr }).strict(),
  CASH: z.object({ portfolioId: opt(idStr), asOf: opt(dateStr) }).strict(),
};

type P = Record<string, string | undefined>;

async function portfolioOf(v: string) {
  return loadPortfolio(v).catch(() => {
    throw HttpError.badRequest('Validation failed', [{ path: 'portfolioId', message: 'Unknown portfolio' }]);
  });
}
async function fundOf(v: string) {
  const f = await prisma.fund.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
  if (!f) throw HttpError.badRequest('Validation failed', [{ path: 'fundId', message: 'Unknown fund' }]);
  return f;
}

/** Validates and normalises parameters (references resolve to ids) so a stored run can be repeated exactly. */
export async function normaliseParams(key: ReportKey, raw: unknown): Promise<P> {
  const parsed = PARAM_SCHEMAS[key].safeParse(raw ?? {});
  if (!parsed.success) {
    throw HttpError.badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const p = { ...(parsed.data as P) };
  if (p.portfolioId) p.portfolioId = (await portfolioOf(p.portfolioId)).id;
  if (p.fundId) p.fundId = (await fundOf(p.fundId)).id;
  if ((key === 'TRANSACTIONS' || key === 'NAV_PACK') && p.from! > p.to!) {
    throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'To must not be before From' }]);
  }
  return p;
}

// ---------------------------------------------------------------- builders

async function holdingsSections(portfolioId: string, asOf: Date) {
  const v = await calculateValuation(portfolioId, asOf, await loadSettings());
  const total = v.marketValue.add(v.cash);
  const pct = (x: Prisma.Decimal | null) => (x && total.gt(0) ? x.div(total).mul(100).toFixed(2) : null);
  const sorted = [...v.lines].sort((a, b) => (b.valueBase ?? new D(0)).comparedTo(a.valueBase ?? new D(0)));
  return { v, total, pct, sorted };
}

async function buildFactSheet(p: P): Promise<ReportData> {
  const fund = await fundOf(p.fundId!);
  const asOf = p.asOf ? new Date(`${p.asOf}T00:00:00.000Z`) : startOfDay(new Date());
  const meta: [string, string][] = [
    ['Fund', `${fund.name} (${fund.ref})`],
    ['Currency', fund.currency],
    ['Status', fund.status],
    ['Valuation status', fund.valuationStatus],
    ['Valuation date', day(fund.asOfDate) ?? 'n/a'],
    ['NAV per unit', fund.navPerUnit ? fund.navPerUnit.toFixed(4) : 'n/a'],
    ['Total NAV', fund.totalNav ? fund.totalNav.toFixed(2) : 'n/a'],
    ['Report date', day(asOf)!],
  ];
  const sections: ReportSection[] = [];
  const groups = await prisma.fundCommitment.groupBy({ by: ['status'], where: { fundId: fund.id }, _count: { _all: true }, _sum: { commitmentAmount: true } });
  sections.push({
    heading: 'Commitments by status',
    columns: ['Status', 'Investors', `Commitment (${fund.currency})`],
    rows: groups.map((g) => [g.status, g._count._all, f2(g._sum.commitmentAmount)]),
  });
  const notes: string[] = [];
  if (fund.portfolioId) {
    const run = await prisma.navRun.findFirst({ where: { portfolioId: fund.portfolioId, status: 'RELEASED', navDate: { lte: asOf } }, orderBy: [{ navDate: 'desc' }, { version: 'desc' }] });
    if (run) {
      sections.push({
        heading: 'Latest released NAV',
        columns: ['Run', 'NAV date', 'Market value', 'Cash', 'Accruals', 'Fees', 'Liabilities', 'NAV', 'NAV per unit'],
        rows: [[run.ref, day(run.navDate), f2(run.marketValue), f2(run.cash), f2(run.accruals), f2(run.fees), f2(run.liabilities), f2(run.nav), run.navPerUnit ? run.navPerUnit.toFixed(4) : null]],
      });
    } else notes.push('No released NAV run on or before the report date.');
    const h = await holdingsSections(fund.portfolioId, asOf);
    sections.push({
      heading: 'Top holdings (base currency)',
      columns: ['Ticker', 'Name', 'Quantity', 'Value', 'Weight %'],
      rows: h.sorted.slice(0, 10).map((l) => [l.ticker, l.name, l.quantity.toString(), f2(l.valueBase), h.pct(l.valueBase)]),
    });
  } else notes.push('This fund is not linked to a portfolio, so NAV bridge and holdings are not shown.');
  return { title: `Fund fact sheet - ${fund.shortName}`, meta, sections, notes };
}

type ReportSection = ReportData['sections'][number];

async function buildHoldings(p: P): Promise<ReportData> {
  const pf = await portfolioOf(p.portfolioId!);
  const asOf = p.asOf ? new Date(`${p.asOf}T00:00:00.000Z`) : startOfDay(new Date());
  const h = await holdingsSections(pf.id, asOf);
  const notes: string[] = [];
  if (h.v.lines.some((l) => l.valueBase === null)) notes.push('Some positions are unvalued (missing price or FX); they are shown without a value and excluded from totals.');
  return {
    title: `Holdings - ${pf.name}`,
    meta: [
      ['Portfolio', `${pf.name} (${pf.ref})`],
      ['Base currency', h.v.baseCurrency],
      ['As of', day(asOf)!],
      ['Market value', h.v.marketValue.toFixed(2)],
      ['Cash', h.v.cash.toFixed(2)],
      ['Total', h.total.toFixed(2)],
    ],
    sections: [
      {
        heading: 'Positions',
        columns: ['Ticker', 'Name', 'Currency', 'Quantity', 'Price', 'Price date', 'FX', 'Value (local)', `Value (${h.v.baseCurrency})`, 'Weight %'],
        rows: h.sorted.map((l) => [l.ticker, l.name, l.currency, l.quantity.toString(), l.price ? l.price.toString() : null, day(l.priceDate), l.fxRate ? l.fxRate.toString() : null, f2(l.valueLocal), f2(l.valueBase), h.pct(l.valueBase)]),
      },
      {
        heading: 'Cash',
        columns: ['Currency', 'Available', 'FX', `Available (${h.v.baseCurrency})`],
        rows: h.v.cashDetail.map((c) => [c.currency, c.available, c.fxRate, c.availableBase]),
      },
    ],
    notes,
  };
}

const MAX_ROWS = 5000;

async function buildTransactions(p: P): Promise<ReportData> {
  const from = new Date(`${p.from}T00:00:00.000Z`);
  const toEnd = new Date(`${p.to}T00:00:00.000Z`);
  toEnd.setUTCDate(toEnd.getUTCDate() + 1);
  const pf = p.portfolioId ? await portfolioOf(p.portfolioId) : null;
  const fills = await prisma.orderFill.findMany({
    where: { executedAt: { gte: from, lt: toEnd }, ...(pf ? { order: { portfolioId: pf.id } } : {}) },
    include: { order: true },
    orderBy: { executedAt: 'asc' },
    take: MAX_ROWS + 1,
  });
  const secs = new Map((await prisma.security.findMany({ where: { id: { in: [...new Set(fills.map((f) => f.order.securityId))] } }, select: { id: true, ticker: true } })).map((s) => [s.id, s.ticker]));
  const fillPortfolios = new Map((await prisma.portfolio.findMany({ where: { id: { in: [...new Set(fills.map((f) => f.order.portfolioId))] } }, select: { id: true, ref: true } })).map((p) => [p.id, p.ref]));
  const journals = await prisma.cashJournal.findMany({
    where: { status: 'POSTED', entryDate: { gte: from, lt: toEnd }, ...(pf ? { portfolioId: pf.id } : {}) },
    orderBy: [{ entryDate: 'asc' }, { ref: 'asc' }],
    take: MAX_ROWS + 1,
  });
  const jPortfolios = new Map((await prisma.portfolio.findMany({ where: { id: { in: [...new Set(journals.map((j) => j.portfolioId))] } }, select: { id: true, ref: true } })).map((x) => [x.id, x.ref]));
  const notes: string[] = [];
  if (fills.length > MAX_ROWS || journals.length > MAX_ROWS) notes.push(`Output is limited to ${MAX_ROWS} rows per section; narrow the date range for the full set.`);
  return {
    title: `Transactions ${p.from} to ${p.to}`,
    meta: [
      ['Portfolio', pf ? `${pf.name} (${pf.ref})` : 'All portfolios'],
      ['From', p.from!],
      ['To', p.to!],
    ],
    sections: [
      {
        heading: 'Order fills',
        columns: ['Executed', 'Portfolio', 'Order', 'Side', 'Ticker', 'Currency', 'Quantity', 'Price', 'Fees', 'Gross'],
        rows: fills.slice(0, MAX_ROWS).map((f) => [f.executedAt.toISOString(), fillPortfolios.get(f.order.portfolioId) ?? null, f.order.ref, f.order.side, secs.get(f.order.securityId) ?? null, f.order.currency, f.quantity.toString(), f.price.toString(), f.fees.toFixed(2), f.quantity.mul(f.price).toFixed(2)]),
      },
      {
        heading: 'Posted cash journals',
        columns: ['Date', 'Portfolio', 'Journal', 'Purpose', 'Currency', 'Amount', 'Description'],
        rows: journals.slice(0, MAX_ROWS).map((j) => [day(j.entryDate), jPortfolios.get(j.portfolioId) ?? null, j.ref, j.purpose, j.currency, j.totalDebit.toFixed(2), j.description]),
      },
    ],
    notes,
  };
}

async function buildNavPack(p: P): Promise<ReportData> {
  const pf = await portfolioOf(p.portfolioId!);
  const from = new Date(`${p.from}T00:00:00.000Z`);
  const to = new Date(`${p.to}T00:00:00.000Z`);
  const runs = await prisma.navRun.findMany({ where: { portfolioId: pf.id, status: 'RELEASED', navDate: { gte: from, lte: to } }, orderBy: [{ navDate: 'asc' }, { version: 'asc' }] });
  const sections: ReportSection[] = [
    {
      heading: 'Released NAV runs',
      columns: ['Run', 'NAV date', 'Version', 'Market value', 'Cash', 'Accruals', 'Fees', 'Liabilities', 'NAV', 'Units', 'NAV per unit', 'Price coverage %'],
      rows: runs.map((r) => [r.ref, day(r.navDate), r.version, f2(r.marketValue), f2(r.cash), f2(r.accruals), f2(r.fees), f2(r.liabilities), f2(r.nav), r.units ? r.units.toString() : null, r.navPerUnit ? r.navPerUnit.toFixed(4) : null, r.priceCoverage.toFixed(2)]),
    },
  ];
  const notes: string[] = [];
  const last = runs[runs.length - 1];
  if (last) {
    const lines = await prisma.navRunLine.findMany({ where: { runId: last.id }, orderBy: { ticker: 'asc' } });
    sections.push({
      heading: `Lines of ${last.ref}`,
      columns: ['Ticker', 'Name', 'Currency', 'Quantity', 'Price', 'Price source', 'Price date', 'FX', `Value (${last.baseCurrency})`],
      rows: lines.map((l) => [l.ticker, l.name, l.currency, l.quantity.toString(), l.price ? l.price.toString() : null, l.priceSource, day(l.priceDate), l.fxRate ? l.fxRate.toString() : null, f2(l.valueBase)]),
    });
  } else notes.push('No released NAV run in this period.');
  return { title: `NAV pack - ${pf.name}`, meta: [['Portfolio', `${pf.name} (${pf.ref})`], ['From', p.from!], ['To', p.to!], ['Runs', String(runs.length)]], sections, notes };
}

async function buildCash(p: P): Promise<ReportData> {
  const asOf = p.asOf ? new Date(`${p.asOf}T00:00:00.000Z`) : startOfDay(new Date());
  const pf = p.portfolioId ? await portfolioOf(p.portfolioId) : null;
  const b = await balances({ portfolioId: pf?.id, asOf });
  return {
    title: 'Cash report',
    meta: [['Portfolio', pf ? `${pf.name} (${pf.ref})` : 'All portfolios'], ['As of', day(asOf)!]],
    sections: [
      {
        heading: 'Ledgers',
        columns: ['Ledger', 'Name', 'Portfolio', 'Currency', 'Posted', 'Reserved', 'Min buffer', 'Expected net', 'Available', 'Withdrawable'],
        rows: b.ledgers.map((l): Cell[] => [l.ref, l.name, l.portfolioRef, l.currency, l.posted, l.reserved, l.minBuffer, l.expectedNet, l.available, l.withdrawable]),
      },
      {
        heading: 'Totals',
        columns: ['Portfolio', 'Currency', 'Posted', 'Reserved', 'Expected net', 'Available'],
        rows: b.totals.map((t): Cell[] => [t.portfolioName, t.currency, t.posted, t.reserved, t.expectedNet, t.available]),
      },
    ],
    notes: [b.note],
  };
}

export async function build(key: ReportKey, params: P): Promise<ReportData> {
  switch (key) {
    case 'FACT_SHEET':
      return buildFactSheet(params);
    case 'HOLDINGS':
      return buildHoldings(params);
    case 'TRANSACTIONS':
      return buildTransactions(params);
    case 'NAV_PACK':
      return buildNavPack(params);
    case 'CASH':
      return buildCash(params);
  }
}

// ---------------------------------------------------------------- generate and store

export async function generateRun(opts: { key: ReportKey; params: P; format: ReportFormat; actorId: string; audit: AuditContext; scheduleId?: string | null }) {
  const def = await prisma.reportDefinition.findUnique({ where: { key: opts.key } });
  if (!def || !def.active) throw HttpError.notFound('Unknown or inactive report');
  const generatedAt = new Date();
  let data: ReportData | null = null;
  let error: string | null = null;
  try {
    data = await build(opts.key, opts.params);
  } catch (e) {
    if (e instanceof HttpError && e.status < 500) throw e;
    error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'reportRun');
    let fileId: string | null = null;
    let sha: string | null = null;
    let rows = 0;
    if (data) {
      const body = Buffer.from(render(data, opts.format, generatedAt), 'utf8');
      const meta = FORMAT_META[opts.format];
      const file = await storeFile({ name: `${safeName(ref)}-${safeName(opts.key.toLowerCase())}.${meta.ext}`, mime: meta.mime, data: body, uploadedById: opts.actorId }, tx);
      fileId = file.id;
      sha = file.sha256 ?? sha256Hex(body);
      rows = rowCount(data);
    }
    const run = await tx.reportRun.create({
      data: {
        ref,
        definitionId: def.id,
        scheduleId: opts.scheduleId ?? null,
        params: opts.params as Prisma.InputJsonValue,
        format: opts.format,
        status: data ? 'COMPLETED' : 'FAILED',
        fileId,
        sha256: sha,
        rowCount: rows,
        title: data?.title ?? def.name,
        error,
        requestedBy: opts.actorId,
      },
    });
    await writeAudit(tx, opts.audit, { action: data ? 'reports.run_generated' : 'reports.run_failed', objectType: 'report_run', objectId: run.id, after: { ref, report: opts.key, format: opts.format, params: opts.params, rows, sha256: sha, error } });
    return run;
  });
}

// ---------------------------------------------------------------- schedules

/** Runs every active schedule that is due, as the schedule's creator. Safe to call repeatedly (each run advances the date). */
export async function runDueSchedules(now = new Date()): Promise<number> {
  const today = startOfDay(now);
  const due = await prisma.reportSchedule.findMany({ where: { active: true, nextRunOn: { lte: today } }, include: { definition: true }, take: 50 });
  let n = 0;
  for (const s of due) {
    // Claim the slot first so concurrent workers do not run it twice.
    const next = nextRunAfter(today, s.frequency as Frequency);
    const claimed = await prisma.reportSchedule.updateMany({ where: { id: s.id, nextRunOn: s.nextRunOn }, data: { nextRunOn: next, lastRunAt: now } });
    if (claimed.count !== 1) continue;
    try {
      const run = await generateRun({ key: s.definition.key as ReportKey, params: s.params as P, format: s.format as ReportFormat, actorId: s.createdBy, audit: { actorId: s.createdBy, portal: 'admin' } as AuditContext, scheduleId: s.id });
      await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunId: run.id } });
      n++;
    } catch (e) {
      console.error(`[reports] schedule ${s.id} failed`, e);
    }
  }
  return n;
}
