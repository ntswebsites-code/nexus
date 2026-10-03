import { createHash } from 'node:crypto';
import type { CustodianFeedAdapter, DayEndStatement, HoldingLine, HoldingsStatement } from './types';

const n32 = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SAMPLE: HoldingLine[] = [
  { ticker: 'SAMPLE.A', quantity: '12000' },
  { ticker: 'SAMPLE.B', quantity: '4500' },
  { ticker: 'SAMPLE.C', quantity: '800' },
];

/** Generates MT535-like and MT950-like samples; no network. */
export class FakeCustodianFeed implements CustodianFeedAdapter {
  async fetchHoldings({ accountRef, asOf, holdings }: { accountRef: string; asOf: string; holdings?: HoldingLine[] }): Promise<HoldingsStatement> {
    const positions = holdings?.length ? holdings : SAMPLE;
    const ymd = asOf.replace(/-/g, '');
    const message = [
      ':16R:GENL',
      ':28E:1/ONLY',
      `:20C::SEME//FAKE${sha(`${accountRef}${asOf}`).slice(0, 8).toUpperCase()}`,
      ':23G:NEWM',
      `:98A::STAT//${ymd}`,
      `:97A::SAFE//${accountRef}`,
      ':16S:GENL',
      ':16R:SUBSAFE',
      ...positions.flatMap((p) => [':16R:FIN', `:35B:/TICKER/${p.ticker}`, `:93B::AGGR//UNIT/${p.quantity}`, ':16S:FIN']),
      ':16S:SUBSAFE',
    ].join('\n');
    return { format: 'MT535', message, sha256: sha(message), positions };
  }
  async fetchDayEnd({ accountRef, date, currency }: { accountRef: string; date: string; currency: string }): Promise<DayEndStatement> {
    const cash = (100_000_00 + (n32(`cash:${accountRef}:${date}`) % 9_000_000_00)) / 100;
    const mv = (500_000_00 + (n32(`mv:${accountRef}:${date}`) % 90_000_000_00)) / 100;
    const tradeCount = n32(`tc:${accountRef}:${date}`) % 12;
    const message = [`:20:FAKE${sha(`${accountRef}${date}`).slice(0, 8).toUpperCase()}`, `:25:${accountRef}`, `:62F:C${date.replace(/-/g, '').slice(2)}${currency}${cash.toFixed(2).replace('.', ',')}`].join('\n');
    return { format: 'MT950', message, sha256: sha(message), closingCash: cash.toFixed(2), holdingsMv: mv.toFixed(2), tradeCount };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter generating MT535 and MT950 style samples' };
  }
}
