import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config } from './config';
import { createCors } from './config/cors';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { originGuard } from './middleware/originGuard';
import { apiRouter } from './routes';

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
  app.use(createCors(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', originGuard(config.corsOrigins), apiRouter);

  app.get('/', (_req, res) => {
    res.json({ service: 'matanho-nexus-api', health: '/api/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
