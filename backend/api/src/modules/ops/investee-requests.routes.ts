import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requirePermission } from '../../middleware/requireAuth';
import { consentDecisionSchema, decideConsent, decideRequisition, decisionSchema, listConsentsForStaff, listRequisitionsForStaff } from '../investee-portal/investee-workspace';
import { audit } from './ops.common';

/**
 * Staff decisions on company capital and procurement requests.
 * The company submits; a portfolio user with research.edit approves, rejects or marks fulfilled.
 * This records the decision. It does not move cash.
 */
export const opsInvesteeRequestRoutes = Router();

const REVIEW = requirePermission('research.edit');

opsInvesteeRequestRoutes.get('/', REVIEW, async (_req, res) => {
  res.json({ data: await listRequisitionsForStaff() });
});

opsInvesteeRequestRoutes.get('/consents', REVIEW, async (_req, res) => {
  res.json({ data: await listConsentsForStaff() });
});

opsInvesteeRequestRoutes.post('/consents/:companyId/:id/decide', REVIEW, validateBody(consentDecisionSchema), idempotent('ops.investee_consent.decide'), async (req, res) => {
  const companyId = param(req, 'companyId');
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw HttpError.notFound('Company not found');
  const row = await decideConsent(companyId, param(req, 'id'), req.body, audit(req));
  res.json({ data: row });
});

opsInvesteeRequestRoutes.post('/:companyId/:id/decide', REVIEW, validateBody(decisionSchema), idempotent('ops.investee_request.decide'), async (req, res) => {
  const companyId = param(req, 'companyId');
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw HttpError.notFound('Company not found');
  const row = await decideRequisition(companyId, param(req, 'id'), req.body, audit(req));
  res.json({ data: row });
});
