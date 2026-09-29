import { z } from 'zod';
import { PORTALS, PORTAL_IDS } from '@matanho/shared';

const boolFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  API_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required (see .env.example)' })
    .startsWith('mysql://', 'DATABASE_URL must be a mysql:// URL'),

  ADMIN_PORTAL_URL: z.string().url().default(`http://localhost:${PORTALS.admin.devPort}`),
  INVESTOR_PORTAL_URL: z.string().url().default(`http://localhost:${PORTALS.investor.devPort}`),
  ONBOARDING_PORTAL_URL: z.string().url().default(`http://localhost:${PORTALS.onboarding.devPort}`),
  COMPANY_PORTAL_URL: z.string().url().default(`http://localhost:${PORTALS.company.devPort}`),
  CORS_ORIGINS: z.preprocess(emptyToUndefined, z.string().optional()),

  SESSION_COOKIE_NAME: z.string().min(1).default('nexus_session'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_DOMAIN: z.preprocess(emptyToUndefined, z.string().optional()),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  ALLOW_SELF_REGISTRATION: z.preprocess(emptyToUndefined, boolFromString.optional()),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  portalUrls: Record<(typeof PORTAL_IDS)[number], string>;
  corsOrigins: string[];
  session: {
    cookieName: string;
    ttlMs: number;
    cookieDomain?: string;
  };
  bcryptRounds: number;
  allowSelfRegistration: boolean;
}

function normaliseOrigin(value: string): string {
  return new URL(value).origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';

  const portalUrls = {
    admin: e.ADMIN_PORTAL_URL,
    investor: e.INVESTOR_PORTAL_URL,
    onboarding: e.ONBOARDING_PORTAL_URL,
    company: e.COMPANY_PORTAL_URL,
  };

  const explicit = (e.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigins = [
    ...new Set((explicit.length ? explicit : Object.values(portalUrls)).map(normaliseOrigin)),
  ];

  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.API_PORT,
    host: e.API_HOST,
    databaseUrl: e.DATABASE_URL,
    portalUrls,
    corsOrigins,
    session: {
      cookieName: e.SESSION_COOKIE_NAME,
      ttlMs: e.SESSION_TTL_HOURS * 60 * 60 * 1000,
      cookieDomain: e.COOKIE_DOMAIN,
    },
    bcryptRounds: e.BCRYPT_ROUNDS,
    // Open sign-up is a development convenience. In production accounts are
    // provisioned by an administrator unless explicitly enabled.
    allowSelfRegistration: e.ALLOW_SELF_REGISTRATION ?? !isProduction,
  };
}
