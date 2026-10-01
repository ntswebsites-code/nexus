import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireLp } from '../lp.context';
import { lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `requests`: service requests and message threads (WS1). */
export const lpRequestsRoutes = Router();

lpRequestsRoutes.get('/requests', requireLp('lp.requests.view'), lpStubList);
lpRequestsRoutes.post('/requests/attachments', requireLp('lp.requests.create'), lpStubNotLive);
lpRequestsRoutes.get('/requests/:reference', requireLp('lp.requests.view'), lpStubNotLive);
lpRequestsRoutes.post('/requests', requireLp('lp.requests.create'), idempotent('lp.requests.create', { required: false }), lpStubNotLive);
lpRequestsRoutes.post('/requests/:reference/messages', requireLp('lp.messages.reply'), lpStubNotLive);

lpRequestsRoutes.get('/messages', requireLp('lp.messages.view'), lpStubList);
lpRequestsRoutes.get('/messages/:id', requireLp('lp.messages.view'), lpStubNotLive);
lpRequestsRoutes.post('/messages/:id/read', requireLp('lp.messages.view'), lpStubNotLive);
lpRequestsRoutes.post('/messages/:id/replies', requireLp('lp.messages.reply'), lpStubNotLive);
