import type { AdapterBase, AdapterMeta } from '../core/types';

export interface IdentityVerificationRequest {
  subjectName: string;
  documentType: string;
  documentNumber: string;
  country: string;
}

export interface IdentityVerificationResult {
  reference: string;
  status: 'VERIFIED' | 'REFER' | 'FAILED';
  checks: { name: string; passed: boolean }[];
}

export interface IdentityVerificationAdapter extends AdapterBase {
  verify(request: IdentityVerificationRequest): Promise<IdentityVerificationResult>;
}

export const meta: AdapterMeta = {
  name: 'identity-verification',
  label: 'Identity verification',
  gap: 'GAP-A03',
  description: 'Document and liveness verification for onboarding applicants and owners.',
  requiredEnv: ['IDV_API_URL', 'IDV_API_KEY'],
  vendorCalls: { verify: 'POST {IDV_API_URL}/verifications with document images or number; poll or webhook for the decision' },
};
