import { describe, expect, it } from 'vitest';

/** Mirrors backend computeReadinessScore weights (V65 SRD 5.C.0). */
function score(args: {
  form: Record<string, string>;
  bankAccountOnFile: boolean;
  ownerCount: number;
  signatoryCount: number;
  requiredSlotCount: number;
  uploadedRequired: number;
  triageRun: boolean;
}): number {
  const core = ['legalName', 'registrationRef', 'jurisdiction', 'registeredAddress', 'primaryEmail', 'primaryContact', 'sourceFundsNarrative', 'expectedActivity', 'taxResidence', 'bankName', 'bankHolder', 'bankCountry'];
  const coreFilled = core.filter((k) => String(args.form[k] ?? '').trim()).length;
  const bankOk = args.bankAccountOnFile || String(args.form.bankAccount ?? '').trim() ? 1 : 0;
  const fieldComplete = (coreFilled + bankOk) / (core.length + 1);
  const uploaded = args.requiredSlotCount ? args.uploadedRequired / args.requiredSlotCount : 0;
  const owners = args.ownerCount > 0 ? 1 : 0;
  const signatories = args.signatoryCount > 0 ? 1 : 0;
  const triage = args.triageRun ? 1 : 0;
  return Math.min(100, Math.max(0, Math.round((fieldComplete * 0.42 + uploaded * 0.34 + owners * 0.12 + signatories * 0.07 + triage * 0.05) * 100)));
}

describe('onboarding readiness score (V65 formula)', () => {
  const fullForm = {
    legalName: 'Acme',
    registrationRef: 'R1',
    jurisdiction: 'ZW',
    registeredAddress: '1 Main',
    primaryEmail: 'a@b.test',
    primaryContact: 'Jane',
    sourceFundsNarrative: 'Revenue',
    expectedActivity: 'Quarterly',
    taxResidence: 'ZW',
    bankName: 'Bank',
    bankHolder: 'Acme',
    bankCountry: 'ZW',
    bankAccount: '123',
  };

  it('returns 0 for an empty draft and 100 when every component is complete', () => {
    expect(score({ form: {}, bankAccountOnFile: false, ownerCount: 0, signatoryCount: 0, requiredSlotCount: 9, uploadedRequired: 0, triageRun: false })).toBe(0);
    expect(score({ form: fullForm, bankAccountOnFile: false, ownerCount: 1, signatoryCount: 1, requiredSlotCount: 9, uploadedRequired: 9, triageRun: true })).toBe(100);
  });

  it('weights evidence and owners per the published formula', () => {
    expect(score({ form: fullForm, bankAccountOnFile: true, ownerCount: 1, signatoryCount: 0, requiredSlotCount: 10, uploadedRequired: 5, triageRun: false })).toBe(71);
  });
});
