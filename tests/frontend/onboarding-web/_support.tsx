import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { screen, within } from '../_helpers';

export const P = '/api/v1/public';
export const SESSION_KEY = 'matanho-onboarding-session-v1';

export const SLOTS = {
  doc1: 'Identity / legal existence',
  doc2: 'Address evidence',
  doc3: 'Source of funds',
  doc4: 'Ownership structure',
  doc5: 'Bank verification',
  doc6: 'Tax / FATCA / CRS',
  doc7: 'Authority to invest',
  doc8: 'Investment mandate',
  doc9: 'Registry / constitutional extract',
  doc10: 'Owners / signatories ID',
  doc11: 'Additional supporting evidence',
};
export const ENTITY_SLOTS = ['doc1', 'doc9', 'doc4', 'doc10', 'doc2', 'doc5', 'doc3', 'doc6', 'doc7'];
export const INDIVIDUAL_SLOTS = ['doc1', 'doc10', 'doc2', 'doc5', 'doc3', 'doc6'];
const TYPES = ['Institutional investor', 'Pension / provident fund', 'Corporate treasury', 'Investment company / family office', 'Trust / foundation', 'Fund / collective investment vehicle', 'Individual / HNW'];

/** Real shape of GET /public/onboarding/meta (public-extra.routes.ts) */
export const meta = {
  investorTypes: TYPES.map((t) => ({ value: t, entity: t !== 'Individual / HNW', requiredSlots: t === 'Individual / HNW' ? INDIVIDUAL_SLOTS : ENTITY_SLOTS })),
  slots: Object.entries(SLOTS).map(([key, label]) => ({ key, label })),
  maxUploadMb: 10,
  acceptedFileTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
};

export const evidenceRow = (slot: keyof typeof SLOTS, received = false, over: Record<string, unknown> = {}) => ({
  slot,
  label: SLOTS[slot],
  status: received ? 'Received' : 'Missing',
  name: received ? `${slot}.pdf` : null,
  size: received ? 20480 : null,
  mime: received ? 'application/pdf' : null,
  sha256: received ? 'ab'.repeat(32) : null,
  scanStatus: received ? 'clean' : null,
  ...over,
});

/** Real shape of GET /public/applications/:id -> { application } (public.routes.ts view()) */
export function application(over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    ref: null,
    status: 'Draft',
    email: 'cfo@example.test',
    form: { formVersion: 'v65', investorType: 'Institutional investor', jurisdiction: 'Zimbabwe', primaryEmail: 'cfo@example.test' },
    taxIdOnFile: false,
    bankAccountOnFile: false,
    ownerDetails: [],
    signatories: [],
    directors: [],
    evidence: ENTITY_SLOTS.map((s) => evidenceRow(s as keyof typeof SLOTS)),
    requiredSlots: ENTITY_SLOTS,
    requestedSlots: [],
    caseStage: null,
    ...over,
  };
}

export const filledForm = {
  formVersion: 'v65',
  investorType: 'Institutional investor',
  legalName: 'Acme Holdings Ltd',
  registrationRef: 'REG-12345',
  jurisdiction: 'Zimbabwe',
  registeredAddress: '1 Samora Machel Ave, Harare',
  primaryEmail: 'cfo@example.test',
  primaryContact: 'Chipo Moyo',
  sourceFundsNarrative: 'Operating revenue from agricultural exports',
  expectedActivity: 'Quarterly subscriptions',
  taxResidence: 'Zimbabwe',
  bankName: 'Stanbic Bank',
  bankHolder: 'Acme Holdings Ltd',
  bankCountry: 'Zimbabwe',
  bankAccount: '0123456789',
  signatureName: '',
  signatureCapacity: '',
};

export function seedSession(id = 'app-1', token = 'tok-123') {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ id, token }));
}
export const storedSession = () => JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');

/** userEvent with applyAccept off lets a test model a file the picker's filter did not stop (drag and drop, "All files"). */
export const userAnyFile = () => userEvent.setup({ applyAccept: false });

export function renderApp(ui: ReactElement, user = userEvent.setup()) {
  return { user, ...render(ui) };
}

export function stubLocation(search = '') {
  const replace = vi.fn();
  const assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/', search, replace, assign, href: `http://localhost/${search}`, origin: 'http://localhost' } });
  return { replace, assign };
}

export const pdf = (name = 'doc.pdf', size = 2048) => new File([new Uint8Array(size).fill(0x25)], name, { type: 'application/pdf' });

/** The nth heading of the active wizard step. */
export const stepHeading = () => screen.getByRole('heading', { level: 2 });
export const rail = () => within(screen.getByRole('navigation', { name: 'Application steps' }));
