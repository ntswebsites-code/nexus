import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { num } from '../../lib/http';
import { decryptField, encryptField } from '../../lib/crypto';
import { createInvitation } from '../identity/invitations';
import { EVIDENCE_SLOTS, SLOT_KEYS, STAGE_LABELS, requiredSlots, type EvidenceSlot, type KycStage } from './constants';
import { staffFormView } from './public-form';

export const caseInclude = {
  application: { include: { owners: true } },
  evidence: true,
  screening: { orderBy: { receivedAt: 'desc' } },
  events: { orderBy: { at: 'desc' } },
} satisfies Prisma.KycCaseInclude;

export type FullCase = Prisma.KycCaseGetPayload<{ include: typeof caseInclude }>;

export async function loadCase(idOrRef: string): Promise<FullCase> {
  const kycCase = await prisma.kycCase.findFirst({
    where: { OR: [{ id: idOrRef }, { ref: idOrRef }, { application: { ref: idOrRef } }] },
    include: caseInclude,
  });
  if (!kycCase) throw HttpError.notFound('Case not found');
  return kycCase;
}

function latestScreening(c: FullCase) {
  const latest = c.screening[0];
  if (!latest) return { summary: 'Queued', ref: 'Queued', at: null as Date | null, results: [] as FullCase['screening'] };
  const run = c.screening.filter((s) => s.rawRef === latest.rawRef);
  const sanctions = run.find((r) => r.type === 'sanctions');
  const pep = run.find((r) => r.type === 'pep');
  let summary = 'Clear';
  if (sanctions?.outcome === 'Match') summary = 'Potential match';
  else if (pep?.outcome !== 'Clear' && pep) summary = 'PEP review';
  else if (run.some((r) => r.outcome !== 'Clear')) summary = 'Review';
  return { summary, ref: latest.rawRef ?? 'Queued', at: latest.receivedAt, results: run };
}

export function missingEvidence(c: FullCase): EvidenceSlot[] {
  const have = new Set(c.evidence.filter((e) => e.fileId && e.status !== 'Rejected').map((e) => e.slot));
  return requiredSlots(c.application.applicantType).filter((s) => !have.has(s));
}

/** Gates that block approval / activation (FR-ONB-010, FR-ONB-012). */
export function blockers(c: FullCase): string[] {
  const out: string[] = [];
  const missing = missingEvidence(c);
  if (missing.length) out.push(`Missing evidence: ${missing.map((s) => EVIDENCE_SLOTS[s]).join(', ')}`);
  if (c.stage === 'Submitted' || c.stage === 'Screening') out.push('Automated pre-screen still running');
  if (c.stage === 'ClientAction') out.push('Waiting for the applicant');
  if (c.stage === 'EnhancedReview') out.push('Enhanced due diligence open');
  if (c.risk === 'High' && !c.enhancedReviewDoneAt && !['Approved', 'Activation', 'Active'].includes(c.stage)) {
    out.push('High risk: enhanced review must be completed first');
  }
  if (latestScreening(c).summary === 'Potential match') out.push('Potential sanctions match to disposition');
  return out;
}

function nextAction(c: FullCase): string {
  switch (c.stage as KycStage) {
    case 'Submitted':
    case 'Screening':
      return 'Automated document and AML pre-screening before human review.';
    case 'ComplianceReview':
      return blockers(c).length ? blockers(c)[0]! : 'Compliance decision with recorded rationale.';
    case 'ClientAction':
      return 'Applicant to upload the requested evidence.';
    case 'EnhancedReview':
      return 'Complete enhanced due diligence, then return to compliance review.';
    case 'Approved':
      return 'Activate: create client, mandate shell, draft cash account and investor invitation.';
    case 'Activation':
      return 'Cash account approval and investor invitation acceptance.';
    case 'Active':
      return 'Relationship live. Periodic review scheduled.';
    case 'Rejected':
      return 'Case closed.';
  }
}

function readiness(c: FullCase): number {
  if (['Approved', 'Activation', 'Active'].includes(c.stage)) return 100;
  if (c.stage === 'Rejected') return 0;
  const required = requiredSlots(c.application.applicantType).length;
  const have = required - missingEvidence(c).length;
  const screened = c.screening.length ? 1 : 0;
  return Math.max(18, Math.min(95, Math.round((have / required) * 60 + screened * 20 + (blockers(c).length ? 0 : 15))));
}

export function caseSummary(c: FullCase) {
  const s = latestScreening(c);
  return {
    id: c.id,
    ref: c.ref,
    applicationRef: c.application.ref,
    name: c.application.legalName ?? 'Digital applicant',
    type: c.application.applicantType,
    channel: c.application.channel,
    email: c.application.email,
    stage: c.stage,
    stageLabel: STAGE_LABELS[c.stage as KycStage] ?? c.stage,
    risk: c.risk,
    slaState: c.slaState,
    slaDueAt: c.slaDueAt,
    owner: c.ownerName,
    decision: c.decision,
    screening: s.summary,
    blockers: blockers(c),
    readiness: readiness(c),
    next: nextAction(c),
    submittedAt: c.application.submittedAt,
    clientId: c.clientId,
    version: c.version,
  };
}

export function caseDetail(c: FullCase) {
  const app = c.application;
  const s = latestScreening(c);
  return {
    ...caseSummary(c),
    application: {
      registrationRef: app.registrationRef,
      phone: app.phone,
      country: app.country,
      expectedInvestment: num(app.expectedInvestment),
      relationship: app.relationship,
      classification: app.classification,
      baseCurrency: app.baseCurrency,
      riskProfile: app.riskProfile,
      liquidityNeed: app.liquidityNeed,
      purpose: app.purpose,
      sourceOfFunds: app.sourceOfFunds,
      sourceOfWealth: app.sourceOfWealth,
      taxResidence: app.taxResidence,
      taxIdMasked: app.taxIdEnc ? '••••' + (decryptField(app.taxIdEnc) ?? '').slice(-3) : null,
      taxStatus: app.taxStatus,
      pep: app.pep,
      bankJurisdiction: app.bankJurisdiction,
      signingAuthority: app.signingAuthority,
      expectedActivity: app.expectedActivity,
      consentAt: app.consentAt,
      form: staffFormView(app.formData as Record<string, unknown> | null, app.taxIdEnc),
    },
    owners: app.owners.map((o) => ({ name: o.fullName, pct: num(o.ownershipPct), controller: o.isController, pep: o.pep })),
    evidence: evidenceView(c),
    screening: { summary: s.summary, ref: s.ref, at: s.at, results: s.results.map((r) => ({ type: r.type, outcome: r.outcome, score: r.score })) },
    timeline: c.events.map((e) => ({ at: e.at, title: e.title, detail: e.detail })),
    decisionReason: c.decisionReason,
    decidedAt: c.decidedAt,
    fundsApproved: c.fundsApproved,
    enhancedReviewDoneAt: c.enhancedReviewDoneAt,
  };
}

export function evidenceView(c: FullCase) {
  const bySlot = new Map(c.evidence.map((e) => [e.slot, e]));
  const required = new Set(requiredSlots(c.application.applicantType));
  return SLOT_KEYS.map((slot) => {
    const e = bySlot.get(slot);
    return {
      slot,
      label: EVIDENCE_SLOTS[slot],
      required: required.has(slot),
      status: e?.fileId ? e.status : e ? 'Requested' : 'Missing',
      fileId: e?.fileId ?? null,
    };
  });
}

/**
 * Shape consumed by the admin prototype's v10/v35 onboarding screens
 * (`matanho-onboarding-v10` records). `v35` overrides the values the prototype
 * would otherwise derive locally, so its gates reflect the server state.
 */
export async function legacyApplications(cases: FullCase[]) {
  const fileIds = cases.flatMap((c) => c.evidence.map((e) => e.fileId).filter((x): x is string => !!x));
  const files = new Map(
    (await prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, mime: true, size: true } })).map(
      (f) => [f.id, f],
    ),
  );
  return cases.map((c) => {
    const app = c.application;
    const s = latestScreening(c);
    const docs = c.evidence
      .filter((e) => e.fileId)
      .map((e) => {
        const f = files.get(e.fileId!);
        return { key: e.fileId, label: e.label, name: f?.name ?? 'uploaded file', type: f?.mime ?? '', size: f?.size ?? 0, ref: `${app.ref}-${e.slot.toUpperCase()}` };
      });
    const block = blockers(c);
    const evidence = evidenceView(c).map((e) => {
      const f = e.fileId ? files.get(e.fileId) : undefined;
      return {
        label: e.label,
        source: f ? 'Applicant upload' : 'Requested',
        ref: f ? `${app.ref}-${e.slot.toUpperCase()}` : '—',
        state: f ? (e.status === 'Accepted' ? 'Current' : e.status === 'Rejected' ? 'Rejected' : 'Current') : 'Missing',
        name: f?.name ?? '—',
        type: f?.mime ?? '',
        size: f?.size ?? 0,
        docKey: e.fileId,
        slot: e.slot,
      };
    });
    const stageIndex: Record<string, number> = {
      Submitted: 0,
      Screening: 3,
      ClientAction: 2,
      ComplianceReview: 4,
      EnhancedReview: 3,
      Approved: 6,
      Rejected: 6,
      Activation: 6,
      Active: 6,
    };
    const hasDoc = (slot: EvidenceSlot) => c.evidence.some((e) => e.slot === slot && e.fileId);
    const form = staffFormView(app.formData as Record<string, unknown> | null, app.taxIdEnc);
    const field = (key: string) => form?.sections.flatMap((s) => s.fields).find((f) => f.key === key)?.value ?? '';
    // V65 applications carry the prototype's record fields so the admin case view shows them.
    const v65Applicant = form
      ? {
          relationship: field('relationship'),
          mandate: field('mandate'),
          taxResidence: field('taxResidence'),
          fatca: field('fatca'),
          crs: field('crs'),
          bank: {
            name: field('bankName'),
            holder: field('bankHolder'),
            country: field('bankCountry'),
            account: field('bankAccount'),
            currency: field('bankCurrency'),
            swift: field('swift'),
          },
          signatories: form.signatories,
          declarations: {
            pep: field('pep'),
            sanctions: field('sanctions'),
            adverseMedia: field('adverseMedia'),
            highRiskJurisdiction: field('highRiskJurisdiction'),
          },
          signature: form.declaration,
          form,
        }
      : {};
    return {
      id: app.ref ?? c.ref,
      caseId: c.id,
      caseRef: c.ref,
      name: app.legalName ?? 'Digital applicant',
      type: app.applicantType,
      channel: app.channel,
      stage: STAGE_LABELS[c.stage as KycStage] ?? c.stage,
      risk: c.risk,
      identity: hasDoc('doc1') ? 'Received' : 'Queued',
      screening: s.summary,
      funds: c.fundsApproved ? 'Approved' : hasDoc('doc3') ? 'Under review' : 'Queued',
      docsDone: docs.length,
      docsTotal: requiredSlots(app.applicantType).length,
      owner: c.ownerName,
      sla: c.slaDueAt ? `Due ${c.slaDueAt.toISOString()}` : 'Just now',
      slaState: c.slaState,
      progress: readiness(c),
      next: nextAction(c),
      applicant: {
        registrationRef: app.registrationRef,
        email: app.email,
        phone: app.phone,
        country: app.country,
        expectedInvestment: num(app.expectedInvestment) ?? 0,
        sourceOfFunds: app.sourceOfFunds,
        sourceOfWealth: app.sourceOfWealth,
        beneficialOwnerCount: app.owners.length,
        beneficialOwners: app.owners.map((o) => [o.fullName, '', o.ownershipPct ? String(num(o.ownershipPct)) : '']),
        purpose: app.purpose,
        activity: app.expectedActivity,
        documents: docs,
        ...v65Applicant,
      },
      ai: {
        status: s.results.length ? 'Complete' : 'Queued',
        humanReviewRequired: true,
        exceptions: s.results.filter((r) => r.outcome !== 'Clear').map((r) => r.type),
        finalDecision: c.decision,
        screenRef: s.ref,
        caveat: 'AI supports pre-screening only; final KYC/AML decision is human.',
      },
      timeline: c.events.map((e) => [e.at.toISOString().slice(11, 16), e.title, e.detail ?? '']),
      v35: {
        risk: c.risk === 'Pending' ? 'Pending' : c.risk,
        owner: c.ownerName,
        readiness: readiness(c),
        status: c.stage === 'Rejected' ? 'Declined' : block.length ? 'Action' : 'Ready',
        blockers: c.stage === 'ComplianceReview' || c.stage === 'Approved' ? block.length : Math.max(1, block.length),
        blockerList: block,
        next: nextAction(c),
        stage: stageIndex[c.stage] ?? 0,
        screen: s.summary,
        screenRef: s.ref,
        screened: s.at ? s.at.toLocaleString('en-GB') : 'Not run',
        decision:
          c.decision === 'approve' ? 'Approved' : c.decision === 'reject' ? 'Declined' : c.decision === 'enhanced_review' ? 'Enhanced review' : 'Pending',
        mandate: c.clientId ? 'Shell created' : 'Not started',
        identity: hasDoc('doc1') ? 'Received' : 'Queued',
        funds: c.fundsApproved ? 'Approved' : hasDoc('doc3') ? 'Under review' : 'Queued',
        evidence,
        caseStage: c.stage,
        caseVersion: c.version,
      },
    };
  });
}

export async function addEvent(tx: Prisma.TransactionClient, caseId: string, title: string, detail: string | null, actorId?: string | null) {
  await tx.kycCaseEvent.create({ data: { caseId, title, detail, actorId: actorId ?? null } });
}

/**
 * FR-ONB-013 activation: client (CL-#####, KYC Current), mandate shell, DRAFT
 * cash account, beneficial owners carried over, investor-admin invitation.
 */
export async function activateCase(c: FullCase, audit: AuditContext) {
  if (c.stage !== 'Approved') throw HttpError.conflict('Only approved cases can be activated', 'invalid_transition');
  if (c.risk === 'High' && !c.enhancedReviewDoneAt) {
    throw HttpError.conflict('High-risk case: enhanced review approval is required before activation', 'activation_blocked');
  }
  if (!c.fundsApproved) throw HttpError.conflict('Source of funds has not been approved', 'activation_blocked');

  const app = c.application;
  return prisma.$transaction(async (tx) => {
    const clientRef = await nextRef(tx, 'client');
    const mandateRef = await nextRef(tx, 'mandate');
    const accountRef = await nextRef(tx, 'cashAccount');
    const client = await tx.client.create({
      data: {
        ref: clientRef,
        name: app.legalName ?? app.email,
        type: app.applicantType,
        baseCurrency: (app.baseCurrency ?? 'USD').slice(0, 3).toUpperCase(),
        riskRating: c.risk === 'Pending' ? 'Medium' : c.risk,
        kycStatus: 'Current',
        mandateLabel: 'Mandate shell',
        ownerName: c.ownerName,
        email: app.email,
        phone: app.phone,
        registrationRef: app.registrationRef,
        notes: app.purpose,
        valueLabel: app.expectedInvestment ? `$${(app.expectedInvestment.toNumber() / 1e6).toFixed(1)}M` : null,
        accountsCount: 1,
        nextReviewDate: new Date(Date.now() + (c.risk === 'High' ? 365 : 3 * 365) * 86_400_000),
        createdBy: audit.actorId ?? null,
      },
    });
    await tx.mandate.create({
      data: { ref: mandateRef, clientId: client.id, name: `${client.name} mandate`, type: 'discretionary', status: 'Shell', createdBy: audit.actorId ?? null },
    });
    await tx.cashAccount.create({
      data: {
        ref: accountRef,
        clientId: client.id,
        legalEntity: client.name,
        currency: client.baseCurrency,
        status: 'DRAFT',
        makerId: audit.actorId ?? null,
      },
    });
    await tx.beneficialOwner.createMany({
      data: app.owners.map((o) => ({
        clientId: client.id,
        fullName: o.fullName,
        idNumberEnc: o.idNumberEnc ? encryptField(decryptField(o.idNumberEnc)) : null,
        ownershipPct: o.ownershipPct,
        isController: o.isController,
        pep: o.pep,
      })),
    });
    await tx.kycCase.update({
      where: { id: c.id },
      data: { stage: 'Activation', clientId: client.id, slaState: 'Activated', version: { increment: 1 } },
    });
    await tx.onboardingApplication.update({ where: { id: app.id }, data: { clientId: client.id } });
    const { invitation } = await createInvitation(tx, {
      email: app.email,
      name: app.legalName,
      portal: 'investor',
      roleKeys: ['admin'],
      clientId: client.id,
      invitedById: audit.actorId,
      context: `the Matanho investor portal for ${client.name}`,
    });
    await addEvent(tx, c.id, 'Relationship activated', `Client ${clientRef}, mandate shell ${mandateRef}, draft cash account ${accountRef}; investor invitation sent to ${app.email}.`, audit.actorId);
    await writeAudit(tx, audit, {
      action: 'kyc.case.activated',
      objectType: 'kyc_case',
      objectId: c.id,
      before: { stage: c.stage },
      after: { stage: 'Activation', clientId: client.id, clientRef, mandateRef, accountRef, invitationId: invitation.id },
    });
    await writeAudit(tx, audit, { action: 'client.created', objectType: 'client', objectId: client.id, after: { ref: clientRef, name: client.name, source: c.ref } });
    await enqueue(tx, 'notify.permission', {
      permission: 'cash.approve',
      type: 'cash_account.pending',
      title: `Draft cash account ${accountRef} created for ${client.name}`,
      body: 'Complete the account details and submit it for approval.',
      link: '/#clients',
    });
    return { clientId: client.id, clientRef, mandateRef, accountRef };
  });
}

/** Activation → Active once a cash account is ACTIVE and an investor user has accepted (SRD 7.1). */
export async function maybeCompleteActivation(tx: Prisma.TransactionClient, clientId: string, audit: AuditContext) {
  const kycCase = await tx.kycCase.findFirst({ where: { clientId, stage: 'Activation' } });
  if (!kycCase) return;
  const [account, member] = await Promise.all([
    tx.cashAccount.findFirst({ where: { clientId, status: 'ACTIVE' }, select: { id: true } }),
    tx.clientUser.findFirst({ where: { clientId }, select: { id: true } }),
  ]);
  if (!account || !member) return;
  await tx.kycCase.update({ where: { id: kycCase.id }, data: { stage: 'Active', slaState: 'Complete', version: { increment: 1 } } });
  await tx.kycCaseEvent.create({ data: { caseId: kycCase.id, title: 'Relationship active', detail: 'Cash account approved and investor portal access accepted.' } });
  await writeAudit(tx, audit, { action: 'kyc.case.active', objectType: 'kyc_case', objectId: kycCase.id, before: { stage: 'Activation' }, after: { stage: 'Active' } });
}
