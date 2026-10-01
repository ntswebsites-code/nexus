import { Router } from 'express';
import { requireLp } from '../lp.context';
import { lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `reports`: legacy thin reports list (WS1). */
export const lpReportsRoutes = Router();

lpReportsRoutes.get('/reports', requireLp('lp.documents.view'), lpStubList);
lpReportsRoutes.get('/reports/:jobId/download', requireLp('lp.documents.download'), lpStubNotLive);
