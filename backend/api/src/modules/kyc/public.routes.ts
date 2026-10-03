import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { emailSchema } from '@matanho/shared';
import { config } from '../../config';
import { applicantFormView, mapPublicForm, normaliseOwners, v65Missing } from './public-form';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { encryptField, randomToken, safeEqualHex } from '../../lib/crypto';
import { storeFile } from '../../lib/storage';
import { param } from '../../lib/http';
import { hashToken } from '../../auth/session';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { EVIDENCE_SLOTS, SLOT_KEYS, V65_SLOT_MAP, requiredSlots, slaDue, type EvidenceSlot } from './constants';
import { addEvent } from './kyc.service';
import { onboardingExtraRoutes } from './public-extra.routes';

/**
 * Public onboarding (SRD 5.C, FR-ONB-001..007). No account: a draft is owned by
 * whoever holds its draft token - the browser that created it, or the applicant
 * following the emailed magic link. The token travels in `X-Draft-Token`.
 */
export const publicOnboardingRoutes = Router();

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.isProduction ? 20 : 500,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many applications from this network, try again later' } },
});
const draftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 600 : 5000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
publicOnboardingRoutes.use(draftLimiter);

const DRAFT_TTL_MS = 30 * 86_400_000;
/** Version of the consent wording shown on the V65 review step (FR-ONB-038). */
const CONSENT_VERSION = 'v65-2026-10';

// No `.default()` on these: zod 4 applies defaults even under `.optional()`, which would turn
// a bare `{ consent: true }` submit into an empty form that overwrites the draft.
const formFields = z.record(z.string(), z.string().max(4000));
const ownerObject = z.object({
  name: z.string().max(200).default(''),
  nationality: z.string().max(80).optional(),
  id: z.string().max(80).optional(),
  pct: z.union([z.string().max(20), z.number()]).optional(),
});
const ownersSchema = z.array(z.union([z.array(z.string().max(200)).max(3), ownerObject])).max(20);
const signatoriesSchema = z
  .array(z.object({ name: z.string().max(160).default(''), role: z.string().max(120).default(''), email: z.string().max(254).default('') }))
  .max(20);

export async function draftFor(req: Request, opts: { allowSubmitted?: boolean } = {}) {
  const id = param(req, 'id');
  const token = req.get('x-draft-token') ?? '';
  const app = await prisma.onboardingApplication.findUnique({ where: { id }, include: { owners: true, kycCase: true } });
  if (!app || !app.draftTokenHash || !token || !safeEqualHex(app.draftTokenHash, hashToken(token))) {
    throw HttpError.notFound('Application not found or link expired');
  }
  if (app.draftTokenExpiresAt && app.draftTokenExpiresAt < new Date()) {
    throw HttpError.notFound('Application not found or link expired');
  }
  // Submitted applications stay reachable only while the case waits on the applicant.
  if (app.status !== 'Draft' && !opts.allowSubmitted) {
    throw HttpError.conflict('This application has already been submitted', 'already_submitted');
  }
  return app;
}

type DraftApp = Awaited<ReturnType<typeof draftFor>>;
type FormBody = {
  form: Record<string, string>;
  owners?: z.infer<typeof ownersSchema>;
  signatories?: z.infer<typeof signatoriesSchema>;
  directors?: z.infer<typeof signatoriesSchema>;
};

/** Writes form, owners and signatories of a PATCH or submit body in one transaction. */
async function saveForm(app: DraftApp, body: FormBody) {
  const owners = body.owners ? normaliseOwners(body.owners as (string[] | Record<string, unknown>)[]) : undefined;
  const { data, formData } = mapPublicForm(body.form, { owners, signatories: body.signatories, directors: body.directors }, app.formData as Record<string, unknown> | null);
  await prisma.$transaction(async (tx) => {
    await tx.onboardingApplication.update({
      where: { id: app.id },
      data: { ...data, formData: formData as Prisma.InputJsonValue } as Prisma.OnboardingApplicationUpdateInput,
    });
    if (owners) {
      // A resumed draft never receives owner id numbers back, so a blank id keeps the one on file.
      const keep = new Map((await tx.beneficialOwner.findMany({ where: { applicationId: app.id } })).map((o) => [o.fullName, o.idNumberEnc]));
      await tx.beneficialOwner.deleteMany({ where: { applicationId: app.id } });
      if (owners.length) {
        await tx.beneficialOwner.createMany({
          data: owners.map((o) => {
            const pct = Number(o.pct);
            const has = Number.isFinite(pct) && o.pct !== '';
            return {
              applicationId: app.id,
              fullName: o.name,
              idNumberEnc: o.id ? encryptField(o.id) : (keep.get(o.name) ?? null),
              ownershipPct: has ? Math.min(100, Math.max(0, pct)) : null,
              isController: has && pct >= 25,
            };
          }),
        });
      }
    }
  });
}

async function evidenceList(applicationId: string) {
  const rows = await prisma.kycEvidence.findMany({ where: { applicationId } });
  const files = new Map(
    (await prisma.fileObject.findMany({ where: { id: { in: rows.map((r) => r.fileId).filter((x): x is string => !!x) } } })).map((f) => [f.id, f]),
  );
  return rows.map((r) => {
    const f = r.fileId ? files.get(r.fileId) : undefined;
    return {
      slot: r.slot,
      label: r.label,
      status: f ? r.status : 'Requested',
      name: f?.name ?? null,
      size: f?.size ?? null,
      mime: f?.mime ?? null,
      sha256: f?.sha256 ?? null,
      scanStatus: f?.scanStatus ?? null,
    };
  });
}

async function view(app: DraftApp) {
  const stored = app.formData as Record<string, unknown> | null;
  const { form, bankAccountOnFile, signatories, directors } = applicantFormView(stored);
  const storedOwners = Array.isArray(stored?.owners) ? (stored.owners as { name: string; nationality?: string }[]) : [];
  const nationality = new Map(storedOwners.map((o) => [o.name, o.nationality ?? '']));
  // Resume in the order the applicant entered. beneficial_owners has no position column,
  // and unordered reads come back by random uuid, which swapped ownerDetails[1].
  const byName = new Map(app.owners.map((o) => [o.fullName, o]));
  const ordered = storedOwners.flatMap((o) => {
    const row = byName.get(o.name);
    return row ? [row] : [];
  });
  for (const row of app.owners) {
    if (!ordered.includes(row)) ordered.push(row);
  }
  const ownerRows = ordered.map((o) => ({
    name: o.fullName,
    nationality: nationality.get(o.fullName) ?? '',
    id: '',
    pct: o.ownershipPct ? String(o.ownershipPct.toNumber()) : '',
  }));
  return {
    id: app.id,
    ref: app.ref,
    status: app.status,
    email: app.email,
    form,
    taxIdOnFile: !!app.taxIdEnc,
    bankAccountOnFile,
    owners: ownerRows.map((o) => [o.name, '', o.pct]),
    ownerDetails: ownerRows,
    signatories,
    directors,
    evidence: await evidenceList(app.id),
    requiredSlots: requiredSlots(app.applicantType),
    requestedSlots: app.kycCase?.stage === 'ClientAction' ? (await evidenceList(app.id)).filter((e) => e.status === 'Requested').map((e) => e.slot) : [],
    caseStage: app.kycCase?.stage ?? null,
  };
}

// ------------------------------------------------------------------ routes

const createSchema = z.object({
  email: emailSchema,
  applicantType: z.string().trim().max(64).optional(),
  name: z.string().trim().max(200).optional(),
  sendLink: z.boolean().default(true),
});

/** Starts a draft. Returns the draft token to this browser and emails a resume link. */
publicOnboardingRoutes.post('/applications', createLimiter, validateBody(createSchema), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  const token = randomToken();
  const app = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingApplication.create({
      data: {
        email: b.email,
        applicantType: b.applicantType || 'Individual',
        legalName: b.name || null,
        draftTokenHash: hashToken(token),
        draftTokenExpiresAt: new Date(Date.now() + DRAFT_TTL_MS),
      },
    });
    if (b.sendLink) {
      await enqueue(tx, 'email.send', {
        to: b.email,
        subject: 'Continue your Matanho application',
        text:
          'Hello,\n\nYour Matanho application draft is saved. Continue it on any device with this private link (valid 30 days):\n' +
          `${config.portalUrls.onboarding}/?resume=${created.id}.${token}\n\nIf you did not start an application, ignore this email.`,
      });
    }
    await writeAudit(tx, { actorRole: 'Applicant', portal: 'onboarding', ip: req.ip, requestId: req.requestId }, {
      action: 'application.draft.created',
      objectType: 'onboarding_application',
      objectId: created.id,
      after: { applicantType: created.applicantType },
    });
    return created;
  });
  res.status(201).json({ id: app.id, token });
});

publicOnboardingRoutes.get('/applications/:id', async (req, res) => {
  const app = await draftFor(req, { allowSubmitted: true });
  if (req.query.verified === '1' && !app.emailVerifiedAt) {
    await prisma.onboardingApplication.update({ where: { id: app.id }, data: { emailVerifiedAt: new Date() } });
  }
  res.json({ application: await view(app) });
});

const patchSchema = z.object({
  form: formFields,
  owners: ownersSchema.optional(),
  signatories: signatoriesSchema.optional(),
  directors: signatoriesSchema.optional(),
});

/** Draft autosave. Not audited per keystroke; creation, evidence and submission are. */
publicOnboardingRoutes.patch('/applications/:id', validateBody(patchSchema), async (req, res) => {
  const app = await draftFor(req);
  await saveForm(app, req.body as z.infer<typeof patchSchema>);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

/** Evidence upload for one slot (replaces any earlier file for the slot). V65 card keys are accepted. */
publicOnboardingRoutes.post('/applications/:id/evidence', uploadFiles('file', 1), async (req, res) => {
  const app = await draftFor(req, { allowSubmitted: true });
  const raw = String(req.body?.slot ?? '');
  const slot = (V65_SLOT_MAP[raw] ?? raw) as EvidenceSlot;
  if (!SLOT_KEYS.includes(slot)) throw HttpError.badRequest('Unknown evidence slot');
  if (app.status !== 'Draft' && app.kycCase?.stage !== 'ClientAction') {
    throw HttpError.conflict('Evidence can only be added while the application is open', 'already_submitted');
  }
  const [file] = uploadedFiles(req);
  if (!file) throw HttpError.badRequest('Attach a file');
  let stored: Awaited<ReturnType<typeof storeFile>>;
  try {
    stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, applicationId: app.id });
  } catch (err) {
    if (err instanceof HttpError && err.code === 'malware_detected') {
      await prisma.$transaction((tx) =>
        writeAudit(tx, { actorRole: 'Applicant', portal: 'onboarding', ip: req.ip, requestId: req.requestId }, {
          action: 'kyc.evidence.rejected_malware',
          objectType: 'onboarding_application',
          objectId: app.id,
          after: { slot, name: file.originalname.slice(0, 200), size: file.size },
        }),
      );
    }
    throw err;
  }
  await prisma.$transaction(async (tx) => {
    await tx.kycEvidence.upsert({
      where: { applicationId_slot: { applicationId: app.id, slot } },
      create: { applicationId: app.id, caseId: app.kycCase?.id ?? null, slot, label: EVIDENCE_SLOTS[slot], fileId: stored.id, status: 'Received' },
      update: { fileId: stored.id, status: 'Received', reviewerId: null, reviewedAt: null },
    });
    if (app.kycCase) {
      await addEvent(tx, app.kycCase.id, 'Applicant uploaded evidence', `${EVIDENCE_SLOTS[slot]}: ${stored.name}`);
      // ClientAction -> ComplianceReview once every requested slot has a file (SRD 7.1).
      const open = await tx.kycEvidence.count({ where: { applicationId: app.id, fileId: null } });
      if (app.kycCase.stage === 'ClientAction' && open === 0) {
        await tx.kycCase.update({
          where: { id: app.kycCase.id },
          data: { stage: 'ComplianceReview', slaState: 'Review open', slaDueAt: slaDue('ComplianceReview'), version: { increment: 1 } },
        });
        await addEvent(tx, app.kycCase.id, 'Returned to compliance review', 'All requested evidence received.');
        await enqueue(tx, 'notify.permission', {
          permission: 'onboarding.manage',
          type: 'kyc.evidence.received',
          title: `${app.legalName ?? app.ref}: requested evidence received`,
          link: '/#onboarding',
        });
      }
    }
    await writeAudit(tx, { actorRole: 'Applicant', portal: 'onboarding', ip: req.ip, requestId: req.requestId }, {
      action: 'kyc.evidence.uploaded',
      objectType: app.kycCase ? 'kyc_case' : 'onboarding_application',
      objectId: app.kycCase?.id ?? app.id,
      after: { slot, fileId: stored.id, name: stored.name, size: stored.size, sha256: stored.sha256 },
    });
  });
  res.status(201).json({ slot, label: EVIDENCE_SLOTS[slot], name: stored.name, size: stored.size, mime: stored.mime, sha256: stored.sha256, scanStatus: stored.scanStatus });
});

const submitSchema = z.object({
  consent: z.literal(true),
  form: formFields.optional(),
  owners: ownersSchema.optional(),
  signatories: signatoriesSchema.optional(),
  directors: signatoriesSchema.optional(),
});

/** FR-ONB-004/005/006/007: consent + required evidence, then ONB ref, KYC case and queued pre-screen. */
publicOnboardingRoutes.post('/applications/:id/submit', validateBody(submitSchema), async (req, res) => {
  let app = await draftFor(req);
  const b = req.body as z.infer<typeof submitSchema>;
  if (b.form) {
    await saveForm(app, { form: b.form, owners: b.owners, signatories: b.signatories, directors: b.directors });
    app = await draftFor(req);
  }
  const stored = app.formData as Record<string, unknown> | null;
  const missingFields = [
    ['legalName', 'Legal name'],
    ['email', 'Email'],
    ['country', 'Country'],
  ]
    .filter(([k]) => !(app as unknown as Record<string, unknown>)[k!])
    .map(([, label]) => label!);
  for (const label of v65Missing(stored, app.owners.length, app.applicantType)) if (!missingFields.includes(label)) missingFields.push(label);
  const have = new Set(
    (await prisma.kycEvidence.findMany({ where: { applicationId: app.id, fileId: { not: null } }, select: { slot: true } })).map((e) => e.slot),
  );
  const missingSlots = requiredSlots(app.applicantType).filter((s) => !have.has(s));
  if (missingFields.length || missingSlots.length) {
    throw new HttpError(400, 'incomplete_application', 'Complete the missing items before submitting', {
      fields: missingFields,
      evidence: missingSlots.map((s) => EVIDENCE_SLOTS[s]),
    });
  }

  const now = new Date();
  // FR-ONB-038: signatory, capacity, consent wording version, time, IP and user agent.
  const declaration = {
    name: String(stored?.signatureName ?? ''),
    capacity: String(stored?.signatureCapacity ?? ''),
    consentVersion: CONSENT_VERSION,
    at: now.toISOString(),
    ip: req.ip ?? null,
    userAgent: (req.get('user-agent') ?? '').slice(0, 255),
  };
  const result = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'onboarding');
    const caseRef = await nextRef(tx, 'kycCase');
    await tx.onboardingApplication.update({
      where: { id: app.id },
      data: {
        ref,
        status: 'Submitted',
        submittedAt: now,
        consentAt: now,
        formData: { ...(stored ?? {}), declaration } as Prisma.InputJsonValue,
      },
    });
    const kycCase = await tx.kycCase.create({
      data: { ref: caseRef, applicationId: app.id, stage: 'Screening', slaState: 'Digital submission', slaDueAt: slaDue('Screening') },
    });
    await tx.kycEvidence.updateMany({ where: { applicationId: app.id }, data: { caseId: kycCase.id } });
    await addEvent(tx, kycCase.id, 'Online application submitted', `Investor portal submission captured with ${have.size} evidence file${have.size === 1 ? '' : 's'}.`);
    await addEvent(tx, kycCase.id, 'Automated pre-screen queued', 'Sanctions, PEP, adverse media and document checks (advisory).');
    await enqueue(tx, 'kyc.screening.requested', { caseId: kycCase.id });
    await enqueue(tx, 'email.send', {
      to: app.email,
      subject: `Matanho application received (${ref})`,
      text: `Hello,\n\nWe received your application ${ref}. Our team will review it and contact you if anything else is needed.\n\nMatanho Client Services`,
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'onboarding.manage',
      type: 'application.submitted',
      title: `New application: ${app.legalName ?? app.email}`,
      body: `${ref} submitted online; pre-screen queued.`,
      link: '/#onboarding',
    });
    await writeAudit(tx, { actorRole: 'Applicant', portal: 'onboarding', ip: req.ip, requestId: req.requestId }, {
      action: 'application.submitted',
      objectType: 'onboarding_application',
      objectId: app.id,
      after: { ref, caseRef, evidence: [...have], consentVersion: CONSENT_VERSION, signatory: declaration.name },
    });
    return { ref, caseRef };
  });
  res.json({ ref: result.ref, status: 'Submitted', screening: 'Queued' });
});

// Resume links, status tracker, applicant reply and wizard metadata (R4-6).
publicOnboardingRoutes.use(onboardingExtraRoutes);
