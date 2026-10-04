/**
 * Package S4 demo data: issuer financials, analyst notes / catalysts / risks, a valuation model, the private-markets
 * pipeline (deal, diligence case, cashflow scenario) and portfolio strategy / risk labels. Idempotent: every block
 * checks for its own marker and is skipped when present; portfolio labels only fill columns that are still empty.
 * Run after seed-research-privates (needs its research cases and funds).
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-research-depth.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { runValuation, type ValuationInputs } from '../src/modules/research/research.valuation';
import { CHECKLIST_TEMPLATE, scenarioMetrics } from '../src/modules/private-markets/pm.pipeline';

const log = (m: string) => console.log(`[seed:research-depth] ${m}`);
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function seedResearchDepth() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) return log('no users yet: skipped');
  const securities = await prisma.security.findMany();
  const sec = (t: string) => securities.find((s) => s.ticker === t);

  // ---------------------------------------------------------------- issuer financials
  const fin: { ticker: string; period: string; type: string; end: string; rev: number; ebitda: number; ni: number; eps: number; assets: number; debt: number; equity: number; source: string }[] = [
    { ticker: 'INN.ZW', period: 'FY2025', type: 'FY', end: '2025-06-30', rev: 1_480_000_000, ebitda: 310_000_000, ni: 168_000_000, eps: 0.2, assets: 1_900_000_000, debt: 240_000_000, equity: 1_150_000_000, source: 'Annual report FY2025' },
    { ticker: 'INN.ZW', period: 'H1-2026', type: 'H1', end: '2025-12-31', rev: 790_000_000, ebitda: 171_000_000, ni: 94_000_000, eps: 0.11, assets: 1_960_000_000, debt: 230_000_000, equity: 1_210_000_000, source: 'Interim results H1-2026' },
    { ticker: 'DLTA.ZW', period: 'FY2025', type: 'FY', end: '2025-03-31', rev: 1_120_000_000, ebitda: 330_000_000, ni: 205_000_000, eps: 0.17, assets: 1_350_000_000, debt: 60_000_000, equity: 1_010_000_000, source: 'Annual report FY2025' },
    { ticker: 'ZIM.VX', period: 'FY2025', type: 'FY', end: '2025-06-30', rev: 640_000_000, ebitda: 255_000_000, ni: 118_000_000, eps: 0.11, assets: 1_100_000_000, debt: 150_000_000, equity: 690_000_000, source: 'Annual report FY2025' },
  ];
  for (const f of fin) {
    const s = sec(f.ticker);
    if (!s || (await prisma.issuerFinancial.findUnique({ where: { securityId_period: { securityId: s.id, period: f.period } } }))) continue;
    await prisma.issuerFinancial.create({
      data: { securityId: s.id, period: f.period, periodType: f.type, periodEnd: new Date(`${f.end}T00:00:00.000Z`), currency: s.currency, revenue: D(f.rev), ebitda: D(f.ebitda), netIncome: D(f.ni), eps: D(f.eps), totalAssets: D(f.assets), totalDebt: D(f.debt), equity: D(f.equity), source: f.source, asOf: day(-20), createdBy: actor },
    });
    log(`financials: ${f.ticker} ${f.period}`);
  }

  // ---------------------------------------------------------------- notes, catalysts, risks
  const inn = await prisma.researchCase.findFirst({ where: { title: 'Innscor: scale and margin recovery' } });
  const zim = await prisma.researchCase.findFirst({ where: { title: 'Zimplats: platinum-cycle exposure on VFEX' } });
  const entries: { ticker: string; caseId?: string; kind: string; title: string; body?: string; date?: Date; trigger?: string; impact?: string; severity?: string }[] = [
    { ticker: 'INN.ZW', caseId: inn?.id, kind: 'NOTE', title: 'Management call: margin bridge', body: 'CFO expects packaging margins to recover by two points in the second half as imported resin costs normalise. Capex unchanged.' },
    { ticker: 'INN.ZW', caseId: inn?.id, kind: 'CATALYST', title: 'Full-year results', date: day(35), trigger: 'Publication of audited FY results and dividend declaration', impact: 'POSITIVE', body: 'Consensus expects a higher dividend cover.' },
    { ticker: 'INN.ZW', caseId: inn?.id, kind: 'RISK', title: 'Price controls on staples', severity: 'MEDIUM', body: 'A return of statutory price controls would cap pass-through in the food division.' },
    { ticker: 'ZIM.VX', caseId: zim?.id, kind: 'CATALYST', title: 'Quarterly production update', date: day(12), trigger: 'Operational update with ounces produced and cash cost per ounce', impact: 'NEUTRAL' },
    { ticker: 'ZIM.VX', caseId: zim?.id, kind: 'RISK', title: 'Power supply interruptions', severity: 'HIGH', body: 'Load-shedding at the smelter reduces throughput; a second-feed project is not due until next year.' },
  ];
  for (const e of entries) {
    const s = sec(e.ticker);
    if (!s || (await prisma.researchEntry.findFirst({ where: { securityId: s.id, kind: e.kind, title: e.title } }))) continue;
    await prisma.researchEntry.create({
      data: { securityId: s.id, caseId: e.caseId ?? null, kind: e.kind, title: e.title, body: e.body ?? null, eventDate: e.date ?? null, triggerText: e.trigger ?? null, impact: e.impact ?? null, severity: e.severity ?? null, status: e.kind === 'CATALYST' ? 'PENDING' : e.kind === 'RISK' ? 'OPEN' : 'RECORDED', createdBy: actor },
    });
    log(`research entry: ${e.title}`);
  }

  // ---------------------------------------------------------------- valuation model
  if (inn && !(await prisma.researchValuation.findUnique({ where: { caseId: inn.id } }))) {
    const inputs: ValuationInputs = { revenue: 1_480_000_000, sharesOutstanding: 840_000_000, netDebt: 90_000_000, terminalGrowthPct: 2, growthPct: { low: 6, base: 11, high: 15 }, marginPct: { low: 9, base: 12, high: 14 }, discountPct: { low: 14, base: 17, high: 21 } };
    const out = runValuation(inputs);
    const d6 = (n: number) => D(n.toFixed(6));
    const base = out.prices.base > 0 ? out.prices.base : Number(inn.targetPrice.toString());
    await prisma.$transaction(async (tx) => {
      const v = await tx.researchValuation.create({ data: { caseId: inn.id, method: 'DCF', currency: inn.currency, currentVersion: 1, createdBy: actor } });
      await tx.researchValuationVersion.create({ data: { valuationId: v.id, version: 1, inputs: inputs as unknown as Prisma.InputJsonValue, result: { ...out, targetSource: 'MODEL' } as unknown as Prisma.InputJsonValue, targetPrice: d6(base), lowPrice: d6(out.prices.low), highPrice: d6(out.prices.high), note: 'Initial model', createdBy: actor } });
    });
    log('valuation model for the Innscor case');
  }

  // ---------------------------------------------------------------- private-markets pipeline
  const deals = [
    { name: 'Zambezi Cold Chain Holdings', sponsor: 'Kopje Growth Partners', strategy: 'PRIVATE_EQUITY', vintage: 2026, amount: '2500000', stage: 'DILIGENCE', level: 3 },
    { name: 'Eastern Highlands Solar Platform', sponsor: 'Highveld Asset Managers', strategy: 'INFRASTRUCTURE', vintage: 2026, amount: '4000000', stage: 'SCREENING', level: null },
    { name: 'Matanho Agri-Credit Facility II', sponsor: 'Kopje Credit', strategy: 'PRIVATE_CREDIT', vintage: 2025, amount: '1500000', stage: 'SOURCED', level: null },
  ];
  for (const d of deals) {
    if (await prisma.pmPipelineDeal.findFirst({ where: { name: d.name } })) continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'pmPipeline');
      const row = await tx.pmPipelineDeal.create({
        data: { ref, name: d.name, sponsor: d.sponsor, strategy: d.strategy, vintage: d.vintage, currency: 'USD', proposedAmount: D(d.amount), expectedClose: day(75), stage: d.stage, fairValueLevel: d.level, valuationDate: d.level ? day(-14) : null, ownerId: actor, createdBy: actor, notes: 'Seeded pipeline example.' },
      });
      if (d.stage === 'DILIGENCE') {
        const cref = await nextRef(tx, 'pmDiligence');
        const checklist = CHECKLIST_TEMPLATE.map((i, n) => ({ ...i, status: n < 3 ? 'DONE' : 'OPEN', note: n < 3 ? 'Reviewed, no exceptions.' : null }));
        await tx.pmDiligenceCase.create({ data: { ref: cref, dealId: row.id, title: `${d.name}: commercial and legal diligence`, leadId: actor, status: 'IN_REVIEW', checklist: checklist as unknown as Prisma.InputJsonValue, createdBy: actor } });
        const flows = [
          { date: iso(day(90)), kind: 'CALL' as const, amount: D('1000000') },
          { date: iso(day(270)), kind: 'CALL' as const, amount: D('1500000') },
          { date: iso(day(1100)), kind: 'DISTRIBUTION' as const, amount: D('1800000') },
          { date: iso(day(1650)), kind: 'DISTRIBUTION' as const, amount: D('2600000') },
        ];
        const sref = await nextRef(tx, 'pmScenario');
        await tx.pmCashflowScenario.create({
          data: { ref: sref, dealId: row.id, name: 'Base case: exit in year five', kind: 'BASE', currency: 'USD', flows: flows.map((f) => ({ ...f, amount: f.amount.toFixed(4) })) as unknown as Prisma.InputJsonValue, metrics: scenarioMetrics(flows) as unknown as Prisma.InputJsonValue, createdBy: actor },
        });
      }
    });
    log(`pipeline: ${d.name} (${d.stage})`);
  }

  // ---------------------------------------------------------------- portfolio strategy and risk labels (only where empty)
  const labels: [string, string, string][] = [
    ['Balanced Growth Fund', 'Balanced', 'MODERATE'],
    ['Growth Portfolio', 'Growth', 'HIGH'],
    ['Income Fund', 'Income', 'LOW'],
  ];
  for (const [name, strategy, risk] of labels) {
    const r = await prisma.portfolio.updateMany({ where: { name, strategy: null, riskProfile: null }, data: { strategy, riskProfile: risk } });
    if (r.count) log(`portfolio labels: ${name} -> ${strategy}/${risk}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedResearchDepth();
  } catch (err) {
    console.error('[seed:research-depth] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
