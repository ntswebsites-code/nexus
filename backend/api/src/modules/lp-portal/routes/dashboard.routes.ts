import { Router } from 'express';
import { requireLp } from '../lp.context';
import { lpStubItems, lpStubNotLive } from '../lp.http';

/** Domain `dashboard` (WS1). */
export const lpDashboardRoutes = Router();

lpDashboardRoutes.get('/dashboard', requireLp('lp.dashboard.view'), lpStubNotLive);
lpDashboardRoutes.get('/dashboard/actions', requireLp('lp.dashboard.view'), lpStubItems);
lpDashboardRoutes.get('/dashboard/activity/recent', requireLp('lp.dashboard.view'), lpStubItems);
