import { instrument } from '../core/calls';
import { withHealth } from '../core/adapt';
import { fakeESign } from './fake';
import { liveESign } from './live';
import { nativeESign } from './native';
import type { ESignAdapter } from './types';

export * from './types';
export * from './chain';
export * from './stamp';
export { meta } from './meta';

export type ESignMode = 'native' | 'fake' | 'live';
export const esignMode = (env: NodeJS.ProcessEnv = process.env): ESignMode => {
  const v = (env.INTEGRATION_ESIGN ?? 'native').trim().toLowerCase();
  return v === 'live' || v === 'fake' ? v : 'native';
};

const IMPLS: Record<ESignMode, ESignAdapter> = { native: nativeESign, fake: fakeESign, live: liveESign };

/** Registry-ready adapter for a mode: carries `health()`. */
export const esignFor = (mode: ESignMode) =>
  withHealth(IMPLS[mode], () =>
    mode === 'live'
      ? { ok: false, detail: 'No hosted e-sign vendor client in this build' }
      : { ok: true, detail: mode === 'native' ? 'Native sealing (pdf-lib), hash-chained signatures' : 'Simulated sealing (not legally binding)' },
  );

/** `INTEGRATION_ESIGN=native|fake|live` (default native). Sealing is logged to `integration_calls`. */
export function getESignAdapter(): ESignAdapter {
  const mode = esignMode();
  return instrument('esign', mode, esignFor(mode), ['seal']);
}
