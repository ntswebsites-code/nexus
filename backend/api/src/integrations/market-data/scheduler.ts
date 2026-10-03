import { prisma } from '../../lib/prisma';
import { hararePartsOf } from '../common';
import { schedulerEnabled } from './index';
import { dueScope } from './schedule';
import { refreshMarketData, type RefreshScope } from './service';

let lastCheck = 0;

/** Cheap to call every worker tick: it checks at most once a minute. Returns the scope run, if any. */
export async function marketDataTick(now = new Date()): Promise<RefreshScope | null> {
  if (!schedulerEnabled()) return null;
  if (now.getTime() - lastCheck < 60_000) return null;
  lastCheck = now.getTime();
  const dayStartUtc = new Date(`${hararePartsOf(now).iso}T00:00:00.000Z`);
  const since = new Date(dayStartUtc.getTime() - 2 * 3_600_000); // Harare midnight
  const runs = await prisma.mdRefreshRun.findMany({ where: { trigger: 'SCHEDULE', startedAt: { gte: since } }, select: { scope: true, status: true, startedAt: true } });
  const scope = dueScope(now, runs);
  if (!scope) return null;
  try {
    const r = await refreshMarketData({ trigger: 'SCHEDULE', scope });
    console.log(`[worker] market data ${scope} ${r.status}: ${r.accepted} updated, ${r.unchanged} unchanged, ${r.rejected} rejected, ${r.errors} errors, ${r.skipped} skipped`);
  } catch (e) {
    console.error('[worker] market data refresh failed', e instanceof Error ? e.message : e);
  }
  return scope;
}
