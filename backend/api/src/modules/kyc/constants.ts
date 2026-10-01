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
} as const;

export type EvidenceSlot = keyof typeof EVIDENCE_SLOTS;
export const SLOT_KEYS = Object.keys(EVIDENCE_SLOTS) as EvidenceSlot[];

/** FR-ONB-004: individuals need three core documents, every other applicant type four. */
export function requiredSlots(applicantType: string | null | undefined): EvidenceSlot[] {
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
