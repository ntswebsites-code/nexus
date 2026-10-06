import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { getLlmAdapter } from '../../integrations/llm';
import type { TriageInput, TriageResult } from '../../integrations/llm/types';
import { prisma } from '../../lib/prisma';
import { applicantFormView, v65Missing } from './public-form';
import { EVIDENCE_SLOTS, requiredSlots } from './constants';

/** Core fields used in the V65 readiness formula (SRD 5.C.0). */
const CORE_FIELDS = [
  'legalName',
  'registrationRef',
  'jurisdiction',
  'registeredAddress',
  'primaryEmail',
  'primaryContact',
  'sourceFundsNarrative',
  'expectedActivity',
  'taxResidence',
  'bankName',
  'bankHolder',
  'bankCountry',
] as const;

export interface ReadinessCheck {
  name: string;
  state: 'good' | 'warn' | 'neutral';
  detail: string;
  right: string;
}

export interface StoredDraftTriage extends TriageResult {
  inputSha256: string;
  at: string;
  advisory: true;
}

export interface ReadinessView {
  score: number;
  checks: ReadinessCheck[];
  riskBand: 'Pending' | 'LOW' | 'MEDIUM' | 'HIGH';
  triageRun: boolean;
  triage: Omit<StoredDraftTriage, 'inputSha256'> | null;
}

type DraftApp = {
  id: string;
  ref: string | null;
  applicantType: string;
  legalName: string | null;
  email: string;
  country: string | null;
  expectedInvestment: { toNumber(): number } | null;
  pep: string | null;
  sourceOfFunds: string | null;
  formData: unknown;
  owners: { fullName: string }[];
};

type EvidenceRow = { slot: string; name: string | null };

function normaliseName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function computeReadinessScore(args: {
  form: Record<string, string>;
  bankAccountOnFile: boolean;
  ownerCount: number;
  signatoryCount: number;
  requiredSlotCount: number;
  uploadedRequired: number;
  triageRun: boolean;
}): number {
  const coreFilled = CORE_FIELDS.filter((k) => String(args.form[k] ?? '').trim()).length;
  const bankOk = args.bankAccountOnFile || String(args.form.bankAccount ?? '').trim() ? 1 : 0;
  const fieldComplete = (coreFilled + bankOk) / (CORE_FIELDS.length + 1);
  const uploaded = args.requiredSlotCount ? args.uploadedRequired / args.requiredSlotCount : 0;
  const owners = args.ownerCount > 0 ? 1 : 0;
  const signatories = args.signatoryCount > 0 ? 1 : 0;
  const triage = args.triageRun ? 1 : 0;
  return Math.min(100, Math.max(0, Math.round((fieldComplete * 0.42 + uploaded * 0.34 + owners * 0.12 + signatories * 0.07 + triage * 0.05) * 100)));
}

function riskPreview(app: DraftApp, missingEvidence: string[]) {
  let score = 0;
  const factors: string[] = [];
  if (app.pep && !/^(no|none|false)$/i.test(app.pep)) {
    score += 35;
    factors.push('PEP declared');
  }
  if (missingEvidence.length) {
    score += Math.min(25, missingEvidence.length * 5);
    factors.push('Missing evidence');
  }
  if ((app.expectedInvestment?.toNumber() ?? 0) >= 1_000_000) {
    score += 20;
    factors.push('Large expected investment');
  }
  if (!app.sourceOfFunds?.trim()) {
    score += 10;
    factors.push('No source of funds on file');
  }
  const rating = score >= 55 ? 'High' : score >= 25 ? 'Medium' : 'Low';
  return { score, rating, factors };
}

export function buildTriageInput(app: DraftApp, evidence: EvidenceRow[]): TriageInput {
  const stored = app.formData as Record<string, unknown> | null;
  const { form, signatories } = applicantFormView(stored);
  const slots = requiredSlots(app.applicantType);
  const have = new Set(evidence.filter((e) => e.name).map((e) => e.slot));
  const missingEvidence = slots.filter((s) => !have.has(s)).map((s) => EVIDENCE_SLOTS[s]);
  const preview = riskPreview(app, missingEvidence);
  const namedOwners = app.owners.filter((o) => o.fullName.trim()).length;
  const namedSignatories = signatories.filter((s) => s.name.trim()).length;
  return {
    caseRef: app.ref ?? `DRAFT-${app.id.slice(0, 8)}`,
    applicant: {
      name: app.legalName ?? form.legalName ?? app.email,
      type: app.applicantType,
      country: app.country ?? form.jurisdiction ?? null,
      pep: app.pep ?? form.pep ?? null,
      sourceOfFunds: app.sourceOfFunds ?? form.sourceFundsNarrative ?? null,
      expectedInvestment: app.expectedInvestment?.toNumber() ?? (form.initialInvestment ? Number(form.initialInvestment) : null),
      owners: namedOwners,
    },
    checks: [],
    riskPreview: preview,
    openReferrals: [],
    missingEvidence,
    blockers: v65Missing(stored, namedOwners, app.applicantType),
  };
}

function buildChecks(args: {
  form: Record<string, string>;
  bankAccountOnFile: boolean;
  ownerCount: number;
  signatoryCount: number;
  requiredSlotCount: number;
  uploadedRequired: number;
  missingEvidence: string[];
  triage: StoredDraftTriage | null;
}): ReadinessCheck[] {
  const bankMatch =
    !args.form.legalName || !args.form.bankHolder
      ? null
      : normaliseName(args.form.legalName) === normaliseName(args.form.bankHolder) ||
        normaliseName(args.form.bankHolder).includes(normaliseName(args.form.legalName).split(' ')[0] ?? '');
  const coreOk = CORE_FIELDS.every((k) => String(args.form[k] ?? '').trim()) && (args.bankAccountOnFile || String(args.form.bankAccount ?? '').trim());
  return [
    {
      name: 'Core application',
      state: coreOk ? 'good' : 'warn',
      detail: args.form.legalName ? 'Profile captured' : 'Legal profile incomplete',
      right: args.form.registrationRef ? 'Ready' : 'Incomplete',
    },
    {
      name: 'Beneficial ownership',
      state: args.ownerCount > 0 ? 'good' : 'warn',
      detail: args.ownerCount ? `${args.ownerCount} person(s) captured` : 'Owner / controller required',
      right: args.ownerCount > 0 ? 'Captured' : 'Required',
    },
    {
      name: 'Required evidence',
      state: args.missingEvidence.length ? 'warn' : 'good',
      detail: args.missingEvidence.length ? `${args.missingEvidence.length} required document(s) outstanding` : 'Required evidence uploaded',
      right: `${args.uploadedRequired}/${args.requiredSlotCount}`,
    },
    {
      name: 'Authorised signatories',
      state: args.signatoryCount > 0 ? 'good' : 'warn',
      detail: args.signatoryCount ? `${args.signatoryCount} signatory(ies) captured` : 'At least one signatory required',
      right: args.signatoryCount > 0 ? 'Captured' : 'Required',
    },
    {
      name: 'Bank holder consistency',
      state: bankMatch === true ? 'good' : bankMatch === false ? 'warn' : 'neutral',
      detail:
        bankMatch === true
          ? 'Holder broadly aligns to legal name'
          : bankMatch === false
            ? 'Possible name mismatch — human review required'
            : 'Waiting for bank details',
      right: bankMatch === false ? 'Review' : bankMatch === true ? 'Pass' : 'Pending',
    },
    {
      name: 'AI-assisted triage',
      state: args.triage ? (args.triage.riskBand === 'LOW' ? 'good' : 'warn') : 'neutral',
      detail: args.triage ? args.triage.summary.slice(0, 120) : 'Run pre-screen when the draft is ready',
      right: args.triage ? `${args.triage.riskBand} risk` : 'Optional',
    },
    {
      name: 'Human compliance decision',
      state: 'neutral',
      detail: 'Required before account activation',
      right: 'Mandatory',
    },
  ];
}

export function applicationReadiness(app: DraftApp, evidence: EvidenceRow[]): ReadinessView {
  const stored = app.formData as Record<string, unknown> | null;
  const { form, bankAccountOnFile, signatories } = applicantFormView(stored);
  const slots = requiredSlots(app.applicantType);
  const have = new Set(evidence.filter((e) => e.name).map((e) => e.slot));
  const uploadedRequired = slots.filter((s) => have.has(s)).length;
  const missingEvidence = slots.filter((s) => !have.has(s)).map((s) => EVIDENCE_SLOTS[s]);
  const ownerCount = app.owners.filter((o) => o.fullName.trim()).length;
  const signatoryCount = signatories.filter((s) => s.name.trim()).length;
  const triageRaw = stored?.draftTriage as StoredDraftTriage | undefined;
  const triageRun = !!triageRaw;
  const score = computeReadinessScore({
    form,
    bankAccountOnFile,
    ownerCount,
    signatoryCount,
    requiredSlotCount: slots.length,
    uploadedRequired,
    triageRun,
  });
  const triage = triageRaw
    ? {
        riskBand: triageRaw.riskBand,
        summary: triageRaw.summary,
        flags: triageRaw.flags,
        nextSteps: triageRaw.nextSteps,
        model: triageRaw.model,
        at: triageRaw.at,
        advisory: true as const,
      }
    : null;
  return {
    score,
    checks: buildChecks({ form, bankAccountOnFile, ownerCount, signatoryCount, requiredSlotCount: slots.length, uploadedRequired, missingEvidence, triage: triageRaw ?? null }),
    riskBand: triage?.riskBand ?? 'Pending',
    triageRun,
    triage,
  };
}

/** Advisory draft triage via the LLM adapter; stored on the draft until facts change. */
export async function runDraftTriage(app: DraftApp, evidence: EvidenceRow[]): Promise<Omit<StoredDraftTriage, 'inputSha256'>> {
  const input = buildTriageInput(app, evidence);
  const inputSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const stored = app.formData as Record<string, unknown> | null;
  const prev = stored?.draftTriage as StoredDraftTriage | undefined;
  if (prev && prev.inputSha256 === inputSha256) {
    return { riskBand: prev.riskBand, summary: prev.summary, flags: prev.flags, nextSteps: prev.nextSteps, model: prev.model, at: prev.at, advisory: true };
  }
  const result = await getLlmAdapter().triage(input);
  const at = new Date().toISOString();
  const row: StoredDraftTriage = { ...result, inputSha256, at, advisory: true };
  await prisma.onboardingApplication.update({
    where: { id: app.id },
    data: { formData: { ...(stored ?? {}), draftTriage: row } as Prisma.InputJsonValue },
  });
  return { riskBand: row.riskBand, summary: row.summary, flags: row.flags, nextSteps: row.nextSteps, model: row.model, at: row.at, advisory: true };
}
