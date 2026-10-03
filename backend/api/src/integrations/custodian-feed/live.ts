import { IntegrationNotConfiguredError } from '../common';
import type { CustodianFeedAdapter, FeedHolding, FeedStatement, FeedTransaction } from './types';

/**
 * Live custodian connectivity placeholder: SWIFT (MT535/MT536/MT940 over Alliance Access or a service bureau) or the
 * custodian's REST API. Credentials and the connectivity route are supplied later; every method fails clearly until then.
 */
export const CUSTODIAN_LIVE_REQUIRED_ENV = [
  'CUSTODIAN_FEED_SWIFT_BIC',
  'CUSTODIAN_FEED_SWIFT_ENDPOINT',
  'CUSTODIAN_FEED_SWIFT_CERT',
  'CUSTODIAN_FEED_API_BASE_URL',
  'CUSTODIAN_FEED_API_KEY',
];

const fail = (): never => {
  throw new IntegrationNotConfiguredError('Custodian feed', CUSTODIAN_LIVE_REQUIRED_ENV, 'Set the SWIFT variables or the API pair (base URL and key), whichever route the custodian provides.');
};

export class LiveCustodianFeed implements CustodianFeedAdapter {
  readonly name = 'live' as const;
  async listStatements(): Promise<FeedStatement[]> {
    return fail();
  }
  async fetchStatement(_id: string): Promise<FeedStatement | null> {
    return fail();
  }
  async fetchHoldings(_id: string): Promise<FeedHolding[]> {
    return fail();
  }
  async fetchTransactions(_id: string): Promise<FeedTransaction[]> {
    return fail();
  }
}

export const liveMissingEnv = () => CUSTODIAN_LIVE_REQUIRED_ENV.filter((k) => !process.env[k]);
