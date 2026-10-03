/**
 * WP-2 wiring demo data (orders, cash, private markets, corporate actions). Idempotent; run after seed-portfolio,
 * seed-orders, seed-corporate-actions and seed-research-privates (seed-demo.ts and seed-uat.ts call it last).
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-orders-pm.ts   (standalone)
 *
 *  1. Realised gain rows for seeded SELL fills (average cost), so the ticket and settlement split have data.
 *  2. An approved IC decision with a linked draft order, so the order ticket shows its originating decision.
 *  3. A EUR private fund (with a EUR/USD rate), a distribution split into return of capital and income, and
 *     pm_postings rows for every settled flow and approved mark (the seeded books are written directly, so the
 *     postings carry the carrying value only and say `seeded_opening`; no journals are invented).
 *  4. A bonus issue with cash in lieu (ANNOUNCED) to show the fraction handling.
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { seqRef } from '../src/modules/ops/ops.common';

const log = (m: string) => console.log(`[seed:orders-pm] ${m}`);
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export async function seedOrdersPm() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) return log('no users yet: skipped');

  // ---------------------------------------------------------------- 1. realised gains for seeded sells
  const sells = await prisma.order.findMany({ where: { side: 'SELL', fills: { some: {} } }, include: { fills: true } });
  let gains = 0;
  for (const o of sells) {
    for (const f of o.fills) {
      if (await prisma.orderRealisedGain.findUnique({ where: { fillId: f.id } })) continue;
      const pos = await prisma.portfolioPosition.findFirst({ where: { portfolioId: o.portfolioId, securityId: o.securityId }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
      const unit = pos?.avgCost ?? f.price;
      const proceeds = f.quantity.mul(f.price).toDecimalPlaces(4);
      const cost = f.quantity.mul(unit).toDecimalPlaces(4);
      await prisma.orderRealisedGain.create({ data: { orderId: o.id, fillId: f.id, portfolioId: o.portfolioId, securityId: o.securityId, quantity: f.quantity, unitCost: unit, proceeds, costBasis: cost, fees: f.fees, realisedGain: proceeds.sub(cost), currency: o.currency } });
      gains++;
    }
  }
  if (gains) log(`${gains} realised-gain row(s) for seeded sell fills`);

  // ---------------------------------------------------------------- 2. IC decision -> draft order
  const bgf = await prisma.portfolio.findFirst({ where: { name: 'Balanced Growth Fund' } });
  const zim = await prisma.security.findUnique({ where: { ticker: 'ZIM.VX' } });
  const zimCase = zim ? await prisma.researchCase.findFirst({ where: { securityId: zim.id, status: 'PUBLISHED' } }) : null;
  const MARK = 'Demo seed (IC order):';
  if (bgf && zim && zimCase && !(await prisma.order.findFirst({ where: { rationale: { startsWith: MARK } } }))) {
    const px = (await prisma.securityPrice.findFirst({ where: { securityId: zim.id }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }] }))?.price;
    if (px) {
      await prisma.$transaction(async (tx) => {
        const dref = await nextRef(tx, 'icDecision');
        const d = await tx.icDecision.create({
          data: { ref: dref, caseId: zimCase.id, portfolioId: bgf.id, securityId: zim.id, action: 'BUY', quantity: D('100000'), rationale: 'Accumulate on weakness per the published ACCUMULATE rating.', status: 'APPROVED', proposerId: actor, openedAt: new Date(), votesFor: 3, votesAgainst: 0, votesAbstain: 0, ratifiedBy: actor, ratifiedAt: new Date(), outcomeNote: 'Carried 3-0' },
        });
        const ref = await seqRef(tx, 'order', 'ORD-', 6, 1001);
        const o = await tx.order.create({
          data: { ref, portfolioId: bgf.id, securityId: zim.id, side: 'BUY', quantity: D('100000'), orderType: 'MARKET', tif: 'DAY', urgency: 'Normal', rationale: `${MARK} IC ${dref}`, currency: zim.currency, decisionPrice: px, status: 'Draft', makerId: actor },
        });
        await tx.icDecisionOrder.create({ data: { decisionId: d.id, orderId: o.id, orderRef: o.ref, createdBy: actor } });
        log(`${dref} approved, draft order ${ref} linked`);
      });
    }
  }

  // ---------------------------------------------------------------- 3. private markets: EUR fund, split distribution, postings
  if (bgf) {
    await prisma.fxRate.upsert({ where: { fromCurrency_toCurrency_rateDate: { fromCurrency: 'EUR', toCurrency: 'USD', rateDate: day(-1) } }, update: {}, create: { fromCurrency: 'EUR', toCurrency: 'USD', rateDate: day(-1), rate: D('1.0800000000'), source: 'SEED' } });
    const name = 'Cape Sustainable Infrastructure Fund (EUR)';
    if (!(await prisma.pmFund.findFirst({ where: { name } }))) {
      await prisma.$transaction(async (tx) => {
        const fref = await nextRef(tx, 'pmFund');
        const fund = await tx.pmFund.create({ data: { ref: fref, name, manager: 'Cape Capital Partners', strategy: 'INFRASTRUCTURE', vintage: 2023, currency: 'EUR', createdBy: actor } });
        const cref = await nextRef(tx, 'pmCommitment');
        const c = await tx.pmCommitment.create({ data: { ref: cref, fundId: fund.id, portfolioId: bgf.id, amount: D('2000000'), committedOn: day(-500), createdBy: actor } });
        const flows: { kind: string; amount: string; roc?: string; offset: number }[] = [
          { kind: 'CALL', amount: '500000', offset: -420 },
          { kind: 'CALL', amount: '300000', offset: -250 },
          { kind: 'DISTRIBUTION', amount: '60000', roc: '40000', offset: -90 },
        ];
        for (const fl of flows) {
          const xref = await nextRef(tx, 'pmCashflow');
          await tx.pmCashflow.create({ data: { ref: xref, commitmentId: c.id, kind: fl.kind, amount: D(fl.amount), returnOfCapital: fl.roc ? D(fl.roc) : null, noticeDate: day(fl.offset - 14), dueDate: day(fl.offset), paidOn: day(fl.offset), status: 'PAID', createdBy: actor, settledBy: actor } });
        }
        const mref = await nextRef(tx, 'pmMark');
        await tx.pmMark.create({ data: { ref: mref, commitmentId: c.id, asOf: day(-30), nav: D('880000'), method: 'GP_REPORTED', status: 'APPROVED', note: 'Quarter-end GP statement (EUR)', makerId: actor, approverId: actor, approvedAt: new Date() } });
      });
      log(`private fund (EUR): ${name}`);
    }
    // Split any seeded distribution that has no return-of-capital figure: half of it returns capital.
    for (const f of await prisma.pmCashflow.findMany({ where: { kind: 'DISTRIBUTION', returnOfCapital: null, status: 'PAID' } })) {
      await prisma.pmCashflow.update({ where: { id: f.id }, data: { returnOfCapital: f.amount.mul('0.5').toDecimalPlaces(4) } });
    }
    // Postings for settled flows and approved marks that were seeded directly (carrying value only).
    let posted = 0;
    const commitments = await prisma.pmCommitment.findMany({ include: { fund: true } });
    for (const c of commitments) {
      const base = (await prisma.portfolio.findUnique({ where: { id: c.portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD';
      const rate = c.fund.currency === base ? D(1) : ((await prisma.fxRate.findFirst({ where: { fromCurrency: c.fund.currency, toCurrency: base }, orderBy: { rateDate: 'desc' } }))?.rate ?? D(1));
      const events: { at: number; src: string; kind: string; amount: Prisma.Decimal; delta: Prisma.Decimal; cashflowId?: string; markId?: string }[] = [];
      for (const f of await prisma.pmCashflow.findMany({ where: { commitmentId: c.id, status: 'PAID' } })) {
        const roc = f.kind === 'DISTRIBUTION' ? (f.returnOfCapital ?? D(0)) : D(0);
        events.push({ at: (f.paidOn ?? f.dueDate).getTime(), src: `PMX:${f.ref}`, kind: f.kind, amount: f.amount, delta: f.kind === 'CALL' ? f.amount : roc.neg(), cashflowId: f.id });
      }
      let carrying = D(0);
      const sorted = events.sort((a, b) => a.at - b.at);
      const marks = (await prisma.pmMark.findMany({ where: { commitmentId: c.id, status: 'APPROVED' }, orderBy: { asOf: 'asc' } })).map((m) => ({ at: m.asOf.getTime(), m }));
      const timeline = [...sorted.map((e) => ({ at: e.at, e })), ...marks.map((x) => ({ at: x.at + 1, mark: x.m }))].sort((a, b) => a.at - b.at);
      for (const t of timeline) {
        if ('e' in t && t.e) {
          carrying = carrying.add(t.e.delta);
          if (await prisma.pmPosting.findUnique({ where: { sourceRef: t.e.src } })) continue;
          await prisma.pmPosting.create({ data: { sourceRef: t.e.src, kind: t.e.kind, commitmentId: c.id, portfolioId: c.portfolioId, cashflowId: t.e.cashflowId ?? null, currency: c.fund.currency, amount: t.e.amount, fxRate: rate, baseCurrency: base, baseAmount: t.e.amount.mul(rate).toDecimalPlaces(4), carryingDelta: t.e.delta, skipped: 'seeded_opening' } });
          posted++;
        } else if ('mark' in t && t.mark) {
          const adj = t.mark.nav.sub(carrying).toDecimalPlaces(4);
          carrying = carrying.add(adj);
          const src = `PMM:${t.mark.ref}`;
          if (await prisma.pmPosting.findUnique({ where: { sourceRef: src } })) continue;
          await prisma.pmPosting.create({ data: { sourceRef: src, kind: 'MARK', commitmentId: c.id, portfolioId: c.portfolioId, markId: t.mark.id, currency: c.fund.currency, amount: adj, fxRate: rate, baseCurrency: base, baseAmount: adj.mul(rate).toDecimalPlaces(4), carryingDelta: adj, skipped: 'seeded_opening' } });
          posted++;
        }
      }
    }
    if (posted) log(`${posted} pm_postings backfilled (carrying value; no journals)`);
  }

  // ---------------------------------------------------------------- 4. bonus issue with cash in lieu
  const seed = await prisma.security.findUnique({ where: { ticker: 'SEED.VX' } });
  const CIL = 'Demo event (cash in lieu).';
  if (seed && !(await prisma.corpActionEvent.findFirst({ where: { securityId: seed.id, description: { startsWith: CIL } } }))) {
    const px = (await prisma.securityPrice.findFirst({ where: { securityId: seed.id }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }] }))?.price ?? D(1);
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'corpAction');
      await tx.corpActionEvent.create({
        data: { ref, securityId: seed.id, ticker: seed.ticker, securityName: seed.name, type: 'BONUS_ISSUE', status: 'ANNOUNCED', currency: seed.currency, exDate: day(10), recordDate: day(12), payDate: day(12), ratioNew: D(1), ratioOld: D(7), cashInLieu: true, cilPrice: px, description: `${CIL} 1 bonus share for every 7 held; fractions are paid in cash at the market price.`, makerId: actor },
      });
      log(`${ref} ${seed.ticker} bonus issue with cash in lieu`);
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedOrdersPm();
  } catch (err) {
    console.error('[seed:orders-pm] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
