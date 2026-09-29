import type { RequestHandler } from 'express';
import { HttpError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth for cookie sessions: any state-changing request that
 * carries an Origin header must come from an allow-listed portal origin.
 * (Browsers always send Origin on cross-origin POSTs.)
 */
export const originGuard = (allowedOrigins: string[]): RequestHandler => {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) {
      throw HttpError.forbidden('Origin not allowed', 'origin_not_allowed');
    }
    next();
  };
};
