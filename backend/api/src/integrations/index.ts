/**
 * Integrations layer (WP-8). One folder per adapter: `types.ts` (interface and metadata), `fake.ts`, `live.ts`,
 * `index.ts` exporting `getXAdapter()`. Flags: INTEGRATION_<NAME>=fake|live (default fake). The registry wraps every
 * adapter so each operation is logged to `integration_calls`; fakes persist simulated artefacts in `integration_inbox`.
 */
import { config } from '../config';
import { settlePendingPayments } from './payment/fake';

export * from './core/names';
export * from './core/types';
export { withCorrelation, redact } from './core/calls';
export {
  getAdapter,
  adapterMode,
  adapterMeta,
  adapterHealth,
  runAdapterTest,
  missingEnv,
  validateIntegrationConfig,
  assertIntegrationsConfig,
  fakeInProduction,
  allAdapterNames,
} from './core/registry';

let lastTick = 0;
const TICK_EVERY_MS = 10_000;
const SETTLE_AFTER_MS = 5_000;

/** Worker timer tick: advances simulated asynchronous work (fake payments settle). A no-op for live adapters. */
export async function integrationTick(): Promise<number> {
  if (Date.now() - lastTick < TICK_EVERY_MS) return 0;
  lastTick = Date.now();
  if (config.integrations.payment !== 'fake') return 0;
  try {
    return await settlePendingPayments(SETTLE_AFTER_MS);
  } catch (error) {
    console.error('[worker] integration tick failed', error instanceof Error ? error.message : error);
    return 0;
  }
}
