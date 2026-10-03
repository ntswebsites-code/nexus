import { hashUnit, isoDay, lastWeekdayOnOrBefore, sha256 } from '../common';
import { renderStatement } from './parsers';
import type { CustodianFeedAdapter, FeedHolding, FeedStatement, FeedTransaction, ListStatementsQuery, ParsedStatement } from './types';

/** Deterministic statement for (counterparty, account, date): same inputs always give the same numbers. */
export function fakeStatement(counterpartyId: string, accountRef: string, dateIso: string, currency = 'USD', tickers: string[] = ['DLTA.ZW', 'CBZ.ZW', 'ZIM.VX']): ParsedStatement {
  const seed = `${counterpartyId}|${accountRef}|${dateIso}`;
  const holdings: FeedHolding[] = tickers.map((ticker) => {
    const q = Math.round((1 + hashUnit(`${seed}|q|${ticker}`) * 99) * 100);
    const px = Number((1 + hashUnit(`${seed}|p|${ticker}`) * 40).toFixed(4));
    return { accountRef, statementDate: dateIso, ticker, isin: null, quantity: String(q), price: String(px), marketValue: (q * px).toFixed(2), currency };
  });
  const transactions: FeedTransaction[] = tickers.slice(0, 2).map((ticker, i) => ({
    tradeRef: `FK-${sha256(`${seed}|t|${i}`).slice(0, 10).toUpperCase()}`,
    executionAt: `${dateIso}T0${8 + i}:30:00.000Z`,
    accountRef,
    ticker,
    side: hashUnit(`${seed}|s|${i}`) > 0.5 ? 'BUY' : 'SELL',
    quantity: String(100 * (i + 1)),
    price: String(Number((1 + hashUnit(`${seed}|tp|${i}`) * 40).toFixed(4))),
    currency,
    settlementDate: null,
  }));
  return { format: 'JSON', accountRef, statementDate: dateIso, currency, closingCash: (50_000 + hashUnit(`${seed}|cash`) * 450_000).toFixed(2), holdings, transactions, warnings: [] };
}

export function fakeStatementFile(counterpartyId: string, accountRef: string, dateIso: string | undefined, format: 'CSV' | 'MT940' | 'JSON', currency?: string, tickers?: string[]) {
  const date = dateIso ?? lastWeekdayOnOrBefore(isoDay(new Date()));
  const s = fakeStatement(counterpartyId, accountRef, date, currency, tickers);
  return { filename: `fake-${accountRef}-${date}.${format === 'MT940' ? 'sta' : format.toLowerCase()}`, content: renderStatement(s, format), statement: s };
}

/** In-memory fake feed: statements for the last few weekdays of every known account. */
export class FakeCustodianFeed implements CustodianFeedAdapter {
  readonly name = 'fake' as const;
  constructor(private readonly accounts: { counterpartyId: string; accountRef: string }[] = [{ counterpartyId: 'fake-cp', accountRef: 'FAKE-001' }]) {}

  private all(days = 5): (FeedStatement & { parsed: ParsedStatement })[] {
    const out: (FeedStatement & { parsed: ParsedStatement })[] = [];
    let d = new Date(`${lastWeekdayOnOrBefore(isoDay(new Date()))}T00:00:00Z`);
    for (let i = 0; i < days; i++) {
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86_400_000);
      for (const a of this.accounts) {
        const parsed = fakeStatement(a.counterpartyId, a.accountRef, isoDay(d));
        const mv = parsed.holdings.reduce((n, h) => n + Number(h.marketValue ?? 0), 0);
        out.push({ id: `fake:${a.counterpartyId}:${a.accountRef}:${isoDay(d)}`, counterpartyId: a.counterpartyId, accountRef: a.accountRef, statementDate: isoDay(d), currency: parsed.currency, closingCash: parsed.closingCash, holdingsMv: mv.toFixed(2), tradeCount: parsed.transactions.length, source: 'fake', parsed });
      }
      d = new Date(d.getTime() - 86_400_000);
    }
    return out;
  }

  async listStatements(q: ListStatementsQuery = {}): Promise<FeedStatement[]> {
    return this.all()
      .filter((s) => (!q.counterpartyId || s.counterpartyId === q.counterpartyId) && (!q.accountRef || s.accountRef === q.accountRef) && (!q.from || s.statementDate >= q.from) && (!q.to || s.statementDate <= q.to))
      .slice(0, q.limit ?? 50)
      .map(({ parsed: _p, ...s }) => s);
  }
  async fetchStatement(id: string) {
    const s = this.all(30).find((x) => x.id === id);
    if (!s) return null;
    const { parsed: _p, ...rest } = s;
    return rest;
  }
  async fetchHoldings(id: string) {
    return this.all(30).find((x) => x.id === id)?.parsed.holdings ?? [];
  }
  async fetchTransactions(id: string) {
    return this.all(30).find((x) => x.id === id)?.parsed.transactions ?? [];
  }
}
