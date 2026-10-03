import { NotConfiguredError, type ESignAdapter } from './types';

/**
 * Placeholder for a future hosted e-signature vendor (INTEGRATION_ESIGN=live). A vendor would take
 * over envelope delivery, signer identity and sealing; this stub documents that and fails loudly.
 */
const missing = () =>
  new NotConfiguredError('ESign', 'set INTEGRATION_ESIGN=native, or implement the vendor client in integrations/esign/live.ts and add its credentials');

export const liveESign: ESignAdapter = {
  mode: 'live',
  async seal() {
    throw missing();
  },
  verifyChain() {
    throw missing();
  },
};
