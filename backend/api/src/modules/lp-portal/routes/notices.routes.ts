import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireLp } from '../lp.context';
import { lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `notices` (WS1). */
export const lpNoticesRoutes = Router();

lpNoticesRoutes.get('/notices', requireLp('lp.notices.view'), lpStubList);
lpNoticesRoutes.get('/notices/:id', requireLp('lp.notices.view'), lpStubNotLive);
lpNoticesRoutes.post(
  '/notices/:id/acknowledge',
  requireLp('lp.notices.acknowledge'),
  idempotent('lp.notices.acknowledge', { required: false }),
  lpStubNotLive,
);
