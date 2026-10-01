import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { opsCustodianRoutes } from './custodian.routes';

/**
 * `/api/v1/ops` - staff fund operations used by the admin `(ops)` console: funds and
 * commitments, capital calls, distributions, notices, dealing queue, term sheets.
 * Money actions: `requirePermission` + `requireStepUp` + `idempotent()` + maker/checker + audit.
 * Owned by WS2 (capital, dealing), WS1 (notices), WS3 (term sheets); mounts by WS0.
 */
export const opsRoutes = Router();

opsRoutes.use(requireAuth, requirePortalAccess('admin'));
opsRoutes.get('/health', (_req, res) => {
  res.json({ domain: 'ops', live: false });
});
opsRoutes.use('/custodian', opsCustodianRoutes);
opsRoutes.use(() => {
  throw new HttpError(501, 'not_implemented', 'This operations endpoint is not available yet');
});
