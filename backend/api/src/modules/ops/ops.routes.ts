import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { opsTermSheetRoutes } from './term-sheets.routes';
import { opsFundsRoutes } from './funds.routes';
import { opsCapitalRoutes } from './capital.routes';
import { opsDistributionsRoutes } from './distributions.routes';
import { opsDealingRoutes } from './dealing.routes';
import { opsCustodianRoutes } from './custodian.routes';
import { opsNoticesRoutes } from './notices.routes';
import { opsBankInstructionRoutes } from './bank-instructions.routes';
import { opsInvesteeRequestRoutes } from './investee-requests.routes';

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
opsRoutes.use('/term-sheets', opsTermSheetRoutes);
opsRoutes.use('/custodian', opsCustodianRoutes);
opsRoutes.use('/notices', opsNoticesRoutes);
opsRoutes.use('/bank-instructions', opsBankInstructionRoutes);
opsRoutes.use('/investee-requests', opsInvesteeRequestRoutes);
opsRoutes.use(opsFundsRoutes);
opsRoutes.use(opsCapitalRoutes);
opsRoutes.use(opsDistributionsRoutes);
opsRoutes.use(opsDealingRoutes);
opsRoutes.use(() => {
  throw new HttpError(501, 'not_implemented', 'This operations endpoint is not available yet');
});
