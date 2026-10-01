import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { param } from '../../../lib/http';
import { requireStepUp } from '../../../middleware/requireAuth';
import { lp, requireLp, requireLpRole } from '../lp.context';
import { lpOk } from '../lp.http';
import {
  getOrganisation,
  inviteColleague,
  listBankChanges,
  listColleagues,
  revokeColleague,
  submitBankChange,
  updateColleague,
} from '../services/organisation';

/** Domain `organisation`: organisation, colleagues, bank-instruction changes (WS1). */
export const lpOrganisationRoutes = Router();

lpOrganisationRoutes.get('/organisation', requireLp('lp.organisation.view'), async (req, res) => {
  lpOk(req, res, await getOrganisation(lp(req)));
});

lpOrganisationRoutes.get('/colleagues', requireLp('lp.organisation.view'), async (req, res) => {
  lpOk(req, res, await listColleagues(lp(req)));
});

lpOrganisationRoutes.post(
  '/colleagues',
  requireLp('lp.organisation.manage_colleagues'),
  requireLpRole('MANAGER'),
  idempotent('lp.colleagues.invite', { required: false }),
  async (req, res) => {
    lpOk(req, res, await inviteColleague(req, lp(req)), 'Colleague invited', 201);
  },
);

lpOrganisationRoutes.patch('/colleagues/:membershipId', requireLp('lp.organisation.manage_colleagues'), requireLpRole('MANAGER'), async (req, res) => {
  lpOk(req, res, await updateColleague(req, lp(req), param(req, 'membershipId')), 'Colleague updated');
});

lpOrganisationRoutes.patch(
  '/colleagues/:membershipId/revoke',
  requireLp('lp.organisation.manage_colleagues'),
  requireLpRole('MANAGER'),
  async (req, res) => {
    lpOk(req, res, await revokeColleague(req, lp(req), param(req, 'membershipId')), 'Colleague revoked');
  },
);

lpOrganisationRoutes.get('/bank-instructions/changes', requireLp('lp.organisation.view'), async (req, res) => {
  lpOk(req, res, await listBankChanges(lp(req)));
});

lpOrganisationRoutes.post(
  '/bank-instructions/changes',
  requireLp('lp.organisation.view'),
  requireLpRole('SIGNATORY'),
  requireStepUp,
  idempotent('lp.bank_instructions.change'),
  async (req, res) => {
    lpOk(req, res, await submitBankChange(req, lp(req)), 'Bank instruction change submitted for verification', 201);
  },
);
