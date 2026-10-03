/**
 * Reports & Regulatory, Data Fabric and Model Governance demo wiring. Idempotent (every record is keyed); nothing is
 * generated, filed, run or approved here except one legacy-attested model, so the screens start from a realistic
 * register and the workflows are exercised live.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-reports.ts   (standalone; run seed-portfolio and seed-nav first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { ensureCatalogue } from '../src/modules/reports/reports.service';
import { nextRunAfter } from '../src/modules/reports/reports.engine';
import { TEMPLATES, dueDateFor, lastClosedPeriod, startOfDay } from '../src/modules/regulatory/reg.engine';
import { DATASETS } from '../src/modules/data-fabric/data.engine';
import { ingestCsv, type FeedSchema } from '../src/modules/data-fabric/data.feed';

const log = (m: string) => console.log(`[seed:reports] ${m}`);

const SOURCES = [
  { key: 'zse-daily-prices', name: 'ZSE and VFEX daily closing prices', kind: 'FILE_FEED', system: 'ZSE market data', owner: 'Operations', cadence: 'DAILY', description: 'End-of-day closing prices loaded into security prices.' },
  { key: 'fx-provider', name: 'Reserve Bank and bank FX rates', kind: 'API', system: 'FX provider', owner: 'Operations', cadence: 'DAILY', description: 'Daily FX rates used by NAV and reporting.' },
  { key: 'custodian-statements', name: 'Custodian and bank statements', kind: 'FILE_FEED', system: 'Custodian portal', owner: 'Fund Accounting', cadence: 'DAILY', description: 'Statements staged in Cash & Ledgers and Reconciliations.' },
  { key: 'kyc-screening', name: 'KYC screening provider', kind: 'API', system: 'Screening provider', owner: 'Compliance', cadence: 'REALTIME', description: 'Sanctions, PEP and adverse-media screening results.' },
  { key: 'manual-corporate-actions', name: 'Corporate action announcements', kind: 'MANUAL', system: 'Entered by operations', owner: 'Operations', cadence: 'MANUAL', description: 'Announcements keyed from issuer circulars.' },
] as const;

const TABLE_SOURCES = DATASETS.map((d) => ({ key: `table-${d.key.replace(/_/g, '-')}`, name: `${d.label} (platform table)`, kind: 'TABLE' as const, dataset: d.key, system: 'Matanho Nexus database', owner: 'Operations', cadence: 'REALTIME' as const, description: `Live profile of ${d.table}.` }));

const RULES: { key: string; name: string; dataset: string; checkType: string; col: string; params?: Prisma.InputJsonValue; severity: string; source?: string }[] = [
  { key: 'securities-isin-present', name: 'Every security has an ISIN', dataset: 'securities', checkType: 'NOT_NULL', col: 'isin', severity: 'MEDIUM', source: 'table-securities' },
  { key: 'securities-sector-present', name: 'Every security has a sector', dataset: 'securities', checkType: 'NOT_NULL', col: 'sector', severity: 'LOW', source: 'table-securities' },
  { key: 'prices-positive', name: 'Prices are positive', dataset: 'security_prices', checkType: 'RANGE', col: 'price', params: { min: 0.000001 }, severity: 'HIGH', source: 'table-security-prices' },
  { key: 'prices-fresh', name: 'Prices are no older than 7 days', dataset: 'security_prices', checkType: 'FRESHNESS', col: 'price_date', params: { maxAgeDays: 7 }, severity: 'HIGH', source: 'zse-daily-prices' },
  { key: 'prices-security-exists', name: 'Every price belongs to a security', dataset: 'security_prices', checkType: 'ORPHAN', col: 'security_id', params: { relation: 'security' }, severity: 'HIGH', source: 'table-security-prices' },
  { key: 'fx-positive', name: 'FX rates are positive', dataset: 'fx_rates', checkType: 'RANGE', col: 'rate', params: { min: 0.0000001 }, severity: 'HIGH', source: 'fx-provider' },
  { key: 'fx-fresh', name: 'FX rates are no older than 7 days', dataset: 'fx_rates', checkType: 'FRESHNESS', col: 'rate_date', params: { maxAgeDays: 7 }, severity: 'MEDIUM', source: 'fx-provider' },
  { key: 'positions-security-exists', name: 'Every position references a security', dataset: 'portfolio_positions', checkType: 'ORPHAN', col: 'security_id', params: { relation: 'security' }, severity: 'HIGH', source: 'table-portfolio-positions' },
  { key: 'positions-portfolio-exists', name: 'Every position references a portfolio', dataset: 'portfolio_positions', checkType: 'ORPHAN', col: 'portfolio_id', params: { relation: 'portfolio' }, severity: 'HIGH', source: 'table-portfolio-positions' },
  { key: 'positions-quantity-positive', name: 'Position quantities are positive', dataset: 'portfolio_positions', checkType: 'RANGE', col: 'quantity', params: { min: 0.000001 }, severity: 'MEDIUM', source: 'table-portfolio-positions' },
  { key: 'clients-email-present', name: 'Every client has an email address', dataset: 'clients', checkType: 'NOT_NULL', col: 'email', severity: 'MEDIUM', source: 'table-clients' },
  { key: 'clients-email-unique', name: 'Client email addresses are unique', dataset: 'clients', checkType: 'UNIQUE', col: 'email', severity: 'MEDIUM', source: 'table-clients' },
  { key: 'clients-country-present', name: 'Every client has a country', dataset: 'clients', checkType: 'NOT_NULL', col: 'country', severity: 'LOW', source: 'table-clients' },
  { key: 'clients-review-date-present', name: 'Every client has a next KYC review date', dataset: 'clients', checkType: 'NOT_NULL', col: 'next_review_date', severity: 'MEDIUM', source: 'kyc-screening' },
  { key: 'nav-coverage-complete', name: 'NAV price coverage is at least 95%', dataset: 'nav_runs', checkType: 'RANGE', col: 'price_coverage', params: { min: 95, max: 100 }, severity: 'HIGH', source: 'table-nav-runs' },
  { key: 'nav-portfolio-exists', name: 'Every NAV run references a portfolio', dataset: 'nav_runs', checkType: 'ORPHAN', col: 'portfolio_id', params: { relation: 'portfolio' }, severity: 'HIGH', source: 'table-nav-runs' },
  { key: 'orders-quantity-positive', name: 'Order quantities are positive', dataset: 'orders', checkType: 'RANGE', col: 'quantity', params: { min: 0.000001 }, severity: 'HIGH', source: 'table-orders' },
  { key: 'funds-nav-fresh', name: 'Fund valuations are no older than 100 days', dataset: 'funds', checkType: 'FRESHNESS', col: 'as_of_date', params: { maxAgeDays: 100 }, severity: 'MEDIUM', source: 'table-funds' },
  { key: 'cash-journals-portfolio-exists', name: 'Every cash journal references a portfolio', dataset: 'cash_journals', checkType: 'ORPHAN', col: 'portfolio_id', params: { relation: 'portfolio' }, severity: 'HIGH', source: 'table-cash-journals' },
  { key: 'prices-unique-per-day', name: 'One price per security per day', dataset: 'security_prices', checkType: 'COMPOSITE_UQ', col: 'security_id,price_date', severity: 'MEDIUM', source: 'table-security-prices' },
  { key: 'cash-journals-balanced', name: 'Cash journals balance (debit equals credit)', dataset: 'cash_journals', checkType: 'COL_COMPARE', col: 'total_debit', params: { op: 'eq', other: 'total_credit' }, severity: 'HIGH', source: 'table-cash-journals' },
];

const FEED_KEY = 'zse-closing-prices-file';
const FEED_SCHEMA: FeedSchema = {
  keyColumn: 'ticker',
  columns: [
    { name: 'ticker', type: 'text', required: true },
    { name: 'price_date', type: 'date', required: true },
    { name: 'close_price', type: 'num', required: true },
    { name: 'volume', type: 'num', required: false },
  ],
};
const FEED_RULES = [
  { key: 'feed-closing-ticker-present', name: 'Closing price file: every row has a ticker', checkType: 'NOT_NULL', col: 'ticker', params: null, severity: 'MEDIUM' },
  { key: 'feed-closing-price-positive', name: 'Closing price file: prices are positive', checkType: 'RANGE', col: 'close_price', params: { min: 0.000001 }, severity: 'HIGH' },
  { key: 'feed-closing-fresh', name: 'Closing price file: newest row is no older than 7 days', checkType: 'FRESHNESS', col: 'price_date', params: { maxAgeDays: 7 }, severity: 'HIGH' },
  { key: 'feed-closing-ticker-known', name: 'Closing price file: every ticker exists in the securities master', checkType: 'CROSS_TABLE', col: 'ticker', params: { refDataset: 'securities', refCol: 'ticker' }, severity: 'MEDIUM' },
] as const;

export async function seedReports() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }

  // ---- Reports
  await ensureCatalogue();
  const defs = new Map((await prisma.reportDefinition.findMany()).map((d) => [d.key, d]));
  const pf = await prisma.portfolio.findFirst({ where: { status: { not: 'Closed' } }, orderBy: { ref: 'asc' } });
  const fund = await prisma.fund.findFirst({ orderBy: { ref: 'asc' } });
  const sched: { name: string; key: string; params: Record<string, string>; frequency: string }[] = [];
  if (pf) {
    sched.push({ name: `Weekly holdings - ${pf.name}`, key: 'HOLDINGS', params: { portfolioId: pf.id }, frequency: 'WEEKLY' });
    sched.push({ name: `Monthly cash report - ${pf.name}`, key: 'CASH', params: { portfolioId: pf.id }, frequency: 'MONTHLY' });
  }
  if (fund) sched.push({ name: `Quarterly fact sheet - ${fund.shortName}`, key: 'FACT_SHEET', params: { fundId: fund.id }, frequency: 'QUARTERLY' });
  let sc = 0;
  for (const s of sched) {
    const def = defs.get(s.key);
    if (!def || (await prisma.reportSchedule.findFirst({ where: { name: s.name }, select: { id: true } }))) continue;
    await prisma.reportSchedule.create({ data: { definitionId: def.id, name: s.name, params: s.params, format: 'CSV', frequency: s.frequency, nextRunOn: nextRunAfter(startOfDay(new Date()), 'DAILY'), createdBy: actor } });
    sc++;
  }
  log(`${defs.size} report definitions, ${sc} schedule(s) added`);

  // ---- Regulatory
  for (const t of TEMPLATES) {
    await prisma.regTemplate.upsert({ where: { key: t.key }, update: { regulator: t.regulator, formCode: t.formCode, name: t.name, description: t.description, frequency: t.frequency, dueAfterDays: t.dueAfterDays }, create: t });
  }
  let filings = 0;
  for (const t of await prisma.regTemplate.findMany({ where: { active: true } })) {
    const per = lastClosedPeriod(t.frequency as 'MONTHLY', startOfDay(new Date()));
    if (await prisma.regFiling.findUnique({ where: { templateId_periodEnd: { templateId: t.id, periodEnd: per.end } }, select: { id: true } })) continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'regFiling');
      await tx.regFiling.create({ data: { ref, templateId: t.id, periodStart: per.start, periodEnd: per.end, dueDate: dueDateFor(per.end, t.dueAfterDays), makerId: null } });
    });
    filings++;
  }
  log(`${TEMPLATES.length} regulator templates, ${filings} calendar filing(s) opened`);

  // ---- Data fabric
  let src = 0;
  for (const s of [...SOURCES.map((x) => ({ ...x, dataset: null as string | null })), ...TABLE_SOURCES]) {
    if (await prisma.dataSource.findUnique({ where: { key: s.key }, select: { id: true } })) continue;
    await prisma.dataSource.create({ data: { key: s.key, name: s.name, kind: s.kind, dataset: s.dataset, system: s.system, owner: s.owner, cadence: s.cadence, description: s.description, createdBy: actor } });
    src++;
  }
  const bySource = new Map((await prisma.dataSource.findMany({ select: { id: true, key: true } })).map((s) => [s.key, s.id]));
  let rules = 0;
  for (const r of RULES) {
    if (await prisma.dataQualityRule.findUnique({ where: { key: r.key }, select: { id: true } })) continue;
    await prisma.dataQualityRule.create({ data: { key: r.key, name: r.name, sourceId: r.source ? bySource.get(r.source) ?? null : null, dataset: r.dataset, checkType: r.checkType, col: r.col, params: r.params ?? Prisma.JsonNull, severity: r.severity, createdBy: actor } });
    rules++;
  }
  log(`${src} data source(s), ${rules} quality rule(s) added`);

  // ---- Model governance
  const models = [
    { name: 'NAV pricing and FX conversion', purpose: 'Values portfolio positions from closing prices and converts to the base currency for NAV and reporting.', modelType: 'PRICING', tier: 1, ownerName: 'Fund Accounting', state: 'APPROVED' },
    { name: 'Concentration limit monitor', purpose: 'Measures single-name and sector weights against mandate limits and raises breaches.', modelType: 'RISK', tier: 2, ownerName: 'Risk and Compliance', state: 'SUBMITTED' },
    { name: 'Client risk rating scorecard', purpose: 'Scores clients at onboarding and review to propose a KYC risk rating.', modelType: 'SCORING', tier: 2, ownerName: 'Compliance', state: 'DRAFT' },
  ] as const;
  let mdl = 0;
  const today = startOfDay(new Date());
  for (const m of models) {
    if (await prisma.govModel.findFirst({ where: { name: m.name }, select: { id: true } })) continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'govModel');
      const row = await tx.govModel.create({ data: { ref, name: m.name, purpose: m.purpose, modelType: m.modelType, tier: m.tier, ownerName: m.ownerName, createdBy: actor, status: m.state === 'APPROVED' ? 'APPROVED' : m.state === 'SUBMITTED' ? 'IN_VALIDATION' : 'DRAFT', nextReviewOn: new Date(Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate())) } });
      const v = await tx.govModelVersion.create({
        data: { modelId: row.id, version: '1.0', changeNote: m.state === 'APPROVED' ? 'Carried over from the legacy model register' : 'Initial version', authorId: actor, status: m.state === 'APPROVED' ? 'APPROVED' : m.state, submittedAt: m.state === 'DRAFT' ? null : new Date(), ...(m.state === 'APPROVED' ? { approvedBy: actor, approvedAt: new Date(), decisionNote: 'Attested at migration from the legacy model register (seed data, not a live approval)' } : {}) },
      });
      if (m.state === 'APPROVED') {
        await tx.govModelValidation.create({ data: { versionId: v.id, validatorId: actor, outcome: 'PASS', scope: 'Legacy register attestation at migration', performedOn: today } });
        await tx.govModel.update({ where: { id: row.id }, data: { currentVersionId: v.id } });
      }
    });
    mdl++;
  }
  log(`${mdl} model(s) added`);

  // ---- WP-6: file feed with a column contract, a sample load and feed rules
  let feed = await prisma.dataSource.findUnique({ where: { key: FEED_KEY } });
  if (!feed) {
    feed = await prisma.dataSource.create({ data: { key: FEED_KEY, name: 'ZSE closing prices (CSV upload)', kind: 'FILE_FEED', system: 'ZSE market data file', owner: 'Operations', cadence: 'DAILY', description: 'Upload the day-end closing price CSV; rows are typed, validated and staged, refused rows are listed with the reason.', schemaSpec: FEED_SCHEMA as unknown as Prisma.InputJsonValue, createdBy: actor } });
  } else if (!feed.schemaSpec) feed = await prisma.dataSource.update({ where: { id: feed.id }, data: { schemaSpec: FEED_SCHEMA as unknown as Prisma.InputJsonValue } });
  if (!(await prisma.dataStagedRecord.count({ where: { sourceId: feed.id } }))) {
    const d = new Date().toISOString().slice(0, 10);
    const tickers = (await prisma.security.findMany({ orderBy: { ticker: 'asc' }, take: 5, select: { ticker: true } })).map((s) => s.ticker);
    const csv = ['ticker,price_date,close_price,volume', ...tickers.map((t, i) => `${t},${d},${(10 + i * 1.25).toFixed(2)},${1000 * (i + 1)}`), `DEMO-UNLISTED,${d},3.10,500`, `BAD-ROW,${d},not-a-number,10`].join('\n');
    const res = ingestCsv(csv, FEED_SCHEMA);
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'dataJob');
      const job = await tx.dataIngestionJob.create({ data: { ref, sourceId: feed!.id, status: 'SUCCEEDED', rowsRead: res.rowsRead, rowsRejected: res.rejected.length, latestRecordAt: res.latestRecordAt, note: `${res.accepted.length} accepted from seed sample`, triggeredBy: actor, finishedAt: new Date(), fileName: 'seed-sample.csv' } });
      if (res.rejected.length) await tx.dataRejectedRow.createMany({ data: res.rejected.map((r) => ({ jobId: job.id, rowNo: r.rowNo, reason: r.reason, raw: r.raw })) });
      await tx.dataStagedRecord.createMany({ data: res.accepted.map((r) => ({ sourceId: feed!.id, jobId: job.id, rowNo: r.rowNo, recordKey: r.key, data: r.data as Prisma.InputJsonValue })) });
      await tx.dataSource.update({ where: { id: feed!.id }, data: { lastSyncAt: new Date(), lastRowCount: res.accepted.length } });
    });
  }
  let fr = 0;
  for (const r of FEED_RULES) {
    if (await prisma.dataQualityRule.findUnique({ where: { key: r.key }, select: { id: true } })) continue;
    await prisma.dataQualityRule.create({ data: { key: r.key, name: r.name, sourceId: feed.id, dataset: `feed:${FEED_KEY}`, checkType: r.checkType, col: r.col, params: (r.params ?? Prisma.JsonNull) as Prisma.InputJsonValue, severity: r.severity, createdBy: actor } });
    fr++;
  }
  log(`file feed ${FEED_KEY} ready, ${fr} feed rule(s) added`);

  // ---- WP-6: month-end schedules use a rolling window; the NAV pricing model is bound (not enforced) so NAV runs log their use
  await prisma.reportSchedule.updateMany({ where: { name: { startsWith: 'Monthly cash report' }, rolling: null }, data: { rolling: 'PREVIOUS_MONTH' } });
  const navModel = await prisma.govModel.findFirst({ where: { name: 'NAV pricing and FX conversion', status: 'APPROVED' } });
  if (navModel && !(await prisma.govModelBinding.findUnique({ where: { purpose: 'NAV_VALUATION' } }))) await prisma.govModelBinding.create({ data: { purpose: 'NAV_VALUATION', modelId: navModel.id, enforce: false, updatedBy: actor } });
  const riskModel = await prisma.govModel.findFirst({ where: { name: 'Concentration limit monitor', status: 'APPROVED' } });
  if (riskModel && !(await prisma.govModelBinding.findUnique({ where: { purpose: 'RISK_SCENARIO' } }))) await prisma.govModelBinding.create({ data: { purpose: 'RISK_SCENARIO', modelId: riskModel.id, enforce: false, updatedBy: actor } });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedReports();
  } catch (err) {
    console.error('[seed:reports] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
