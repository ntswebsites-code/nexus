import { createHash } from 'node:crypto';
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
  /** Ceiling for the admin `session_idle_minutes` policy (default 30). */
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(240),

  PUBLIC_API_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  /// 32-byte key, base64 or hex. Encrypts stored files and sensitive columns.
  FILE_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /// Secret for signed download URLs and other HMACs.
  DOWNLOAD_SIGNING_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),

  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_SECURE: z.preprocess(emptyToUndefined, boolFromString.optional()),
  MAIL_FROM: z.string().default('Matanho Nexus <no-reply@nexus.matanho.com>'),
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
    idleMs: number;
  };
  bcryptRounds: number;
  allowSelfRegistration: boolean;
  publicApiUrl: string;
  storage: { dir: string; maxUploadBytes: number };
  encryptionKey: Buffer;
  signingSecret: string;
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string };
  mailFrom: string;
}

/** Accepts a 32-byte key as base64 or hex; derives a stable dev key when unset outside production. */
function parseKey(raw: string | undefined, isProduction: boolean): Buffer {
  if (!raw) {
    if (isProduction) throw new Error('FILE_ENCRYPTION_KEY is required in production (32 bytes, base64 or hex)');
    return createHash('sha256').update('matanho-nexus-dev-only-key').digest();
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FILE_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
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
      idleMs: e.SESSION_IDLE_MINUTES * 60 * 1000,
    },
    bcryptRounds: e.BCRYPT_ROUNDS,
    // Open sign-up is a development convenience. In production accounts are
    // provisioned by an administrator unless explicitly enabled.
    allowSelfRegistration: e.ALLOW_SELF_REGISTRATION ?? !isProduction,
    publicApiUrl: (e.PUBLIC_API_URL ?? `http://localhost:${e.API_PORT}`).replace(/\/+$/, ''),
    storage: { dir: e.STORAGE_DIR, maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024 },
    encryptionKey: parseKey(e.FILE_ENCRYPTION_KEY, isProduction),
    signingSecret: (() => {
      if (e.DOWNLOAD_SIGNING_SECRET) return e.DOWNLOAD_SIGNING_SECRET;
      if (isProduction) throw new Error('DOWNLOAD_SIGNING_SECRET is required in production');
      return 'matanho-nexus-dev-signing-secret';
    })(),
    smtp: e.SMTP_HOST
      ? {
          host: e.SMTP_HOST,
          port: e.SMTP_PORT,
          secure: e.SMTP_SECURE ?? e.SMTP_PORT === 465,
          user: e.SMTP_USER,
          password: e.SMTP_PASSWORD,
        }
      : undefined,
    mailFrom: e.MAIL_FROM,
  };
}
