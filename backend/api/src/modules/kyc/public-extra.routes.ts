import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { emailSchema } from '@matanho/shared';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { randomToken, safeEqualHex } from '../../lib/crypto';
import { param } from '../../lib/http';
import { hashToken } from '../../auth/session';
import { validateBody } from '../../middleware/validate';
import { EVIDENCE_SLOTS, V65_INVESTOR_TYPES, requiredSlots, type KycStage } from './constants';
import { addEvent } from './kyc.service';

/**
 * Public onboarding extras (R4-6): wizard metadata, magic-link resume, the applicant status
 * tracker and the applicant's reply during an admin "request more information" loop-back.
 * Mounted under the same `/public` prefix as the core applications API.
 */
export const onboardingExtraRoutes = Router();

const RESUME_LINK_TTL_MS = 24 * 3_600_000;
const DRAFT_TOKEN_TTL_MS = 30 * 86_400_000;
const ENTITY_REPLY_MAX = 4000;

const resumeRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 5 : 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many resume requests, try again later' } },
});
const resumeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isProduction ? 30 : 500, standardHeaders: 'draft-7', legacyHeaders: false });

const actor = (req: Request) => ({ actorRole: 'Applicant', portal: 'onboarding', ip: req.ip, requestId: req.requestId });

/** Applicant-facing label for each internal stage. Screening and enhanced review are not disclosed. */
const PUBLIC_STAGE: Record<KycStage, { key: string; label: string }> = {
  Submitted: { key: 'received', label: 'Received' },
  Screening: { key: 'received', label: 'Received' },
  ComplianceReview: { key: 'review', label: 'Under review' },
  EnhancedReview: { key: 'review', label: 'Under review' },
  ClientAction: { key: 'action', label: 'Information needed' },
  Approved: { key: 'decision', label: 'Approved' },
  Activation: { key: 'decision', label: 'Approved' },
  Active: { key: 'decision', label: 'Account active' },
  Rejected: { key: 'decision', label: 'Decision issued' },
};

/** Event titles an applicant may see; everything else on the case timeline is internal. */
const VISIBLE_EVENT = /^(Online application submitted|Evidence requested from applicant|Message to applicant|Applicant uploaded evidence|Applicant reply|Returned to compliance review)/;

async function appForToken(req: Request) {
  const id = param(req, 'id');
  const token = req.get('x-draft-token') ?? '';
  const app = await prisma.onboardingApplication.findUnique({ where: { id }, include: { kycCase: true } });
  if (!app || !app.draftTokenHash || !token || !safeEqualHex(app.draftTokenHash, hashToken(token))) {
    throw HttpError.notFound('Application not found or link expired');
  }
  if (app.draftTokenExpiresAt && app.draftTokenExpiresAt < new Date()) throw HttpError.notFound('Application not found or link expired');
  return app;
}

/** Wizard metadata so the portal never hard-codes entity types, slots or required documents. */
onboardingExtraRoutes.get('/onboarding/meta', (_req, res) => {
  const types = [...V65_INVESTOR_TYPES];
  res.json({
    investorTypes: types.map((t) => ({ value: t, entity: t !== 'Individual / HNW', requiredSlots: requiredSlots(t) })),
    slots: Object.entries(EVIDENCE_SLOTS).map(([key, label]) => ({ key, label })),
    maxUploadMb: Math.round(config.storage.maxUploadBytes / 1_048_576),
    acceptedFileTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
  });
});

const resumeRequestSchema = z.object({ email: emailSchema });

/**
 * Lost the browser? Asks for a magic link. Always answers 202 so the endpoint cannot be used to
 * discover which emails have applications. A link is issued at most once per two minutes per application.
 */
onboardingExtraRoutes.post('/onboarding/resume-link', resumeRequestLimiter, validateBody(resumeRequestSchema), async (req, res) => {
  const { email } = req.body as z.infer<typeof resumeRequestSchema>;
  const since = new Date(Date.now() - 90 * 86_400_000);
  const apps = await prisma.onboardingApplication.findMany({
    where: { email, updatedAt: { gte: since }, OR: [{ status: 'Draft' }, { kycCase: { is: { stage: 'ClientAction' } } }] },
    select: { id: true, ref: true, legalName: true, status: true },
    orderBy: { updatedAt: 'desc' },
    take: 3,
  });
  for (const app of apps) {
    const recent = await prisma.onboardingResumeLink.findFirst({
      where: { applicationId: app.id, usedAt: null, createdAt: { gte: new Date(Date.now() - 120_000) } },
    });
    if (recent) continue;
    const token = randomToken();
    await prisma.$transaction(async (tx) => {
      await tx.onboardingResumeLink.create({
        data: { applicationId: app.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESUME_LINK_TTL_MS), requestIp: (req.ip ?? '').slice(0, 64) || null },
      });
      await enqueue(tx, 'email.send', {
        to: email,
        subject: app.ref ? `Matanho application ${app.ref}: continue` : 'Continue your Matanho application',
        text:
          `Hello,\n\nUse this one-time private link to ${app.status === 'Draft' ? 'continue your application draft' : 'respond to our request for information'} (valid 24 hours):\n` +
          `${config.portalUrls.onboarding}/resume?link=${token}\n\nIf you did not ask for this, ignore this email; nothing changes.`,
      });
      await writeAudit(tx, actor(req), { action: 'application.resume_link.issued', objectType: 'onboarding_application', objectId: app.id });
    });
  }
  res.status(202).json({ ok: true });
});

const exchangeSchema = z.object({ link: z.string().min(20).max(200) });

/**
 * Exchanges a single-use magic link for a fresh draft token. The first call wins; replays are
 * rejected, so a forwarded or prefetched email link cannot be reused.
 */
onboardingExtraRoutes.post('/onboarding/resume', resumeLimiter, validateBody(exchangeSchema), async (req, res) => {
  const { link } = req.body as z.infer<typeof exchangeSchema>;
  const row = await prisma.onboardingResumeLink.findUnique({ where: { tokenHash: hashToken(link) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw HttpError.notFound('This link has expired or was already used. Request a new one.');
  const token = randomToken();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.onboardingResumeLink.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw HttpError.notFound('This link has expired or was already used. Request a new one.');
    await tx.onboardingApplication.update({
      where: { id: row.applicationId },
      data: { draftTokenHash: hashToken(token), draftTokenExpiresAt: new Date(Date.now() + DRAFT_TOKEN_TTL_MS), emailVerifiedAt: new Date() },
    });
    await writeAudit(tx, actor(req), { action: 'application.resume_link.used', objectType: 'onboarding_application', objectId: row.applicationId });
  });
  res.json({ id: row.applicationId, token });
});

/** Status tracker: applicant-safe stage, what we are waiting for, and the visible timeline. */
onboardingExtraRoutes.get('/applications/:id/status', async (req, res) => {
  const app = await appForToken(req);
  if (app.status === 'Draft' || !app.kycCase) {
    res.json({ status: { ref: app.ref, submitted: false, stage: { key: 'draft', label: 'Draft' }, steps: [], updates: [], requested: null } });
    return;
  }
  const c = app.kycCase;
  const stage = (c.stage in PUBLIC_STAGE ? c.stage : 'Submitted') as KycStage;
  const pub = PUBLIC_STAGE[stage];
  const events = await prisma.kycCaseEvent.findMany({ where: { caseId: c.id }, orderBy: { at: 'asc' } });
  const visible = events.filter((e) => VISIBLE_EVENT.test(e.title));
  const reached = new Set(['received']);
  if (['ComplianceReview', 'EnhancedReview', 'ClientAction', 'Approved', 'Rejected', 'Activation', 'Active'].includes(c.stage)) reached.add('review');
  if (['Approved', 'Rejected', 'Activation', 'Active'].includes(c.stage)) reached.add('decision');
  const currentKey = pub.key === 'action' ? 'review' : pub.key;
  const steps = [
    { key: 'received', label: 'Received' },
    { key: 'review', label: 'Under review' },
    { key: 'decision', label: stage === 'Rejected' ? 'Decision issued' : 'Decision' },
  ].map((s) => ({ ...s, done: reached.has(s.key) && (s.key !== currentKey || s.key === 'decision'), current: s.key === currentKey }));
  let requested: { slots: { key: string; label: string; received: boolean }[]; message: string | null; dueAt: string | null } | null = null;
  if (c.stage === 'ClientAction') {
    const ev = await prisma.kycEvidence.findMany({ where: { applicationId: app.id, status: { in: ['Missing', 'Requested'] }, fileId: null } });
    const lastAsk = [...visible].reverse().find((e) => e.title.startsWith('Evidence requested') || e.title.startsWith('Message to applicant'));
    requested = {
      slots: ev.map((e) => ({ key: e.slot, label: e.label, received: false })),
      message: lastAsk?.detail ?? null,
      dueAt: c.slaDueAt?.toISOString() ?? null,
    };
  }
  res.json({
    status: {
      ref: app.ref,
      submitted: true,
      submittedAt: app.submittedAt?.toISOString() ?? null,
      stage: { key: pub.key, label: pub.label },
      steps,
      updates: visible.map((e) => ({ at: e.at.toISOString(), title: e.title, detail: e.detail })),
      requested,
    },
  });
});

const replySchema = z.object({ message: z.string().trim().min(1).max(ENTITY_REPLY_MAX) });

/** Applicant answers a request for information. Repeating the same text is a no-op (idempotent). */
onboardingExtraRoutes.post('/applications/:id/reply', validateBody(replySchema), async (req, res) => {
  const app = await appForToken(req);
  const c = app.kycCase;
  if (!c || !['ClientAction', 'ComplianceReview'].includes(c.stage)) {
    throw HttpError.conflict('There is no open request to reply to', 'no_open_request');
  }
  const { message } = req.body as z.infer<typeof replySchema>;
  const last = await prisma.kycCaseEvent.findFirst({ where: { caseId: c.id, title: 'Applicant reply' }, orderBy: { at: 'desc' } });
  if (last?.detail === message) {
    res.json({ ok: true, duplicate: true });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await addEvent(tx, c.id, 'Applicant reply', message);
    await enqueue(tx, 'notify.permission', {
      permission: 'onboarding.manage',
      type: 'kyc.applicant.reply',
      title: `${app.legalName ?? app.ref ?? app.email}: applicant replied`,
      body: message.slice(0, 200),
      link: '/#onboarding',
    });
    await writeAudit(tx, actor(req), { action: 'kyc.applicant.replied', objectType: 'kyc_case', objectId: c.id, after: { length: message.length } });
  });
  res.status(201).json({ ok: true, duplicate: false });
});
