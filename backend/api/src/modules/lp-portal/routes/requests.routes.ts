import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { param } from '../../../lib/http';
import { readFileObject } from '../../../lib/storage';
import { uploadFiles } from '../../../middleware/upload';
import { lp, requireLp } from '../lp.context';
import { lpList, lpOk, lpPaginate, pageOf } from '../lp.http';
import { queryFund, str } from '../services/common';
import {
  createRequest,
  findAttachment,
  getRequest,
  getThread,
  listRequests,
  listThreads,
  markThreadRead,
  replyToRequest,
  replyToThread,
  uploadAttachment,
} from '../services/requests';

/** Domain `requests`: service requests and message threads (WS1). */
export const lpRequestsRoutes = Router();

lpRequestsRoutes.get('/requests', requireLp('lp.requests.view'), async (req, res) => {
  const ctx = lp(req);
  const { page, pageSize } = pageOf(req);
  const items = await listRequests(ctx, { status: str(req.query.status), fundId: queryFund(req, ctx), type: str(req.query.type) });
  lpOk(req, res, lpPaginate(items, page, pageSize));
});

lpRequestsRoutes.post(
  '/requests/attachments',
  requireLp('lp.requests.create'),
  idempotent('lp.requests.attachments', { required: false }),
  uploadFiles('file'),
  async (req, res) => {
    lpOk(req, res, await uploadAttachment(req, lp(req), req.file), 'Attachment uploaded', 201);
  },
);

lpRequestsRoutes.get('/requests/attachments/:id/download', requireLp('lp.requests.view'), async (req, res) => {
  const a = await findAttachment(lp(req), param(req, 'id'));
  const { file, data } = await readFileObject(a.fileId);
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `attachment; filename="${a.name.replace(/[^\w.\- ]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(data);
});

lpRequestsRoutes.get('/requests/:reference', requireLp('lp.requests.view'), async (req, res) => {
  lpOk(req, res, await getRequest(lp(req), param(req, 'reference')));
});

lpRequestsRoutes.post('/requests', requireLp('lp.requests.create'), idempotent('lp.requests.create', { required: false }), async (req, res) => {
  lpOk(req, res, await createRequest(req, lp(req)), 'Service request created', 201);
});

lpRequestsRoutes.post('/requests/:reference/messages', requireLp('lp.messages.reply'), async (req, res) => {
  lpOk(req, res, await replyToRequest(req, lp(req), param(req, 'reference')), 'Message sent', 201);
});

lpRequestsRoutes.get('/messages', requireLp('lp.messages.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  const { items, total } = await listThreads(lp(req), page, pageSize);
  lpOk(req, res, lpList(items, page, pageSize, total));
});

lpRequestsRoutes.get('/messages/:id', requireLp('lp.messages.view'), async (req, res) => {
  lpOk(req, res, await getThread(lp(req), param(req, 'id')));
});

lpRequestsRoutes.post('/messages/:id/read', requireLp('lp.messages.view'), async (req, res) => {
  lpOk(req, res, await markThreadRead(lp(req), param(req, 'id')));
});

lpRequestsRoutes.post('/messages/:id/replies', requireLp('lp.messages.reply'), async (req, res) => {
  lpOk(req, res, await replyToThread(req, lp(req), param(req, 'id')), 'Message sent', 201);
});
