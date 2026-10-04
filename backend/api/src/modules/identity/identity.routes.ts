import { Prisma } from '@prisma/client';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  acceptInvitationSchema,
  forgotPasswordSchema,
  mfaCodeSchema,
  resetPasswordSchema,
  type AuthResponse,
  type InvitationPreview,
  type MfaEnrollResponse,
} from '@matanho/shared';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { ctx, param } from '../../lib/http';
import { decryptField, encryptField, randomToken } from '../../lib/crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../lib/totp';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requireAuthAllowMfaPending } from '../../middleware/requireAuth';
import { createSession, destroyUserSessions, hashToken, setSessionCookie } from '../../auth/session';
import { hashPassword, verifyPassword } from '../../auth/password';
import { loadAuthUser } from '../../services/authService';
import { maybeCompleteActivation } from '../kyc/kyc.service';
import { hashBackupCode, normaliseBackupCode } from '../account-security/security.routes';
import { lpInviteSettingKey, takeInviteGrant } from './invite-grant';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProduction ? 30 : 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts, try again later' } },
});

export const identityRoutes = Router();

// ---------------------------------------------------------------- MFA -----

/** Starts (or restarts) TOTP enrolment. The factor is inactive until a code is verified. */
identityRoutes.post('/mfa/enroll', limiter, requireAuthAllowMfaPending, async (req, res) => {
  const user = req.user!;
  const existing = await prisma.userMfaFactor.findFirst({ where: { userId: user.id, verifiedAt: { not: null } } });
  if (existing) {
    throw HttpError.conflict('Two-factor authentication is already set up', 'mfa_already_enrolled');
  }
  await prisma.userMfaFactor.deleteMany({ where: { userId: user.id, verifiedAt: null } });
  const secret = generateTotpSecret();
  await prisma.userMfaFactor.create({ data: { userId: user.id, type: 'totp', secretEnc: encryptField(secret)! } });
  res.json({ secret, otpauthUri: otpauthUri(secret, user.email) } satisfies MfaEnrollResponse);
});

async function checkCode(userId: string, code: string) {
  const factors = await prisma.userMfaFactor.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const verified = factors.find((f) => f.verifiedAt);
  const candidates = verified ? [verified] : factors.slice(0, 1);
  for (const f of candidates) {
    const secret = decryptField(f.secretEnc);
    if (secret && verifyTotp(secret, code)) return f;
  }
  return null;
}

/** Completes sign-in (or enrolment) with a TOTP code. */
identityRoutes.post('/mfa/verify', limiter, requireAuthAllowMfaPending, validateBody(mfaCodeSchema), async (req, res) => {
  const user = req.user!;
  const factor = await checkCode(user.id, req.body.code);
  if (!factor) throw new HttpError(401, 'invalid_mfa_code', 'That code is not valid. Try the latest code.');
  await prisma.$transaction(async (tx) => {
    if (!factor.verifiedAt) {
      await tx.userMfaFactor.update({ where: { id: factor.id }, data: { verifiedAt: new Date() } });
      await writeAudit(tx, ctx(req), { action: 'auth.mfa.enrolled', objectType: 'user', objectId: user.id });
    }
    await tx.session.update({
      where: { id: req.authSession!.id },
      data: { mfaPending: false, mfaVerifiedAt: new Date() },
    });
    await writeAudit(tx, ctx(req), { action: 'auth.mfa.verified', objectType: 'user', objectId: user.id });
  });
  res.json({ user } satisfies AuthResponse);
});

const recoverSchema = z.object({ code: z.string().trim().min(8).max(16) });

/** Completes sign-in with a single-use backup code when the authenticator is not at hand. */
identityRoutes.post('/mfa/recover', limiter, requireAuthAllowMfaPending, validateBody(recoverSchema), async (req, res) => {
  const user = req.user!;
  const verified = await prisma.userMfaFactor.findFirst({ where: { userId: user.id, verifiedAt: { not: null } }, select: { id: true } });
  const raw = (req.body as z.infer<typeof recoverSchema>).code;
  if (!verified || normaliseBackupCode(raw).length !== 10) throw new HttpError(401, 'invalid_mfa_code', 'That backup code is not valid.');
  const row = await prisma.userMfaBackupCode.findFirst({ where: { userId: user.id, codeHash: hashBackupCode(raw), usedAt: null } });
  if (!row) throw new HttpError(401, 'invalid_mfa_code', 'That backup code is not valid.');
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.userMfaBackupCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(401, 'invalid_mfa_code', 'That backup code is not valid.');
    await tx.session.update({ where: { id: req.authSession!.id }, data: { mfaPending: false, mfaVerifiedAt: new Date() } });
    await writeAudit(tx, ctx(req), { action: 'auth.mfa.backup_code_used', objectType: 'user', objectId: user.id });
  });
  res.json({ user } satisfies AuthResponse);
});

/** Step-up: re-confirms a code for approvals and signatures (valid five minutes). */
identityRoutes.post('/mfa/step-up', limiter, requireAuth, validateBody(mfaCodeSchema), async (req, res) => {
  const factor = await checkCode(req.user!.id, req.body.code);
  if (!factor?.verifiedAt) throw new HttpError(401, 'invalid_mfa_code', 'That code is not valid. Try the latest code.');
  await prisma.session.update({ where: { id: req.authSession!.id }, data: { mfaVerifiedAt: new Date() } });
  res.json({ ok: true, validForSeconds: 300 });
});

identityRoutes.get('/mfa/status', requireAuth, async (req, res) => {
  const factor = await prisma.userMfaFactor.findFirst({
    where: { userId: req.user!.id, verifiedAt: { not: null } },
    select: { verifiedAt: true },
  });
  res.json({ enrolled: !!factor, enrolledAt: factor?.verifiedAt ?? null });
});

// ---------------------------------------------------------------- passwords

const RESET_TTL_MS = 60 * 60 * 1000;

/** Always answers 200 so account existence cannot be probed. */
identityRoutes.post('/password/forgot', limiter, validateBody(forgotPasswordSchema), async (req, res) => {
  const { email, portal } = req.body as { email: string; portal?: keyof typeof config.portalUrls };
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true, name: true } });
  if (user?.isActive) {
    const token = randomToken();
    await prisma.$transaction(async (tx) => {
      await tx.passwordReset.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      const base = config.portalUrls[portal ?? 'admin'];
      await enqueue(tx, 'email.send', {
        to: email,
        subject: 'Reset your Matanho Nexus password',
        text:
          `Hello${user.name ? ` ${user.name}` : ''},\n\nUse this link within one hour to choose a new password:\n` +
          `${base}/reset-password?token=${encodeURIComponent(token)}\n\nIf you did not ask for this, ignore this email.`,
      });
      await writeAudit(tx, { ...ctx(req), actorId: user.id }, {
        action: 'auth.password.reset_requested',
        objectType: 'user',
        objectId: user.id,
      });
    });
  }
  res.json({ ok: true });
});

identityRoutes.post('/password/reset', limiter, validateBody(resetPasswordSchema), async (req, res) => {
  const { token, password } = req.body as { token: string; password: string };
  const reset = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    throw HttpError.badRequest('This reset link is invalid or has expired');
  }
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    await writeAudit(tx, { ...ctx(req), actorId: reset.userId }, {
      action: 'auth.password.reset',
      objectType: 'user',
      objectId: reset.userId,
    });
  });
  await destroyUserSessions(reset.userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- invitations

async function findOpenInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt < new Date()) {
    throw HttpError.notFound('This invitation is invalid, already used or expired');
  }
  return invitation;
}

identityRoutes.get('/invitations/:token', limiter, async (req, res) => {
  const invitation = await findOpenInvitation(param(req, 'token'));
  const existing = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  res.json({
    email: invitation.email,
    name: invitation.name,
    portal: invitation.portal,
    existingAccount: !!existing,
    expiresAt: invitation.expiresAt.toISOString(),
  } satisfies InvitationPreview);
});

identityRoutes.post('/invitations/accept', limiter, validateBody(acceptInvitationSchema), async (req, res) => {
  const { token, name, password } = req.body as { token: string; name?: string; password: string };
  const invitation = await findOpenInvitation(token);
  const roleKeys = (invitation.roleKeys as string[]) ?? [];

  const existing = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (existing) {
    if (!existing.isActive || !(await verifyPassword(password, existing.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials', 'Enter the current password for this existing account');
    }
  }
  const passwordHash = existing ? null : await hashPassword(password);

  const userId = await prisma.$transaction(async (tx) => {
    const user = existing
      ? { id: existing.id }
      : await tx.user.create({
          data: { email: invitation.email, passwordHash: passwordHash!, name: name ?? invitation.name ?? null },
          select: { id: true },
        });
    const roles = await tx.role.findMany({ where: { portal: invitation.portal, key: { in: roleKeys } } });
    for (const role of roles) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      });
    }
    const grant = await takeInviteGrant(tx, invitation.id);
    if (invitation.clientId) {
      const lp = grant?.kind === 'lp' ? grant : null;
      await tx.clientUser.upsert({
        where: { clientId_userId: { clientId: invitation.clientId, userId: user.id } },
        create: {
          clientId: invitation.clientId,
          userId: user.id,
          investorRole: roleKeys[0] ?? 'viewer',
          accountScope: invitation.scope ?? 'all',
          fundIds: lp?.fundIds ?? undefined,
          lpRole: lp?.lpRole ?? null,
          invitedById: lp?.invitedById ?? invitation.invitedById,
          status: 'ACTIVE',
        },
        update: {
          investorRole: roleKeys[0] ?? 'viewer',
          accountScope: invitation.scope ?? 'all',
          revokedAt: null,
          status: 'ACTIVE',
          invitedById: lp?.invitedById ?? invitation.invitedById,
          ...(lp ? { fundIds: lp.fundIds === null ? Prisma.DbNull : lp.fundIds, lpRole: lp.lpRole } : {}),
        },
      });
      await tx.setting.deleteMany({ where: { ownerId: invitation.clientId, key: lpInviteSettingKey(invitation.email) } });
      await tx.client.update({ where: { id: invitation.clientId }, data: { portalEnabled: true } });
      await maybeCompleteActivation(tx, invitation.clientId, { actorId: user.id, portal: 'investor', ip: req.ip, requestId: req.requestId });
    }
    if (invitation.companyId) {
      const co = grant?.kind === 'company' ? grant : null;
      await tx.companyUser.upsert({
        where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
        create: {
          companyId: invitation.companyId,
          userId: user.id,
          status: 'active',
          invitedById: co?.invitedById ?? invitation.invitedById,
          ...(co ? { profile: co.profile, title: co.title } : {}),
        },
        update: {
          status: 'active',
          ...(co ? { profile: co.profile, title: co.title, invitedById: co.invitedById } : {}),
        },
      });
    }
    if (grant?.kind === 'custodian') {
      await tx.counterpartyUser.upsert({
        where: { counterpartyId_userId: { counterpartyId: grant.counterpartyId, userId: user.id } },
        create: {
          counterpartyId: grant.counterpartyId,
          userId: user.id,
          role: grant.role,
          status: 'active',
          invitedById: grant.invitedById,
        },
        update: { role: grant.role, status: 'active', invitedById: grant.invitedById },
      });
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    await writeAudit(tx, { ...ctx(req), actorId: user.id, portal: invitation.portal }, {
      action: 'invitation.accepted',
      objectType: 'invitation',
      objectId: invitation.id,
      after: { email: invitation.email, portal: invitation.portal, roleKeys, clientId: invitation.clientId },
    });
    return user.id;
  });

  const { token: sessionToken, expiresAt } = await createSession(userId, req);
  setSessionCookie(res, sessionToken, expiresAt);
  const user = await loadAuthUser(userId);
  res.json({ user: user! } satisfies AuthResponse);
});
