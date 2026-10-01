import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';

/** `/api/v1/custodian` - counterparty (custodian) executions and day-end packages (SRD 5E). Owned by WS4. */
export const custodianRoutes = Router();

custodianRoutes.use(requireAuth, requirePortalAccess('custodian'));
custodianRoutes.get('/health', (_req, res) => {
  res.json({ domain: 'custodian', live: false });
});
custodianRoutes.use(() => {
  throw new HttpError(501, 'not_implemented', 'This custodian endpoint is not available yet');
});
