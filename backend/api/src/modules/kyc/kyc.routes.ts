import { Router } from 'express';
import { z } from 'zod';
import { emailSchema } from '@matanho/shared';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { policy } from '../../lib/policy';
import { hashToken } from '../../auth/session';
import { randomToken } from '../../lib/crypto';
import { signedDownloadUrl } from '../../lib/storage';
import { ctx, expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { EVIDENCE_SLOTS, MANUAL_TRANSITIONS, SLOT_KEYS, slaDue, type EvidenceSlot, type KycStage } from './constants';
import {
  activateCase,
  addEvent,
  blockers,
  caseDetail,
  caseInclude,
  caseSummary,
  legacyApplications,
  loadCase,
  missingEvidence,
} from './kyc.service';

export const kycRoutes = Router();
kycRoutes.use(requireAuth, requirePortalAccess('admin'));

const listQuery = z.object({
  stage: z.string().optional(),
  risk: z.string().optional(),
  q: z.string().trim().max(120).optional(),
});

kycRoutes.get('/cases', requirePermission('onboarding.view'), validateQuery(listQuery), async (req, res) => {
  const q = query<z.infer<typeof listQuery>>(req);
  const cases = await prisma.kycCase.findMany({
    where: {
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.risk ? { risk: q.risk } : {}),
      ...(q.q
        ? { OR: [{ ref: { contains: q.q } }, { application: { legalName: { contains: q.q } } }, { application: { ref: { contains: q.q } } }] }
        : {}),
    },
    include: caseInclude,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ data: cases.map(caseSummary), total: cases.length });
});

/** Records for the admin prototype's onboarding screens (bridge). */
kycRoutes.get('/cases/legacy', requirePermission('onboarding.view'), async (_req, res) => {
  const cases = await prisma.kycCase.findMany({ include: caseInclude, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ data: await legacyApplications(cases) });
});

kycRoutes.get('/cases/:id', requirePermission('onboarding.view'), async (req, res) => {
  res.json({ case: caseDetail(await loadCase(param(req, 'id'))) });
});

// ------------------------------------------------------------ assisted ----

const assistedSchema = z.object({
  applicantType: z.string().trim().min(1).max(64),
  legalName: z.string().trim().min(1).max(200),
  email: emailSchema,
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  expectedInvestment: z.coerce.number().nonnegative().optional(),
});

kycRoutes.post('/cases', requirePermission('onboarding.manage'), validateBody(assistedSchema), async (req, res) => {
  const b = req.body as z.infer<typeof assistedSchema>;
  const created = await prisma.$transaction(async (tx) => {
    const appRef = await nextRef(tx, 'onboarding');
    const caseRef = await nextRef(tx, 'kycCase');
    const application = await tx.onboardingApplication.create({
      data: {
        ref: appRef,
        channel: 'Assisted',
        applicantType: b.applicantType,
        legalName: b.legalName,
        email: b.email,
        phone: b.phone ?? null,
        country: b.country ?? null,
        expectedInvestment: b.expectedInvestment ?? null,
        status: 'Submitted',
        submittedAt: new Date(),
      },
    });
    const kycCase = await tx.kycCase.create({
      data: {
        ref: caseRef,
        applicationId: application.id,
        stage: 'Screening',
        slaState: 'Within SLA',
        slaDueAt: slaDue('Screening'),
        ownerId: req.user!.id,
        ownerName: req.user!.name ?? req.user!.email,
        preparedById: req.user!.id,
      },
    });
    await addEvent(tx, kycCase.id, 'Assisted application created', `Captured by ${req.user!.name ?? req.user!.email}.`, req.user!.id);
    await enqueue(tx, 'kyc.screening.requested', { caseId: kycCase.id });
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'kyc.case.created',
      objectType: 'kyc_case',
      objectId: kycCase.id,
      after: { ref: caseRef, applicationRef: appRef, channel: 'Assisted', legalName: b.legalName },
    });
    return kycCase.id;
  });
  res.status(201).json({ case: caseDetail(await loadCase(created)) });
});

// ------------------------------------------------------------ transitions --

const advanceSchema = z.object({ toStage: z.string(), reason: z.string().trim().max(2000).optional(), version: z.number().int().optional() });

kycRoutes.post('/cases/:id/advance', requirePermission('onboarding.manage'), validateBody(advanceSchema), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  expectVersion(req, c.version);
  const to = req.body.toStage as KycStage;
  if (!(MANUAL_TRANSITIONS[c.stage as KycStage] ?? []).includes(to)) {
    throw HttpError.conflict(`Cannot move a case from ${c.stage} to ${to}`, 'invalid_transition');
  }
  const eddDone = c.stage === 'EnhancedReview' && to === 'ComplianceReview';
  await prisma.$transaction(async (tx) => {
    await tx.kycCase.update({
      where: { id: c.id },
      data: {
        stage: to,
        slaDueAt: slaDue(to),
        slaState: to === 'ClientAction' ? 'Client action' : 'Review open',
        preparedById: req.user!.id,
        ...(eddDone ? { enhancedReviewDoneAt: new Date() } : {}),
        version: { increment: 1 },
      },
    });
    await addEvent(tx, c.id, eddDone ? 'Enhanced due diligence completed' : `Moved to ${to}`, req.body.reason ?? null, req.user!.id);
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'kyc.case.advanced',
      objectType: 'kyc_case',
      objectId: c.id,
      before: { stage: c.stage },
      after: { stage: to },
      reason: req.body.reason ?? null,
    });
  });
  res.json({ case: caseDetail(await loadCase(c.id)) });
});

const evidenceRequestSchema = z.object({
  slots: z.array(z.enum(SLOT_KEYS as [EvidenceSlot, ...EvidenceSlot[]])).default([]),
  message: z.string().trim().min(1).max(4000),
});

/** FR-ONB-011: ask the applicant for evidence; emails a resume link and moves the case to Client action. */
kycRoutes.post('/cases/:id/request-evidence', requirePermission('onboarding.manage'), validateBody(evidenceRequestSchema), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (!['ComplianceReview', 'ClientAction', 'Screening', 'EnhancedReview'].includes(c.stage)) {
    throw HttpError.conflict(`Evidence cannot be requested while the case is ${c.stage}`, 'invalid_transition');
  }
  const { slots, message } = req.body as z.infer<typeof evidenceRequestSchema>;
  const requested = slots.length ? slots : missingEvidence(c);
  const token = randomToken();
  await prisma.$transaction(async (tx) => {
    for (const slot of requested) {
      await tx.kycEvidence.upsert({
        where: { applicationId_slot: { applicationId: c.applicationId, slot } },
        create: { applicationId: c.applicationId, caseId: c.id, slot, label: EVIDENCE_SLOTS[slot], status: 'Missing' },
        update: { status: 'Missing', caseId: c.id },
      });
    }
    await tx.onboardingApplication.update({
      where: { id: c.applicationId },
      data: { draftTokenHash: hashToken(token), draftTokenExpiresAt: new Date(Date.now() + 14 * 86_400_000) },
    });
    await tx.kycCase.update({
      where: { id: c.id },
      data: { stage: 'ClientAction', slaState: 'Client action', slaDueAt: slaDue('ClientAction'), preparedById: req.user!.id, version: { increment: 1 } },
    });
    const labels = requested.map((s) => EVIDENCE_SLOTS[s]).join(', ') || 'additional information';
    await addEvent(tx, c.id, 'Evidence requested from applicant', `${labels}. ${message}`, req.user!.id);
    await enqueue(tx, 'email.send', {
      to: c.application.email,
      subject: `Matanho onboarding ${c.application.ref}: information requested`,
      text:
        `Hello,\n\nTo continue your application (${c.application.ref}) we need: ${labels}.\n\n${message}\n\n` +
        `Upload securely here (link valid 14 days):\n${config.portalUrls.onboarding}/?resume=${c.applicationId}.${token}\n`,
    });
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'kyc.evidence.requested',
      objectType: 'kyc_case',
      objectId: c.id,
      before: { stage: c.stage },
      after: { stage: 'ClientAction', slots: requested },
      reason: message,
    });
  });
  res.json({ case: caseDetail(await loadCase(c.id)) });
});

const messageSchema = z.object({ message: z.string().trim().min(1).max(4000), topic: z.string().trim().max(80).optional() });

kycRoutes.post('/cases/:id/messages', requirePermission('onboarding.manage'), validateBody(messageSchema), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const { message, topic } = req.body as z.infer<typeof messageSchema>;
  await prisma.$transaction(async (tx) => {
    await addEvent(tx, c.id, `Message to applicant${topic ? `: ${topic}` : ''}`, message, req.user!.id);
    await enqueue(tx, 'email.send', {
      to: c.application.email,
      subject: `Matanho onboarding ${c.application.ref}${topic ? `: ${topic}` : ''}`,
      text: `Hello,\n\n${message}\n\nMatanho Client Services`,
    });
    await writeAudit(tx, ctx(req, 'admin'), { action: 'kyc.message.sent', objectType: 'kyc_case', objectId: c.id, after: { topic: topic ?? null } });
  });
  res.json({ ok: true });
});

kycRoutes.post('/cases/:id/screening/refresh', requirePermission('onboarding.manage'), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (['Approved', 'Rejected', 'Activation', 'Active'].includes(c.stage)) {
    throw HttpError.conflict('Screening cannot be re-run on a decided case', 'invalid_transition');
  }
  await prisma.$transaction(async (tx) => {
    await tx.kycCase.update({ where: { id: c.id }, data: { preparedById: req.user!.id } });
    await enqueue(tx, 'kyc.screening.requested', { caseId: c.id });
    await addEvent(tx, c.id, 'Screening re-run requested', null, req.user!.id);
    await writeAudit(tx, ctx(req, 'admin'), { action: 'kyc.screening.requested', objectType: 'kyc_case', objectId: c.id });
  });
  res.status(202).json({ ok: true });
});

const evidenceReviewSchema = z.object({ status: z.enum(['Accepted', 'Rejected']), note: z.string().trim().max(1000).optional() });

kycRoutes.post('/cases/:id/evidence/:slot/review', requirePermission('onboarding.manage'), validateBody(evidenceReviewSchema), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const slot = param(req, 'slot');
  const ev = c.evidence.find((e) => e.slot === slot && e.fileId);
  if (!ev) throw HttpError.notFound('No evidence uploaded for this slot');
  await prisma.$transaction(async (tx) => {
    await tx.kycEvidence.update({ where: { id: ev.id }, data: { status: req.body.status, reviewerId: req.user!.id, reviewedAt: new Date() } });
    await addEvent(tx, c.id, `${ev.label} ${req.body.status.toLowerCase()}`, req.body.note ?? null, req.user!.id);
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'kyc.evidence.reviewed',
      objectType: 'kyc_case',
      objectId: c.id,
      before: { slot, status: ev.status },
      after: { slot, status: req.body.status },
      reason: req.body.note ?? null,
    });
  });
  res.json({ case: caseDetail(await loadCase(c.id)) });
});

kycRoutes.get('/cases/:id/evidence/:slot/download-url', requirePermission('onboarding.view'), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const ev = c.evidence.find((e) => e.slot === param(req, 'slot') && e.fileId);
  if (!ev) throw HttpError.notFound('No evidence uploaded for this slot');
  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx(req, 'admin'), { action: 'kyc.evidence.downloaded', objectType: 'kyc_case', objectId: c.id, after: { slot: ev.slot } }),
  );
  res.json({ url: signedDownloadUrl(ev.fileId!), expiresAt: new Date(Date.now() + 300_000).toISOString() });
});

// ------------------------------------------------------------ decision -----

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'enhanced_review']),
  reason: z.string().trim().min(5, 'Record the basis for the decision').max(4000),
  version: z.number().int().optional(),
});

/** FR-ONB-012: compliance decides with rationale; decider must not be the preparer (policy kyc_dual_control). */
kycRoutes.post(
  '/cases/:id/decision',
  requirePermission('onboarding.manage'),
  validateBody(decisionSchema),
  requireStepUp,
  async (req, res) => {
    if (!req.user!.roles.some((r) => r.portal === 'admin' && r.key === 'compliance')) {
      throw HttpError.forbidden('Only Compliance can record a KYC decision', 'compliance_role_required');
    }
    const c = await loadCase(param(req, 'id'));
    expectVersion(req, c.version);
    const { decision, reason } = req.body as z.infer<typeof decisionSchema>;
    if ((await policy('kyc_dual_control')) && c.preparedById && c.preparedById === req.user!.id) {
      throw HttpError.conflict('The person who prepared this case cannot also decide it', 'sod_violation');
    }

    let to: KycStage;
    if (decision === 'approve') {
      if (c.stage !== 'ComplianceReview') throw HttpError.conflict(`Cannot approve a case in ${c.stage}`, 'invalid_transition');
      const gates = blockers(c);
      if (await policy('kyc_risk_assessment_required')) {
        const ok = await prisma.kycRiskAssessment.findFirst({ where: { caseId: c.id, status: 'APPROVED', proposedRating: c.risk }, select: { id: true } });
        if (!ok) gates.push('An approved risk assessment matching the case rating is required');
      }
      if (gates.length) throw new HttpError(409, 'approval_blocked', gates.join('; '), { blockers: gates });
      to = 'Approved';
    } else if (decision === 'reject') {
      if (!['ComplianceReview', 'EnhancedReview', 'ClientAction', 'Screening'].includes(c.stage)) {
        throw HttpError.conflict(`Cannot reject a case in ${c.stage}`, 'invalid_transition');
      }
      to = 'Rejected';
    } else {
      if (c.stage !== 'ComplianceReview') throw HttpError.conflict(`Cannot open enhanced review from ${c.stage}`, 'invalid_transition');
      to = 'EnhancedReview';
    }

    await prisma.$transaction(async (tx) => {
      await tx.kycCase.update({
        where: { id: c.id },
        data: {
          stage: to,
          decision,
          decisionReason: reason,
          decidedById: req.user!.id,
          decidedAt: new Date(),
          slaDueAt: slaDue(to),
          slaState: to === 'Approved' ? 'Ready' : to === 'Rejected' ? 'Complete' : 'Review open',
          ...(decision === 'approve' ? { fundsApproved: true } : {}),
          version: { increment: 1 },
        },
      });
      const title = decision === 'approve' ? 'Application approved' : decision === 'reject' ? 'Application declined' : 'Enhanced review opened';
      await addEvent(tx, c.id, title, reason, req.user!.id);
      await writeAudit(tx, ctx(req, 'admin'), {
        action: 'kyc.case.decided',
        objectType: 'kyc_case',
        objectId: c.id,
        before: { stage: c.stage, decision: c.decision },
        after: { stage: to, decision },
        reason,
      });
      if (decision === 'reject') {
        await enqueue(tx, 'email.send', {
          to: c.application.email,
          subject: `Matanho onboarding ${c.application.ref}: application outcome`,
          text: 'Hello,\n\nThank you for your application. After review we are unable to proceed with it at this time.\n\nMatanho Client Services',
        });
      }
      await enqueue(tx, 'notify.permission', {
        permission: 'onboarding.manage',
        type: 'kyc.case.decided',
        title: `${c.application.legalName ?? c.ref}: ${title.toLowerCase()}`,
        body: reason,
        link: '/#onboarding',
      });
    });
    res.json({ case: caseDetail(await loadCase(c.id)) });
  },
);

kycRoutes.post('/cases/:id/activate', requirePermission('onboarding.manage'), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const result = await activateCase(c, ctx(req, 'admin'));
  res.json({ ...result, case: caseDetail(await loadCase(c.id)) });
});
