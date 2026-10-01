import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { ctx } from '../../../lib/http';
import type { AuditContext } from '../../../lib/audit';
import { LpError } from '../lp.http';
import { assertFund, type LpContext } from '../lp.context';

/** Audit context for LP-portal writes (portal = investor). */
export const lpAudit = (req: Request): AuditContext => ctx(req, 'investor');

/** 2dp money string from a Decimal/number/null (never a float round-trip). */
export function money(value: Prisma.Decimal | number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0.00';
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value).toFixed(2);
  } catch {
    return '0.00';
  }
}

/** Decimal string from stored JSON (string or number), or `fallback` when absent/invalid. */
export function jsonDec(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return value.trim();
  return fallback;
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function isoOr(value: Date | null | undefined, fallback = ''): string {
  return value ? value.toISOString() : fallback;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** `fundId` from the query: 404 when outside the caller's scope, `undefined` for none/"all". */
export function queryFund(req: Request, ctx: LpContext): string | undefined {
  const raw = str(req.query.fundId);
  if (!raw || raw === 'all') return undefined;
  assertFund(ctx, raw);
  return raw;
}

/** Records addressed by an optional fund: fund-less rows are visible, fund rows only in scope. */
export function fundScopeWhere(ctx: LpContext, fundId?: string) {
  if (fundId) return { fundId };
  return { OR: [{ fundId: null }, { fundId: { in: ctx.fundIds } }] };
}

export function inScope(ctx: LpContext, fundId: string | null | undefined): boolean {
  return !fundId || ctx.fundIds.includes(fundId);
}

/** id -> fund for the caller's visible funds. */
export async function fundMap(ctx: LpContext) {
  const funds = await prisma.fund.findMany({ where: { id: { in: ctx.fundIds } } });
  return new Map(funds.map((f) => [f.id, f]));
}

export async function fundNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, string>();
  const funds = await prisma.fund.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(funds.map((f) => [f.id, f.name]));
}

export function bodyString(body: unknown, key: string): string | undefined {
  return str(asRecord(body)[key]);
}

export function requireText(body: unknown, key: string, max = 4000): string {
  const value = bodyString(body, key);
  if (!value) throw LpError.validation(`${key} is required`, { [key]: 'Required' });
  if (value.length > max) throw LpError.validation(`${key} is too long`, { [key]: `At most ${max} characters` });
  return value;
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s.@]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/** Capital calls are LP-visible once issued; drafts, approvals in flight and cancellations stay hidden. */
export const VISIBLE_CALL_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];
export const VISIBLE_DISTRIBUTION_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

/** Derived LP status of a call allocation (paid > part-paid > acknowledged > overdue > issued). */
export function callStatus(a: { status: string; callAmount: Prisma.Decimal; amountPaid: Prisma.Decimal; acknowledgedAt: Date | null }, dueDate: Date) {
  if (a.status === 'CANCELLED') return 'CANCELLED';
  if (a.status === 'PAID' || (a.callAmount.gt(0) && a.amountPaid.gte(a.callAmount))) return 'PAID';
  if (a.amountPaid.gt(0)) return 'PARTIALLY_PAID';
  if (a.acknowledgedAt) return 'ACKNOWLEDGED';
  if (dueDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) return 'OVERDUE';
  return 'ISSUED';
}

/** Short random id for upload-then-attach rows (`RequestAttachment.id` is VARCHAR(20)). */
export function attachmentId(): string {
  return `att_${randomBytes(8).toString('hex')}`;
}
