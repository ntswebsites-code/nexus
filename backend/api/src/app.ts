import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { createCors } from './config/cors';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { originGuard } from './middleware/originGuard';
import { requestId } from './middleware/requestId';
import { generalLimiter, metricsHandler, requestLog, uploadLimiter } from './middleware/observability';
import { apiRouter } from './routes';

// Audit/outbox ids are BIGINT; serialise them as strings in JSON responses.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
  return this.toString();
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Honour X-Forwarded-* when running behind a reverse proxy in production.
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // HSTS is only meaningful (and only honoured) over HTTPS in production.
      hsts: config.isProduction,
    }),
  );
  app.use(requestId);
  app.use(requestLog);
  app.use(createCors(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.get('/api/internal/metrics', metricsHandler);
  app.use('/api', generalLimiter, uploadLimiter, originGuard(config.corsOrigins), apiRouter);

  app.get('/', (_req, res) => {
    res.json({ service: 'matanho-nexus-api', health: '/api/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
