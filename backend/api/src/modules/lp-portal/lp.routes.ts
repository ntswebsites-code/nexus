import { Router } from 'express';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { lpContextMiddleware, requireLp } from './lp.context';
import { LpError, lpErrorHandler } from './lp.http';
import { lpSessionRoutes } from './routes/session.routes';
import { lpDashboardRoutes } from './routes/dashboard.routes';
import { lpCapitalRoutes } from './routes/capital.routes';
import { lpActivityRoutes } from './routes/activity.routes';
import { lpDealingRoutes } from './routes/dealing.routes';
import { lpPerformanceRoutes } from './routes/performance.routes';
import { lpDocumentsRoutes } from './routes/documents.routes';
import { lpNoticesRoutes } from './routes/notices.routes';
import { lpRequestsRoutes } from './routes/requests.routes';
import { lpOrganisationRoutes } from './routes/organisation.routes';
import { lpSettingsRoutes } from './routes/settings.routes';
import { lpReportsRoutes } from './routes/reports.routes';

/**
 * `/api/v1/lp-portal` - the LP contract facade (SRD 5B). Every handler is scoped by `req.lp`
 * (client + fund scope), gated by `lp.*` permissions and answers in the LP envelope.
 * One sub-router per data domain so workstreams own separate files.
 */
export const lpPortalRoutes = Router();

lpPortalRoutes.use(requireAuth, requirePortalAccess('investor'), lpContextMiddleware, requireLp('lp.portal.access'));
lpPortalRoutes.use(
  lpSessionRoutes,
  lpDashboardRoutes,
  lpCapitalRoutes,
  lpActivityRoutes,
  lpDealingRoutes,
  lpPerformanceRoutes,
  lpDocumentsRoutes,
  lpNoticesRoutes,
  lpRequestsRoutes,
  lpOrganisationRoutes,
  lpSettingsRoutes,
  lpReportsRoutes,
);
lpPortalRoutes.use(() => {
  throw LpError.notFound('Endpoint');
});
lpPortalRoutes.use(lpErrorHandler);
