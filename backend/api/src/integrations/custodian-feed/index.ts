import { custodianFeedMode } from './mode';
import { FakeCustodianFeed } from './fake';
import { FileDropCustodianFeed } from './file-drop';
import { LiveCustodianFeed } from './live';
import type { CustodianFeedAdapter } from './types';

export * from './types';

export { custodianFeedMode } from './mode';

export function getCustodianFeedAdapter(env: NodeJS.ProcessEnv = process.env): CustodianFeedAdapter {
  const mode = custodianFeedMode(env);
  return mode === 'live' ? new LiveCustodianFeed() : mode === 'fake' ? new FakeCustodianFeed() : new FileDropCustodianFeed();
}
