import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { lpList, lpOk, pageOf } from '../lp.http';
import { enumQuery } from '../services/common';
import { acknowledgeNotice, getNotice, listNotices } from '../services/notices';

/** Domain `notices` (WS1). */
export const lpNoticesRoutes = Router();

lpNoticesRoutes.get('/notices', requireLp('lp.notices.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  const status = enumQuery(req.query.status, 'status', ['PUBLISHED', 'OPENED', 'ACKNOWLEDGED'] as const);
  const { items, total } = await listNotices(lp(req), page, pageSize, status);
  lpOk(req, res, lpList(items, page, pageSize, total));
});

lpNoticesRoutes.get('/notices/:id', requireLp('lp.notices.view'), async (req, res) => {
  lpOk(req, res, await getNotice(lp(req), param(req, 'id')));
});

lpNoticesRoutes.post(
  '/notices/:id/acknowledge',
  requireLp('lp.notices.acknowledge'),
  idempotent('lp.notices.acknowledge', { required: false }),
  async (req, res) => {
    lpOk(req, res, await acknowledgeNotice(req, lp(req), param(req, 'id')), 'Notice acknowledged');
  },
);
