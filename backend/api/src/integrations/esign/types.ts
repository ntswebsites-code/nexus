import type { AdapterBase, AdapterMeta } from '../core/types';

export interface EsignRequest {
  documentName: string;
  documentSha256: string;
  signers: { name: string; email: string }[];
}
export interface EsignEnvelope {
  envelopeId: string;
  status: 'SENT' | 'COMPLETED' | 'VOIDED';
  /** Set once completed: a stored file holding the completion certificate. */
  certificateFileId: string | null;
}

export interface EsignAdapter extends AdapterBase {
  createEnvelope(request: EsignRequest): Promise<EsignEnvelope>;
  getEnvelope(input: { envelopeId: string }): Promise<EsignEnvelope>;
}

export const meta: AdapterMeta = {
  name: 'esign',
  label: 'E-signature',
  gap: 'GAP-A07',
  description: 'Signature envelopes for term sheets and subscription documents, with completion certificates.',
  requiredEnv: ['ESIGN_API_URL', 'ESIGN_API_KEY'],
  vendorCalls: {
    createEnvelope: 'POST {ESIGN_API_URL}/envelopes with the document hash and signers',
    getEnvelope: 'GET {ESIGN_API_URL}/envelopes/{id}; download the completion certificate when COMPLETED',
  },
};
