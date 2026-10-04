import { Router } from 'express';
import { requireStepUp } from '../../../middleware/requireAuth';
import { idempotent } from '../../../lib/idempotency';
import { param } from '../../../lib/http';
import { lp, requireLp, requireLpRole } from '../lp.context';
import { LpError, lpOk, lpPaginate, pageOf } from '../lp.http';
import { queryFund, str } from '../services/common';
import {
  CONSENT_TEXT,
  DOCUMENT_SORTS,
  CONSENT_TEXT_VERSION,
  documentDetail,
  documentsSummary,
  listDocuments,
  listVault,
  sendDocument,
  signDocument,
  verifyVault,
} from '../services/documents';

/** Domain `documents`: documents and the vault (WS1). */
export const lpDocumentsRoutes = Router();

lpDocumentsRoutes.get('/documents', requireLp('lp.documents.view'), async (req, res) => {
  const ctx = lp(req);
  const { page, pageSize } = pageOf(req);
  const sortRaw = str(req.query.sortBy);
  const sortBy = sortRaw ? DOCUMENT_SORTS.find((k) => k.toLowerCase() === sortRaw.toLowerCase()) : undefined;
  if (sortRaw && !sortBy) throw LpError.validation('sortBy is not valid', { sortBy: `Use one of ${DOCUMENT_SORTS.join(', ')}` });
  const dir = str(req.query.sortDirection)?.toLowerCase();
  if (dir && dir !== 'asc' && dir !== 'desc') throw LpError.validation('sortDirection is not valid', { sortDirection: 'Use asc or desc' });
  const items = await listDocuments(ctx, { fundId: queryFund(req, ctx), category: str(req.query.category), q: str(req.query.q), sortBy, sortDirection: dir as 'asc' | 'desc' | undefined });
  lpOk(req, res, lpPaginate(items, page, pageSize));
});

lpDocumentsRoutes.get('/documents/summary', requireLp('lp.documents.view'), async (req, res) => {
  lpOk(req, res, await documentsSummary(lp(req)));
});

lpDocumentsRoutes.get('/documents/consent-text', requireLp('lp.documents.view'), (req, res) => {
  lpOk(req, res, { version: CONSENT_TEXT_VERSION, text: CONSENT_TEXT });
});

lpDocumentsRoutes.get('/documents/:id', requireLp('lp.documents.view'), async (req, res) => {
  lpOk(req, res, await documentDetail(req, lp(req), param(req, 'id')));
});

lpDocumentsRoutes.get('/documents/:id/download', requireLp('lp.documents.download'), async (req, res) => {
  await sendDocument(req, res, lp(req), param(req, 'id'), 'download', (data) => lpOk(req, res, data));
});

lpDocumentsRoutes.get('/documents/:id/preview', requireLp('lp.documents.view'), async (req, res) => {
  await sendDocument(req, res, lp(req), param(req, 'id'), 'preview', (data) => lpOk(req, res, data));
});

lpDocumentsRoutes.post(
  '/documents/:id/sign',
  requireLp('lp.documents.view'),
  requireLpRole('SIGNATORY'),
  requireStepUp,
  idempotent('lp.documents.sign', { required: false }),
  async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fieldErrors: Record<string, string> = {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const authority = typeof b.authority === 'string' ? b.authority.trim() : '';
    if (name.length < 2 || name.length > 120) fieldErrors.name = 'Type your full name';
    if (authority.length < 2 || authority.length > 160) fieldErrors.authority = 'State the capacity in which you sign';
    if (b.consent !== true) fieldErrors.consent = 'Consent is required';
    if (Object.keys(fieldErrors).length) throw LpError.validation('Check the signature details', fieldErrors);
    const consentTextVersion = typeof b.consentTextVersion === 'string' ? b.consentTextVersion.slice(0, 32) : undefined;
    lpOk(req, res, await signDocument(req, lp(req), param(req, 'id'), { name, authority, consentTextVersion }), 'Document signed', 201);
  },
);

lpDocumentsRoutes.get('/vault', requireLp('lp.documents.view'), async (req, res) => {
  const ctx = lp(req);
  lpOk(req, res, await listVault(ctx, { fundId: queryFund(req, ctx), category: str(req.query.category), search: str(req.query.search) }));
});

lpDocumentsRoutes.get('/vault/:documentId/download', requireLp('lp.documents.download'), async (req, res) => {
  await sendDocument(req, res, lp(req), param(req, 'documentId'), 'download', (data) => lpOk(req, res, data));
});

lpDocumentsRoutes.get('/vault/:documentId/verify', requireLp('lp.documents.view'), async (req, res) => {
  lpOk(req, res, await verifyVault(lp(req), param(req, 'documentId')));
});
