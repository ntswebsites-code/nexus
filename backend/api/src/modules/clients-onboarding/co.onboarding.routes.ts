import { createHash } from 'node:crypto';
import { Router } from 'express';
import { getLlmAdapter } from '../../integrations/llm';
import type { TriageInput } from '../../integrations/llm/types';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { num, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, audit, notifyPermission } from '../ops/ops.common';
import { addEvent, blockers, caseSummary, loadCase, missingEvidence, type FullCase } from '../kyc/kyc.service';
import { CHECK_KINDS, CHECK_OUTCOMES, RATINGS, scoreRisk, slaState } from './co.engine';
import { assertStaff, loadRiskConfig, userNames } from './co.service';

/** Onboarding & KYC (page `onboarding`): review queue, KYC/AML checks, risk rating with maker-checker, assignment. */
export const coOnboardingRoutes = Router();

const OPEN_STAGES = ['Submitted', 'Screening', 'ComplianceReview', 'ClientAction', 'EnhancedReview', 'Approved', 'Activation'];

function riskInput(c: FullCase, checks: { kind: string; outcome: string }[]) {
  const app = c.application;
  const latest = c.screening[0];
  const run = latest ? c.screening.filter((s) => s.rawRef === latest.rawRef) : [];
  const worst = (t: string) => run.filter((r) => r.type === t).map((r) => r.outcome).find((o) => o !== 'Clear') ?? (run.some((r) => r.type === t) ? 'Clear' : undefined);
  const otherHit = run.filter((r) => r.type !== 'sanctions' && r.type !== 'pep').find((r) => r.outcome !== 'Clear');
  return {
    country: app.country,
    bankJurisdiction: app.bankJurisdiction,
    pep: app.pep,
    applicantType: app.applicantType,
    expectedInvestment: num(app.expectedInvestment),
    ownerPep: app.owners.some((o) => o.pep),
    screening: { sanctions: worst('sanctions'), pep: worst('pep'), other: otherHit?.outcome },
    checks,
    missingSourceOfFunds: !app.sourceOfFunds?.trim(),
  };
}

const queueQuery = z.object({
  stage: z.string().trim().max(60).optional(),
  risk: z.string().trim().max(16).optional(),
  sla: z.enum(['Breached', 'At risk', 'On track']).optional(),
  owner: z.string().trim().max(40).optional(),
  q: z.string().trim().max(120).optional(),
  open: z.enum(['true', 'false']).optional(),
});

coOnboardingRoutes.get('/onboarding/queue', requirePermission('onboarding.view'), validateQuery(queueQuery), async (req, res) => {
  const f = query<z.infer<typeof queueQuery>>(req);
  const cases = await prisma.kycCase.findMany({
    where: {
      ...(f.stage ? { stage: { in: f.stage.split(',') } } : f.open === 'true' ? { stage: { in: OPEN_STAGES } } : {}),
      ...(f.risk ? { risk: f.risk } : {}),
      ...(f.owner === 'unassigned' ? { ownerId: null } : f.owner ? { ownerId: f.owner } : {}),
      ...(f.q ? { OR: [{ ref: { contains: f.q } }, { application: { legalName: { contains: f.q } } }, { application: { email: { contains: f.q } } }, { application: { ref: { contains: f.q } } }] } : {}),
    },
    include: { application: { select: { ref: true, legalName: true, applicantType: true, channel: true, email: true, country: true, submittedAt: true } }, screening: { orderBy: { receivedAt: 'desc' }, take: 6 } },
    orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const ids = cases.map((c) => c.id);
  const [pending, checks] = await Promise.all([
    prisma.kycRiskAssessment.findMany({ where: { caseId: { in: ids }, status: { in: ['PROPOSED', 'APPROVED'] } }, orderBy: { createdAt: 'desc' } }),
    prisma.kycCheck.findMany({ where: { caseId: { in: ids } }, orderBy: { performedAt: 'asc' } }),
  ]);
  const assessmentOf = new Map<string, (typeof pending)[number]>();
  for (const a of pending) if (!assessmentOf.has(a.caseId)) assessmentOf.set(a.caseId, a);
  const checksOf = new Map<string, Map<string, string>>();
  for (const c of checks) (checksOf.get(c.caseId) ?? checksOf.set(c.caseId, new Map()).get(c.caseId)!).set(c.kind, c.outcome);
  let data = cases.map((c) => {
    const done = checksOf.get(c.id) ?? new Map<string, string>();
    const closed = !OPEN_STAGES.includes(c.stage) || ['Approved', 'Activation'].includes(c.stage);
    const a = assessmentOf.get(c.id);
    return {
      id: c.id,
      ref: c.ref,
      applicationRef: c.application.ref,
      name: c.application.legalName ?? 'Digital applicant',
      type: c.application.applicantType,
      channel: c.application.channel,
      country: c.application.country,
      email: c.application.email,
      stage: c.stage,
      risk: c.risk,
      owner: c.ownerName,
      ownerId: c.ownerId,
      slaDueAt: c.slaDueAt,
      sla: closed ? 'Closed' : slaState(c.slaDueAt, c.createdAt, false),
      submittedAt: c.application.submittedAt,
      checks: { done: done.size, total: CHECK_KINDS.length, failed: [...done.values()].filter((o) => o === 'FAIL').length, referred: [...done.values()].filter((o) => o === 'REFER').length },
      riskAssessment: a ? { id: a.id, status: a.status, rating: a.proposedRating, score: a.score } : null,
    };
  });
  if (f.sla) data = data.filter((r) => r.sla === f.sla);
  const countBy = (k: 'stage' | 'risk' | 'sla') => data.reduce<Record<string, number>>((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
  res.json({ data, total: data.length, summary: { byStage: countBy('stage'), byRisk: countBy('risk'), bySla: countBy('sla'), awaitingRiskApproval: data.filter((r) => r.riskAssessment?.status === 'PROPOSED').length } });
});

async function workup(idOrRef: string) {
  const c = await loadCase(idOrRef);
  const [checks, assessments] = await Promise.all([
    prisma.kycCheck.findMany({ where: { caseId: c.id }, orderBy: { performedAt: 'desc' } }),
    prisma.kycRiskAssessment.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } }),
  ]);
  const names = await userNames([c.ownerId, ...checks.map((x) => x.performedBy), ...assessments.flatMap((a) => [a.makerId, a.checkerId])]);
  const latestByKind = new Map<string, (typeof checks)[number]>();
  for (const x of checks) if (!latestByKind.has(x.kind)) latestByKind.set(x.kind, x);
  const preview = scoreRisk(riskInput(c, [...latestByKind.values()].map((x) => ({ kind: x.kind, outcome: x.outcome }))), await loadRiskConfig());
  const approved = assessments.find((a) => a.status === 'APPROVED');
  return {
    case: caseSummary(c),
    app: { country: c.application.country, pep: c.application.pep, sourceOfFunds: c.application.sourceOfFunds, expectedInvestment: num(c.application.expectedInvestment), owners: c.application.owners.length },
    checks: CHECK_KINDS.map((kind) => {
      const x = latestByKind.get(kind);
      return { kind, outcome: x?.outcome ?? null, provider: x?.provider ?? null, notes: x?.notes ?? null, by: x ? (names.get(x.performedBy) ?? null) : null, at: x?.performedAt ?? null, history: checks.filter((h) => h.kind === kind).length };
    }),
    history: checks.map((x) => ({ id: x.id, kind: x.kind, outcome: x.outcome, provider: x.provider, notes: x.notes, by: names.get(x.performedBy) ?? null, at: x.performedAt })),
    riskPreview: preview,
    assessments: assessments.map((a) => ({ id: a.id, score: a.score, rating: a.proposedRating, factors: a.factors, rationale: a.rationale, status: a.status, maker: names.get(a.makerId) ?? null, makerId: a.makerId, checker: a.checkerId ? (names.get(a.checkerId) ?? null) : null, decisionNote: a.decisionNote, at: a.createdAt, decidedAt: a.decidedAt })),
    gates: {
      blockers: blockers(c),
      missingEvidence: missingEvidence(c),
      riskApproved: !!approved && approved.proposedRating === c.risk,
      checksComplete: CHECK_KINDS.every((k) => latestByKind.get(k)?.outcome === 'PASS'),
      openReferrals: [...latestByKind.values()].filter((x) => x.outcome !== 'PASS').map((x) => x.kind),
    },
    timeline: c.events.map((e) => ({ at: e.at, title: e.title, detail: e.detail })),
  };
}

coOnboardingRoutes.get('/onboarding/cases/:id/workup', requirePermission('onboarding.view'), async (req, res) => {
  res.json(await workup(param(req, 'id')));
});

const checkSchema = z.object({ kind: z.enum(CHECK_KINDS), outcome: z.enum(CHECK_OUTCOMES), provider: z.string().trim().max(80).optional(), notes: z.string().trim().max(2000).optional() }).strict();

coOnboardingRoutes.post('/onboarding/cases/:id/checks', requirePermission('onboarding.manage'), validateBody(checkSchema), idempotent('co.kyc_check', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (['Rejected', 'Active'].includes(c.stage)) throw HttpError.conflict(`Checks cannot be recorded on a ${c.stage} case`, 'invalid_state');
  const b = req.body as z.infer<typeof checkSchema>;
  if (b.outcome !== 'PASS' && !b.notes) throw HttpError.badRequest('Validation failed', [{ path: 'notes', message: 'Explain a referred or failed check' }]);
  await prisma.$transaction(async (tx) => {
    const row = await tx.kycCheck.create({ data: { caseId: c.id, kind: b.kind, outcome: b.outcome, provider: b.provider || 'Manual review', notes: b.notes ?? null, performedBy: req.user!.id } });
    await addEvent(tx, c.id, `${b.kind.replace(/_/g, ' ')} check: ${b.outcome}`, b.notes ?? null, req.user!.id);
    await tx.kycCase.update({ where: { id: c.id }, data: { preparedById: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'kyc.check_recorded', objectType: 'kyc_case', objectId: c.id, after: { checkId: row.id, kind: b.kind, outcome: b.outcome } });
    if (b.outcome === 'FAIL') await notifyPermission(tx, 'onboarding.approve', { type: 'kyc.check.failed', title: `${c.application.legalName ?? c.ref}: ${b.kind.replace(/_/g, ' ').toLowerCase()} check failed`, body: b.notes, link: '/ops/onboarding' });
  });
  res.status(201).json(await workup(c.id));
});

const riskSchema = z.object({ rating: z.enum(RATINGS).optional(), rationale: z.string().trim().max(2000).optional() }).strict();

/** Maker: computes the risk score from the application, screening and checks, and proposes a rating (an override needs a rationale). */
coOnboardingRoutes.post('/onboarding/cases/:id/risk', requirePermission('onboarding.manage'), validateBody(riskSchema), idempotent('co.kyc_risk', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  if (['Rejected', 'Active'].includes(c.stage)) throw HttpError.conflict(`Risk cannot be assessed on a ${c.stage} case`, 'invalid_state');
  const b = req.body as z.infer<typeof riskSchema>;
  const checks = await prisma.kycCheck.findMany({ where: { caseId: c.id }, orderBy: { performedAt: 'asc' } });
  const computed = scoreRisk(riskInput(c, checks), await loadRiskConfig());
  const rating = b.rating ?? computed.rating;
  if (rating !== computed.rating && (b.rationale ?? '').length < 10) {
    throw HttpError.badRequest('Validation failed', [{ path: 'rationale', message: `The computed rating is ${computed.rating}; explain the override (10+ characters)` }]);
  }
  const id = await prisma.$transaction(async (tx) => {
    await tx.kycRiskAssessment.updateMany({ where: { caseId: c.id, status: 'PROPOSED' }, data: { status: 'SUPERSEDED' } });
    const a = await tx.kycRiskAssessment.create({ data: { caseId: c.id, score: computed.score, factors: computed.factors as unknown as Prisma.InputJsonValue, proposedRating: rating, rationale: b.rationale ?? null, makerId: req.user!.id } });
    await tx.kycCase.update({ where: { id: c.id }, data: { preparedById: req.user!.id } });
    await addEvent(tx, c.id, `Risk rating proposed: ${rating}`, `Score ${computed.score}${b.rationale ? `. ${b.rationale}` : ''}`, req.user!.id);
    await writeAudit(tx, audit(req), { action: 'kyc.risk_proposed', objectType: 'kyc_case', objectId: c.id, after: { assessmentId: a.id, score: computed.score, computed: computed.rating, proposed: rating } });
    await notifyPermission(tx, 'onboarding.approve', { type: 'kyc.risk.proposed', title: `${c.application.legalName ?? c.ref}: ${rating} risk rating awaits approval`, link: '/ops/onboarding' });
    return a.id;
  });
  res.status(201).json({ assessmentId: id, ...(await workup(c.id)) });
});

const decideSchema = z.object({ note: z.string().trim().min(5).max(500) }).strict();

async function decideRisk(req: import('express').Request, approve: boolean) {
  const a = await prisma.kycRiskAssessment.findUnique({ where: { id: param(req, 'id') } });
  if (!a) throw HttpError.notFound('Risk assessment not found');
  if (a.status !== 'PROPOSED') throw HttpError.conflict(`The assessment is ${a.status}; it cannot be decided`, 'invalid_state');
  assertSegregation(req.user!.id, a.makerId);
  const c = await loadCase(a.caseId);
  await prisma.$transaction(async (tx) => {
    const n = await tx.kycRiskAssessment.updateMany({ where: { id: a.id, status: 'PROPOSED' }, data: { status: approve ? 'APPROVED' : 'REJECTED', checkerId: req.user!.id, decisionNote: req.body.note, decidedAt: new Date() } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    if (approve) {
      await tx.kycRiskAssessment.updateMany({ where: { caseId: a.caseId, status: 'APPROVED', id: { not: a.id } }, data: { status: 'SUPERSEDED' } });
      await tx.kycCase.update({ where: { id: c.id }, data: { risk: a.proposedRating, version: { increment: 1 } } });
    }
    await addEvent(tx, c.id, approve ? `Risk rating approved: ${a.proposedRating}` : 'Risk rating rejected', req.body.note, req.user!.id);
    await writeAudit(tx, audit(req), { action: approve ? 'kyc.risk_approved' : 'kyc.risk_rejected', objectType: 'kyc_case', objectId: c.id, before: { risk: c.risk }, after: { risk: approve ? a.proposedRating : c.risk, assessmentId: a.id }, reason: req.body.note });
    await notifyPermission(tx, 'onboarding.manage', { type: 'kyc.risk.decided', title: `${c.application.legalName ?? c.ref}: risk rating ${approve ? 'approved' : 'rejected'}`, body: req.body.note, link: '/ops/onboarding' });
  });
  return c.id;
}

coOnboardingRoutes.post('/onboarding/risk/:id/approve', requirePermission('onboarding.approve'), validateBody(decideSchema), requireStepUp, idempotent('clients-onboarding.post.onboarding_risk_id_approve', { required: false }), async (req, res) => {
  res.json(await workup(await decideRisk(req, true)));
});
coOnboardingRoutes.post('/onboarding/risk/:id/reject', requirePermission('onboarding.approve'), validateBody(decideSchema), idempotent('clients-onboarding.post.onboarding_risk_id_reject', { required: false }), async (req, res) => {
  res.json(await workup(await decideRisk(req, false)));
});

const assignSchema = z.object({ userId: z.string().uuid().nullable() }).strict();

coOnboardingRoutes.post('/onboarding/cases/:id/assign', requirePermission('onboarding.manage'), validateBody(assignSchema), idempotent('clients-onboarding.post.onboarding_cases_id_assign', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const staff = req.body.userId ? await assertStaff(req.body.userId) : null;
  await prisma.$transaction(async (tx) => {
    await tx.kycCase.update({ where: { id: c.id }, data: { ownerId: staff?.id ?? null, ownerName: staff?.name ?? 'Client Services intake', version: { increment: 1 } } });
    await addEvent(tx, c.id, staff ? `Assigned to ${staff.name}` : 'Unassigned', null, req.user!.id);
    await writeAudit(tx, audit(req), { action: 'kyc.case_assigned', objectType: 'kyc_case', objectId: c.id, before: { ownerId: c.ownerId }, after: { ownerId: staff?.id ?? null } });
  });
  res.json({ ok: true, owner: staff?.name ?? 'Client Services intake' });
});

// ---------------------------------------------------------------- R4-8: advisory AI triage

const triageView = (t: { id: string; riskBand: string; summary: string; flags: unknown; nextSteps: unknown; model: string; createdBy: string; createdAt: Date }, by: Map<string, string>) => ({
  id: t.id,
  riskBand: t.riskBand,
  summary: t.summary,
  flags: t.flags,
  nextSteps: t.nextSteps,
  model: t.model,
  by: by.get(t.createdBy) ?? null,
  at: t.createdAt.toISOString(),
  advisory: true,
});

coOnboardingRoutes.get('/onboarding/cases/:id/triage', requirePermission('onboarding.view'), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const rows = await prisma.onboardingTriage.findMany({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' }, take: 5 });
  const by = await userNames(rows.map((r) => r.createdBy));
  res.json({ data: rows.map((r) => triageView(r, by)) });
});

/**
 * Runs the LLM adapter over the case facts (checks, computed risk, declared PEP / source of funds, missing evidence) and stores the
 * result as advisory only: it never changes the case, the rating or any check. Re-running on unchanged facts returns the stored triage.
 */
coOnboardingRoutes.post('/onboarding/cases/:id/triage', requirePermission('onboarding.manage'), idempotent('co.kyc_triage', { required: false }), async (req, res) => {
  const c = await loadCase(param(req, 'id'));
  const w = await workup(c.id);
  const input: TriageInput = {
    caseRef: c.ref,
    applicant: { name: w.case.name, type: c.application.applicantType, country: w.app.country, pep: w.app.pep, sourceOfFunds: w.app.sourceOfFunds, expectedInvestment: w.app.expectedInvestment, owners: w.app.owners },
    checks: w.checks.map((x) => ({ kind: x.kind, outcome: x.outcome })),
    riskPreview: { score: w.riskPreview.score, rating: w.riskPreview.rating, factors: w.riskPreview.factors.map((f) => f.label) },
    openReferrals: w.gates.openReferrals,
    missingEvidence: w.gates.missingEvidence,
    blockers: w.gates.blockers,
  };
  const inputSha256 = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const latest = await prisma.onboardingTriage.findFirst({ where: { caseId: c.id }, orderBy: { createdAt: 'desc' } });
  let row = latest && latest.inputSha256 === inputSha256 ? latest : null;
  if (!row) {
    const result = await getLlmAdapter().triage(input);
    row = await prisma.$transaction(async (tx) => {
      const t = await tx.onboardingTriage.create({
        data: { caseId: c.id, riskBand: result.riskBand, summary: result.summary.slice(0, 4000), flags: result.flags as unknown as Prisma.InputJsonValue, nextSteps: result.nextSteps as unknown as Prisma.InputJsonValue, model: result.model.slice(0, 60), inputSha256, createdBy: req.user!.id },
      });
      await writeAudit(tx, audit(req), { action: 'kyc.triage_generated', objectType: 'kyc_case', objectId: c.id, after: { triageId: t.id, riskBand: result.riskBand, flags: result.flags.length, model: result.model } });
      return t;
    });
  }
  res.status(201).json({ data: triageView(row, await userNames([row.createdBy])) });
});
