import type { Request } from 'express';
import type { PortalId } from '@matanho/shared';
import type { AuditContext } from './audit';
import { HttpError } from './errors';

/** Audit/actor context for the current request. */
export function ctx(req: Request, portal?: PortalId): AuditContext {
  const user = req.user;
  const roleLabel = user?.roles
    .filter((r) => !portal || r.portal === portal)
    .map((r) => r.label)
    .join(', ');
  return {
    actorId: user?.id ?? null,
    actorRole: roleLabel || null,
    portal: portal ?? null,
    ip: req.ip ?? null,
    requestId: req.requestId ?? null,
  };
}

export function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'System';
}

export function query<T>(req: Request): T {
  return req.validatedQuery as T;
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw HttpError.badRequest(`Missing parameter ${name}`);
  return value;
}

export function hasPermission(req: Request, code: string): boolean {
  return !!req.user?.permissions.includes(code);
}

/** Optimistic concurrency: compares `If-Match` (or body.version) with the row version when supplied. */
export function expectVersion(req: Request, current: number) {
  const header = req.get('if-match')?.replace(/"/g, '');
  const supplied = header ?? (typeof req.body?.version === 'number' ? String(req.body.version) : undefined);
  if (supplied !== undefined && Number(supplied) !== current) {
    throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  }
}

/** Decimal/Date/BigInt-safe JSON projection. */
export function num(value: { toNumber(): number } | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}
