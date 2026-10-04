import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import type { LpContext } from '../lp.context';
import { loadPrefs } from '../routes/settings.routes';
import type { FundPosition } from './positions';

/**
 * Presentation-currency conversion for the LP portal (SRD 5B BR-087, BR-095, BR-152, BR-170, BR-171).
 *
 * Four currencies stay apart: the transaction currency (on the record), the fund currency, the investor
 * reporting currency (`client.baseCurrency`) and the temporary display currency (`presentationCurrency`).
 * The display currency changes presentation only, never the stored records. Snapshot amounts convert with the
 * stored `fx_rates` row of the as-of date; ledger rows convert with the rate of the transaction date and keep
 * that rate on `lp_fx_stamps`. A missing rate leaves the original currency in place with a note (never a
 * silent USD value).
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

const startOfDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);

export interface FxRateUsed {
  from: string;
  to: string;
  rate: string;
  rateDate: string;
}

/** Block returned beside converted payloads so the screen can label the currency and show the rate used. */
export interface FxPresentation {
  /** The currency the investor chose to see. */
  presentationCurrency: string;
  /** Currency of the amounts in this payload (equals presentationCurrency when converted). */
  reportingCurrency: string;
  converted: boolean;
  rates: FxRateUsed[];
  note: string | null;
}

/** Stored rate (direct, else inverse) on or before `asOf`, with the date of the row used. */
export async function findRate(from: string, to: string, asOf: string): Promise<{ rate: Dec; rateDate: string } | null> {
  if (from === to) return { rate: new D(1), rateDate: asOf.slice(0, 10) };
  const day = startOfDay(asOf);
  const direct = await prisma.fxRate.findFirst({ where: { fromCurrency: from, toCurrency: to, rateDate: { lte: day } }, orderBy: { rateDate: 'desc' } });
  if (direct && !direct.rate.isZero()) return { rate: direct.rate, rateDate: direct.rateDate.toISOString().slice(0, 10) };
  const inverse = await prisma.fxRate.findFirst({ where: { fromCurrency: to, toCurrency: from, rateDate: { lte: day } }, orderBy: { rateDate: 'desc' } });
  if (inverse && !inverse.rate.isZero()) return { rate: new D(1).div(inverse.rate), rateDate: inverse.rateDate.toISOString().slice(0, 10) };
  return null;
}

export async function presentationCurrencyOf(ctx: LpContext): Promise<string> {
  const prefs = await loadPrefs(ctx);
  return (prefs.presentationCurrency || ctx.client.baseCurrency).toUpperCase();
}

const scale = (v: Dec, rate: Dec) => v.mul(rate);

/**
 * Converts the money of each position from its fund currency into the presentation currency using the rate of
 * the position's as-of date. Ratios (TVPI, DPI, RVPI, IRR) are currency-free and unchanged. When any rate is
 * missing nothing is converted and the note names the missing pair.
 */
export async function presentPositions(ctx: LpContext, positions: FundPosition[]): Promise<{ positions: FundPosition[]; fx: FxPresentation; rates: Map<string, Dec> }> {
  const target = await presentationCurrencyOf(ctx);
  const rates = new Map<string, Dec>();
  const used: FxRateUsed[] = [];
  const missing: string[] = [];
  for (const p of positions) {
    const from = p.fund.currency.toUpperCase();
    if (rates.has(p.fund.id) || from === target) {
      rates.set(p.fund.id, new D(1));
      continue;
    }
    const hit = await findRate(from, target, p.asOfDate);
    if (!hit) {
      if (!missing.includes(`${from}/${target}`)) missing.push(`${from}/${target}`);
      continue;
    }
    rates.set(p.fund.id, hit.rate);
    if (!used.some((u) => `${u.from}|${u.rateDate}` === `${from}|${hit.rateDate}`)) used.push({ from, to: target, rate: hit.rate.toFixed(10), rateDate: hit.rateDate });
  }
  const currencies = [...new Set(positions.map((p) => p.fund.currency.toUpperCase()))];
  if (missing.length) {
    return {
      positions,
      rates: new Map(),
      fx: {
        presentationCurrency: target,
        reportingCurrency: currencies.length === 1 ? currencies[0]! : ctx.client.baseCurrency,
        converted: false,
        rates: [],
        note: `FX rate unavailable for ${missing.join(', ')}; amounts are shown in their original currency.`,
      },
    };
  }
  const out = positions.map((p) => {
    const r = rates.get(p.fund.id)!;
    if (r.eq(1)) return p;
    return {
      ...p,
      committed: scale(p.committed, r),
      called: scale(p.called, r),
      paidIn: scale(p.paidIn, r),
      distributions: scale(p.distributions, r),
      nav: scale(p.nav, r),
      holding: p.holding ? { ...p.holding, accountValue: scale(p.holding.accountValue, r), navPerUnit: scale(p.holding.navPerUnit, r) } : null,
    };
  });
  return { positions: out, rates, fx: { presentationCurrency: target, reportingCurrency: positions.length ? target : ctx.client.baseCurrency, converted: used.length > 0, rates: used, note: null } };
}

// ── Transaction-date stamps (ledger) ───────────────────────────────────────

export interface StampTarget {
  entryId: string;
  entryType: string;
  currency: string;
  txnDate: string;
}

export interface StampView {
  rate: string;
  rateDate: string;
  txnDate: string;
}

/**
 * Rate of each record's transaction date, read from `lp_fx_stamps` and created on first sight. A stamp is
 * written once and never updated, so later rate changes cannot restate a ledger row (BR-152). Records whose
 * currency already equals the target need no stamp (rate 1). Entries with no stored rate return no stamp.
 */
export async function stampEntries(ctx: LpContext, target: string, entries: StampTarget[]): Promise<Map<string, StampView>> {
  const out = new Map<string, StampView>();
  const todo = entries.filter((e) => e.currency.toUpperCase() !== target);
  for (const e of entries) {
    if (e.currency.toUpperCase() === target) out.set(e.entryId, { rate: '1.0000000000', rateDate: e.txnDate, txnDate: e.txnDate });
  }
  if (!todo.length) return out;
  const existing = await prisma.lpFxStamp.findMany({ where: { clientId: ctx.client.id, toCurrency: target, entryId: { in: todo.map((e) => e.entryId) } } });
  for (const s of existing) {
    out.set(s.entryId, { rate: s.rate.toFixed(10), rateDate: s.rateDate.toISOString().slice(0, 10), txnDate: s.txnDate.toISOString().slice(0, 10) });
  }
  const fresh: Prisma.LpFxStampCreateManyInput[] = [];
  const cache = new Map<string, { rate: Dec; rateDate: string } | null>();
  for (const e of todo) {
    if (out.has(e.entryId)) continue;
    const key = `${e.currency.toUpperCase()}|${e.txnDate}`;
    if (!cache.has(key)) cache.set(key, await findRate(e.currency.toUpperCase(), target, e.txnDate));
    const hit = cache.get(key);
    if (!hit) continue;
    fresh.push({
      clientId: ctx.client.id,
      entryId: e.entryId,
      entryType: e.entryType,
      fromCurrency: e.currency.toUpperCase(),
      toCurrency: target,
      rate: hit.rate,
      rateDate: startOfDay(hit.rateDate),
      txnDate: startOfDay(e.txnDate),
    });
    out.set(e.entryId, { rate: hit.rate.toFixed(10), rateDate: hit.rateDate, txnDate: e.txnDate });
  }
  if (fresh.length) await prisma.lpFxStamp.createMany({ data: fresh, skipDuplicates: true });
  return out;
}
