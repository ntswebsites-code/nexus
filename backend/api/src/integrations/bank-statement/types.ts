import type { AdapterBase, AdapterMeta } from '../core/types';

export interface BankStatementLine {
  date: string;
  amount: string;
  reference: string;
  description: string;
}
export interface BankStatement {
  format: 'CAMT053';
  xml: string;
  openingBalance: string;
  closingBalance: string;
  lines: BankStatementLine[];
  /** The same statement as JSON, in the shape `POST /cash/statement-imports` (format JSON) accepts. */
  json: string;
}

export interface BankStatementAdapter extends AdapterBase {
  fetchStatement(input: { accountRef: string; from: string; to: string; currency: string; openingBalance: string }): Promise<BankStatement>;
}

export const meta: AdapterMeta = {
  name: 'bank-statement',
  label: 'Bank statements (CAMT.053 / MT940)',
  gap: 'GAP-A05',
  description: 'Bank account statements for cash reconciliation.',
  requiredEnv: ['BANK_STATEMENT_HOST', 'BANK_STATEMENT_USER', 'BANK_STATEMENT_KEY'],
  vendorCalls: { fetchStatement: 'Bank host API or SFTP drop: fetch the CAMT.053 / MT940 statement for the account and date range, parse to lines' },
};
