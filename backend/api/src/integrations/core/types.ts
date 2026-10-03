import { HttpError } from '../../lib/errors';
import type { IntegrationMode, IntegrationName } from './names';

export interface HealthResult {
  ok: boolean;
  detail: string;
}

/** Every adapter exposes a cheap, side-effect-free health probe. */
export interface AdapterBase {
  health(): Promise<HealthResult>;
}

/** Thrown by `live` stubs (and by startup validation) when credentials or the vendor client are missing. */
export class NotConfiguredError extends HttpError {
  constructor(
    readonly adapter: IntegrationName,
    readonly requiredEnv: string[],
    message?: string,
  ) {
    super(503, 'integration_not_configured', message ?? `Integration '${adapter}' is not configured: set ${requiredEnv.join(', ')}`);
    this.name = 'NotConfiguredError';
  }
}

/** Thrown by fake adapters while a failure simulation is active. */
export class SimulatedFailureError extends HttpError {
  constructor(readonly adapter: IntegrationName) {
    super(502, 'integration_simulated_failure', `Simulated failure for integration '${adapter}'`);
    this.name = 'SimulatedFailureError';
  }
}

export interface AdapterMeta {
  name: IntegrationName;
  label: string;
  /** Gap-analysis id (GAP-A01 ...). */
  gap: string;
  description: string;
  /** Environment variables `live` mode needs. Startup refuses `live` while any is empty. */
  requiredEnv: string[];
  /** Extra variables a non-live real mode needs (for example `s3`). */
  modeRequiredEnv?: Partial<Record<IntegrationMode, string[]>>;
  /** One line per operation naming the vendor call the live class has to make. */
  vendorCalls: Record<string, string>;
  /** True when `fake` is an acceptable production setting (for example email with SMTP, local encrypted storage). */
  productionSafeFake?: (env: NodeJS.ProcessEnv) => boolean;
}

export type { IntegrationMode, IntegrationName };
