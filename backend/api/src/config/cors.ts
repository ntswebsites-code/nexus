import cors from 'cors';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from './env';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/i;

/** Port of the calling portal when the request comes from a local dev origin, else undefined. */
function localPortalPort(req: Request): string | undefined {
  const source = req.get('origin') ?? req.get('referer');
  if (!source) return undefined;
  try {
    const url = new URL(source);
    return LOCAL_HOST.test(url.hostname) && url.port ? url.port : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Outside production every portal runs on `localhost` with a different port, and cookies are not scoped by
 * port, so they would all share one `nexus_session` and overwrite each other (ISS-ADA-004, ISS-LPC-001).
 * For browser calls from a local portal origin the session cookie is stored as `<name>_<port>`; this
 * middleware (installed before cookie-parser) maps it back to the plain name on the way in and renames the
 * cookie the API sets/clears on the way out, so auth code is unchanged. Production keeps one plain cookie.
 */
function namespaceSessionCookie(config: AppConfig): RequestHandler {
  const base = config.session.cookieName;
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.isProduction) return next();
    const port = localPortalPort(req);
    if (!port) return next();
    const scoped = `${base}_${port}`;

    const raw = req.headers.cookie;
    if (raw) {
      const kept: string[] = [];
      let token: string | undefined;
      for (const part of raw.split(';')) {
        const name = part.split('=')[0].trim();
        if (name === scoped) token = part.slice(part.indexOf('=') + 1).trim();
        else if (name !== base) kept.push(part.trim());
      }
      if (token !== undefined) kept.push(`${base}=${token}`);
      req.headers.cookie = kept.join('; ');
    }

    const rename = (name: string) => (name === base ? scoped : name);
    const setCookie = res.cookie.bind(res) as (name: string, ...rest: unknown[]) => Response;
    const clearCookie = res.clearCookie.bind(res) as (name: string, ...rest: unknown[]) => Response;
    res.cookie = ((name: string, ...rest: unknown[]) => setCookie(rename(name), ...rest)) as Response['cookie'];
    res.clearCookie = ((name: string, ...rest: unknown[]) =>
      clearCookie(rename(name), ...rest)) as Response['clearCookie'];
    next();
  };
}

/**
 * Credentialed CORS restricted to an explicit allow-list of portal origins
 * (from env). Requests without an Origin header (curl, server-to-server,
 * health probes) are allowed through; they cannot carry a browser session.
 */
export function createCors(config: AppConfig): RequestHandler {
  const allowed = new Set(config.corsOrigins);
  const handler = cors({
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'If-Match', 'Idempotency-Key', 'X-Request-Id', 'X-Draft-Token'],
    exposedHeaders: ['X-Request-Id', 'ETag'],
    maxAge: 600,
  });
  const namespace = namespaceSessionCookie(config);
  return (req, res, next) => namespace(req, res, (err?: unknown) => (err ? next(err) : handler(req, res, next)));
}
