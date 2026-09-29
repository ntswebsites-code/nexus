import type { RequestHandler } from 'express';
import type { PortalId } from '@matanho/shared';
import { HttpError } from '../lib/errors';
import { hashToken, readSessionToken, clearSessionCookie } from '../auth/session';
import { findUserBySessionHash, userHasPortalAccess } from '../services/authService';

/** Rejects with 401 unless the request carries a valid session; sets `req.user`. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = readSessionToken(req);
  if (!token) throw HttpError.unauthorized();

  const user = await findUserBySessionHash(hashToken(token));
  if (!user) {
    clearSessionCookie(res);
    throw HttpError.unauthorized('Session expired or invalid');
  }
  req.user = user;
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
