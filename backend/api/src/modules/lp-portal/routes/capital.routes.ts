import { Router, type Response } from 'express';
import { lpPaymentConfirmationFields } from '@matanho/shared';
import { idempotent } from '../../../lib/idempotency';
import { uploadFiles } from '../../../middleware/upload';
import { lp, requireLp, requireLpRole } from '../lp.context';
import { LpError, lpOk, lpPaginate, pageOf } from '../lp.http';
import { acknowledge, callSummary, getCall, listCallDocuments, listCalls, noticeFile, uploadPaymentConfirmation } from '../services/capital';
import { distributionFile, getDistribution, listDistributions, statementFile } from '../services/distributions';

/** Domain `capital`: capital calls and distributions (WS2). */
export const lpCapitalRoutes = Router();

const str = (v: unknown) => (typeof v === 'string' && v && v !== 'all' ? v : undefined);

function sendFile(res: Response, f: { name: string; data: Buffer; mime?: string }) {
  res.setHeader('Content-Type', f.mime ?? 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^\w.-]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(f.data);
}

lpCapitalRoutes.get('/capital-calls', requireLp('lp.capital_calls.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  const items = await listCalls(lp(req), { fundId: str(req.query.fundId), status: str(req.query.status), page, pageSize });
  lpOk(req, res, lpPaginate(items, page, pageSize));
});

lpCapitalRoutes.get('/capital-calls/summary', requireLp('lp.capital_calls.view'), async (req, res) => {
  lpOk(req, res, await callSummary(lp(req), str(req.query.fundId)));
});

lpCapitalRoutes.get('/capital-calls/:id', requireLp('lp.capital_calls.view'), async (req, res) => {
  lpOk(req, res, await getCall(lp(req), String(req.params.id)));
});

lpCapitalRoutes.get('/capital-calls/:id/documents', requireLp('lp.capital_calls.view'), async (req, res) => {
  lpOk(req, res, await listCallDocuments(lp(req), String(req.params.id)));
});

lpCapitalRoutes.get('/capital-calls/:id/notice/download', requireLp('lp.capital_calls.download_notice'), async (req, res) => {
  sendFile(res, await noticeFile(req, lp(req), String(req.params.id)));
});

lpCapitalRoutes.post(
  '/capital-calls/:id/acknowledge',
  requireLp('lp.capital_calls.acknowledge'),
  requireLpRole('SIGNATORY'),
  idempotent('lp.capital_calls.acknowledge'),
  async (req, res) => {
    lpOk(req, res, await acknowledge(req, lp(req), String(req.params.id)), 'Capital call acknowledged');
  },
);

lpCapitalRoutes.post(
  '/capital-calls/:id/payment-confirmations',
  requireLp('lp.capital_calls.upload_payment_confirmation'),
  requireLpRole('SIGNATORY'),
  uploadFiles('file'),
  idempotent('lp.capital_calls.upload_payment_confirmation', { required: false }),
  async (req, res) => {
    const fields = lpPaymentConfirmationFields.safeParse({
      amountClaimed: req.body?.amountClaimed || req.body?.amount || undefined,
      notes: req.body?.notes || undefined,
    });
    if (!fields.success) {
      throw LpError.validation('Check the payment details', Object.fromEntries(fields.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
    }
    const out = await uploadPaymentConfirmation(req, lp(req), String(req.params.id), req.file, fields.data);
    lpOk(req, res, out, 'Payment confirmation uploaded', 201);
  },
);

lpCapitalRoutes.get('/distributions', requireLp('lp.distributions.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  const items = await listDistributions(lp(req), { fundId: str(req.query.fundId), from: str(req.query.from), to: str(req.query.to) });
  lpOk(req, res, lpPaginate(items, page, pageSize));
});

lpCapitalRoutes.get('/distributions/statement/download', requireLp('lp.distributions.download'), async (req, res) => {
  sendFile(res, await statementFile(req, lp(req), { fundId: str(req.query.fundId), asOfDate: str(req.query.asOfDate) }));
});

lpCapitalRoutes.get('/distributions/:id', requireLp('lp.distributions.view'), async (req, res) => {
  lpOk(req, res, await getDistribution(lp(req), String(req.params.id)));
});

lpCapitalRoutes.get('/distributions/:id/download', requireLp('lp.distributions.download'), async (req, res) => {
  sendFile(res, await distributionFile(req, lp(req), String(req.params.id)));
});
