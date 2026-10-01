import type { RequestHandler } from 'express';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@matanho/shared';
import { config } from '../config';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { policy } from '../lib/policy';
import { writeAudit } from '../lib/audit';
import { ctx } from '../lib/http';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  purgeExpiredSessions,
  readSessionToken,
  setSessionCookie,
} from '../auth/session';
import { registerUser, verifyCredentials } from '../services/authService';

export const register: RequestHandler = async (req, res) => {
  if (!config.allowSelfRegistration) {
    throw HttpError.forbidden('Self-registration is disabled', 'registration_disabled');
  }
  const user = await registerUser(req.body as RegisterRequest);
  // Registration does not sign the user in and grants no portal access:
  // roles are assigned by an administrator.
  res.status(201).json({ user } satisfies AuthResponse);
};

/** Portals where MFA is mandatory when the `mfa_required` policy is on (SRD 7.1). */
const MFA_PORTALS = new Set(['admin', 'investor', 'custodian']);

export const login: RequestHandler = async (req, res) => {
  const input = req.body as LoginRequest;
  const user = await verifyCredentials(input);

  const factor = await prisma.userMfaFactor.findFirst({
    where: { userId: user.id, verifiedAt: { not: null } },
    select: { id: true },
  });
  let mfa: AuthResponse['mfa'];
  if (factor) mfa = 'verify';
  else if ((await policy('mfa_required')) && (!input.portal || MFA_PORTALS.has(input.portal))) mfa = 'enroll';

  // Rotate: replace any session the browser already holds.
  const previous = readSessionToken(req);
  if (previous) await destroySession(previous);

  const { token, expiresAt } = await createSession(user.id, req, { mfaPending: !!mfa });
  setSessionCookie(res, token, expiresAt);
  void purgeExpiredSessions().catch(() => undefined);

  await prisma.$transaction((tx) =>
    writeAudit(tx, { ...ctx(req, input.portal), actorId: user.id }, {
      action: mfa ? 'auth.login.password_ok' : 'auth.login',
      objectType: 'user',
      objectId: user.id,
      after: { portal: input.portal ?? null, mfa: mfa ?? null },
    }),
  );

  res.json({ user, ...(mfa ? { mfa } : {}) } satisfies AuthResponse);
};

export const logout: RequestHandler = async (req, res) => {
  const token = readSessionToken(req);
  if (token) await destroySession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
};

/** Requires `requireAuth` upstream. */
export const me: RequestHandler = (req, res) => {
  res.json({ user: req.user! } satisfies AuthResponse);
};
