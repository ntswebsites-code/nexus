import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { PortalId } from '@matanho/shared';
import { config } from '../../config';
import { HttpError } from '../../lib/errors';
import { actorName, param } from '../../lib/http';
import { sha256Hex as sha256 } from '../../lib/crypto';
import { validateBody } from '../../middleware/validate';
import { uploadFiles } from '../../middleware/upload';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { maskEmail } from './esign.logic';
import {
  createRequest,
  declineRequest,
  directory,
  fileForSigner,
  getRequestView,
  integrityReport,
  listForUser,
  listRequests,
  loadByToken,
  pdfDocuments,
  recordViewed,
  requestFile,
  resendRequest,
  sendOtp,
  sendRequest,
  signRequest,
  signerForUser,
  signerSideView,
  verifyByHash,
  verifyOtp,
  verifyProof,
  voidRequest,
  type EsignActor,
} from './esign.service';
import { requestCapitalCallAckSignature, requestCommitmentSignature } from './esign.flows';

/**
 * `/api/v1/esign`
 *   /public/*  external signers (one-time token link + e-mail OTP) and the hash verifier - no session
 *   /me/*      signers who are signed in (staff, LP signatories, investee authorised signatories)
 *   /*         staff operations (esign.view / esign.manage / esign.void)
 */
export const esignRoutes = Router();

function actorOf(req: Request, portal: PortalId | null, external?: string): EsignActor {
  const roles = req.user?.roles.filter((r) => !portal || r.portal === portal).map((r) => r.label).join(', ');
  return {
    userId: req.user?.id ?? null,
    name: external ?? (req.user ? actorName(req) : null),
    role: external ? 'External signer' : roles || null,
    portal,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: req.requestId ?? null,
  };
}

function sendPdf(res: Response, name: string, data: Buffer, inline: boolean) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.\- ]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(data);
}

const signSchema = z.object({
  mode: z.enum(['TYPED', 'DRAWN']),
  typedName: z.string().trim().max(160).optional(),
  drawnPng: z.string().max(220_000).optional(),
  consent: z.boolean(),
});
const declineSchema = z.object({ reason: z.string().trim().min(3).max(500) });

// ============================================================== public (no session)

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 120 : 2000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests, try again later' } },
});
const publicRoutes = Router();
publicRoutes.use(publicLimiter);

/** Verify a document: upload the PDF (multipart `file`) or post `{ sha256 }`. */
publicRoutes.post('/verify', uploadFiles('file', 1), async (req, res) => {
  const hash = req.file ? sha256(req.file.buffer) : z.object({ sha256: z.string() }).parse(req.body ?? {}).sha256;
  res.json(await verifyByHash(hash));
});

publicRoutes.get('/:token', async (req, res) => {
  const { req: r, signer } = await loadByToken(param(req, 'token'));
  res.json({
    request: { ref: r.ref, title: r.title, message: r.message, status: r.status, expiresAt: r.expiresAt },
    signer: { name: signer.name, email: maskEmail(signer.email), roleLabel: signer.roleLabel, status: signer.status },
    canSign: r.status === 'PENDING' && signer.status === 'PENDING',
  });
});

publicRoutes.post('/:token/otp', async (req, res) => {
  await sendOtp(actorOf(req, null), param(req, 'token'));
  res.json({ sent: true });
});

publicRoutes.post('/:token/verify-otp', validateBody(z.object({ code: z.string().trim().regex(/^\d{6}$/) })), async (req, res) => {
  res.json(await verifyOtp(actorOf(req, null), param(req, 'token'), req.body.code));
});

async function proven(req: Request) {
  const { req: r, signer } = await loadByToken(param(req, 'token'));
  const proof = req.get('x-esign-proof') ?? (typeof req.body?.proof === 'string' ? req.body.proof : undefined);
  if (!verifyProof(signer.id, proof)) throw new HttpError(401, 'esign_identity_required', 'Confirm your e-mail address with the one-time code first');
  return { r, signer };
}

publicRoutes.get('/:token/document', async (req, res) => {
  const { r, signer } = await proven(req);
  await recordViewed(actorOf(req, null, signer.name), signer, r.id);
  const { file, data } = await fileForSigner(r);
  sendPdf(res, file.name, data, true);
});

publicRoutes.post('/:token/sign', validateBody(signSchema.extend({ proof: z.string().optional() })), async (req, res) => {
  const { r, signer } = await proven(req);
  const view = await signRequest(actorOf(req, null, signer.name), r.id, signer.id, { method: 'EMAIL_OTP' }, req.body);
  res.json({ signed: true, status: view.status, ref: view.ref });
});

publicRoutes.post('/:token/decline', validateBody(declineSchema.extend({ proof: z.string().optional() })), async (req, res) => {
  const { r, signer } = await proven(req);
  const view = await declineRequest(actorOf(req, null, signer.name), r.id, signer.id, req.body.reason);
  res.json({ declined: true, status: view.status });
});

esignRoutes.use('/public', publicRoutes);

// ============================================================== signed-in signers

const meRoutes = Router();
meRoutes.use(requireAuth);

meRoutes.get('/requests', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json({ data: await listForUser(req.user!.id, status) });
});

meRoutes.get('/requests/:id', async (req, res) => {
  const { req: r, signer } = await signerForUser(req.user!.id, param(req, 'id'));
  res.json({ request: signerSideView(r, signer), actionable: r.status === 'PENDING' && signer.status === 'PENDING' });
});

meRoutes.get('/requests/:id/document', async (req, res) => {
  const { req: r, signer } = await signerForUser(req.user!.id, param(req, 'id'));
  await recordViewed(actorOf(req, null), signer, r.id);
  const variant = req.query.variant === 'certificate' ? 'certificate' : 'document';
  const { file, data } = await fileForSigner(r, variant);
  sendPdf(res, file.name, data, req.query.download !== '1');
});

meRoutes.post('/requests/:id/sign', requireStepUp, validateBody(signSchema), async (req, res) => {
  const { req: r, signer } = await signerForUser(req.user!.id, param(req, 'id'));
  const view = await signRequest(actorOf(req, null), r.id, signer.id, { method: 'SESSION', mfaAt: req.authSession?.mfaVerifiedAt ?? null }, req.body);
  res.json({ signed: true, status: view.status, ref: view.ref });
});

meRoutes.post('/requests/:id/decline', validateBody(declineSchema), async (req, res) => {
  const { req: r, signer } = await signerForUser(req.user!.id, param(req, 'id'));
  const view = await declineRequest(actorOf(req, null), r.id, signer.id, req.body.reason);
  res.json({ declined: true, status: view.status });
});

esignRoutes.use('/me', meRoutes);

// ============================================================== staff

const staff = Router();
staff.use(requireAuth, requirePortalAccess('admin'));
const adminActor = (req: Request) => actorOf(req, 'admin');

const signerInput = z.object({
  kind: z.enum(['STAFF', 'LP', 'INVESTEE', 'EXTERNAL']).optional(),
  userId: z.string().trim().max(40).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  roleLabel: z.string().trim().max(160).optional(),
  orderNo: z.number().int().min(1).max(12).optional(),
  clientId: z.string().trim().max(40).optional(),
  companyId: z.string().trim().max(40).optional(),
});

const createSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    message: z.string().trim().max(2000).optional(),
    documentId: z.string().trim().max(40).optional(),
    fileId: z.string().trim().max(40).optional(),
    signingOrder: z.enum(['SEQUENTIAL', 'PARALLEL']).default('PARALLEL'),
    signers: z.array(signerInput).min(1).max(12),
    expiresInDays: z.number().int().min(1).max(90).optional(),
    subjectType: z.string().trim().max(40).optional(),
    subjectId: z.string().trim().max(64).optional(),
    clientId: z.string().trim().max(40).optional(),
    companyId: z.string().trim().max(40).optional(),
    send: z.boolean().default(true),
  })
  .refine((v) => !!v.documentId !== !!v.fileId, { message: 'Provide either documentId or fileId' });

const flowSchema = z.object({
  signerUserIds: z.array(z.string().max(40)).max(12).optional(),
  countersignerUserId: z.string().max(40).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  send: z.boolean().optional(),
});

staff.get('/requests', requirePermission('esign.view'), async (req, res) => {
  const s = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
  res.json(await listRequests({ status: s('status'), q: s('q'), subjectType: s('subjectType'), subjectId: s('subjectId') }));
});

staff.get('/requests/:id', requirePermission('esign.view'), async (req, res) => {
  res.json({ request: await getRequestView(param(req, 'id'), true) });
});

staff.post('/requests', requirePermission('esign.manage'), validateBody(createSchema), async (req, res) => {
  res.status(201).json({ request: await createRequest(adminActor(req), req.body) });
});

staff.post('/requests/:id/send', requirePermission('esign.manage'), async (req, res) => {
  res.json({ request: await sendRequest(adminActor(req), param(req, 'id')) });
});

staff.post('/requests/:id/resend', requirePermission('esign.manage'), validateBody(z.object({ signerId: z.string().max(40).optional() })), async (req, res) => {
  res.json({ request: await resendRequest(adminActor(req), param(req, 'id'), req.body.signerId) });
});

staff.post('/requests/:id/void', requirePermission('esign.void'), validateBody(z.object({ reason: z.string().trim().min(3).max(500) })), async (req, res) => {
  res.json({ request: await voidRequest(adminActor(req), param(req, 'id'), req.body.reason) });
});

staff.get('/requests/:id/verify', requirePermission('esign.view'), async (req, res) => {
  res.json(await integrityReport(param(req, 'id')));
});

for (const variant of ['original', 'sealed', 'certificate'] as const) {
  staff.get(`/requests/:id/${variant}`, requirePermission('esign.view'), async (req, res) => {
    const { req: r, data } = await requestFile(param(req, 'id'), variant);
    sendPdf(res, `${r.ref}-${variant === 'sealed' ? 'signed' : variant}.pdf`, data, req.query.inline === '1');
  });
}

staff.get('/directory', requirePermission('esign.view'), async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind.toUpperCase() : 'STAFF';
  const s = (k: string) => (typeof req.query[k] === 'string' && req.query[k] ? (req.query[k] as string) : undefined);
  res.json({ data: await directory(kind, { q: s('q'), clientId: s('clientId'), companyId: s('companyId') }) });
});

staff.get('/documents', requirePermission('esign.view'), async (req, res) => {
  res.json({ data: await pdfDocuments(typeof req.query.q === 'string' ? req.query.q : undefined) });
});

staff.post('/flows/commitment/:commitmentId', requirePermission('esign.manage'), validateBody(flowSchema), async (req, res) => {
  res.status(201).json({ request: await requestCommitmentSignature(adminActor(req), param(req, 'commitmentId'), req.body) });
});

staff.post('/flows/capital-call-ack/:allocationId', requirePermission('esign.manage'), validateBody(flowSchema), async (req, res) => {
  res.status(201).json({ request: await requestCapitalCallAckSignature(adminActor(req), param(req, 'allocationId'), req.body) });
});

esignRoutes.use(staff);
