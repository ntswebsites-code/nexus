import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireLp, requireLpRole } from '../lp.context';
import { lpStubArray, lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `dealing`: subscriptions and redemptions (WS2, after J3). */
export const lpDealingRoutes = Router();

lpDealingRoutes.get('/dealing/bank-accounts', requireLp('lp.dealing.view'), lpStubArray);
lpDealingRoutes.get('/dealing/overview', requireLp('lp.dealing.view'), lpStubNotLive);
lpDealingRoutes.get('/dealing/rules', requireLp('lp.dealing.view'), lpStubNotLive);
lpDealingRoutes.get('/dealing/requests', requireLp('lp.dealing.view'), lpStubList);
lpDealingRoutes.get('/dealing/requests/export', requireLp('lp.dealing.view'), lpStubNotLive);
lpDealingRoutes.post('/dealing/subscriptions/estimate', requireLp('lp.dealing.estimate'), lpStubNotLive);
lpDealingRoutes.post(
  '/dealing/subscriptions',
  requireLp('lp.dealing.subscribe'),
  requireLpRole('SIGNATORY'),
  idempotent('lp.dealing.subscribe'),
  lpStubNotLive,
);
lpDealingRoutes.post('/dealing/redemptions/estimate', requireLp('lp.dealing.estimate'), lpStubNotLive);
lpDealingRoutes.post(
  '/dealing/redemptions',
  requireLp('lp.dealing.redeem'),
  requireLpRole('SIGNATORY'),
  idempotent('lp.dealing.redeem'),
  lpStubNotLive,
);
