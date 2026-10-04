import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requirePermission } from '../../middleware/requireAuth';
import {
  addReservedMatter,
  consentDecisionSchema,
  decideConsent,
  decideRequisition,
  decisionSchema,
  listConsentsForStaff,
  listReservedMattersForStaff,
  listRequisitionsForStaff,
  reservedMatterSchema,
  reservedMatterUpdateSchema,
  setCommittedTranche,
  slaBreachedRequisitions,
  submittedForecastVersions,
  trancheLedger,
  trancheSchema,
  updateReservedMatter,
} from '../investee-portal/investee-workspace';
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

async function requireCompany(companyId: string) {
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw HttpError.notFound('Company not found');
}

// BR-230: requests that have waited 48 hours or more for VC executive review
opsInvesteeRequestRoutes.get('/sla', REVIEW, async (_req, res) => {
  res.json({ data: await slaBreachedRequisitions() });
});

// BR-270, BR-272: committed, reserved, available and approved figures for a company's investment tranche
opsInvesteeRequestRoutes.get('/tranche/:companyId', REVIEW, async (req, res) => {
  const companyId = param(req, 'companyId');
  await requireCompany(companyId);
  res.json({ data: await trancheLedger(companyId) });
});

opsInvesteeRequestRoutes.put('/tranche/:companyId', REVIEW, validateBody(trancheSchema), idempotent('ops.investee_tranche.set'), async (req, res) => {
  const companyId = param(req, 'companyId');
  res.json({ data: await setCommittedTranche(companyId, req.body, audit(req)) });
});

// BR-208: the fund sees submitted forecast versions only
opsInvesteeRequestRoutes.get('/forecasts/:companyId', REVIEW, async (req, res) => {
  const companyId = param(req, 'companyId');
  await requireCompany(companyId);
  res.json({ data: await submittedForecastVersions(companyId) });
});

opsInvesteeRequestRoutes.get('/forecasts/:companyId/:version', REVIEW, async (req, res) => {
  const companyId = param(req, 'companyId');
  const no = Number(param(req, 'version'));
  if (!Number.isInteger(no) || no < 1) throw HttpError.badRequest('Version must be a whole number');
  await requireCompany(companyId);
  res.json({ data: await submittedForecastVersions(companyId, no) });
});

// CMP-030: reserved matters and notice periods per company
opsInvesteeRequestRoutes.get('/reserved-matters/:companyId', REVIEW, async (req, res) => {
  const companyId = param(req, 'companyId');
  await requireCompany(companyId);
  res.json({ data: await listReservedMattersForStaff(companyId) });
});

opsInvesteeRequestRoutes.post('/reserved-matters/:companyId', REVIEW, validateBody(reservedMatterSchema), idempotent('ops.investee_reserved_matter.create'), async (req, res) => {
  const companyId = param(req, 'companyId');
  res.status(201).json({ data: await addReservedMatter(companyId, req.body, audit(req)) });
});

opsInvesteeRequestRoutes.patch('/reserved-matters/:companyId/:id', REVIEW, validateBody(reservedMatterUpdateSchema), idempotent('ops.investee_reserved_matter.update'), async (req, res) => {
  const companyId = param(req, 'companyId');
  res.json({ data: await updateReservedMatter(companyId, param(req, 'id'), req.body, audit(req)) });
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
