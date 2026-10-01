import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireLp, requireLpRole } from '../lp.context';
import { lpStubArray, lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `capital`: capital calls and distributions (WS2). */
export const lpCapitalRoutes = Router();

lpCapitalRoutes.get('/capital-calls', requireLp('lp.capital_calls.view'), lpStubList);
lpCapitalRoutes.get('/capital-calls/summary', requireLp('lp.capital_calls.view'), lpStubNotLive);
lpCapitalRoutes.get('/capital-calls/:id', requireLp('lp.capital_calls.view'), lpStubNotLive);
lpCapitalRoutes.get('/capital-calls/:id/documents', requireLp('lp.capital_calls.view'), lpStubArray);
lpCapitalRoutes.get('/capital-calls/:id/notice/download', requireLp('lp.capital_calls.download_notice'), lpStubNotLive);
lpCapitalRoutes.post(
  '/capital-calls/:id/acknowledge',
  requireLp('lp.capital_calls.acknowledge'),
  requireLpRole('SIGNATORY'),
  idempotent('lp.capital_calls.acknowledge'),
  lpStubNotLive,
);
lpCapitalRoutes.post(
  '/capital-calls/:id/payment-confirmations',
  requireLp('lp.capital_calls.upload_payment_confirmation'),
  requireLpRole('SIGNATORY'),
  lpStubNotLive,
);

lpCapitalRoutes.get('/distributions', requireLp('lp.distributions.view'), lpStubList);
lpCapitalRoutes.get('/distributions/statement/download', requireLp('lp.distributions.download'), lpStubNotLive);
lpCapitalRoutes.get('/distributions/:id', requireLp('lp.distributions.view'), lpStubNotLive);
lpCapitalRoutes.get('/distributions/:id/download', requireLp('lp.distributions.download'), lpStubNotLive);
