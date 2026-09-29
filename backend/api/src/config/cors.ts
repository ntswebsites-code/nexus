import cors from 'cors';
import type { AppConfig } from './env';

/**
 * Credentialed CORS restricted to an explicit allow-list of portal origins
 * (from env). Requests without an Origin header (curl, server-to-server,
 * health probes) are allowed through; they cannot carry a browser session.
 */
export function createCors(config: AppConfig) {
  const allowed = new Set(config.corsOrigins);
  return cors({
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 600,
  });
}
