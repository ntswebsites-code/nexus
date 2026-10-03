import type { AdapterBase, AdapterMeta } from '../core/types';

export interface HoldingLine {
  ticker: string;
  quantity: string;
}
export interface HoldingsStatement {
  format: 'MT535';
  message: string;
  sha256: string;
  positions: HoldingLine[];
}
export interface DayEndStatement {
  format: 'MT950';
  message: string;
  sha256: string;
  closingCash: string;
  holdingsMv: string;
  tradeCount: number;
}

export interface CustodianFeedAdapter extends AdapterBase {
  fetchHoldings(input: { accountRef: string; asOf: string; holdings?: HoldingLine[] }): Promise<HoldingsStatement>;
  fetchDayEnd(input: { accountRef: string; date: string; currency: string }): Promise<DayEndStatement>;
}

export const meta: AdapterMeta = {
  name: 'custodian-feed',
  label: 'Custodian feed (SWIFT / file)',
  gap: 'GAP-A05',
  description: 'Custody holdings (MT535) and day-end cash and control totals from the custodian.',
  requiredEnv: ['CUSTODIAN_FEED_HOST', 'CUSTODIAN_FEED_USER', 'CUSTODIAN_FEED_KEY'],
  vendorCalls: {
    fetchHoldings: 'SFTP/SWIFT pull of the MT535 statement of holdings for the safekeeping account, parsed to positions',
    fetchDayEnd: 'SFTP/SWIFT pull of the day-end cash statement (MT940/950) plus trade control totals',
  },
};
