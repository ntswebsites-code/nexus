import type { RequestHandler } from 'express';
import type { HealthResponse } from '@matanho/shared';
import { config } from '../config';
import { checkDatabase } from '../lib/prisma';
import { storageStatus } from '../integrations/object-storage';
import { queueMetrics } from '../modules/admin-core/ops-health';

/** GET /api/health - liveness. Add `?deep=1` to also probe the database. */
export const health: RequestHandler = async (req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'matanho-nexus-api',
    environment: config.nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };

  if (req.query.deep === '1' || req.query.deep === 'true') {
    body.database = (await checkDatabase()) ? 'up' : 'down';
    body.storage = await storageStatus();
    if (body.database === 'up') body.queue = await queueMetrics().catch(() => undefined);
    if (body.database === 'down') {
      res.status(503).json({ ...body, status: 'degraded' });
      return;
    }
  }
  res.json(body);
};
