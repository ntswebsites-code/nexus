import { Router, type Request } from 'express';
import { HttpError } from '../../../lib/errors';
import { actorName, ctx, param } from '../../../lib/http';
import { idempotent } from '../../../lib/idempotency';
import { validateBody } from '../../../middleware/validate';
import { requirePermission } from '../../../middleware/requireAuth';
import { certificateVerify } from '../workspace/cap';
import { z } from 'zod';
import { capData, companiesOverview, forecastData, governanceData, recordReview, reviewSchema, reviews } from './review';
import { mailLog } from './mail';
import { requestSignoff, signoffs } from './signoff';
import type { EsignActor } from '../../esign';

/**
 * Staff screen for investee data, mounted at /api/v1/ops/investee-review (staff session already required by /ops).
 * Reads need research.view; a review, a query back to the company and a sign-off request need research.edit.
 */
export const opsInvesteeReviewRoutes = Router();

const READ = requirePermission('research.view');
const WRITE = requirePermission('research.edit');
const audit = (req: Request) => ctx(req, 'admin');
const cid = (req: Request) => param(req, 'companyId');

export function staffEsignActor(req: Request): EsignActor {
  return {
    userId: req.user?.id ?? null,
    name: actorName(req),
    role: req.user?.roles.filter((r) => r.portal === 'admin').map((r) => r.label).join(', ') || null,
    portal: 'admin',
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    requestId: req.requestId ?? null,
  };
}

opsInvesteeReviewRoutes.get('/companies', READ, async (_req, res) => {
  res.json({ data: await companiesOverview() });
});
opsInvesteeReviewRoutes.get('/:companyId/cap-table', READ, async (req, res) => {
  res.json({ data: await capData(cid(req)) });
});
opsInvesteeReviewRoutes.get('/:companyId/certificates/:no/verify', READ, async (req, res) => {
  res.json({ data: await certificateVerify(cid(req), param(req, 'no')) });
});
opsInvesteeReviewRoutes.get('/:companyId/forecast', READ, async (req, res) => {
  res.json({ data: await forecastData(cid(req)) });
});
opsInvesteeReviewRoutes.get('/:companyId/governance', READ, async (req, res) => {
  res.json({ data: await governanceData(cid(req)) });
});
opsInvesteeReviewRoutes.get('/:companyId/reviews', READ, async (req, res) => {
  res.json({ data: await reviews(cid(req)) });
});
opsInvesteeReviewRoutes.post('/:companyId/reviews', WRITE, validateBody(reviewSchema), idempotent('ops.investee_review.record'), async (req, res) => {
  if (!req.user) throw HttpError.unauthorized();
  res.status(201).json({ data: await recordReview(cid(req), { id: req.user.id, name: actorName(req) }, req.body, audit(req)) });
});
opsInvesteeReviewRoutes.get('/:companyId/signoffs', READ, async (req, res) => {
  res.json({ data: await signoffs(cid(req)) });
});
opsInvesteeReviewRoutes.post('/:companyId/signoffs', WRITE, validateBody(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/) })), idempotent('ops.investee_signoff.request'), async (req, res) => {
  res.status(201).json({ data: await requestSignoff(staffEsignActor(req), cid(req), req.body.period) });
});
opsInvesteeReviewRoutes.get('/:companyId/mail-log', READ, async (req, res) => {
  res.json({ data: await mailLog(cid(req)) });
});
