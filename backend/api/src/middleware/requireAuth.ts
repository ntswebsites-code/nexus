import type { Request, RequestHandler, Response } from 'express';
import type { PortalId } from '@matanho/shared';
import { HttpError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { policy } from '../lib/policy';
import { hashToken, readSessionToken, clearSessionCookie } from '../auth/session';
import { resolveSession, userHasPortalAccess } from '../services/authService';

async function authenticate(req: Request, res: Response, allowMfaPending: boolean) {
  const token = readSessionToken(req);
  if (!token) throw HttpError.unauthorized();

  const resolved = await resolveSession(hashToken(token));
  if (!resolved) {
    clearSessionCookie(res);
    throw HttpError.unauthorized('Session expired or invalid');
  }
  if (resolved.session.mfaPending && !allowMfaPending) {
    throw new HttpError(401, 'mfa_required', 'Enter your authentication code to continue');
  }
  req.user = resolved.user;
  req.authSession = resolved.session;
}

/** Rejects with 401 unless the request carries a fully authenticated session; sets `req.user`. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  await authenticate(req, res, false);
  next();
};

/** Like `requireAuth` but also admits sessions still waiting for their second factor. */
export const requireAuthAllowMfaPending: RequestHandler = async (req, res, next) => {
  await authenticate(req, res, true);
  next();
};

/** Use after `requireAuth`. 403 unless the user holds a role in the given portal. */
export const requirePortalAccess =
  (portal: PortalId): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw HttpError.unauthorized();
    if (!userHasPortalAccess(req.user, portal)) {
      throw HttpError.forbidden('This account is not authorised to use this portal', 'portal_access_denied');
    }
    next();
  };

/** Use after `requireAuth`. 403 unless the user holds every listed permission code. */
export const requirePermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw HttpError.unauthorized();
    const granted = new Set(req.user.permissions);
    if (!permissions.every((p) => granted.has(p))) {
      throw HttpError.forbidden('You do not have permission to perform this action', 'permission_denied');
    }
    next();
  };

/** 403 unless the user holds at least one of the listed permission codes. */
export const requireAnyPermission =
  (...permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw HttpError.unauthorized();
    const granted = new Set(req.user.permissions);
    if (!permissions.some((p) => granted.has(p))) {
      throw HttpError.forbidden('You do not have permission to perform this action', 'permission_denied');
    }
    next();
  };

const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Step-up for approvals and signatures (SRD 7.1): users with an enrolled factor
 * must have verified a code within the last five minutes. When MFA is mandatory
 * by policy every user has a factor (enrolment is forced at sign-in).
 */
export const requireStepUp: RequestHandler = async (req, _res, next) => {
  if (!req.user || !req.authSession) throw HttpError.unauthorized();
  const factor = await prisma.userMfaFactor.findFirst({
    where: { userId: req.user.id, verifiedAt: { not: null } },
    select: { id: true },
  });
  if (!factor) {
    if (await policy('mfa_required')) {
      throw new HttpError(401, 'mfa_enrolment_required', 'Set up two-factor authentication to continue');
    }
    return next();
  }
  const verifiedAt = req.authSession.mfaVerifiedAt?.getTime() ?? 0;
  if (Date.now() - verifiedAt > STEP_UP_WINDOW_MS) {
    throw new HttpError(401, 'step_up_required', 'Confirm this action with your authentication code');
  }
  next();
};
