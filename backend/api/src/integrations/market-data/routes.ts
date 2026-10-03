import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { audit } from '../../modules/ops/ops.common';
import { IntegrationNotConfiguredError } from '../common';
import { getMarketDataAdapter, marketDataMode } from './index';
import { getMarketDataStatus, refreshMarketData, securityProvenance, undoRefreshRun } from './service';

/**
 * Market-data ops API (`/api/v1/market-data`). Admin staff only. Reads: `portfolio.view` or `operations.view`.
 * Refresh and exception handling need `portfolio.manage`. Manual price overrides keep using
 * `POST /securities/:id/prices` (source MANUAL), which always wins over a feed price for the same date.
 */
export const marketDataRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canRead = [...staff, requireAnyPermission('portfolio.view', 'operations.view')];
const canManage = [...staff, requirePermission('portfolio.manage')];
const canSimulate = [...staff, requireAnyPermission('portfolio.manage', 'admin.settings')];

const notConfigured = (e: unknown): never => {
  if (e instanceof IntegrationNotConfiguredError) throw new HttpError(503, e.code, e.message, { requiredEnv: e.requiredEnv });
  throw e;
};

marketDataRoutes.get('/status', ...canRead, async (_req, res) => {
  res.json({ data: await getMarketDataStatus() });
});

marketDataRoutes.get('/health', ...canRead, async (_req, res) => {
  res.json({ data: await getMarketDataAdapter().healthCheck() });
});

const refreshSchema = z.object({
  scope: z.enum(['EOD', 'INTRADAY', 'FX', 'ALL']).default('ALL'),
  tickers: z.array(z.string().trim().min(1).max(24)).max(200).optional(),
  force: z.boolean().default(false),
});

/** 'Refresh now'. Honours source back-off and the per-source minimum interval; `force` only bypasses the response cache. */
marketDataRoutes.post('/refresh', ...canManage, validateBody(refreshSchema), async (req, res) => {
  const b = req.body as z.infer<typeof refreshSchema>;
  try {
    const summary = await refreshMarketData({ trigger: 'MANUAL', scope: b.scope, tickers: b.tickers, force: b.force, userId: req.user!.id, audit: audit(req) });
    res.json({ data: summary });
  } catch (e) {
    notConfigured(e);
  }
});

marketDataRoutes.get('/securities/:id/provenance', ...canRead, async (req, res) => {
  const sec = await prisma.security.findFirst({ where: { OR: [{ id: param(req, 'id') }, { ticker: param(req, 'id') }] }, select: { id: true, ticker: true } });
  if (!sec) throw HttpError.notFound('Security not found');
  res.json({ data: { ticker: sec.ticker, rows: await securityProvenance(sec.id) } });
});

marketDataRoutes.post('/exceptions/:id/acknowledge', ...canManage, async (req, res) => {
  const row = await prisma.mdProvenance.findUnique({ where: { id: param(req, 'id') } });
  if (!row || !['REJECTED', 'ERROR'].includes(row.status)) throw HttpError.notFound('Exception not found');
  await prisma.$transaction(async (tx) => {
    await tx.mdProvenance.update({ where: { id: row.id }, data: { acknowledgedAt: new Date(), acknowledgedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'market_data.exception.acknowledged', objectType: 'market_data_exception', objectId: row.id, after: { ticker: row.ticker, source: row.source, reason: row.reason } });
  });
  res.json({ data: { id: row.id, acknowledged: true } });
});

const simulateSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(), tickers: z.array(z.string().trim().min(1).max(24)).max(200).optional() }).strict();

/**
 * 'Run feed' on the Integrations screen. Goes through the same refresh as the scheduler, so every value is checked against
 * the sanity bounds (rejections become exceptions), gets a run record and provenance, and the run can be reversed.
 */
marketDataRoutes.post('/simulate', ...canSimulate, validateBody(simulateSchema), async (req, res) => {
  const b = req.body as z.infer<typeof simulateSchema>;
  if (marketDataMode() !== 'fake') throw HttpError.conflict('Simulated feeds only run while the market-data provider is the fake one. Use Refresh now for a live provider.', 'simulation_not_allowed');
  const now = b.date ? new Date(`${b.date}T12:00:00.000Z`) : new Date();
  if (now.getTime() - 86_400_000 > Date.now()) throw HttpError.badRequest('Validation failed', [{ path: 'date', message: 'A feed date cannot be in the future' }]);
  try {
    const summary = await refreshMarketData({ trigger: 'MANUAL', scope: 'ALL', tickers: b.tickers, force: true, now, userId: req.user!.id, audit: audit(req) });
    res.status(201).json({ data: summary });
  } catch (e) {
    notConfigured(e);
  }
});

/** Reverse one finished refresh run (created rows are removed, changed rows restored). */
const undoSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(300) }).strict();
marketDataRoutes.post('/runs/:id/undo', ...canSimulate, requireStepUp, validateBody(undoSchema), async (req, res) => {
  res.json({ data: await undoRefreshRun(param(req, 'id'), audit(req), (req.body as z.infer<typeof undoSchema>).reason) });
});
