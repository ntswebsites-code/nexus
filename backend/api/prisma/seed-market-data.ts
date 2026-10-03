/**
 * Market-data demo/bootstrap data: registers the public sources in md_source_status (so the ops screen lists them
 * before the first fetch) and the paid-feed placeholder as NOT_CONFIGURED. Idempotent; never fetches anything.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-market-data.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { PUBLIC_SOURCES } from '../src/integrations/market-data/public/sources.config';

const log = (m: string) => console.log(`[seed:market-data] ${m}`);

export async function seedMarketData() {
  let n = 0;
  for (const s of PUBLIC_SOURCES) {
    await prisma.mdSourceStatus.upsert({
      where: { source: s.code },
      create: { source: s.code, provider: 'public', label: s.label, url: s.url },
      update: { label: s.label, url: s.url },
    });
    n++;
  }
  await prisma.mdSourceStatus.upsert({
    where: { source: 'LIVE' },
    create: { source: 'LIVE', provider: 'live', label: 'Paid market-data feed (not configured)', url: '', enabled: false, lastStatus: 'NOT_CONFIGURED', lastError: 'Set MARKET_DATA_LIVE_BASE_URL and MARKET_DATA_LIVE_API_KEY and implement the vendor client' },
    update: {},
  });
  log(`${n} public source(s) and the live placeholder registered`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedMarketData();
  } catch (err) {
    console.error('[seed:market-data] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
