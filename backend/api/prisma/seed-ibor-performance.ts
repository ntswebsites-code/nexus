/**
 * IBOR & Performance demo wiring (run seed-portfolio first):
 *  1. Back-fills about 60 weekdays of deterministic price and FX history before the earliest seeded price, and one
 *     backdated position / cash row per portfolio at the start of that history, so returns can be computed.
 *  2. Opening tax lots and OPENING lineage events for every current position that has no lots yet.
 *  3. Benchmark compositions for the benchmark names the seeded portfolios carry (weights total 100).
 * Idempotent: existing prices, rows, lots and compositions are left alone. Nothing is posted or locked.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-ibor-performance.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';

const log = (m: string) => console.log(`[seed:ibor-performance] ${m}`);
const D = (v: string | number) => new Prisma.Decimal(v);
const DAY = 86_400_000;
const HISTORY_DAYS = 60;

/** Deterministic pseudo-random daily move in [-1.8%, +1.8%] for a ticker and date. */
function move(ticker: string, date: string): number {
  const h = createHash('sha256').update(`${ticker}|${date}`).digest();
  return ((h.readUInt16BE(0) / 65535) * 2 - 1) * 0.018;
}

const BENCHMARKS: { code: string; name: string; parts: [string | null, string, number][] }[] = [
  {
    code: 'BM-BALANCED',
    name: 'Composite: ZSE 40% / fixed income 35% / cash & MM 25%',
    parts: [['DLTA.ZW', '', 10], ['INN.ZW', '', 6], ['ECO.ZW', '', 8], ['CBZ.ZW', '', 8], ['FBC.ZW', '', 8], ['T-BILL-91D', '', 35], [null, 'Cash', 25]],
  },
  {
    code: 'BM-ZSE-ALL',
    name: 'ZSE All Share',
    parts: [['DLTA.ZW', '', 18], ['CBZ.ZW', '', 14], ['ECO.ZW', '', 12], ['INN.ZW', '', 10], ['FBC.ZW', '', 8], ['MEIK.ZW', '', 8], ['SIM.ZW', '', 8], ['OKZ.ZW', '', 6], ['NMB.ZW', '', 6], ['ZIM.VX', '', 5], ['CMCL.VX', '', 5]],
  },
  {
    code: 'BM-ZSE-ALL-USD',
    name: 'ZSE All Share (USD)',
    parts: [['DLTA.ZW', '', 18], ['CBZ.ZW', '', 14], ['ECO.ZW', '', 12], ['INN.ZW', '', 10], ['FBC.ZW', '', 8], ['MEIK.ZW', '', 8], ['SIM.ZW', '', 8], ['OKZ.ZW', '', 6], ['NMB.ZW', '', 6], ['ZIM.VX', '', 5], ['CMCL.VX', '', 5]],
  },
  {
    code: 'BM-PENSION',
    name: 'Pension composite (ZSE 50% / fixed income 50%)',
    parts: [['INN.ZW', '', 12], ['SIM.ZW', '', 10], ['ECO.ZW', '', 10], ['FBC.ZW', '', 9], ['NMB.ZW', '', 5], ['CBZ.ZW', '', 4], ['T-BILL-91D', '', 50]],
  },
  { code: 'BM-TBILL-91D', name: '91-day T-Bill', parts: [['T-BILL-91D', '', 100]] },
];

function weekdaysBefore(from: Date, n: number): string[] {
  const out: string[] = [];
  let d = from.getTime();
  while (out.length < n) {
    d -= DAY;
    const dow = new Date(d).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d).toISOString().slice(0, 10));
  }
  return out;
}

export async function seedIborPerformance() {
  const securities = await prisma.security.findMany();
  if (!securities.length) {
    log('no securities: skipped (run seed-portfolio first)');
    return;
  }

  // ---- 1. price / fx history, then backdated positions and cash
  let priceRows = 0;
  for (const s of securities) {
    const count = await prisma.securityPrice.count({ where: { securityId: s.id } });
    const first = await prisma.securityPrice.findFirst({ where: { securityId: s.id }, orderBy: { priceDate: 'asc' } });
    if (!first || count >= 10) continue; // already has history
    let price = first.price;
    const rows: { securityId: string; priceDate: Date; price: Prisma.Decimal; source: string }[] = [];
    // Walk backwards: the price before a date is the date's price undone by that date's move.
    let cur = first.priceDate.toISOString().slice(0, 10);
    for (const d of weekdaysBefore(first.priceDate, HISTORY_DAYS)) {
      price = price.div(1 + move(s.ticker, cur)).toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
      rows.push({ securityId: s.id, priceDate: new Date(`${d}T00:00:00.000Z`), price, source: 'SEED' });
      cur = d;
    }
    await prisma.securityPrice.createMany({ data: rows, skipDuplicates: true });
    priceRows += rows.length;
  }
  const histStart = (await prisma.securityPrice.aggregate({ _min: { priceDate: true } }))._min.priceDate;
  {
    const fx = await prisma.fxRate.findMany({ orderBy: { rateDate: 'asc' } });
    const byPair = new Map<string, (typeof fx)[number][]>();
    for (const r of fx) byPair.set(`${r.fromCurrency}>${r.toCurrency}`, [...(byPair.get(`${r.fromCurrency}>${r.toCurrency}`) ?? []), r]);
    for (const rows of byPair.values()) {
      if (rows.length > 3) continue;
      const r = rows[0]!;
      await prisma.fxRate.createMany({ data: weekdaysBefore(r.rateDate, HISTORY_DAYS).map((d) => ({ fromCurrency: r.fromCurrency, toCurrency: r.toCurrency, rateDate: new Date(`${d}T00:00:00.000Z`), rate: r.rate, source: 'SEED' })), skipDuplicates: true });
    }
  }
  let backdated = 0;
  if (histStart) {
    for (const p of await prisma.portfolio.findMany({ select: { id: true } })) {
      const pos = await prisma.portfolioPosition.findMany({ where: { portfolioId: p.id }, orderBy: { asOf: 'asc' } });
      const firstBySec = new Map<string, (typeof pos)[number]>();
      for (const r of pos) if (!firstBySec.has(r.securityId)) firstBySec.set(r.securityId, r);
      for (const r of firstBySec.values()) {
        if (r.asOf <= histStart) continue;
        await prisma.portfolioPosition.create({ data: { portfolioId: p.id, securityId: r.securityId, quantity: r.quantity, avgCost: r.avgCost, asOf: histStart } });
        backdated++;
      }
      const cash = await prisma.portfolioCash.findMany({ where: { portfolioId: p.id }, orderBy: { asOf: 'asc' } });
      const firstCcy = new Map<string, (typeof cash)[number]>();
      for (const r of cash) if (!firstCcy.has(r.currency)) firstCcy.set(r.currency, r);
      for (const r of firstCcy.values()) {
        if (r.asOf <= histStart) continue;
        await prisma.portfolioCash.create({ data: { portfolioId: p.id, currency: r.currency, available: r.available, asOf: histStart } });
        backdated++;
      }
    }
  }
  log(`${priceRows} history price row(s), ${backdated} backdated position/cash row(s)`);

  // ---- 2. opening lots
  let lotsMade = 0;
  for (const p of await prisma.portfolio.findMany({ select: { id: true, ref: true } })) {
    const rows = await prisma.portfolioPosition.findMany({ where: { portfolioId: p.id }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    const latest = new Map<string, (typeof rows)[number]>();
    const first = new Map<string, Date>();
    for (const r of rows) {
      if (!latest.has(r.securityId)) latest.set(r.securityId, r);
      first.set(r.securityId, r.asOf);
    }
    for (const [secId, pos] of latest) {
      if (pos.quantity.lte(0)) continue;
      if (await prisma.iborLot.count({ where: { portfolioId: p.id, securityId: secId } })) continue;
      const sec = securities.find((s) => s.id === secId)!;
      await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'iborEvent');
        await tx.iborEvent.create({
          data: { ref, portfolioId: p.id, securityId: secId, eventType: 'OPENING', quantityDelta: pos.quantity, price: pos.avgCost, effectiveDate: first.get(secId)!, sourceType: 'OPENING', sourceId: `${p.id}:${secId}`, summary: `${p.ref} ${sec.ticker}: opening lot of ${pos.quantity.toString()} from the position record`, detail: { positionId: pos.id, avgCost: pos.avgCost.toString(), seeded: true } },
        });
        await tx.iborLot.create({ data: { portfolioId: p.id, securityId: secId, openedOn: first.get(secId)!, originalQty: pos.quantity, remainingQty: pos.quantity, unitCost: pos.avgCost, currency: sec.currency, sourceType: 'OPENING', sourceId: ref } });
      });
      lotsMade++;
    }
  }
  log(`${lotsMade} opening lot(s)`);

  // ---- 3. benchmarks
  const bySec = new Map(securities.map((s) => [s.ticker, s]));
  for (const b of BENCHMARKS) {
    const row = await prisma.perfBenchmark.upsert({ where: { code: b.code }, update: {}, create: { code: b.code, name: b.name } });
    if (await prisma.perfBenchmarkConstituent.count({ where: { benchmarkId: row.id } })) continue;
    const data = b.parts
      .filter(([t]) => t === null || bySec.has(t))
      .map(([t, sector, w]) => ({ benchmarkId: row.id, securityId: t ? bySec.get(t)!.id : null, sector: t ? (bySec.get(t)!.sector ?? 'Unclassified') : sector, weightPct: D(w) }));
    const total = data.reduce((a, c) => a.add(c.weightPct), D(0));
    if (!total.eq(100)) {
      log(`${b.code}: composition skipped (securities missing, weights total ${total.toString()})`);
      continue;
    }
    await prisma.perfBenchmarkConstituent.createMany({ data });
    log(`${b.code}: ${data.length} constituents`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedIborPerformance();
  } catch (err) {
    console.error('[seed:ibor-performance] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
