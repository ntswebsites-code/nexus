import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { HttpError } from '../../../lib/errors';
import { actorName, param } from '../../../lib/http';
import { idempotent } from '../../../lib/idempotency';
import { validateBody } from '../../../middleware/validate';
import { requireStepUp } from '../../../middleware/requireAuth';
import { inv, investeeAudit, requireProfile } from '../investee.context';
import { investeeErrorHandler, ok } from '../investee.http';
import {
  capDecisionSchema,
  capTransactions,
  capTxSchema,
  certificateDownload,
  certificatesView,
  certificateVerify,
  classTermsSchema,
  createCapTransaction,
  decideCapTransaction,
  updateClassTerms,
  waterfallSchema,
  waterfallView,
} from './cap';
import {
  addPackItem,
  boardActionSchema,
  boardActionUpdateSchema,
  createBoardAction,
  createMeeting,
  forecastLockSchema,
  lockForecast,
  meetingSchema,
  meetingsView,
  meetingUpdateSchema,
  packItemSchema,
  publishPack,
  removePackItem,
  updateBoardAction,
  updateMeeting,
} from './records';
import {
  companySignRequests,
  createShareLink,
  createSignRequest,
  listShareLinks,
  publicShareFile,
  publicShareInfo,
  publicSign,
  publicSignDocument,
  publicSignInfo,
  publicSignSchema,
  remindSignRequest,
  revokeShareLink,
  shareLinkSchema,
  signRequestSchema,
  voidSchema,
  voidSignRequest,
} from './sharing';
import { accessReviewSchema, accessView, kpiExport, kpiHistory, recordAccessReview, searchWorkspace } from './insights';
import { ensureWorkspace } from './store';

/** Authenticated routes under /api/v1/investee-portal (mounted after the context middleware). */
export const workspaceRoutes = Router();

const body = (req: Request) => req.body;
const edit = requireProfile('edit_draft');

// ---- cap table: transactions with maker-checker, certificates, class terms, waterfall
workspaceRoutes.get('/cap-table/transactions', async (req, res) => {
  const c = inv(req);
  await ensureWorkspace(c.company.id);
  ok(res, { transactions: await capTransactions(c.company.id) });
});
workspaceRoutes.post('/cap-table/transactions', edit, validateBody(capTxSchema), idempotent('investee.cap_tx.create'), async (req, res) => {
  const c = inv(req);
  await ensureWorkspace(c.company.id);
  ok(res, await createCapTransaction(c, actorName(req), body(req), investeeAudit(req)), 'Transaction submitted for approval', 201);
});
workspaceRoutes.post('/cap-table/transactions/:ref/decide', requireProfile('sign'), requireStepUp, validateBody(capDecisionSchema), idempotent('investee.cap_tx.decide'), async (req, res) => {
  const row = await decideCapTransaction(inv(req), param(req, 'ref'), body(req), investeeAudit(req));
  ok(res, row, row.status === 'APPROVED' ? 'Transaction approved' : 'Transaction rejected');
});
workspaceRoutes.get('/cap-table/certificates', async (req, res) => {
  ok(res, { certificates: await certificatesView(inv(req).company.id) });
});
workspaceRoutes.get('/cap-table/certificates/:no/download-url', async (req, res) => {
  ok(res, await certificateDownload(inv(req).company.id, param(req, 'no')));
});
workspaceRoutes.get('/cap-table/certificates/:no/verify', async (req, res) => {
  ok(res, await certificateVerify(inv(req).company.id, param(req, 'no')));
});
workspaceRoutes.put('/cap-table/classes/:id', requireProfile('sign'), requireStepUp, validateBody(classTermsSchema), async (req, res) => {
  ok(res, await updateClassTerms(inv(req), param(req, 'id'), body(req), investeeAudit(req)), 'Share class updated');
});
workspaceRoutes.post('/cap-table/waterfall', validateBody(waterfallSchema), async (req, res) => {
  ok(res, await waterfallView(inv(req), body(req)));
});

// ---- forecast month locking
workspaceRoutes.post('/forecast/lock', requireProfile('sign'), validateBody(forecastLockSchema), async (req, res) => {
  ok(res, await lockForecast(inv(req), body(req), true, investeeAudit(req)), 'Months locked');
});
workspaceRoutes.post('/forecast/unlock', requireProfile('manage_company'), validateBody(forecastLockSchema), async (req, res) => {
  ok(res, await lockForecast(inv(req), body(req), false, investeeAudit(req)), 'Months unlocked');
});

// ---- board calendar, packs, actions
workspaceRoutes.get('/governance/meetings', async (req, res) => {
  const c = inv(req);
  await ensureWorkspace(c.company.id);
  ok(res, { meetings: await meetingsView(c.company.id) });
});
workspaceRoutes.post('/governance/meetings', edit, validateBody(meetingSchema), idempotent('investee.meeting.create'), async (req, res) => {
  ok(res, { meetings: await createMeeting(inv(req), body(req), investeeAudit(req)) }, 'Meeting scheduled', 201);
});
workspaceRoutes.patch('/governance/meetings/:id', edit, validateBody(meetingUpdateSchema), async (req, res) => {
  ok(res, { meetings: await updateMeeting(inv(req), param(req, 'id'), body(req), investeeAudit(req)) });
});
workspaceRoutes.post('/governance/meetings/:id/pack', edit, validateBody(packItemSchema), async (req, res) => {
  ok(res, { meetings: await addPackItem(inv(req), param(req, 'id'), body(req), investeeAudit(req)) });
});
workspaceRoutes.delete('/governance/meetings/:id/pack/:itemId', edit, async (req, res) => {
  ok(res, { meetings: await removePackItem(inv(req), param(req, 'id'), param(req, 'itemId'), investeeAudit(req)) });
});
workspaceRoutes.post('/governance/meetings/:id/publish', requireProfile('sign'), idempotent('investee.pack.publish'), async (req, res) => {
  ok(res, { meetings: await publishPack(inv(req), param(req, 'id'), investeeAudit(req)) }, 'Board pack published');
});
workspaceRoutes.post('/governance/actions', edit, validateBody(boardActionSchema), idempotent('investee.action.create'), async (req, res) => {
  ok(res, await createBoardAction(inv(req), body(req), investeeAudit(req)), 'Action recorded', 201);
});
workspaceRoutes.patch('/governance/actions/:id', edit, validateBody(boardActionUpdateSchema), async (req, res) => {
  ok(res, await updateBoardAction(inv(req), param(req, 'id'), body(req), investeeAudit(req)));
});

// ---- company-initiated signature requests
workspaceRoutes.get('/signature-requests', async (req, res) => {
  ok(res, { requests: await companySignRequests(inv(req).company.id) });
});
workspaceRoutes.post('/signature-requests', requireProfile('sign'), validateBody(signRequestSchema), idempotent('investee.sigreq.create'), async (req, res) => {
  ok(res, await createSignRequest(inv(req), actorName(req), body(req), investeeAudit(req)), 'Signature request sent', 201);
});
workspaceRoutes.post('/signature-requests/:id/remind', requireProfile('sign'), idempotent('investee.sigreq.remind'), async (req, res) => {
  ok(res, await remindSignRequest(inv(req), param(req, 'id'), investeeAudit(req)), 'Reminder sent');
});
workspaceRoutes.post('/signature-requests/:id/void', requireProfile('sign'), validateBody(voidSchema), idempotent('investee.sigreq.void'), async (req, res) => {
  ok(res, await voidSignRequest(inv(req), param(req, 'id'), body(req), investeeAudit(req)), 'Request voided');
});

// ---- share links (7 days at most)
workspaceRoutes.get('/share-links', async (req, res) => {
  ok(res, { links: await listShareLinks(inv(req).company.id) });
});
workspaceRoutes.post('/share-links', edit, validateBody(shareLinkSchema), idempotent('investee.share.create'), async (req, res) => {
  ok(res, await createShareLink(inv(req), body(req), investeeAudit(req)), 'Share link created', 201);
});
workspaceRoutes.delete('/share-links/:id', edit, async (req, res) => {
  ok(res, { links: await revokeShareLink(inv(req), param(req, 'id'), investeeAudit(req)) }, 'Share link revoked');
});

// ---- search, derived KPIs, export, access
workspaceRoutes.get('/search', async (req, res) => {
  ok(res, { query: String(req.query.q ?? ''), hits: await searchWorkspace(inv(req).company.id, String(req.query.q ?? '')) });
});
workspaceRoutes.get('/kpis/history', async (req, res) => {
  ok(res, { rows: await kpiHistory(inv(req).company.id) });
});
workspaceRoutes.get('/kpis/export', async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  const out = await kpiExport(inv(req).company.id, format);
  res.setHeader('Content-Type', out.type);
  res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(out.body);
});
workspaceRoutes.get('/access', async (req, res) => {
  ok(res, await accessView(inv(req).company.id));
});
workspaceRoutes.post('/access/reviews', requireProfile('manage_company'), requireStepUp, validateBody(accessReviewSchema), idempotent('investee.access_review'), async (req, res) => {
  ok(res, await recordAccessReview(inv(req), body(req), investeeAudit(req)), 'Access review recorded', 201);
});

// ---------------------------------------------------------------- public (no session): signer pages and share links

export const investeePublicRoutes = Router();

investeePublicRoutes.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

const tokenOf = (req: Request) => {
  const t = param(req, 'token');
  if (t.length < 20 || t.length > 100) throw HttpError.notFound('This link is not valid');
  return t;
};
const attachment = (res: import('express').Response, file: { mime: string; name: string }, data: Buffer, extra: Record<string, string> = {}) => {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/[^\w.\- ]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(data);
};

investeePublicRoutes.get('/sign/:token', async (req, res) => {
  ok(res, await publicSignInfo(tokenOf(req)));
});
investeePublicRoutes.get('/sign/:token/document', async (req, res) => {
  const { file, data } = await publicSignDocument(tokenOf(req));
  attachment(res, file, data);
});
investeePublicRoutes.post('/sign/:token', validateBody(publicSignSchema), async (req, res) => {
  ok(res, await publicSign(tokenOf(req), body(req), req.ip ?? null), 'Response recorded');
});
investeePublicRoutes.get('/share/:token', async (req, res) => {
  ok(res, await publicShareInfo(tokenOf(req)));
});
investeePublicRoutes.get('/share/:token/file', async (req, res) => {
  const { file, data, watermark } = await publicShareFile(tokenOf(req));
  attachment(res, file, data, { 'X-Watermark': watermark.replace(/[^\x20-\x7e]/g, '?') });
});
investeePublicRoutes.use(investeeErrorHandler);
