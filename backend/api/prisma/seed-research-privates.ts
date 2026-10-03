/**
 * Research & IC, Private Markets, Portfolio Construction and Collateral & Financing demo data. Idempotent: every
 * block checks for its own marker (case title, fund name, model name, rule key, facility name) and is skipped when
 * present. Run after seed-portfolio (needs the demo portfolios and securities). Maker-checker is a control on the API,
 * not on seeding: records here are written directly in their end state (the single seed user is both maker and checker).
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-research-privates.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { seqRef } from '../src/modules/ops/ops.common';

const log = (m: string) => console.log(`[seed:research-privates] ${m}`);
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export async function seedResearchPrivates() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) return log('no users yet: skipped');
  const [securities, portfolios] = await Promise.all([prisma.security.findMany(), prisma.portfolio.findMany()]);
  const sec = (t: string) => securities.find((s) => s.ticker === t);
  const pf = (n: string) => portfolios.find((p) => p.name === n);
  if (!securities.length || !portfolios.length) return log('no securities or portfolios: skipped (run seed-portfolio first)');

  // ---------------------------------------------------------------- research and IC
  const cases: { ticker: string; title: string; rating: string; target: string; status: string; conviction: number; thesis: string; risks: string }[] = [
    { ticker: 'INN.ZW', title: 'Innscor: scale and margin recovery', rating: 'BUY', target: '24.00', status: 'PUBLISHED', conviction: 4, thesis: 'Vertical integration across food, packaging and distribution lets Innscor pass through inflation faster than peers. Margin recovery and a stronger export mix support a re-rating towards our target over twelve months.', risks: 'Currency pass-through lags, input cost spikes and regulatory price controls on staples.' },
    { ticker: 'ZIM.VX', title: 'Zimplats: platinum-cycle exposure on VFEX', rating: 'ACCUMULATE', target: '2.80', status: 'PUBLISHED', conviction: 3, thesis: 'Low-cost platinum producer with a funded expansion programme and a US-dollar revenue line. Accumulate on weakness while the PGM basket stabilises.', risks: 'PGM price volatility, power supply interruptions and royalty changes.' },
    { ticker: 'DLTA.ZW', title: 'Delta: defensive compounder, valuation full', rating: 'HOLD', target: '33.50', status: 'IN_REVIEW', conviction: 3, thesis: 'Dominant beverage franchise with resilient volumes. The shares already discount the earnings path, so we hold the position and add only on pull-backs.', risks: 'Volume elasticity at higher retail prices and forex allocation delays.' },
  ];
  for (const c of cases) {
    const s = sec(c.ticker);
    if (!s || (await prisma.researchCase.findFirst({ where: { title: c.title } }))) continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'researchCase');
      const row = await tx.researchCase.create({
        data: { ref, securityId: s.id, title: c.title, thesis: c.thesis, risks: c.risks, rating: c.rating, targetPrice: D(c.target), currency: s.currency, conviction: c.conviction, status: c.status, analystId: actor, submittedAt: new Date(), reviewerId: c.status === 'PUBLISHED' ? actor : null, publishedAt: c.status === 'PUBLISHED' ? new Date() : null },
      });
      if (c.status === 'PUBLISHED') await tx.researchRatingChange.create({ data: { caseId: row.id, rating: c.rating, targetPrice: D(c.target), conviction: c.conviction, changedBy: actor, approvedBy: actor, note: 'Initiation' } });
    });
    log(`research case: ${c.title}`);
  }
  if (!(await prisma.icMeeting.findFirst({ where: { title: 'Investment Committee: monthly review' } }))) {
    const inn = await prisma.researchCase.findFirst({ where: { title: 'Innscor: scale and margin recovery' } });
    const bgf = pf('Balanced Growth Fund');
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'icMeeting');
      const m = await tx.icMeeting.create({ data: { ref, title: 'Investment Committee: monthly review', scheduledAt: new Date(Date.now() + 5 * 86_400_000), agenda: 'Innscor position size, platinum exposure, private-markets pacing.', quorum: 3, chairId: actor, createdBy: actor } });
      if (inn) {
        const dref = await nextRef(tx, 'icDecision');
        await tx.icDecision.create({ data: { ref: dref, caseId: inn.id, meetingId: m.id, portfolioId: bgf?.id ?? null, securityId: inn.securityId, action: 'BUY', quantity: D('200000'), rationale: 'Add 200,000 shares to the Balanced Growth Fund on the published BUY, funded from cash.', status: 'VOTING', proposerId: actor, openedAt: new Date() } });
      }
    });
    log('IC meeting and one decision open for voting');
  }

  // ---------------------------------------------------------------- private markets
  const funds = [
    { name: 'Matanho Private Equity Fund I', manager: 'Matanho Capital Partners', strategy: 'PRIVATE_EQUITY', vintage: 2021, commit: '6000000' },
    { name: 'Highveld Infrastructure Partners', manager: 'Highveld Asset Managers', strategy: 'INFRASTRUCTURE', vintage: 2022, commit: '4000000' },
    { name: 'Southern Africa Private Credit Fund II', manager: 'Kopje Credit', strategy: 'PRIVATE_CREDIT', vintage: 2023, commit: '3000000' },
  ];
  const bgf = pf('Balanced Growth Fund');
  for (const [i, f] of funds.entries()) {
    if (!bgf || (await prisma.pmFund.findFirst({ where: { name: f.name } }))) continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'pmFund');
      const fund = await tx.pmFund.create({ data: { ref, name: f.name, manager: f.manager, strategy: f.strategy, vintage: f.vintage, createdBy: actor } });
      const cref = await nextRef(tx, 'pmCommitment');
      const c = await tx.pmCommitment.create({ data: { ref: cref, fundId: fund.id, portfolioId: bgf.id, amount: D(f.commit), committedOn: day(-(1100 - i * 250)), createdBy: actor } });
      const amt = (share: number) => D(f.commit).mul(share).toDecimalPlaces(2);
      const flows: { kind: string; share: number; offset: number; paid: boolean }[] = [
        { kind: 'CALL', share: 0.2, offset: -700 + i * 150, paid: true },
        { kind: 'CALL', share: 0.15, offset: -420 + i * 90, paid: true },
        { kind: 'DISTRIBUTION', share: i === 0 ? 0.08 : 0.02, offset: -200, paid: true },
        { kind: 'CALL', share: 0.1, offset: i === 0 ? -60 : 25, paid: i === 0 },
      ];
      for (const fl of flows) {
        if (i === 2 && fl.kind === 'DISTRIBUTION') continue;
        const xref = await nextRef(tx, 'pmCashflow');
        await tx.pmCashflow.create({ data: { ref: xref, commitmentId: c.id, kind: fl.kind, amount: amt(fl.share), noticeDate: day(fl.offset - 14), dueDate: day(fl.offset), paidOn: fl.paid ? day(fl.offset) : null, status: fl.paid ? 'PAID' : 'NOTICED', createdBy: actor, settledBy: fl.paid ? actor : null } });
      }
      const mref = await nextRef(tx, 'pmMark');
      const paidIn = flows.filter((x) => x.kind === 'CALL' && x.paid).reduce((s, x) => s.add(amt(x.share)), D(0));
      const nav = paidIn.mul(i === 0 ? '1.32' : i === 1 ? '1.08' : '1.03').toDecimalPlaces(2);
      const mark = await tx.pmMark.create({ data: { ref: mref, commitmentId: c.id, asOf: day(-30), nav, method: 'GP_REPORTED', status: 'APPROVED', note: 'Quarter-end GP statement', makerId: actor, approverId: actor, approvedAt: new Date() } });
      await tx.pmEvidence.create({ data: { markId: mark.id, kind: 'GP_STATEMENT', title: `${f.name}: quarterly capital account statement`, reference: `VAULT-${fund.ref}-Q`, addedBy: actor } });
      if (i === 0) {
        const m2 = await nextRef(tx, 'pmMark');
        const pending = await tx.pmMark.create({ data: { ref: m2, commitmentId: c.id, asOf: day(-2), nav: nav.mul('1.04').toDecimalPlaces(2), method: 'ADJUSTED', status: 'PENDING_APPROVAL', note: 'Adjusted for a post-quarter portfolio-company sale', makerId: actor } });
        await tx.pmEvidence.create({ data: { markId: pending.id, kind: 'TRANSACTION', title: 'Share purchase agreement summary', reference: 'VAULT-SPA-0041', addedBy: actor } });
      }
    });
    log(`private fund: ${f.name}`);
  }

  // ---------------------------------------------------------------- portfolio lab
  if (!(await prisma.modelPortfolio.findFirst({ where: { name: 'Balanced Core' } }))) {
    const w: [string, string][] = [['DLTA.ZW', '12'], ['INN.ZW', '11'], ['ECO.ZW', '9'], ['CBZ.ZW', '8'], ['FBC.ZW', '7'], ['MEIK.ZW', '6'], ['SIM.ZW', '8'], ['OKZ.ZW', '5'], ['ZIM.VX', '10'], ['CMCL.VX', '8'], ['SEED.VX', '6']];
    const rows = w.map(([t, p]) => ({ s: sec(t), p })).filter((x): x is { s: NonNullable<ReturnType<typeof sec>>; p: string } => !!x.s);
    await prisma.$transaction(async (tx) => {
      const ref = await seqRef(tx, 'modelPortfolio', 'PMD-', 4, 1001);
      await tx.modelPortfolio.create({ data: { ref, name: 'Balanced Core', description: 'Diversified ZSE and VFEX equity core with a 10% cash reserve.', cashTargetPct: D('10'), status: 'ACTIVE', createdBy: actor, weights: { create: rows.map((r) => ({ securityId: r.s.id, targetPct: D(r.p) })) } } });
      const ref2 = await seqRef(tx, 'modelPortfolio', 'PMD-', 4, 1001);
      await tx.modelPortfolio.create({ data: { ref: ref2, name: 'Resources Tilt (draft)', description: 'Overweight VFEX materials; awaiting a second approver.', cashTargetPct: D('5'), status: 'DRAFT', createdBy: actor, weights: { create: rows.filter((r) => ['ZIM.VX', 'CMCL.VX', 'DLTA.ZW', 'INN.ZW', 'CBZ.ZW', 'SEED.VX'].includes(r.s.ticker)).map((r) => ({ securityId: r.s.id, targetPct: D(r.s.ticker.endsWith('.VX') ? '20' : '11.67') })) } } });
    });
    log('model portfolios');
  }

  // Earlier seeds issued MDL-#### to Portfolio Construction models, clashing with Model Governance refs: re-prefix to PMD-####.
  // Idempotent: only rows still starting with MDL- are touched.
  const renamed = await prisma.$executeRaw`UPDATE model_portfolios SET ref = CONCAT('PMD-', SUBSTRING(ref, 5)) WHERE ref LIKE 'MDL-%'`;
  if (renamed) log(`model portfolio refs re-prefixed to PMD-: ${renamed}`);

  // ---------------------------------------------------------------- financing
  const rules: { assetClass: string; market: string; eligible: boolean; haircut: string; cap: string | null; note: string }[] = [
    { assetClass: 'Equity', market: 'VFEX', eligible: true, haircut: '25', cap: null, note: 'USD-settled VFEX equities' },
    { assetClass: 'Equity', market: 'ZSE', eligible: true, haircut: '40', cap: '50', note: 'ZWG-priced ZSE equities, capped at 50% of the pool' },
    { assetClass: 'Equity', market: '', eligible: true, haircut: '45', cap: null, note: 'Other equities' },
    { assetClass: 'Fixed income', market: '', eligible: true, haircut: '5', cap: null, note: 'Government paper' },
    { assetClass: 'Fund', market: '', eligible: true, haircut: '30', cap: null, note: 'Listed and daily-dealing funds' },
    { assetClass: 'Private', market: '', eligible: false, haircut: '100', cap: null, note: 'Illiquid; never eligible' },
  ];
  for (const r of rules) {
    await prisma.finEligibilityRule.upsert({ where: { assetClass_market: { assetClass: r.assetClass, market: r.market } }, update: {}, create: { assetClass: r.assetClass, market: r.market, eligible: r.eligible, haircutPct: D(r.haircut), maxPoolPct: r.cap ? D(r.cap) : null, note: r.note, updatedBy: actor } });
  }
  const zim = sec('ZIM.VX');
  const cmcl = sec('CMCL.VX');
  const usd = pf('USD Equity Fund');
  const setups = [
    { pool: 'Balanced Growth margin pool', facility: 'Imara margin line', lender: 'Imara Edwards Securities', type: 'MARGIN_LOAN', portfolio: bgf, items: [[zim, '400000'], [cmcl, '100000']] as const, limit: '3000000', drawn: '800000' },
    { pool: 'USD Equity Fund repo pool', facility: 'Kopje repo line', lender: 'Kopje Capital', type: 'REPO', portfolio: usd, items: [[cmcl, '100000']] as const, limit: '1000000', drawn: '500000' },
  ];
  for (const s of setups) {
    if (!s.portfolio || (await prisma.finFacility.findFirst({ where: { name: s.facility } }))) continue;
    await prisma.$transaction(async (tx) => {
      const pref = await nextRef(tx, 'finPool');
      const pool = await tx.finPool.create({ data: { ref: pref, name: s.pool, portfolioId: s.portfolio!.id, createdBy: actor } });
      for (const [sc, q] of s.items) if (sc) await tx.finCollateralItem.create({ data: { poolId: pool.id, securityId: sc.id, quantity: D(q), createdBy: actor } });
      const fref = await nextRef(tx, 'finFacility');
      const f = await tx.finFacility.create({ data: { ref: fref, name: s.facility, type: s.type, lender: s.lender, portfolioId: s.portfolio!.id, poolId: pool.id, limitAmount: D(s.limit), ratePct: D('9.5'), status: 'ACTIVE', makerId: actor, approverId: actor, approvedAt: new Date() } });
      await tx.finMovement.create({ data: { facilityId: f.id, kind: 'DRAW', amount: D(s.drawn), valueDate: day(-20), note: 'Opening drawdown', createdBy: actor } });
    });
    log(`facility: ${s.facility}`);
  }
  // Raise the margin call a deficit facility is owed (the repo line is thinly covered by design).
  const repo = await prisma.finFacility.findFirst({ where: { name: 'Kopje repo line' } });
  if (repo && !(await prisma.finMarginCall.count({ where: { facilityId: repo.id } }))) {
    const { facilityMargin } = await import('../src/modules/financing/fin.service');
    const m = (await facilityMargin(repo)).margin;
    if (m.state === 'DEFICIT') {
      await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'finMarginCall');
        await tx.finMarginCall.create({ data: { ref, facilityId: repo.id, calledAmount: m.callAmount, drawn: m.drawn, eligibleValue: m.counted, coverageRatio: m.coverage!, dueAt: day(2), issuedBy: actor } });
      });
      log('margin call raised on the repo line');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedResearchPrivates();
  } catch (err) {
    console.error('[seed:research-privates] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
