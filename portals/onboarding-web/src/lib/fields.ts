/** Data-driven field definitions for the application wizard (SRD 5.C steps 1, 3 and 4). Keys match the API form keys. */

export interface Field {
  key: string;
  label: string;
  type?: 'text' | 'email' | 'date' | 'number' | 'url' | 'textarea' | 'select';
  options?: string[];
  required?: boolean;
  wide?: boolean;
  hint?: string;
  placeholder?: string;
  /** Hide for individuals. */
  entityOnly?: boolean;
}

const CCY = ['USD', 'ZWG', 'ZAR', 'GBP', 'EUR'];
const YES_NO = [
  { v: 'no', l: 'No' },
  { v: 'yes', l: 'Yes / possible' },
  { v: 'unknown', l: 'Unsure' },
];
export const DECLARATIONS = [
  { key: 'pep', title: 'Politically exposed person (PEP)', help: 'Applicant, owner, controller or close associate.' },
  { key: 'sanctions', title: 'Sanctions exposure', help: 'Known current or historic sanctions designation or restriction.' },
  { key: 'adverseMedia', title: 'Adverse media / legal matters', help: 'Material fraud, corruption, financial-crime or regulatory concerns.' },
  { key: 'highRiskJurisdiction', title: 'Enhanced-risk jurisdictions', help: 'Material business, ownership or funds nexus requiring enhanced due diligence.' },
];
export const DECLARATION_OPTIONS = YES_NO;

export const STEPS = [
  { key: 'investor', title: 'Investor', sub: 'Profile & relationship' },
  { key: 'ownership', title: 'Ownership', sub: 'UBOs, directors, signatories' },
  { key: 'kyc', title: 'KYC / AML', sub: 'Funds & declarations' },
  { key: 'tax', title: 'Tax & bank', sub: 'Tax + funding account' },
  { key: 'evidence', title: 'Evidence', sub: 'Documents' },
  { key: 'review', title: 'Review', sub: 'Declare & submit' },
] as const;
export type StepKey = (typeof STEPS)[number]['key'];

export const STEP_HELP: Record<StepKey, [string, string]> = {
  investor: ['Investor profile', 'Tell us who the investor is and what relationship is being requested.'],
  ownership: ['Ownership and authority', 'Identify the people who ultimately own, control and are authorised to act for the investor.'],
  kyc: ['KYC / AML declarations', 'Economic purpose, source of funds, source of wealth and risk declarations used in due diligence.'],
  tax: ['Tax and bank verification', 'FATCA / CRS classification and the bank account used for funding.'],
  evidence: ['Supporting evidence', 'Upload original documents. Every file is scanned for malware before it is stored.'],
  review: ['Review and submit', 'Check the application pack and make the authorised declaration.'],
};

export const INVESTOR_FIELDS: Field[] = [
  { key: 'legalName', label: 'Legal name', required: true },
  { key: 'registrationRef', label: 'Registration / identity number', required: true },
  { key: 'jurisdiction', label: 'Jurisdiction of incorporation / residence', required: true },
  { key: 'incorporationDate', label: 'Date incorporated / date of birth', type: 'date' },
  { key: 'regulatedStatus', label: 'Regulatory status', type: 'select', entityOnly: true, options: ['Not a regulated financial institution', 'Regulated financial institution', 'Pension / retirement arrangement', 'Government / public institution', 'Other regulated entity'] },
  { key: 'regulator', label: 'Regulator / supervisory body', hint: 'if applicable', entityOnly: true },
  { key: 'licenceRef', label: 'Licence / registration reference', hint: 'if applicable', entityOnly: true },
  { key: 'website', label: 'Website', type: 'url', hint: 'optional', placeholder: 'https://' },
  { key: 'registeredAddress', label: 'Registered / residential address', type: 'textarea', required: true, wide: true },
  { key: 'relationship', label: 'Relationship requested', type: 'select', options: ['Discretionary managed account', 'Fund / LP subscription', 'Segregated mandate', 'Advisory relationship', 'Cash / liquidity mandate'] },
  { key: 'mandate', label: 'Fund / mandate' },
  { key: 'initialInvestment', label: 'Expected commitment / initial investment', type: 'number' },
  { key: 'baseCurrency', label: 'Base currency', type: 'select', options: CCY },
  { key: 'investorClassification', label: 'Investor classification', type: 'select', options: ['Institutional / professional investor', 'Qualified / sophisticated investor', 'Retail / individual investor', 'To be confirmed by Compliance'] },
  { key: 'primaryEmail', label: 'Primary contact email', type: 'email', required: true },
  { key: 'primaryContact', label: 'Primary contact name', required: true },
  { key: 'telephone', label: 'Telephone' },
  { key: 'purpose', label: 'Relationship purpose', type: 'select', options: ['Long-term capital growth', 'Income / preservation', 'Liquidity management', 'Pension / liability matching', 'Strategic allocation', 'Other'] },
];

export const OWNERSHIP_NARRATIVES: Field[] = [
  { key: 'ownershipNarrative', label: 'Ownership structure description', type: 'textarea', entityOnly: true, placeholder: 'Parent entities, trustees, beneficiaries, controllers, nominee arrangements.' },
  { key: 'authorityNarrative', label: 'Authority to invest', type: 'textarea', entityOnly: true, placeholder: 'Board / trustee / investment committee authority and signing rules.' },
];

export const KYC_FIELDS: Field[] = [
  { key: 'sourceFunds', label: 'Primary source of funds', type: 'select', options: ['Operating revenue / treasury funds', 'Investment proceeds', 'Pension contributions / member assets', 'Sale of business / asset', 'Employment / professional income', 'Inheritance / family wealth', 'Capital call / investor contributions', 'Other'] },
  { key: 'sourceWealth', label: 'Primary source of wealth / capital', type: 'select', options: ['Business / operating activity', 'Investments / accumulated savings', 'Pension / institutional assets', 'Property / asset ownership', 'Inheritance / family capital', 'Other'] },
  { key: 'annualVolume', label: 'Expected annual transaction volume (USD eq.)', type: 'number' },
  { key: 'transactionFrequency', label: 'Expected transaction frequency', type: 'select', options: ['Monthly or less', '2-5 per month', 'Weekly', 'Daily / treasury activity'] },
  { key: 'fundingJurisdictions', label: 'Primary funding jurisdictions' },
  { key: 'expectedCurrencies', label: 'Primary investment / payment currencies' },
  { key: 'sourceFundsNarrative', label: 'Source of funds explanation', type: 'textarea', required: true, wide: true, placeholder: 'Where the money for this investment comes from and the activity that generated it.' },
  { key: 'expectedActivity', label: 'Expected account activity', type: 'textarea', required: true, wide: true, placeholder: 'Expected subscriptions, withdrawals, transfers, counterparties and cross-border activity.' },
];

export const TAX_FIELDS: Field[] = [
  { key: 'taxResidence', label: 'Primary tax residence', required: true },
  { key: 'taxId', label: 'Tax identification number', hint: 'stored encrypted' },
  { key: 'fatca', label: 'FATCA classification', type: 'select', options: ['Non-US entity / individual', 'Participating FFI', 'Active NFFE', 'Passive NFFE', 'US person / US entity', 'To be confirmed'] },
  { key: 'giin', label: 'GIIN', hint: 'if applicable', entityOnly: true },
  { key: 'crs', label: 'CRS classification', type: 'select', options: ['Financial institution', 'Active non-financial entity', 'Passive non-financial entity', 'Individual', 'To be confirmed'] },
  { key: 'usIndicia', label: 'US indicia present?', type: 'select', options: ['no', 'yes'] },
];
export const BANK_FIELDS: Field[] = [
  { key: 'bankName', label: 'Bank / financial institution', required: true },
  { key: 'bankHolder', label: 'Account holder', required: true },
  { key: 'bankCountry', label: 'Bank jurisdiction', required: true },
  { key: 'bankAccount', label: 'Account / IBAN reference', required: true, hint: 'stored encrypted' },
  { key: 'swift', label: 'SWIFT / BIC', hint: 'if applicable' },
  { key: 'bankCurrency', label: 'Account currency', type: 'select', options: CCY },
];

export const DEFAULT_FORM: Record<string, string> = {
  formVersion: 'v65',
  investorType: 'Institutional investor',
  jurisdiction: 'Zimbabwe',
  regulatedStatus: 'Not a regulated financial institution',
  relationship: 'Discretionary managed account',
  baseCurrency: 'USD',
  investorClassification: 'Institutional / professional investor',
  purpose: 'Long-term capital growth',
  pep: 'no',
  sanctions: 'no',
  adverseMedia: 'no',
  highRiskJurisdiction: 'no',
  sourceFunds: 'Operating revenue / treasury funds',
  sourceWealth: 'Business / operating activity',
  transactionFrequency: 'Monthly or less',
  taxResidence: 'Zimbabwe',
  fatca: 'Non-US entity / individual',
  crs: 'Financial institution',
  usIndicia: 'no',
  bankCountry: 'Zimbabwe',
  bankCurrency: 'USD',
};

export const isEntity = (investorType: string) => investorType !== 'Individual / HNW';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const holderMatches = (legal: string, holder: string) => {
  const a = norm(legal);
  const b = norm(holder);
  return !a || !b || a === b || b.includes(a.split(' ')[0]!);
};
