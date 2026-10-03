import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../../modules/ops/ops.common';
import { IntegrationNotConfiguredError } from '../common';
import { getMarketDataAdapter } from './index';
import { getMarketDataStatus, refreshMarketData, securityProvenance } from './service';

/**
 * Market-data ops API (`/api/v1/market-data`). Admin staff only. Reads: `portfolio.view` or `operations.view`.
 * Refresh and exception handling need `portfolio.manage`. Manual price overrides keep using
 * `POST /securities/:id/prices` (source MANUAL), which always wins over a feed price for the same date.
 */
export const marketDataRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canRead = [...staff, requireAnyPermission('portfolio.view', 'operations.view')];
const canManage = [...staff, requirePermission('portfolio.manage')];

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
