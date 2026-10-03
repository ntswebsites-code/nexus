import type { AdapterBase, AdapterMeta } from '../core/types';

export interface ScreeningInput {
  caseRef: string;
  legalName: string;
  ownerNames: string[];
  /** Applicant or any owner is a PEP. */
  pep: boolean;
  declaredSanctions: boolean;
  declaredAdverseMedia: boolean;
  country: string;
  taxResidence: string;
  expectedInvestment: number;
  documentsPresent: number;
}

export interface ScreeningCheck {
  type: 'sanctions' | 'pep' | 'adverse_media' | 'document';
  outcome: 'Clear' | 'Review' | 'Match';
  score: number;
}

export interface ScreeningOutput {
  provider: string;
  rawRef: string;
  risk: 'Low' | 'Medium' | 'High';
  results: ScreeningCheck[];
}

export interface ScreeningAdapter extends AdapterBase {
  /** Advisory only: the result never decides a case, a human reviews it. */
  screen(input: ScreeningInput): Promise<ScreeningOutput>;
}

export const meta: AdapterMeta = {
  name: 'screening',
  label: 'Sanctions / PEP screening',
  gap: 'GAP-A03',
  description: 'Sanctions, PEP, adverse media and document screening for KYC cases.',
  requiredEnv: ['SCREENING_API_URL', 'SCREENING_API_KEY'],
  vendorCalls: { screen: 'POST {SCREENING_API_URL}/screenings with entity and owners; map hits to sanctions/pep/adverse_media/document results' },
};
