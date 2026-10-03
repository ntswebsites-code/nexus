import type { AdapterBase, AdapterMeta } from '../core/types';

export interface FilingSubmission {
  regulator: string;
  formCode: string;
  filingRef: string;
  payloadSha256: string;
}
export interface FilingReceipt {
  receiptRef: string;
  status: 'ACKNOWLEDGED' | 'REJECTED';
  receivedAt: string;
}

export interface RegulatorFilingAdapter extends AdapterBase {
  submit(submission: FilingSubmission): Promise<FilingReceipt>;
}

export const meta: AdapterMeta = {
  name: 'regulator-filing',
  label: 'Regulator filing (SECZ / FIU)',
  gap: 'GAP-A12',
  description: 'Electronic submission of approved regulatory filings and receipt of the acknowledgement.',
  requiredEnv: ['REGULATOR_API_URL', 'REGULATOR_API_KEY'],
  vendorCalls: { submit: 'POST {REGULATOR_API_URL}/filings with form code, period and payload; store the acknowledgement reference' },
};
