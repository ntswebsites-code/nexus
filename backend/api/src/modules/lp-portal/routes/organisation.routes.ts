import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireStepUp } from '../../../middleware/requireAuth';
import { requireLp, requireLpRole } from '../lp.context';
import { lpStubArray, lpStubNotLive } from '../lp.http';

/** Domain `organisation`: organisation, colleagues, bank-instruction changes (WS1). */
export const lpOrganisationRoutes = Router();

lpOrganisationRoutes.get('/organisation', requireLp('lp.organisation.view'), lpStubNotLive);
lpOrganisationRoutes.get('/colleagues', requireLp('lp.organisation.view'), lpStubArray);
lpOrganisationRoutes.post(
  '/colleagues',
  requireLp('lp.organisation.manage_colleagues'),
  requireLpRole('MANAGER'),
  idempotent('lp.colleagues.invite', { required: false }),
  lpStubNotLive,
);
lpOrganisationRoutes.patch('/colleagues/:membershipId', requireLp('lp.organisation.manage_colleagues'), requireLpRole('MANAGER'), lpStubNotLive);
lpOrganisationRoutes.patch(
  '/colleagues/:membershipId/revoke',
  requireLp('lp.organisation.manage_colleagues'),
  requireLpRole('MANAGER'),
  lpStubNotLive,
);
lpOrganisationRoutes.get('/bank-instructions/changes', requireLp('lp.organisation.view'), lpStubArray);
lpOrganisationRoutes.post(
  '/bank-instructions/changes',
  requireLp('lp.organisation.view'),
  requireLpRole('SIGNATORY'),
  requireStepUp,
  idempotent('lp.bank_instructions.change'),
  lpStubNotLive,
);
