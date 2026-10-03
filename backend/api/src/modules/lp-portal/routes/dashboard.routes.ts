import { Router } from 'express';
import { lp, requireLp } from '../lp.context';
import { lpOk } from '../lp.http';
import { dateQuery, str } from '../services/common';
import { getActions, getDashboard, getRecentActivity } from '../services/dashboard';

/** Domain `dashboard` (WS1). */
export const lpDashboardRoutes = Router();

lpDashboardRoutes.get('/dashboard', requireLp('lp.dashboard.view'), async (req, res) => {
  const fundId = str(req.query.fundId);
  dateQuery(req.query.asOfDate, 'asOfDate');
  lpOk(req, res, await getDashboard(lp(req), fundId === 'all' ? undefined : fundId));
});

lpDashboardRoutes.get('/dashboard/actions', requireLp('lp.dashboard.view'), async (req, res) => {
  lpOk(req, res, { items: await getActions(lp(req)) });
});

lpDashboardRoutes.get('/dashboard/activity/recent', requireLp('lp.dashboard.view'), async (req, res) => {
  const raw = Number.parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Math.min(50, Math.max(1, Number.isNaN(raw) ? 10 : raw));
  lpOk(req, res, { items: await getRecentActivity(lp(req), limit) });
});
