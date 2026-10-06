import { describe, expect, it } from 'vitest';
import { parseStatement } from '../../../backend/api/src/modules/cash/cash.engine';

const isCamtStatement = (content: string, format?: string) => format === 'CAMT053' || /camt\.053/i.test(content);

const sampleCamt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt>
<Stmt><Id>TEST-1</Id><Acct><Id><Othr><Id>CUST-CL-00418</Id></Othr></Id><Ccy>USD</Ccy></Acct>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="USD">110.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="USD">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><ValDt><Dt>2026-10-01</Dt></ValDt><AcctSvcrRef>BNK-001</AcctSvcrRef><AddtlNtryInf>Credit</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe('custodian CAMT bridge (pure)', () => {
  it('detects CAMT.053 by format flag or XML content', () => {
    expect(isCamtStatement(sampleCamt)).toBe(true);
    expect(isCamtStatement('acct,date\n1,2', 'CAMT053')).toBe(true);
    expect(isCamtStatement('acct,date\n1,2', 'CSV')).toBe(false);
  });

  it('parses sample CAMT with account ref and footing lines via cash.engine', () => {
    const parsed = parseStatement('CAMT053', sampleCamt, {});
    expect(parsed.errors).toEqual([]);
    expect(parsed.accountRef).toBe('CUST-CL-00418');
    expect(parsed.currency).toBe('USD');
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.opening?.toFixed(2)).toBe('100.00');
    expect(parsed.closing?.toFixed(2)).toBe('110.00');
  });
});
