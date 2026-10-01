import { emailSchema } from '@matanho/shared';
import { decryptField, encryptField } from '../../lib/crypto';

/**
 * Field mapping for the public onboarding wizard (SRD 5.C, FR-ONB-029..032, 038).
 *
 * Two form generations post to the same API: the V56 wizard (short keys such as `name`,
 * `reg`, `country`) and the V65 wizard (`legalName`, `registrationRef`, `jurisdiction`, ...).
 * Typed columns get the values staff filter and decide on; every field, typed or not, is
 * kept in `formData` so nothing the applicant typed is lost. The tax id and the funding
 * account number are encrypted and never stored in `formData` in clear.
 */

/** Every input of the V65 wizard (`dataIds` in the prototype), in screen order. */
export const V65_FIELDS = [
  'investorType', 'legalName', 'registrationRef', 'jurisdiction', 'incorporationDate', 'regulatedStatus', 'regulator',
  'licenceRef', 'website', 'registeredAddress', 'relationship', 'mandate', 'initialInvestment', 'baseCurrency',
  'investorClassification', 'primaryEmail', 'primaryContact', 'telephone', 'purpose', 'ownershipNarrative',
  'authorityNarrative', 'pep', 'sanctions', 'adverseMedia', 'highRiskJurisdiction', 'sourceFunds', 'sourceWealth',
  'annualVolume', 'transactionFrequency', 'fundingJurisdictions', 'expectedCurrencies', 'sourceFundsNarrative',
  'expectedActivity', 'taxResidence', 'taxId', 'fatca', 'giin', 'crs', 'usIndicia', 'bankName', 'bankHolder',
  'bankCountry', 'bankAccount', 'swift', 'bankCurrency', 'evidenceNote', 'complianceContact', 'signatureName',
  'signatureCapacity',
] as const;

/** Fields the V65 wizard marks `required`, re-checked on submit (labels as on screen). */
export const V65_REQUIRED: [string, string][] = [
  ['legalName', 'Legal name'],
  ['registrationRef', 'Registration / identity number'],
  ['jurisdiction', 'Jurisdiction of incorporation / residence'],
  ['registeredAddress', 'Registered address'],
  ['primaryEmail', 'Primary contact email'],
  ['primaryContact', 'Primary contact name'],
  ['sourceFundsNarrative', 'Source of funds explanation'],
  ['expectedActivity', 'Expected account activity'],
  ['taxResidence', 'Primary tax residence'],
  ['bankName', 'Bank / financial institution'],
  ['bankHolder', 'Account holder'],
  ['bankCountry', 'Bank jurisdiction'],
  ['bankAccount', 'Account / IBAN reference'],
  ['signatureName', 'Authorised signatory name'],
  ['signatureCapacity', 'Capacity / title'],
];

const V56_MAP = {
  type: 'applicantType',
  name: 'legalName',
  reg: 'registrationRef',
  phone: 'phone',
  country: 'country',
  relationship: 'relationship',
  classification: 'classification',
  baseCurrency: 'baseCurrency',
  riskProfile: 'riskProfile',
  liquidityNeed: 'liquidityNeed',
  purpose: 'purpose',
  funds: 'sourceOfFunds',
  wealth: 'sourceOfWealth',
  taxResidence: 'taxResidence',
  taxStatus: 'taxStatus',
  pep: 'pep',
  bankJurisdiction: 'bankJurisdiction',
  signingAuthority: 'signingAuthority',
  activity: 'expectedActivity',
} as const;

const V65_MAP = {
  investorType: 'applicantType',
  legalName: 'legalName',
  registrationRef: 'registrationRef',
  telephone: 'phone',
  jurisdiction: 'country',
  relationship: 'relationship',
  investorClassification: 'classification',
  baseCurrency: 'baseCurrency',
  purpose: 'purpose',
  sourceWealth: 'sourceOfWealth',
  taxResidence: 'taxResidence',
  pep: 'pep',
  bankCountry: 'bankJurisdiction',
  expectedActivity: 'expectedActivity',
} as const;

const LIMITS: Record<string, number> = {
  applicantType: 64,
  legalName: 200,
  registrationRef: 80,
  phone: 40,
  country: 80,
  relationship: 80,
  classification: 80,
  baseCurrency: 8,
  riskProfile: 40,
  liquidityNeed: 40,
  taxResidence: 80,
  taxStatus: 80,
  pep: 16,
  bankJurisdiction: 80,
  signingAuthority: 160,
};

export interface Signatory {
  name: string;
  role: string;
  email: string;
}

export interface OwnerInput {
  name: string;
  nationality: string;
  id: string;
  pct: string;
}

/** Owners arrive as V56 `[name, id, pct]` tuples or V65 `{name, nationality, id, pct}` objects. */
export function normaliseOwners(owners: (string[] | Record<string, unknown>)[]): OwnerInput[] {
  return owners
    .map((o) =>
      Array.isArray(o)
        ? { name: o[0] ?? '', nationality: '', id: o[1] ?? '', pct: o[2] ?? '' }
        : {
            name: String(o.name ?? ''),
            nationality: String(o.nationality ?? ''),
            id: String(o.id ?? ''),
            pct: o.pct === undefined || o.pct === null ? '' : String(o.pct),
          },
    )
    .map((o) => ({ name: o.name.trim().slice(0, 160), nationality: o.nationality.trim().slice(0, 80), id: o.id.trim().slice(0, 80), pct: o.pct.trim() }))
    .filter((o) => o.name);
}

type Stored = Record<string, unknown>;

const cell = (v: string | undefined, column: string) => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, LIMITS[column] ?? 4000) : null;
};

/**
 * Builds the column update for a PATCH/submit. `existing` is the stored `formData`, used to
 * keep the encrypted funding account when the browser sends it blank (resumed drafts never
 * receive the clear value back).
 */
export function mapPublicForm(
  form: Record<string, string>,
  extras: { signatories?: Signatory[]; owners?: OwnerInput[] },
  existing: Stored | null,
): { data: Record<string, unknown>; formData: Stored } {
  const data: Record<string, unknown> = {};
  const v65 = form.formVersion === 'v65' || form.legalName !== undefined || form.primaryEmail !== undefined;

  for (const [field, column] of Object.entries(v65 ? V65_MAP : V56_MAP)) {
    if (form[field] !== undefined) data[column] = cell(form[field], column);
  }

  const email = v65 ? form.primaryEmail : form.email;
  if (email !== undefined) {
    const parsed = emailSchema.safeParse(email);
    if (parsed.success) data.email = parsed.data;
  }
  const amount = v65 ? form.initialInvestment : form.amount;
  if (amount !== undefined) {
    const n = Number(String(amount).replace(/[^\d.]/g, ''));
    data.expectedInvestment = Number.isFinite(n) && amount !== '' ? n : null;
  }
  if (form.taxId !== undefined && (form.taxId.trim() || !v65)) data.taxIdEnc = encryptField(form.taxId.trim());

  if (v65) {
    if (form.sourceFunds !== undefined || form.sourceFundsNarrative !== undefined) {
      data.sourceOfFunds = [form.sourceFunds, form.sourceFundsNarrative].map((s) => (s ?? '').trim()).filter(Boolean).join(' — ') || null;
    }
    if (form.fatca !== undefined || form.crs !== undefined) {
      data.taxStatus = cell([form.fatca && `FATCA: ${form.fatca}`, form.crs && `CRS: ${form.crs}`].filter(Boolean).join(' · '), 'taxStatus');
    }
    if (form.signatureName !== undefined || form.signatureCapacity !== undefined) {
      const name = (form.signatureName ?? '').trim();
      const cap = (form.signatureCapacity ?? '').trim();
      data.signingAuthority = cell(name && cap ? `${name} (${cap})` : name || cap, 'signingAuthority');
    }
  }

  const { taxId: _t, bankAccount, ...rest } = form;
  void _t;
  const formData: Stored = { ...rest };
  if (v65) formData.formVersion = 'v65';
  const prevAccount = typeof existing?.bankAccountEnc === 'string' ? existing.bankAccountEnc : null;
  const account = (bankAccount ?? '').trim();
  if (account) {
    formData.bankAccountEnc = encryptField(account);
    formData.bankAccountLast4 = account.slice(-4);
  } else if (prevAccount) {
    formData.bankAccountEnc = prevAccount;
    formData.bankAccountLast4 = existing?.bankAccountLast4 ?? null;
  }
  if (extras.signatories) {
    formData.signatories = extras.signatories
      .map((s) => ({ name: s.name.trim().slice(0, 160), role: s.role.trim().slice(0, 120), email: s.email.trim().slice(0, 254) }))
      .filter((s) => s.name);
  } else if (existing?.signatories) formData.signatories = existing.signatories;
  if (extras.owners) {
    // Owner id numbers live encrypted on beneficial_owners only.
    formData.owners = extras.owners.map((o) => ({ name: o.name, nationality: o.nationality, pct: o.pct }));
  } else if (existing?.owners) formData.owners = existing.owners;
  if (existing?.declaration) formData.declaration = existing.declaration;
  return { data, formData };
}

/** Draft view for the applicant: never returns the tax id or account number. */
export function applicantFormView(formData: Stored | null) {
  const { bankAccountEnc, bankAccountLast4: _l, owners: _o, signatories, declaration: _d, ...form } = formData ?? {};
  void _l;
  void _o;
  void _d;
  return {
    form: { ...(form as Record<string, string>), taxId: '', bankAccount: '' },
    bankAccountOnFile: typeof bankAccountEnc === 'string',
    signatories: Array.isArray(signatories) ? (signatories as Signatory[]) : [],
  };
}

export function v65Missing(formData: Stored | null, ownerCount: number): string[] {
  const f = (formData ?? {}) as Record<string, unknown>;
  if (f.formVersion !== 'v65') return [];
  const missing = V65_REQUIRED.filter(([k]) => {
    if (k === 'bankAccount') return typeof f.bankAccountEnc !== 'string';
    return !String(f[k] ?? '').trim();
  }).map(([, label]) => label);
  if (!ownerCount) missing.push('At least one beneficial owner or controller');
  const sigs = Array.isArray(f.signatories) ? f.signatories : [];
  if (!sigs.length) missing.push('At least one authorised signatory');
  return missing;
}

const SECTIONS: [string, [string, string][]][] = [
  ['Investor identity', [
    ['investorType', 'Investor type'], ['legalName', 'Legal name'], ['registrationRef', 'Registration / identity number'],
    ['jurisdiction', 'Jurisdiction'], ['incorporationDate', 'Date incorporated / date of birth'], ['regulatedStatus', 'Regulatory status'],
    ['regulator', 'Regulator'], ['licenceRef', 'Licence reference'], ['website', 'Website'], ['registeredAddress', 'Registered address'],
  ]],
  ['Investment relationship', [
    ['relationship', 'Relationship requested'], ['mandate', 'Fund / mandate'], ['initialInvestment', 'Expected investment'],
    ['baseCurrency', 'Base currency'], ['investorClassification', 'Investor classification'], ['primaryEmail', 'Primary contact email'],
    ['primaryContact', 'Primary contact name'], ['telephone', 'Telephone'], ['purpose', 'Relationship purpose'],
  ]],
  ['Ownership and authority', [['ownershipNarrative', 'Ownership structure'], ['authorityNarrative', 'Authority to invest']]],
  ['KYC / AML declarations', [
    ['pep', 'Politically exposed person'], ['sanctions', 'Sanctions exposure'], ['adverseMedia', 'Adverse media / legal matters'],
    ['highRiskJurisdiction', 'Enhanced-risk jurisdictions'], ['sourceFunds', 'Primary source of funds'], ['sourceWealth', 'Primary source of wealth'],
    ['annualVolume', 'Expected annual volume (USD eq.)'], ['transactionFrequency', 'Transaction frequency'],
    ['fundingJurisdictions', 'Funding jurisdictions'], ['expectedCurrencies', 'Expected currencies'],
    ['sourceFundsNarrative', 'Source of funds explanation'], ['expectedActivity', 'Expected account activity'],
  ]],
  ['Tax', [['taxResidence', 'Tax residence'], ['fatca', 'FATCA classification'], ['giin', 'GIIN'], ['crs', 'CRS classification'], ['usIndicia', 'US indicia']]],
  ['Funding account', [['bankName', 'Bank'], ['bankHolder', 'Account holder'], ['bankCountry', 'Bank jurisdiction'], ['swift', 'SWIFT / BIC'], ['bankCurrency', 'Account currency']]],
  ['Evidence notes', [['evidenceNote', 'Additional evidence / explanation'], ['complianceContact', 'Compliance contact']]],
  ['Electronic declaration', [['signatureName', 'Authorised signatory'], ['signatureCapacity', 'Capacity / title']]],
];

/**
 * Staff view of the submitted V65 form (admin KYC case): every field grouped as on screen,
 * the account number masked, owners with nationality, signatories and the declaration record.
 * Returns null for V56 / assisted applications.
 */
export function staffFormView(formData: Stored | null, taxIdEnc: string | null) {
  const f = (formData ?? {}) as Record<string, unknown>;
  if (f.formVersion !== 'v65') return null;
  const sections = SECTIONS.map(([title, fields]) => ({
    title,
    fields: fields.map(([key, label]) => ({ key, label, value: String(f[key] ?? '') })),
  }));
  const funding = sections.find((s) => s.title === 'Funding account')!;
  funding.fields.splice(3, 0, {
    key: 'bankAccount',
    label: 'Account / IBAN reference',
    value: typeof f.bankAccountEnc === 'string' ? `•••• ${String(f.bankAccountLast4 ?? '')}` : '',
  });
  const tax = sections.find((s) => s.title === 'Tax')!;
  tax.fields.splice(1, 0, { key: 'taxId', label: 'Tax identification number', value: taxIdEnc ? `•••• ${(decryptField(taxIdEnc) ?? '').slice(-3)}` : '' });
  return {
    version: 'v65',
    sections,
    owners: Array.isArray(f.owners) ? f.owners : [],
    signatories: Array.isArray(f.signatories) ? f.signatories : [],
    declaration: f.declaration ?? null,
  };
}
