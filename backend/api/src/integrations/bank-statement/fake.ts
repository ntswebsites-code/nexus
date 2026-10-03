import { createHash } from 'node:crypto';
import type { BankStatement, BankStatementAdapter, BankStatementLine } from './types';

const n32 = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cents = (v: string) => Math.round(Number(v) * 100);
const fmt = (c: number) => (c / 100).toFixed(2);

/** Deterministic statement: one or two movements per day (max five lines) for the account and period. */
export class FakeBankStatement implements BankStatementAdapter {
  async fetchStatement({ accountRef, from, to, currency, openingBalance }: { accountRef: string; from: string; to: string; currency: string; openingBalance: string }): Promise<BankStatement> {
    const lines: BankStatementLine[] = [];
    let total = 0;
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    for (let d = start, i = 0; d <= end && lines.length < 5; d = new Date(d.getTime() + 86_400_000), i++) {
      const seed = n32(`bk:${accountRef}:${iso(d)}`);
      const amount = (seed % 2 === 0 ? 1 : -1) * (10_000 + (seed % 4_000_000));
      total += amount;
      lines.push({ date: iso(d), amount: fmt(amount), reference: `BNK-${seed.toString(16).slice(0, 6).toUpperCase()}`, description: amount > 0 ? 'Incoming credit (simulated)' : 'Outgoing debit (simulated)' });
    }
    const opening = cents(openingBalance);
    const closing = opening + total;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>',
      `<Stmt><Id>FAKE-${n32(`${accountRef}${from}${to}`).toString(16)}</Id><Acct><Id><Othr><Id>${accountRef}</Id></Othr></Id><Ccy>${currency}</Ccy></Acct>`,
      `<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">${fmt(Math.abs(opening))}</Amt><CdtDbtInd>${opening >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd></Bal>`,
      `<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="${currency}">${fmt(Math.abs(closing))}</Amt><CdtDbtInd>${closing >= 0 ? 'CRDT' : 'DBIT'}</CdtDbtInd></Bal>`,
      ...lines.map((l) => `<Ntry><Amt Ccy="${currency}">${l.amount.replace('-', '')}</Amt><CdtDbtInd>${l.amount.startsWith('-') ? 'DBIT' : 'CRDT'}</CdtDbtInd><ValDt><Dt>${l.date}</Dt></ValDt><AcctSvcrRef>${l.reference}</AcctSvcrRef><AddtlNtryInf>${l.description}</AddtlNtryInf></Ntry>`),
      '</Stmt></BkToCstmrStmt></Document>',
    ].join('\n');
    const json = JSON.stringify({ openingBalance: fmt(opening), closingBalance: fmt(closing), lines: lines.map((l) => ({ date: l.date, amount: l.amount, reference: l.reference, description: l.description })) });
    return { format: 'CAMT053', xml, openingBalance: fmt(opening), closingBalance: fmt(closing), lines, json };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter generating CAMT.053 samples' };
  }
}
