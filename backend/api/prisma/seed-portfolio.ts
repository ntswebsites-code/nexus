/**
 * Portfolio foundation demo data, consistent with the V56 prototype (portals/admin-web/public/legacy/js/01-inline.js:
 * portfolios, marketUniverse, institutionalPositions, order brokers): six portfolios, 13 ZSE / VFEX / OTC securities with a
 * two-day price history, positions, cash and three brokers. Prices of securities the prototype does not quote are
 * illustrative demo values.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-portfolio.ts      (standalone)
 *   SEED_DEMO=1 npm run db:seed                                           (also runs it, via seed-demo.ts)
 *
 * Idempotent: securities (ticker), brokers (name), prices, positions, cash and FX are upserted on their unique keys;
 * portfolios are matched by name and created only when missing (so edited mandates and managers are not reset).
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';

const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const AS_OF = '2026-08-26';
const PREV = '2026-08-25';
/** Prototype implied rate: ZWG 36.48M = US$ 2.81M, so about ZWG 13 per US$. */
const ZWG_PER_USD = 13;

interface Sec {
  ticker: string;
  name: string;
  market: 'ZSE' | 'VFEX' | 'OTC';
  assetClass: string;
  currency: string;
  boardLot: number;
  sector: string;
  isin?: string;
  last: string;
  prev: string;
}

const SECURITIES: Sec[] = [
  { ticker: 'DLTA.ZW', name: 'Delta Corporation Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Consumer Staples', last: '31.94', prev: '31.95' },
  { ticker: 'CBZ.ZW', name: 'CBZ Holdings Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Financials', last: '39.96', prev: '39.97' },
  { ticker: 'ECO.ZW', name: 'Econet Wireless Zimbabwe Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Telecommunications', last: '15.41', prev: '15.52' },
  { ticker: 'INN.ZW', name: 'Innscor Africa Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Consumer Staples', last: '18.42', prev: '18.30' },
  { ticker: 'FBC.ZW', name: 'FBC Holdings Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Financials', last: '8.64', prev: '8.60' },
  { ticker: 'MEIK.ZW', name: 'Meikles Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Consumer Discretionary', last: '22.10', prev: '22.18' },
  { ticker: 'SIM.ZW', name: 'Simbisa Brands Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Consumer Discretionary', last: '6.35', prev: '6.31' },
  { ticker: 'OKZ.ZW', name: 'OK Zimbabwe Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Consumer Staples', last: '5.20', prev: '5.22' },
  { ticker: 'NMB.ZW', name: 'NMBZ Holdings Limited', market: 'ZSE', assetClass: 'Equity', currency: 'ZWG', boardLot: 100, sector: 'Financials', last: '2.84', prev: '2.80' },
  { ticker: 'ZIM.VX', name: 'Zimplats Holdings Limited', market: 'VFEX', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'Materials', last: '2.29', prev: '2.27' },
  { ticker: 'CMCL.VX', name: 'Caledonia Mining Corporation', market: 'VFEX', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'Materials', last: '7.85', prev: '7.90' },
  { ticker: 'SEED.VX', name: 'Seed Co International Limited', market: 'VFEX', assetClass: 'Equity', currency: 'USD', boardLot: 1, sector: 'Consumer Staples', last: '0.85', prev: '0.84' },
  { ticker: 'T-BILL-91D', name: '91-day Treasury Bill', market: 'OTC', assetClass: 'Fixed income', currency: 'USD', boardLot: 1, sector: 'Government', last: '1.000000', prev: '0.999800' },
];

const BROKERS = [
  { name: 'Imara Edwards Securities', email: 'dealing@imara-edwards.example.test' },
  { name: 'IH Securities', email: 'trading@ihsecurities.example.test' },
  { name: 'FBC Securities', email: 'desk@fbcsecurities.example.test' },
];

interface Pf {
  name: string;
  type: string;
  baseCurrency: string;
  benchmark: string;
  manager: string;
  mandate: Record<string, unknown>;
  cash: [string, string][];
  positions: [string, string, string][]; // ticker, quantity, avg cost (security currency)
}

const PORTFOLIOS: Pf[] = [
  {
    name: 'Balanced Growth Fund',
    type: 'Balanced Fund',
    baseCurrency: 'USD',
    benchmark: 'Composite: ZSE 40% / fixed income 35% / cash & MM 25%',
    manager: 'T. Moyo',
    mandate: { maxSingleNamePct: 13, maxSectorPct: 40, cashFloorPct: 2, maxCashPct: 15 },
    cash: [['USD', '1834560.00']],
    positions: [
      ['DLTA.ZW', '1142000', '25.28'],
      ['INN.ZW', '822000', '14.39'],
      ['ECO.ZW', '628000', '14.28'],
      ['CBZ.ZW', '600000', '33.10'],
      ['FBC.ZW', '3000000', '7.02'],
      ['MEIK.ZW', '900000', '19.40'],
      ['SIM.ZW', '3500000', '5.10'],
      ['OKZ.ZW', '2000000', '4.35'],
      ['ZIM.VX', '1200000', '1.95'],
      ['CMCL.VX', '330000', '6.40'],
      ['SEED.VX', '2200000', '0.71'],
    ],
  },
  {
    name: 'USD Equity Fund',
    type: 'Equity Fund',
    baseCurrency: 'USD',
    benchmark: 'ZSE All Share (USD)',
    manager: 'R. Dube',
    mandate: { maxSingleNamePct: 13, maxSectorPct: 35, cashFloorPct: 1, maxCashPct: 10 },
    cash: [['USD', '912400.00']],
    positions: [
      ['ZIM.VX', '1000000', '1.88'],
      ['CMCL.VX', '280000', '6.10'],
      ['SEED.VX', '2400000', '0.66'],
      ['DLTA.ZW', '700000', '26.00'],
      ['ECO.ZW', '900000', '14.00'],
      ['CBZ.ZW', '700000', '35.00'],
      ['FBC.ZW', '3000000', '7.20'],
      ['INN.ZW', '900000', '15.00'],
      ['SIM.ZW', '2500000', '5.40'],
      ['MEIK.ZW', '900000', '20.50'],
      ['OKZ.ZW', '1200000', '4.50'],
    ],
  },
  {
    name: 'Platinum Preservation Fund',
    type: 'Absolute Return',
    baseCurrency: 'USD',
    benchmark: 'USD LIBOR + 3%',
    manager: 'K. Moyo',
    mandate: { maxSingleNamePct: 40, maxSectorPct: 60, cashFloorPct: 5, maxCashPct: 25 },
    cash: [['USD', '1597120.00']],
    positions: [
      ['ZIM.VX', '2000000', '1.80'],
      ['CMCL.VX', '400000', '6.00'],
      ['T-BILL-91D', '4800000', '0.9890'],
    ],
  },
  {
    name: 'Pension Mandate 04',
    type: 'Institutional Mandate',
    baseCurrency: 'ZWG',
    benchmark: 'Pension composite (ZSE 50% / fixed income 50%)',
    manager: 'T. Moyo',
    mandate: { maxSingleNamePct: 20, maxSectorPct: 40, cashFloorPct: 3, maxCashPct: 12 },
    cash: [['ZWG', '11000000.00']],
    positions: [
      ['INN.ZW', '1500000', '14.00'],
      ['SIM.ZW', '4000000', '5.30'],
      ['ECO.ZW', '1800000', '13.80'],
      ['FBC.ZW', '3000000', '7.40'],
      ['NMB.ZW', '9000000', '2.40'],
      ['CBZ.ZW', '400000', '36.00'],
    ],
  },
  {
    name: 'Liquidity Plus',
    type: 'Money Market',
    baseCurrency: 'USD',
    benchmark: '91-day T-Bill',
    manager: 'S. Ncube',
    mandate: { maxSingleNamePct: 80, cashFloorPct: 10, maxCashPct: 40 },
    cash: [['USD', '2359000.00']],
    positions: [['T-BILL-91D', '7200000', '0.9900']],
  },
  {
    name: 'Zimbabwe Opportunities',
    type: 'Equity / Special Sits',
    baseCurrency: 'ZWG',
    benchmark: 'ZSE All Share',
    manager: 'R. Dube',
    mandate: { maxSingleNamePct: 16, maxSectorPct: 40, cashFloorPct: 2, maxCashPct: 15 },
    cash: [['ZWG', '7300000.00']],
    positions: [
      ['DLTA.ZW', '500000', '27.50'],
      ['CBZ.ZW', '400000', '34.00'],
      ['MEIK.ZW', '500000', '20.00'],
      ['OKZ.ZW', '2000000', '4.60'],
      ['FBC.ZW', '1200000', '7.60'],
      ['INN.ZW', '500000', '15.50'],
      ['SIM.ZW', '1200000', '5.60'],
      ['NMB.ZW', '3000000', '2.60'],
      ['ECO.ZW', '500000', '13.90'],
    ],
  },
];

const log = (m: string) => console.log(`[seed:portfolio] ${m}`);

export async function seedPortfolio() {
  const day0 = day(AS_OF);
  const day1 = day(PREV);

  // Brokers
  for (const b of BROKERS) {
    await prisma.broker.upsert({ where: { name: b.name }, update: {}, create: { name: b.name, email: b.email, status: 'Active' } });
  }

  // Securities and prices
  const secIds = new Map<string, string>();
  for (const s of SECURITIES) {
    const row = await prisma.security.upsert({
      where: { ticker: s.ticker },
      update: { name: s.name, market: s.market, assetClass: s.assetClass, currency: s.currency, boardLot: s.boardLot, sector: s.sector },
      create: { ticker: s.ticker, name: s.name, market: s.market, assetClass: s.assetClass, currency: s.currency, boardLot: s.boardLot, sector: s.sector, status: 'Active' },
    });
    secIds.set(s.ticker, row.id);
    for (const [date, price] of [[day0, s.last], [day1, s.prev]] as const) {
      await prisma.securityPrice.upsert({
        where: { securityId_priceDate_source: { securityId: row.id, priceDate: date, source: 'SEED' } },
        update: { price: D(price) },
        create: { securityId: row.id, priceDate: date, source: 'SEED', price: D(price) },
      });
    }
  }

  // FX (ZWG -> USD and USD -> ZWG)
  const zwgUsd = D(1).div(ZWG_PER_USD).toDecimalPlaces(10);
  for (const [from, to, rate] of [['ZWG', 'USD', zwgUsd], ['USD', 'ZWG', D(ZWG_PER_USD)]] as const) {
    for (const date of [day0, day1]) {
      await prisma.fxRate.upsert({
        where: { fromCurrency_toCurrency_rateDate: { fromCurrency: from, toCurrency: to, rateDate: date } },
        update: { rate },
        create: { fromCurrency: from, toCurrency: to, rateDate: date, rate, source: 'SEED' },
      });
    }
  }

  // Portfolios, positions, cash
  let created = 0;
  for (const p of PORTFOLIOS) {
    let row = await prisma.portfolio.findFirst({ where: { name: p.name } });
    if (!row) {
      const manager = await prisma.user.findFirst({ where: { name: p.manager, isActive: true }, select: { id: true } });
      row = await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'portfolio');
        return tx.portfolio.create({
          data: {
            ref,
            name: p.name,
            type: p.type,
            baseCurrency: p.baseCurrency,
            benchmark: p.benchmark,
            status: 'Active',
            managerUserId: manager?.id ?? null,
            mandateJson: p.mandate as Prisma.InputJsonValue,
          },
        });
      });
      created += 1;
    }
    for (const [ticker, qty, cost] of p.positions) {
      const securityId = secIds.get(ticker)!;
      await prisma.portfolioPosition.upsert({
        where: { portfolioId_securityId_asOf: { portfolioId: row.id, securityId, asOf: day0 } },
        update: { quantity: D(qty), avgCost: D(cost) },
        create: { portfolioId: row.id, securityId, quantity: D(qty), avgCost: D(cost), asOf: day0 },
      });
    }
    for (const [currency, available] of p.cash) {
      await prisma.portfolioCash.upsert({
        where: { portfolioId_currency_asOf: { portfolioId: row.id, currency, asOf: day0 } },
        update: { available: D(available) },
        create: { portfolioId: row.id, currency, available: D(available), asOf: day0 },
      });
    }
  }
  log(`${SECURITIES.length} securities, ${BROKERS.length} brokers, ${PORTFOLIOS.length} portfolios (${created} created), as of ${AS_OF}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedPortfolio();
  } catch (err) {
    console.error('[seed:portfolio] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
