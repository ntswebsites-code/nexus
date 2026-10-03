import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { loadPortfolio } from './portfolio/portfolio.service';

/** Shared helpers for the Research & IC, Private Markets, Portfolio lab and Financing modules. */
export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const ZERO = new D(0);

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const today = () => startOfDay(new Date());
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
export const f2 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
export const f4 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(4));
export const f6 = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(6));

export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
export const positive = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && new D(v).gt(0), 'Enter a positive number (up to 6 decimals)')
  .transform((v) => new D(v));
export const nonNegative = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,6})?$/.test(v), 'Enter a non-negative number (up to 6 decimals)')
  .transform((v) => new D(v));
export const pct = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && new D(v).lte(100), 'Enter a percentage between 0 and 100')
  .transform((v) => new D(v));
export const ccy = z.string().trim().length(3).transform((v) => v.toUpperCase());
export const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500) }).strict();
export const statusIn = (s?: string) => (s ? { in: s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) } : undefined);

export const sod = (msg: string) => HttpError.forbidden(msg, 'sod_violation');
export const invalidState = (msg: string) => HttpError.conflict(msg, 'invalid_state');

export async function names(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const rows = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((u) => [u.id, u.name || u.email]));
}

export async function portfolioMap(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await prisma.portfolio.findMany({ where: { id: { in: list } }, select: { id: true, ref: true, name: true, baseCurrency: true } }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

export async function securityMap(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = list.length ? await prisma.security.findMany({ where: { id: { in: list } } }) : [];
  return new Map(rows.map((s) => [s.id, s]));
}

export async function resolvePortfolioId(v: string, path = 'portfolioId'): Promise<string> {
  return (
    await loadPortfolio(v).catch(() => {
      throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown portfolio' }]);
    })
  ).id;
}

export async function resolveSecurity(v: string, path = 'securityId') {
  const s = await prisma.security.findFirst({ where: UUID.test(v) ? { id: v } : { ticker: v.toUpperCase() } });
  if (!s) throw HttpError.badRequest('Validation failed', [{ path, message: 'Unknown security' }]);
  return s;
}

export async function portfolioFilter(v?: string) {
  if (!v) return undefined;
  return UUID.test(v) ? v : ((await prisma.portfolio.findUnique({ where: { ref: v }, select: { id: true } }))?.id ?? '0');
}

export const listPage = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
