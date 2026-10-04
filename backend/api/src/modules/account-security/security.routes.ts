import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { passwordSchema, type PortalId } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { ctx, param } from '../../lib/http';
import { sha256Hex } from '../../lib/crypto';
import { idempotent } from '../../lib/idempotency';
import { policy } from '../../lib/policy';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requireStepUp } from '../../middleware/requireAuth';
import { hashPassword, verifyPassword } from '../../auth/password';
import { hashToken, readSessionToken } from '../../auth/session';

/**
 * `/api/v1/account` - the signed-in user's own security settings, for every portal (FR-LP-102, FR-AUTH-018): MFA status
 * and backup codes, active sessions, session revocation and password change. Enrolment itself is `/auth/mfa/enroll` +
 * `/auth/mfa/verify`. Every handler works only on `req.user`; there is no user id in any path.
 */
export const accountSecurityRoutes = Router();
accountSecurityRoutes.use(requireAuth);

const BACKUP_CODE_COUNT = 10;

/** Portal for the audit trail: the first portal the user holds a role in (the caller's own portal in practice). */
function auditCtx(req: Request) {
  const portal = (req.user!.roles[0]?.portal ?? undefined) as PortalId | undefined;
  return ctx(req, portal);
}

export const normaliseBackupCode = (v: string) => v.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
export const hashBackupCode = (v: string) => sha256Hex(`mfa-backup:${normaliseBackupCode(v)}`);

function newBackupCode(): string {
  const hex = randomBytes(5).toString('hex');
  return `${hex.slice(0, 5)}-${hex.slice(5)}`;
}

accountSecurityRoutes.get('/security', async (req, res) => {
  const user = req.user!;
  const currentToken = readSessionToken(req);
  const currentHash = currentToken ? hashToken(currentToken) : null;
  const [factor, sessions, backupLeft, required] = await Promise.all([
    prisma.userMfaFactor.findFirst({ where: { userId: user.id, verifiedAt: { not: null } }, select: { verifiedAt: true } }),
    prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() }, mfaPending: false }, orderBy: { lastUsedAt: 'desc' }, take: 20 }),
    prisma.userMfaBackupCode.count({ where: { userId: user.id, usedAt: null } }),
    policy('mfa_required'),
  ]);
  res.json({
    data: {
      email: user.email,
      mfa: { enrolled: !!factor, enrolledAt: factor?.verifiedAt?.toISOString() ?? null, required: Boolean(required), backupCodesRemaining: backupLeft },
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.tokenHash === currentHash,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        userAgent: s.userAgent,
        ip: s.ipAddress,
      })),
    },
  });
});

const passwordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

/** Changes the signed-in user's password; every other session is signed out. */
accountSecurityRoutes.post('/security/password', idempotent('account.password_change', { required: false }), validateBody(passwordBody), async (req, res) => {
  const b = req.body as z.infer<typeof passwordBody>;
  const row = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
  if (!row?.passwordHash || !(await verifyPassword(b.currentPassword, row.passwordHash))) {
    throw new HttpError(400, 'invalid_current_password', 'Your current password is not correct');
  }
  if (b.currentPassword === b.newPassword) throw HttpError.badRequest('Choose a password you have not used just now');
  const passwordHash = await hashPassword(b.newPassword);
  const token = readSessionToken(req);
  const keep = token ? hashToken(token) : '';
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user!.id }, data: { passwordHash } });
    const gone = await tx.session.deleteMany({ where: { userId: req.user!.id, tokenHash: { not: keep } } });
    await writeAudit(tx, auditCtx(req), { action: 'auth.password.changed', objectType: 'user', objectId: req.user!.id, after: { otherSessionsRevoked: gone.count } });
    return gone.count;
  });
  res.json({ data: { ok: true, otherSessionsRevoked: revoked } });
});

/** `POST .../revoke` is the same action for clients without a DELETE helper. */
accountSecurityRoutes.delete('/security/sessions/:id', revokeSession);
accountSecurityRoutes.post('/security/sessions/:id/revoke', revokeSession);

async function revokeSession(req: Request, res: Response) {
  const id = param(req, 'id');
  const token = readSessionToken(req);
  const target = await prisma.session.findFirst({ where: { id, userId: req.user!.id } });
  if (!target) throw HttpError.notFound('Session not found');
  if (token && target.tokenHash === hashToken(token)) throw HttpError.conflict('That is this browser. Use Sign out instead.', 'current_session');
  await prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id } });
    await writeAudit(tx, auditCtx(req), { action: 'auth.session.revoked', objectType: 'session', objectId: id, after: { userId: req.user!.id } });
  });
  res.json({ data: { ok: true } });
}

accountSecurityRoutes.post('/security/sessions/revoke-others', async (req, res) => {
  const token = readSessionToken(req);
  const keep = token ? hashToken(token) : '';
  const count = await prisma.$transaction(async (tx) => {
    const gone = await tx.session.deleteMany({ where: { userId: req.user!.id, tokenHash: { not: keep } } });
    await writeAudit(tx, auditCtx(req), { action: 'auth.sessions.revoked_others', objectType: 'user', objectId: req.user!.id, after: { count: gone.count } });
    return gone.count;
  });
  res.json({ data: { ok: true, revoked: count } });
});

/**
 * (Re)generates the recovery codes. Needs an enrolled authenticator and a fresh step-up. The plain codes are returned
 * once; only their hashes are stored, and generating a new set voids the old one.
 */
accountSecurityRoutes.post('/security/mfa/backup-codes', requireStepUp, async (req, res) => {
  const userId = req.user!.id;
  const factor = await prisma.userMfaFactor.findFirst({ where: { userId, verifiedAt: { not: null } }, select: { id: true } });
  if (!factor) throw HttpError.conflict('Set up your authenticator app before creating backup codes', 'mfa_not_enrolled');
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  await prisma.$transaction(async (tx) => {
    await tx.userMfaBackupCode.deleteMany({ where: { userId } });
    await tx.userMfaBackupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashBackupCode(c) })) });
    await writeAudit(tx, auditCtx(req), { action: 'auth.mfa.backup_codes_generated', objectType: 'user', objectId: userId, after: { count: codes.length } });
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { codes, count: codes.length } });
});
