import { afterEach, describe, expect, it } from 'vitest';
import { fmtSize } from '@/components/ui';
import { BANK_FIELDS, DEFAULT_FORM, holderMatches, INVESTOR_FIELDS, isEntity, KYC_FIELDS, STEPS, TAX_FIELDS } from '@/lib/fields';
import { clearSession, loadSession, saveSession, api, OnboardingApiError } from '@/lib/api';
import { fail, mockApi, raw } from '../_helpers';

afterEach(() => localStorage.clear());

describe('onboarding pure logic', () => {
  it('isEntity: every investor type except Individual / HNW is an entity (directors required)', () => {
    expect(isEntity('Individual / HNW')).toBe(false);
    for (const t of ['Institutional investor', 'Pension / provident fund', 'Corporate treasury', 'Investment company / family office', 'Trust / foundation', 'Fund / collective investment vehicle']) expect(isEntity(t)).toBe(true);
  });

  it('INO-024: holderMatches treats equal names (ignoring case and punctuation) and a shared first word as a match, blanks as no opinion, others as mismatch', () => {
    expect(holderMatches('Acme Holdings Ltd', 'ACME HOLDINGS LTD.')).toBe(true);
    expect(holderMatches('Acme Holdings Ltd', 'Acme Holdings (Pvt) Ltd')).toBe(true);
    expect(holderMatches('', 'Anyone')).toBe(true);
    expect(holderMatches('Acme', '')).toBe(true);
    expect(holderMatches('Acme Holdings Ltd', 'Someone Else Ltd')).toBe(false);
  });

  it('the six steps are in order and every required field is a text-bearing field of the SRD', () => {
    expect(STEPS.map((s) => s.key)).toEqual(['investor', 'ownership', 'kyc', 'tax', 'evidence', 'review']);
    const required = [...INVESTOR_FIELDS, ...KYC_FIELDS, ...TAX_FIELDS, ...BANK_FIELDS].filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(['legalName', 'registrationRef', 'jurisdiction', 'registeredAddress', 'primaryEmail', 'primaryContact', 'sourceFundsNarrative', 'expectedActivity', 'taxResidence', 'bankName', 'bankHolder', 'bankCountry', 'bankAccount']);
  });

  it('defaults: declarations start as No (never pre-declared), form version v65, no demo identity values', () => {
    for (const k of ['pep', 'sanctions', 'adverseMedia', 'highRiskJurisdiction']) expect(DEFAULT_FORM[k]).toBe('no');
    expect(DEFAULT_FORM.formVersion).toBe('v65');
    expect(DEFAULT_FORM.legalName).toBeUndefined();
    expect(DEFAULT_FORM.bankAccount).toBeUndefined();
  });

  it('fmtSize', () => {
    expect(fmtSize(0)).toBe('1 KB');
    expect(fmtSize(1536)).toBe('2 KB');
    expect(fmtSize(5 * 1048576)).toBe('5.0 MB');
    expect(fmtSize(undefined)).toBe('');
  });
});

describe('onboarding session storage and api client', () => {
  it('saves, loads and clears the session; corrupt data is ignored', () => {
    expect(loadSession()).toBeNull();
    saveSession({ id: 'a', token: 't' });
    expect(loadSession()).toEqual({ id: 'a', token: 't' });
    clearSession();
    expect(loadSession()).toBeNull();
    localStorage.setItem('matanho-onboarding-session-v1', '{not json');
    expect(loadSession()).toBeNull();
    localStorage.setItem('matanho-onboarding-session-v1', JSON.stringify({ id: 1 }));
    expect(loadSession()).toBeNull();
  });

  it('the client turns an error envelope into OnboardingApiError(status, code, message, details) and a network failure into code "network"', async () => {
    mockApi({ 'GET /api/v1/public/applications/x': fail(400, 'incomplete_application', 'Complete the missing items', { fields: ['Legal name'] }) });
    const e = await api.get('x', 't').catch((err) => err);
    expect(e).toBeInstanceOf(OnboardingApiError);
    expect(e).toMatchObject({ status: 400, code: 'incomplete_application', message: 'Complete the missing items', details: { fields: ['Legal name'] } });
    mockApi({});
    const n = await api.meta().catch((err) => err);
    expect(n).toMatchObject({ status: 0, code: 'network', message: 'Cannot reach the server. Check your connection and try again.' });
  });

  it('a plain error body without an envelope still produces a readable message', async () => {
    mockApi({ 'GET /api/v1/public/applications/x': raw({}, 502) });
    const e = await api.get('x', 't').catch((err) => err);
    expect(e).toMatchObject({ status: 502, code: 'error', message: 'Request failed (502)' });
  });
});
