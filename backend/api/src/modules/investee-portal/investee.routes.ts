import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';

/** `/api/v1/investee-portal` - Investee contract facade (SRD 5D). Owned by WS3. */
export const investeePortalRoutes = Router();

investeePortalRoutes.use(requireAuth, requirePortalAccess('company'));
investeePortalRoutes.get('/health', (_req, res) => {
  res.json({ domain: 'investee-portal', live: false });
});
investeePortalRoutes.use(() => {
  throw new HttpError(501, 'not_implemented', 'This Investee endpoint is not available yet');
});
