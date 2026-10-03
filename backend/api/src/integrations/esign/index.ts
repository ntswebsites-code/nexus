import { liveESign } from './live';
import { nativeESign } from './native';
import type { ESignAdapter } from './types';

export * from './types';
export * from './chain';

/** `INTEGRATION_ESIGN=native|live` (default native). */
export function getESignAdapter(): ESignAdapter {
  return (process.env.INTEGRATION_ESIGN ?? 'native').trim().toLowerCase() === 'live' ? liveESign : nativeESign;
}
