import type { AdapterMeta } from '../core/types';
import { CUSTODIAN_LIVE_REQUIRED_ENV } from './live';

export const meta: AdapterMeta = {
  name: 'custodian-feed',
  label: 'Custodian feed (file drop / SWIFT)',
  gap: 'GAP-A05',
  description: 'Custodian statements. `file-drop` ingests admin-uploaded CSV/MT940/JSON files; `live` is a SWIFT/API stub.',
  requiredEnv: CUSTODIAN_LIVE_REQUIRED_ENV,
  vendorCalls: { listStatements: 'SWIFT MT535/MT940 or custodian REST API: list statements', fetchHoldings: 'MT535 holdings', fetchTransactions: 'MT536 transactions' },
};
