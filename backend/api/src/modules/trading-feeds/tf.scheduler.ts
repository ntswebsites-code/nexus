import { marketDataMode } from '../../integrations/market-data';
import { systemCtx } from '../../lib/system';
import { syncCorporateActions } from './tf.service';

/** On by default only when the market-data provider is real (not fake); override with CA_FEED_SCHEDULER=on|off. */
export function caFeedSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.CA_FEED_SCHEDULER ?? '').trim().toLowerCase();
  if (v === 'on' || v === 'true' || v === '1') return true;
  if (v === 'off' || v === 'false' || v === '0') return false;
  return marketDataMode(env) !== 'fake';
}

/** One scheduled corporate-action feed sync (the worker's job lease makes it run at most once per interval). Returns the drafts created. */
export async function caFeedTick(): Promise<number> {
  if (!caFeedSchedulerEnabled()) return 0;
  const r = await syncCorporateActions({ trigger: 'SCHEDULE', userId: null, ctx: systemCtx() });
  if (r.status === 'ERROR') console.error(`[worker] corporate-action feed failed: ${r.error}`);
  return r.drafted;
}
