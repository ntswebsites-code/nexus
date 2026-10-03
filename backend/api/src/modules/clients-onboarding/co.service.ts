import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { enqueue } from '../../lib/outbox';
import { DEFAULT_RISK_FACTORS, DEFAULT_SLA_HOURS, DEFAULT_THRESHOLDS, defaultRiskConfig, type RiskConfig } from './co.engine';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff (admin portal) users assignable to cases and requests. */
export async function staffDirectory() {
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } },
    select: { id: true, name: true, email: true, roles: { where: { role: { portal: 'admin' } }, select: { role: { select: { label: true } } } } },
    orderBy: { name: 'asc' },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email, email: u.email, roles: u.roles.map((r) => r.role.label) }));
}

export async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  if (!uniq.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

export async function assertStaff(userId: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true, name: true, email: true } });
  if (!u) throw HttpError.badRequest('Validation failed', [{ path: 'userId', message: 'Unknown or inactive staff user' }]);
  return { id: u.id, name: u.name ?? u.email };
}

export async function findClientByRef(refOrId: string) {
  const c = await prisma.client.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }], archivedAt: null } });
  if (!c) throw HttpError.notFound('Client not found');
  return c;
}

export async function notifyClientMembers(tx: Prisma.TransactionClient, clientId: string, n: { type: string; title: string; body?: string; link?: string; email?: boolean }) {
  const members = await tx.clientUser.findMany({ where: { clientId }, select: { userId: true } });
  if (members.length) await enqueue(tx, 'notify.users', { userIds: members.map((m) => m.userId), ...n });
}

/** Investor-portal request types and the SLA policy row they follow. */
export const SLA_TYPE_ALIASES: Record<string, string> = { 'Account / Statement': 'Statement request', 'Tax / Reporting': 'Tax document' };

/** Target hours for a request type and priority: policy row, else the type-agnostic default. */
export async function slaHours(type: string, priority: string): Promise<number> {
  type = SLA_TYPE_ALIASES[type] ?? type;
  const row = await prisma.serviceSlaPolicy.findUnique({ where: { requestType_priority: { requestType: type, priority } } });
  if (row) return row.targetHours;
  const any = await prisma.serviceSlaPolicy.findUnique({ where: { requestType_priority: { requestType: '*', priority } } });
  return any?.targetHours ?? DEFAULT_SLA_HOURS[priority] ?? 48;
}

/** Inserts any missing default factor and threshold rows (idempotent, never overwrites a stored value). */
export async function ensureRiskFactors() {
  const have = new Set((await prisma.kycRiskFactor.findMany({ select: { key: true } })).map((r) => r.key));
  const rows: Prisma.KycRiskFactorCreateManyInput[] = [
    ...DEFAULT_RISK_FACTORS.filter((f) => !have.has(f.key)).map((f) => ({ key: f.key, kind: 'FACTOR', label: f.label, points: f.points, params: (f.params ?? undefined) as Prisma.InputJsonValue | undefined })),
    ...(have.has('rating_medium') ? [] : [{ key: 'rating_medium', kind: 'THRESHOLD', label: 'Score at which the rating becomes Medium', points: DEFAULT_THRESHOLDS.rating_medium }]),
    ...(have.has('rating_high') ? [] : [{ key: 'rating_high', kind: 'THRESHOLD', label: 'Score at which the rating becomes High', points: DEFAULT_THRESHOLDS.rating_high }]),
  ];
  if (rows.length) await prisma.kycRiskFactor.createMany({ data: rows, skipDuplicates: true });
}

/** The risk scoring configuration in force: stored factor points and thresholds over the defaults. */
export async function loadRiskConfig(): Promise<RiskConfig> {
  const cfg = defaultRiskConfig();
  const rows = await prisma.kycRiskFactor.findMany();
  for (const r of rows) {
    if (r.kind === 'THRESHOLD') {
      if (r.key === 'rating_medium') cfg.medium = r.points;
      if (r.key === 'rating_high') cfg.high = r.points;
    } else if (cfg.factors[r.key]) cfg.factors[r.key] = { points: r.points, enabled: r.enabled, params: (r.params as Record<string, unknown> | null) ?? cfg.factors[r.key]!.params };
  }
  return cfg;
}
