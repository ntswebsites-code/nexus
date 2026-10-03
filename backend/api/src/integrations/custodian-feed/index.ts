import { instrument } from '../core/calls';
import { withHealth } from '../core/adapt';
import { custodianFeedMode } from './mode';
import { FakeCustodianFeed } from './fake';
import { FileDropCustodianFeed } from './file-drop';
import { LiveCustodianFeed, liveMissingEnv } from './live';
import type { CustodianFeedAdapter, CustodianFeedMode } from './types';

export * from './types';
export { meta } from './meta';

export { custodianFeedMode } from './mode';

export function custodianFeedFor(mode: CustodianFeedMode) {
  const raw: CustodianFeedAdapter = mode === 'live' ? new LiveCustodianFeed() : mode === 'fake' ? new FakeCustodianFeed() : new FileDropCustodianFeed();
  return withHealth(raw, () => {
    if (mode === 'live') {
      const missing = liveMissingEnv();
      return { ok: false, detail: `Not configured: vendor client not implemented${missing.length ? `; missing ${missing.join(', ')}` : ''}` };
    }
    return { ok: true, detail: mode === 'fake' ? 'Fake feed: deterministic statements, no network' : 'File drop: statements arrive as uploaded files' };
  });
}

/** `INTEGRATION_CUSTODIAN_FEED=file-drop|fake|live`. Statement reads are logged to `integration_calls`. */
export function getCustodianFeedAdapter(env: NodeJS.ProcessEnv = process.env): CustodianFeedAdapter {
  const mode = custodianFeedMode(env);
  return instrument('custodian-feed', mode, custodianFeedFor(mode), ['listStatements', 'fetchStatement', 'fetchHoldings', 'fetchTransactions']);
}
