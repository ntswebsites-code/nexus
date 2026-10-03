import type { AdapterBase, AdapterMeta } from '../core/types';

export interface PaymentInstruction {
  /** Caller's idempotency reference (for example a distribution payment ref). Repeating it returns the same payment. */
  reference: string;
  amount: string;
  currency: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  purpose?: string;
}
export type PaymentStatus = 'PENDING' | 'SETTLED' | 'FAILED';
export interface PaymentResult {
  paymentRef: string;
  status: PaymentStatus;
}

export interface PaymentAdapter extends AdapterBase {
  instruct(instruction: PaymentInstruction): Promise<PaymentResult>;
  getStatus(input: { paymentRef: string }): Promise<PaymentResult>;
}

export const meta: AdapterMeta = {
  name: 'payment',
  label: 'Payments / bank payouts',
  gap: 'GAP-A06',
  description: 'Payout instructions for distributions and status tracking.',
  requiredEnv: ['PAYMENT_API_URL', 'PAYMENT_API_KEY'],
  vendorCalls: {
    instruct: 'POST {PAYMENT_API_URL}/payments (bulk or single) with Idempotency-Key = reference',
    getStatus: 'GET {PAYMENT_API_URL}/payments/{paymentRef} or webhook callback',
  },
};
