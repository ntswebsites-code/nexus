import { Router } from 'express';
import { requireLp } from '../lp.context';
import { lpStubArray, lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `activity`: account activity and ledger (WS1). */
export const lpActivityRoutes = Router();

lpActivityRoutes.get('/account-activity', requireLp('lp.activity.view'), lpStubList);
lpActivityRoutes.get('/account-activity/export', requireLp('lp.activity.export'), lpStubNotLive);
lpActivityRoutes.get('/ledger', requireLp('lp.capital_account.view'), lpStubArray);
lpActivityRoutes.get('/ledger/:entryId', requireLp('lp.capital_account.view'), lpStubNotLive);
