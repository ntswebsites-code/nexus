/** Evidence slots of the onboarding wizard (prototype v35 labels). */
export const EVIDENCE_SLOTS = {
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
} as const;

export type EvidenceSlot = keyof typeof EVIDENCE_SLOTS;
export const SLOT_KEYS = Object.keys(EVIDENCE_SLOTS) as EvidenceSlot[];

/** V65 public wizard evidence cards (`data-doc-input`) -> API slot. */
export const V65_SLOT_MAP: Record<string, EvidenceSlot> = {
  legal: 'doc1',
  registry: 'doc9',
  ownership: 'doc4',
  identity: 'doc10',
  address: 'doc2',
  bank: 'doc5',
  funds: 'doc3',
  tax: 'doc6',
  authority: 'doc7',
  subscription: 'doc8',
  additional: 'doc11',
};

/** Investor types offered by the V65 public wizard. */
export const V65_INVESTOR_TYPES = [
  'Institutional investor',
  'Pension / provident fund',
  'Corporate treasury',
  'Investment company / family office',
  'Trust / foundation',
  'Fund / collective investment vehicle',
  'Individual / HNW',
] as const;

/**
 * FR-ONB-004. V65 investor types use the SRD 5.C.5 target sets (Q-163 default): individuals
 * legal, identity, address, bank, funds, tax; every entity type adds registry, ownership and
 * authority. Older applicant types keep the V56 rule (three core documents for individuals,
 * four otherwise).
 */
export function requiredSlots(applicantType: string | null | undefined): EvidenceSlot[] {
  if (applicantType === 'Individual / HNW') return ['doc1', 'doc10', 'doc2', 'doc5', 'doc3', 'doc6'];
  if ((V65_INVESTOR_TYPES as readonly string[]).includes(applicantType ?? '')) {
    return ['doc1', 'doc9', 'doc4', 'doc10', 'doc2', 'doc5', 'doc3', 'doc6', 'doc7'];
  }
  return applicantType === 'Individual' ? ['doc1', 'doc2', 'doc3'] : ['doc1', 'doc2', 'doc3', 'doc4'];
}

/** SRD 7.1 state machine. */
export const KYC_STAGES = [
  'Submitted',
  'Screening',
  'ComplianceReview',
  'ClientAction',
  'EnhancedReview',
  'Approved',
  'Rejected',
  'Activation',
  'Active',
] as const;
export type KycStage = (typeof KYC_STAGES)[number];

/** Transitions available through the generic `advance` endpoint. Decisions and activation have their own routes. */
export const MANUAL_TRANSITIONS: Partial<Record<KycStage, KycStage[]>> = {
  Submitted: ['Screening'],
  Screening: ['ComplianceReview'],
  ComplianceReview: ['ClientAction'],
  ClientAction: ['ComplianceReview'],
  EnhancedReview: ['ComplianceReview'],
};

export const STAGE_LABELS: Record<KycStage, string> = {
  Submitted: 'Submitted',
  Screening: 'Screening',
  ComplianceReview: 'Compliance review',
  ClientAction: 'Client action',
  EnhancedReview: 'Enhanced review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Activation: 'Activation',
  Active: 'Active',
};

/** SLA per stage in hours (SRD 13.3 default: two business days for review). */
export const STAGE_SLA_HOURS: Partial<Record<KycStage, number>> = {
  Submitted: 4,
  Screening: 4,
  ComplianceReview: 48,
  ClientAction: 120,
  EnhancedReview: 72,
  Approved: 24,
  Activation: 72,
};

export function slaDue(stage: KycStage, from = new Date()): Date | null {
  const h = STAGE_SLA_HOURS[stage];
  return h ? new Date(from.getTime() + h * 3_600_000) : null;
}

/** High-risk jurisdictions used by the screening stub's risk rating. */
export const HIGH_RISK_COUNTRIES = ['iran', 'north korea', 'myanmar', 'syria', 'russia', 'belarus'];

/** Names that make the screening stub return a potential sanctions match (for demos and tests). */
export const STUB_WATCHLIST = ['test sanctions match', 'ivan sanctioned', 'blocked person'];
