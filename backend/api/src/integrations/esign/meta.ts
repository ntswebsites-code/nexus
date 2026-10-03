import type { AdapterMeta } from '../core/types';

export const meta: AdapterMeta = {
  name: 'esign',
  label: 'E-signature',
  gap: 'GAP-A07',
  description: 'Native e-signature: hash-chained signatures, sealed PDF and certificate of completion. `live` is a hosted-vendor stub.',
  requiredEnv: [],
  vendorCalls: { seal: 'Hosted e-sign vendor: create envelope, collect signatures, download sealed PDF and certificate' },
  productionSafeFake: () => false,
};
