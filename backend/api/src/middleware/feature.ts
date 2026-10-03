import type { RequestHandler } from 'express';
import { HttpError } from '../lib/errors';
import { setting } from '../lib/settings';

/** 403 `feature_disabled` unless the platform feature flag (admin settings, category "Feature flags") is on. */
export const requireFeature =
  (key: 'feature.lp_dealing' | 'feature.investee_requests' | 'feature.statement_import' | 'feature.copilot'): RequestHandler =>
  async (_req, _res, next) => {
    if (!(await setting<boolean>(key))) {
      throw HttpError.forbidden('This capability is switched off in platform settings', 'feature_disabled');
    }
    next();
  };
