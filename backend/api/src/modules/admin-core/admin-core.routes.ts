import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { enqueue } from '../../lib/outbox';
import { nextRef, refFormats } from '../../lib/refs';
import { getPolicies } from '../../lib/policy';
import { clearSettingCache, setting } from '../../lib/settings';
import { runRetentionPurge } from './retention';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, assertUpdated, audit, notifyPermission } from '../ops/ops.common';
import {
  MONETARY,
  permissionArea,
  PRIVILEGED_PERMISSIONS,
  privilegedPermissionAdds,
  privilegedRoleAdds,
  SETTINGS,
  settingDef,
  SOD_RULES,
  sodHits,
  STEP_UP_ACTIONS,
  SYSTEM_ADMIN,
  validateSetting,
  isPrivilegedPermission,
  type ChangeKind,
  type SettingDef,
} from './admin-core.engine';
import { SUGGESTIONS } from './copilot';
import { askCopilot } from './copilot-agent';
import { integrationsRoutes } from './integrations.routes';

/**
 * Admin Core (SRD 5A `rbac`, `settings`, `audit`, `copilot`). Mounted at `/api/v1/admin-core`. Extends the staff
 * `/api/v1/admin` routes (users, roles, policy, SoD scan, audit evidence) with: privileged access changes that need an
 * independent checker, access review campaigns, the permission matrix and SoD conflict report, platform settings with
 * change history, audit facets and event detail, and the grounded Copilot.
 */
export const adminCoreRoutes = Router();
adminCoreRoutes.use(requireAuth, requirePortalAccess('admin'));
// Integrations ops screen API (WP-8): /admin-core/integrations/*
adminCoreRoutes.use('/integrations', integrationsRoutes);

const RBAC = requirePermission('admin.rbac');
const SETTINGS_PERM = requirePermission('admin.settings');
const AUDIT = requirePermission('audit.view');
const COPILOT = requirePermission('dashboard.view');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Runs the step-up check inline (for routes where only some branches need it). */
async function stepUp(req: Request, res: Response) {
  await requireStepUp(req, res, (err?: unknown) => {
    if (err) throw err;
  });
}

const staffInclude = {
  roles: { where: { role: { portal: 'admin' } }, include: { role: { include: { permissions: true } } } },
  mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } },
} satisfies Prisma.UserInclude;

const userName = async (ids: (string | null | undefined)[]) => {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
};

// ================================================================ matrix, SoD, step-up policy

adminCoreRoutes.get('/rbac/matrix', RBAC, async (_req, res) => {
  const roles = await prisma.role.findMany({ where: { portal: 'admin' }, include: { permissions: true, _count: { select: { users: true } } }, orderBy: [{ custom: 'asc' }, { label: 'asc' }] });
  const byPerm = new Map<string, string[]>();
  for (const r of roles) for (const p of r.permissions) byPerm.set(p.permission, [...(byPerm.get(p.permission) ?? []), r.key]);
  const areas = new Map<string, { code: string; privileged: boolean; roles: string[] }[]>();
  for (const [code, keys] of [...byPerm.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const a = permissionArea(code);
    areas.set(a, [...(areas.get(a) ?? []), { code, privileged: isPrivilegedPermission(code), roles: keys }]);
  }
  res.json({
    roles: roles.map((r) => ({ key: r.key, label: r.label, locked: r.locked, custom: r.custom, users: r._count.users, permissionCount: r.permissions.length })),
    areas: [...areas.entries()].map(([area, permissions]) => ({ area, permissions })),
    privilegedRule: 'Granting a privileged permission, or the System Administrator role, needs an independent checker.',
  });
});

/** The SoD catalogue itself: the blocklist platform administrators may never hold and every conflicting permission pair. */
adminCoreRoutes.get('/sod/rules', RBAC, async (_req, res) => {
  res.json({ data: SOD_RULES, blocklist: MONETARY, privileged: [...PRIVILEGED_PERMISSIONS].sort() });
});

adminCoreRoutes.get('/rbac/sod', RBAC, async (_req, res) => {
  const [roles, users] = await Promise.all([
    prisma.role.findMany({ where: { portal: 'admin' }, include: { permissions: true } }),
    prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, include: staffInclude, orderBy: { name: 'asc' } }),
  ]);
  const roleConflicts = roles
    .map((r) => ({ key: r.key, label: r.label, hits: sodHits(r.permissions.map((p) => p.permission)) }))
    .filter((r) => r.hits.length);
  const userConflicts = users
    .map((u) => {
      const perms = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)));
      const hits = sodHits(perms);
      // A conflict inside a single role is reported under the role; the user row shows only combinations made by assignment.
      const viaCombination = hits.filter((h) => !u.roles.some((r) => r.role.permissions.some((p) => p.permission === h.a) && r.role.permissions.some((p) => p.permission === h.b)));
      return { userId: u.id, name: u.name ?? u.email, email: u.email, roles: u.roles.map((r) => r.role.label), hits, viaCombination: viaCombination.length };
    })
    .filter((u) => u.hits.length);
  res.json({
    rules: SOD_RULES,
    protectedMonetary: MONETARY,
    roleConflicts,
    userConflicts,
    summary: { rules: SOD_RULES.length, roles: roleConflicts.length, users: userConflicts.length },
    scannedAt: new Date().toISOString(),
  });
});

adminCoreRoutes.get('/rbac/step-up', RBAC, async (_req, res) => {
  const p = await getPolicies();
  const factors = await prisma.userMfaFactor.findMany({ where: { verifiedAt: { not: null }, user: { roles: { some: { role: { portal: 'admin' } } } } }, select: { userId: true }, distinct: ['userId'] });
  const staff = await prisma.user.count({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } } });
  res.json({
    windowMinutes: 5,
    mfaRequired: Boolean(p.mfa_required),
    sessionIdleMinutes: Number(p.session_idle_minutes),
    enrolment: { staff, enrolled: factors.length },
    actions: STEP_UP_ACTIONS,
    note: 'A fresh authenticator code is required within five minutes of the action. Staff without an enrolled factor are blocked from these actions when MFA is mandatory.',
  });
});

// ================================================================ privileged access changes (maker-checker)

interface RoleRef {
  id: string;
  key: string;
  label: string;
  permissions: string[];
}

async function loadAdminRoles(tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<Map<string, RoleRef>> {
  const roles = await tx.role.findMany({ where: { portal: 'admin' }, include: { permissions: true } });
  return new Map(roles.map((r) => [r.key, { id: r.id, key: r.key, label: r.label, permissions: r.permissions.map((p) => p.permission).sort() }]));
}

async function userRoleKeys(tx: Prisma.TransactionClient | typeof prisma, userId: string): Promise<string[]> {
  const rows = await tx.userRole.findMany({ where: { userId, role: { portal: 'admin' } }, include: { role: true } });
  return rows.map((r) => r.role.key).sort();
}

async function activeAdminCount(tx: Prisma.TransactionClient | typeof prisma) {
  return tx.userRole.count({ where: { role: { portal: 'admin', key: SYSTEM_ADMIN }, user: { isActive: true } } });
}

/** Applies a change inside the caller's transaction; throws a 409/400 when it is no longer safe. */
async function applyChange(tx: Prisma.TransactionClient, kind: ChangeKind, targetId: string, proposal: Record<string, unknown>) {
  if (kind === 'USER_ROLES') {
    const wanted = (proposal.roles as string[]) ?? [];
    const roles = await loadAdminRoles(tx);
    const picked = wanted.map((k) => roles.get(k));
    if (picked.some((r) => !r)) throw HttpError.badRequest('A proposed role no longer exists');
    const before = await userRoleKeys(tx, targetId);
    if (before.includes(SYSTEM_ADMIN) && !wanted.includes(SYSTEM_ADMIN) && (await activeAdminCount(tx)) <= 1) {
      throw HttpError.conflict('At least one active System Administrator must remain', 'last_admin');
    }
    await tx.userRole.deleteMany({ where: { userId: targetId, role: { portal: 'admin' } } });
    await tx.userRole.createMany({ data: picked.map((r) => ({ userId: targetId, roleId: r!.id })) });
    return { before: { roles: before }, after: { roles: wanted } };
  }
  if (kind === 'ROLE_PERMISSIONS') {
    const role = await tx.role.findUnique({ where: { id: targetId }, include: { permissions: true } });
    if (!role) throw HttpError.notFound('Role not found');
    if (role.locked || role.key === SYSTEM_ADMIN) throw HttpError.forbidden('System Administrator privileges are platform-only and cannot be edited', 'role_locked');
    const next = [...new Set((proposal.permissions as string[]) ?? [])].sort();
    const before = role.permissions.map((p) => p.permission).sort();
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (next.length) await tx.rolePermission.createMany({ data: next.map((permission) => ({ roleId: role.id, permission })) });
    return { before: { permissions: before }, after: { permissions: next, added: next.filter((p) => !before.includes(p)), removed: before.filter((p) => !next.includes(p)) } };
  }
  const user = await tx.user.findUnique({ where: { id: targetId } });
  if (!user) throw HttpError.notFound('Staff user not found');
  if ((await userRoleKeys(tx, targetId)).includes(SYSTEM_ADMIN) && user.isActive && (await activeAdminCount(tx)) <= 1) {
    throw HttpError.conflict('At least one active System Administrator must remain', 'last_admin');
  }
  await tx.user.update({ where: { id: targetId }, data: { isActive: false } });
  await tx.session.deleteMany({ where: { userId: targetId } });
  return { before: { isActive: user.isActive }, after: { isActive: false } };
}

const requestView = (r: Prisma.AccessChangeRequestGetPayload<object>, names: Map<string, string>) => ({
  id: r.id,
  ref: r.ref,
  kind: r.kind,
  targetType: r.targetType,
  targetId: r.targetId,
  targetLabel: r.targetLabel,
  before: r.before,
  proposal: r.proposal,
  privileged: r.privileged,
  privilegedBy: r.privilegedBy,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requestedBy,
  requestedByName: names.get(r.requestedBy) ?? 'Unknown',
  requestedAt: r.requestedAt.toISOString(),
  decidedBy: r.decidedBy,
  decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? 'Unknown' : null,
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decisionNote: r.decisionNote,
  fromReview: !!r.reviewItemId,
  version: r.version,
});

adminCoreRoutes.get(
  '/rbac/requests',
  RBAC,
  validateQuery(z.object({ status: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })),
  async (req, res) => {
    const q = query<{ status?: string; limit: number }>(req);
    const rows = await prisma.accessChangeRequest.findMany({ where: q.status ? { status: { in: csv(q.status) } } : undefined, orderBy: { requestedAt: 'desc' }, take: q.limit });
    const names = await userName(rows.flatMap((r) => [r.requestedBy, r.decidedBy]));
    res.json({ data: rows.map((r) => requestView(r, names)) });
  },
);

const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('USER_ROLES'), userId: z.string().regex(UUID), roles: z.array(z.string().max(64)).min(1).max(10), reason: z.string().trim().min(5).max(500) }),
  z.object({ kind: z.literal('ROLE_PERMISSIONS'), roleKey: z.string().max(64), permissions: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/)).max(200), reason: z.string().trim().min(5).max(500) }),
  z.object({ kind: z.literal('USER_DISABLE'), userId: z.string().regex(UUID), reason: z.string().trim().min(5).max(500) }),
]);
type RequestBody = z.infer<typeof requestSchema>;

/**
 * Creates the change. A privileged change (or one forced by a review) waits for an independent checker. Anything else
 * is applied at once by the requester under step-up, and recorded the same way.
 */
async function createChange(req: Request, b: RequestBody, opts: { forcePending?: boolean; reviewItemId?: string; tx?: Prisma.TransactionClient } = {}) {
  const me = req.user!.id;
  const roles = await loadAdminRoles();
  let targetType: 'user' | 'role' = 'user';
  let targetId = '';
  let targetLabel = '';
  let before: Prisma.InputJsonObject;
  let proposal: Prisma.InputJsonObject;
  let privilegedBy: string[] = [];

  if (b.kind === 'ROLE_PERMISSIONS') {
    const role = roles.get(b.roleKey);
    if (!role) throw HttpError.notFound('Role not found');
    if (role.key === SYSTEM_ADMIN) throw HttpError.forbidden('System Administrator privileges are platform-only and cannot be edited', 'role_locked');
    const row = await prisma.role.findUnique({ where: { id: role.id } });
    if (row?.locked) throw HttpError.forbidden('This role is locked', 'role_locked');
    const next = [...new Set(b.permissions)].sort();
    if (JSON.stringify(next) === JSON.stringify(role.permissions)) throw HttpError.badRequest('That is already the role\'s permission set');
    if (req.user!.roles.some((r) => r.portal === 'admin' && r.key === role.key) && role.permissions.includes('admin.rbac') && !next.includes('admin.rbac')) {
      throw HttpError.conflict('You cannot remove access control from a role you hold', 'self_lockout');
    }
    targetType = 'role';
    targetId = role.id;
    targetLabel = role.label;
    before = { permissions: role.permissions };
    proposal = { permissions: next, roleKey: role.key };
    privilegedBy = privilegedPermissionAdds(role.permissions, next);
  } else {
    const user = await prisma.user.findUnique({ where: { id: b.userId }, include: staffInclude });
    if (!user || !user.roles.length) throw HttpError.notFound('Staff user not found');
    targetId = user.id;
    targetLabel = user.name ?? user.email;
    const beforeKeys = user.roles.map((r) => r.role.key).sort();
    if (b.kind === 'USER_ROLES') {
      const wanted = [...new Set(b.roles)].sort();
      if (wanted.some((k) => !roles.has(k))) throw HttpError.badRequest('Unknown role');
      if (JSON.stringify(wanted) === JSON.stringify(beforeKeys)) throw HttpError.badRequest('That is already this user\'s role set');
      const picked = wanted.map((k) => roles.get(k)!);
      if (user.id === me && !picked.some((r) => r.permissions.includes('admin.rbac'))) throw HttpError.conflict('You cannot remove your own access-control permission', 'self_lockout');
      if (beforeKeys.includes(SYSTEM_ADMIN) && !wanted.includes(SYSTEM_ADMIN) && (await activeAdminCount(prisma)) <= 1) {
        throw HttpError.conflict('At least one active System Administrator must remain', 'last_admin');
      }
      before = { roles: beforeKeys };
      proposal = { roles: wanted };
      privilegedBy = privilegedRoleAdds(
        beforeKeys.map((k) => ({ key: k, permissions: roles.get(k)?.permissions ?? [] })),
        picked.map((r) => ({ key: r.key, permissions: r.permissions })),
      );
    } else {
      if (user.id === me) throw HttpError.conflict('You cannot disable your own account', 'self_lockout');
      if (!user.isActive) throw HttpError.badRequest('This account is already disabled');
      before = { isActive: true, roles: beforeKeys };
      proposal = { isActive: false };
    }
  }

  const dup = await prisma.accessChangeRequest.findFirst({ where: { status: 'PENDING', kind: b.kind, targetType, targetId } });
  if (dup) throw HttpError.conflict(`${dup.ref} is already pending for this target`, 'duplicate_pending');

  const privileged = privilegedBy.length > 0;
  const pending = privileged || !!opts.forcePending;
  const run = async (tx: Prisma.TransactionClient) => {
    const ref = await nextRef(tx, 'accessRequest');
    let status = 'PENDING';
    let applied: Awaited<ReturnType<typeof applyChange>> | null = null;
    if (!pending) {
      applied = await applyChange(tx, b.kind, targetId, proposal as Record<string, unknown>);
      status = 'APPLIED';
    }
    const row = await tx.accessChangeRequest.create({
      data: {
        ref,
        kind: b.kind,
        targetType,
        targetId,
        targetLabel,
        before,
        proposal,
        privileged,
        privilegedBy: privilegedBy.length ? privilegedBy : Prisma.JsonNull,
        reason: b.reason,
        status,
        reviewItemId: opts.reviewItemId ?? null,
        requestedBy: me,
        ...(applied ? { decidedBy: me, decidedAt: new Date(), decisionNote: 'Not privileged: applied by the requester under step-up' } : {}),
      },
    });
    await writeAudit(tx, audit(req), {
      action: applied ? 'access_change.applied' : 'access_change.requested',
      objectType: 'access_change_request',
      objectId: row.id,
      before: applied?.before ?? before,
      after: applied?.after ?? { ...proposal, status, privilegedBy },
      reason: b.reason,
    });
    if (applied) await writeAudit(tx, audit(req), { action: b.kind === 'ROLE_PERMISSIONS' ? 'role.permissions_changed' : b.kind === 'USER_DISABLE' ? 'staff_user.disabled' : 'staff_user.roles_changed', objectType: targetType === 'role' ? 'role' : 'user', objectId: targetId, before: applied.before, after: applied.after, reason: b.reason });
    if (!applied) {
      await notifyPermission(tx, 'admin.rbac', { type: 'access.change_pending', title: `${ref}: ${privileged ? 'privileged ' : ''}access change needs approval`, body: `${targetLabel}: ${b.reason}`, link: '/ops/rbac' });
    }
    return row;
  };
  const row = opts.tx ? await run(opts.tx) : await prisma.$transaction(run);
  return row;
}

adminCoreRoutes.post('/rbac/requests', RBAC, requireStepUp, idempotent('access_change.create'), validateBody(requestSchema), async (req, res) => {
  const row = await createChange(req, req.body as RequestBody);
  const names = await userName([row.requestedBy, row.decidedBy]);
  res.status(201).json({ data: requestView(row, names) });
});

const decideSchema = z.object({ note: z.string().trim().max(500).optional(), version: z.number().int().optional() });

async function loadRequest(id: string) {
  if (!UUID.test(id)) throw HttpError.notFound('Request not found');
  const r = await prisma.accessChangeRequest.findUnique({ where: { id } });
  if (!r) throw HttpError.notFound('Request not found');
  return r;
}

adminCoreRoutes.post('/rbac/requests/:id/approve', RBAC, requireStepUp, idempotent('access_change.approve'), validateBody(decideSchema), async (req, res) => {
  const r = await loadRequest(param(req, 'id'));
  if (r.status !== 'PENDING') throw HttpError.conflict(`${r.ref} is ${r.status}; it cannot be approved`, 'invalid_state');
  assertSegregation(req.user!.id, r.requestedBy, r.targetType === 'user' ? r.targetId : null);
  const row = await prisma.$transaction(async (tx) => {
    const claimed = await tx.accessChangeRequest.updateMany({ where: { id: r.id, status: 'PENDING', version: r.version }, data: { status: 'APPLIED', decidedBy: req.user!.id, decidedAt: new Date(), decisionNote: (req.body as z.infer<typeof decideSchema>).note ?? null, version: { increment: 1 } } });
    assertUpdated(claimed.count);
    const applied = await applyChange(tx, r.kind as ChangeKind, r.targetId, r.proposal as Record<string, unknown>);
    await writeAudit(tx, audit(req), { action: 'access_change.approved', objectType: 'access_change_request', objectId: r.id, before: { status: 'PENDING', ...applied.before }, after: { status: 'APPLIED', ...applied.after }, reason: (req.body as z.infer<typeof decideSchema>).note ?? r.reason });
    await writeAudit(tx, audit(req), { action: r.kind === 'ROLE_PERMISSIONS' ? 'role.permissions_changed' : r.kind === 'USER_DISABLE' ? 'staff_user.disabled' : 'staff_user.roles_changed', objectType: r.targetType === 'role' ? 'role' : 'user', objectId: r.targetId, before: applied.before, after: applied.after, reason: `Approved ${r.ref}` });
    await enqueue(tx, 'notify.users', { userIds: [r.requestedBy], type: 'access.change_decided', title: `${r.ref} approved`, body: r.targetLabel, link: '/ops/rbac' });
    return tx.accessChangeRequest.findUniqueOrThrow({ where: { id: r.id } });
  });
  const names = await userName([row.requestedBy, row.decidedBy]);
  res.json({ data: requestView(row, names) });
});

adminCoreRoutes.post('/rbac/requests/:id/reject', RBAC, idempotent('access_change.reject'), validateBody(z.object({ note: z.string().trim().min(3).max(500) })), async (req, res) => {
  const r = await loadRequest(param(req, 'id'));
  if (r.status !== 'PENDING') throw HttpError.conflict(`${r.ref} is ${r.status}; it cannot be rejected`, 'invalid_state');
  assertSegregation(req.user!.id, r.requestedBy);
  const note = (req.body as { note: string }).note;
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.accessChangeRequest.updateMany({ where: { id: r.id, status: 'PENDING', version: r.version }, data: { status: 'REJECTED', decidedBy: req.user!.id, decidedAt: new Date(), decisionNote: note, version: { increment: 1 } } });
    assertUpdated(c.count);
    await writeAudit(tx, audit(req), { action: 'access_change.rejected', objectType: 'access_change_request', objectId: r.id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason: note });
    await enqueue(tx, 'notify.users', { userIds: [r.requestedBy], type: 'access.change_decided', title: `${r.ref} rejected`, body: note, link: '/ops/rbac' });
    return tx.accessChangeRequest.findUniqueOrThrow({ where: { id: r.id } });
  });
  const names = await userName([row.requestedBy, row.decidedBy]);
  res.json({ data: requestView(row, names) });
});

adminCoreRoutes.post('/rbac/requests/:id/withdraw', RBAC, idempotent('access_change.withdraw'), async (req, res) => {
  const r = await loadRequest(param(req, 'id'));
  if (r.requestedBy !== req.user!.id) throw HttpError.forbidden('Only the requester can withdraw a request', 'permission_denied');
  if (r.status !== 'PENDING') throw HttpError.conflict(`${r.ref} is ${r.status}; it cannot be withdrawn`, 'invalid_state');
  const row = await prisma.$transaction(async (tx) => {
    const c = await tx.accessChangeRequest.updateMany({ where: { id: r.id, status: 'PENDING', version: r.version }, data: { status: 'WITHDRAWN', decidedBy: req.user!.id, decidedAt: new Date(), version: { increment: 1 } } });
    assertUpdated(c.count);
    await writeAudit(tx, audit(req), { action: 'access_change.withdrawn', objectType: 'access_change_request', objectId: r.id, before: { status: 'PENDING' }, after: { status: 'WITHDRAWN' } });
    return tx.accessChangeRequest.findUniqueOrThrow({ where: { id: r.id } });
  });
  const names = await userName([row.requestedBy, row.decidedBy]);
  res.json({ data: requestView(row, names) });
});

// ================================================================ access reviews

const reviewCounts = (items: { decision: string }[]) => ({
  total: items.length,
  pending: items.filter((i) => i.decision === 'PENDING').length,
  certified: items.filter((i) => i.decision === 'CERTIFIED').length,
  revoke: items.filter((i) => i.decision === 'REVOKE').length,
});

adminCoreRoutes.get('/rbac/reviews', RBAC, async (_req, res) => {
  const rows = await prisma.accessReview.findMany({ orderBy: { openedAt: 'desc' }, take: 50, include: { items: { select: { decision: true } } } });
  const names = await userName(rows.flatMap((r) => [r.openedBy, r.completedBy]));
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      ref: r.ref,
      title: r.title,
      dueDate: r.dueDate.toISOString().slice(0, 10),
      overdue: r.status === 'OPEN' && r.dueDate.getTime() < Date.now() - 86_400_000,
      status: r.status,
      openedBy: names.get(r.openedBy) ?? '',
      openedAt: r.openedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      counts: reviewCounts(r.items),
    })),
  });
});

async function reviewDetail(id: string) {
  if (!UUID.test(id)) throw HttpError.notFound('Review not found');
  const r = await prisma.accessReview.findUnique({ where: { id }, include: { items: { orderBy: { userName: 'asc' } } } });
  if (!r) throw HttpError.notFound('Review not found');
  const names = await userName([r.openedBy, r.completedBy, ...r.items.map((i) => i.decidedBy)]);
  const reqs = await prisma.accessChangeRequest.findMany({ where: { id: { in: r.items.map((i) => i.requestId).filter((x): x is string => !!x) } }, select: { id: true, ref: true, status: true } });
  const rq = new Map(reqs.map((x) => [x.id, x]));
  return {
    id: r.id,
    ref: r.ref,
    title: r.title,
    dueDate: r.dueDate.toISOString().slice(0, 10),
    status: r.status,
    openedBy: names.get(r.openedBy) ?? '',
    openedAt: r.openedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    counts: reviewCounts(r.items),
    items: r.items.map((i) => ({
      id: i.id,
      userId: i.userId,
      userName: i.userName,
      email: i.email,
      roles: i.roles,
      permissionCount: i.permissionCount,
      mfaEnrolled: i.mfaEnrolled,
      lastLoginAt: i.lastLoginAt?.toISOString() ?? null,
      decision: i.decision,
      decidedBy: i.decidedBy ? names.get(i.decidedBy) ?? '' : null,
      decidedAt: i.decidedAt?.toISOString() ?? null,
      note: i.note,
      request: i.requestId ? rq.get(i.requestId) ?? null : null,
    })),
  };
}

adminCoreRoutes.get('/rbac/reviews/:id', RBAC, async (req, res) => {
  res.json({ data: await reviewDetail(param(req, 'id')) });
});

adminCoreRoutes.post(
  '/rbac/reviews',
  RBAC,
  idempotent('access_review.open'),
  validateBody(z.object({ title: z.string().trim().min(3).max(160), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (req, res) => {
    const b = req.body as { title: string; dueDate: string };
    if (await prisma.accessReview.findFirst({ where: { status: 'OPEN' } })) throw HttpError.conflict('Complete the open access review before starting another', 'review_open');
    const users = await prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, include: staffInclude, orderBy: { name: 'asc' } });
    if (!users.length) throw HttpError.badRequest('There are no active staff to review');
    const row = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'accessReview');
      const review = await tx.accessReview.create({ data: { ref, title: b.title, dueDate: new Date(`${b.dueDate}T00:00:00Z`), openedBy: req.user!.id } });
      await tx.accessReviewItem.createMany({
        data: users.map((u) => ({
          reviewId: review.id,
          userId: u.id,
          userName: u.name ?? u.email,
          email: u.email,
          roles: u.roles.map((r) => ({ key: r.role.key, label: r.role.label })),
          permissionCount: new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission))).size,
          mfaEnrolled: u.mfaFactors.length > 0,
          lastLoginAt: u.lastLoginAt,
        })),
      });
      await writeAudit(tx, audit(req), { action: 'access_review.opened', objectType: 'access_review', objectId: review.id, after: { ref, title: b.title, dueDate: b.dueDate, users: users.length } });
      await notifyPermission(tx, 'admin.rbac', { type: 'access.review_opened', title: `${ref}: access review opened`, body: `${b.title}, due ${b.dueDate}`, link: '/ops/rbac' });
      return review;
    });
    res.status(201).json({ data: await reviewDetail(row.id) });
  },
);

adminCoreRoutes.post(
  '/rbac/reviews/:id/items/:itemId/decide',
  RBAC,
  idempotent('access_review.decide'),
  validateBody(z.object({ decision: z.enum(['CERTIFIED', 'REVOKE']), note: z.string().trim().max(500).optional() })),
  async (req, res) => {
    const b = req.body as { decision: 'CERTIFIED' | 'REVOKE'; note?: string };
    const item = await prisma.accessReviewItem.findUnique({ where: { id: param(req, 'itemId') }, include: { review: true } });
    if (!item || item.reviewId !== param(req, 'id')) throw HttpError.notFound('Review item not found');
    if (item.review.status !== 'OPEN') throw HttpError.conflict('This review is completed', 'invalid_state');
    if (item.userId === req.user!.id) throw HttpError.forbidden('You cannot certify your own access (segregation of duties)', 'segregation_of_duties');
    if (b.decision === 'REVOKE' && !b.note) throw HttpError.badRequest('Say why access should be revoked');
    await prisma.$transaction(async (tx) => {
      await tx.accessReviewItem.update({ where: { id: item.id }, data: { decision: b.decision, decidedBy: req.user!.id, decidedAt: new Date(), note: b.note ?? null } });
      await writeAudit(tx, audit(req), { action: 'access_review.decided', objectType: 'access_review', objectId: item.reviewId, before: { user: item.email, decision: item.decision }, after: { user: item.email, decision: b.decision }, reason: b.note ?? null });
    });
    res.json({ data: await reviewDetail(item.reviewId) });
  },
);

adminCoreRoutes.post('/rbac/reviews/:id/complete', RBAC, requireStepUp, idempotent('access_review.complete'), async (req, res) => {
  const review = await prisma.accessReview.findUnique({ where: { id: param(req, 'id') }, include: { items: true } });
  if (!review) throw HttpError.notFound('Review not found');
  if (review.status !== 'OPEN') throw HttpError.conflict('This review is already completed', 'invalid_state');
  const pending = review.items.filter((i) => i.decision === 'PENDING').length;
  if (pending) throw HttpError.conflict(`${pending} user(s) still need a decision`, 'review_incomplete');
  await prisma.$transaction(async (tx) => {
    const done = await tx.accessReview.updateMany({ where: { id: review.id, status: 'OPEN' }, data: { status: 'COMPLETED', completedBy: req.user!.id, completedAt: new Date() } });
    assertUpdated(done.count);
    for (const item of review.items.filter((i) => i.decision === 'REVOKE')) {
      const user = await tx.user.findUnique({ where: { id: item.userId } });
      if (!user?.isActive) continue;
      const open = await tx.accessChangeRequest.findFirst({ where: { status: 'PENDING', kind: 'USER_DISABLE', targetType: 'user', targetId: item.userId } });
      if (open) {
        await tx.accessReviewItem.update({ where: { id: item.id }, data: { requestId: open.id } });
        continue;
      }
      const ref = await nextRef(tx, 'accessRequest');
      const rq = await tx.accessChangeRequest.create({
        data: { ref, kind: 'USER_DISABLE', targetType: 'user', targetId: item.userId, targetLabel: item.userName, before: { isActive: true }, proposal: { isActive: false }, privileged: false, reason: `Access review ${review.ref}: ${item.note ?? 'revoked'}`.slice(0, 500), reviewItemId: item.id, requestedBy: req.user!.id },
      });
      await tx.accessReviewItem.update({ where: { id: item.id }, data: { requestId: rq.id } });
      await writeAudit(tx, audit(req), { action: 'access_change.requested', objectType: 'access_change_request', objectId: rq.id, after: { kind: 'USER_DISABLE', target: item.email, status: 'PENDING', review: review.ref } });
      await notifyPermission(tx, 'admin.rbac', { type: 'access.change_pending', title: `${ref}: revocation from ${review.ref} needs approval`, body: item.userName, link: '/ops/rbac' });
    }
    await writeAudit(tx, audit(req), { action: 'access_review.completed', objectType: 'access_review', objectId: review.id, after: { ...reviewCounts(review.items) } });
  });
  res.json({ data: await reviewDetail(review.id) });
});

// ================================================================ platform settings

async function settingRows() {
  const [rows, policies] = await Promise.all([prisma.platformSetting.findMany(), getPolicies()]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const names = await userName(rows.map((r) => r.updatedBy));
  const current = (d: SettingDef) => (d.policyKey ? (policies[d.policyKey] as boolean | number) : ((byKey.get(d.key)?.value as boolean | number | string | undefined) ?? d.default));
  return SETTINGS.map((d) => {
    const row = byKey.get(d.key);
    return {
      key: d.key,
      category: d.category,
      label: d.label,
      help: d.help,
      type: d.type,
      options: d.options ?? null,
      min: d.min ?? null,
      max: d.max ?? null,
      value: current(d),
      default: d.default,
      isDefault: current(d) === d.default,
      stepUp: !!d.stepUp,
      enforced: d.enforced,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ? names.get(row.updatedBy) ?? '' : null,
    };
  });
}

adminCoreRoutes.get('/settings', SETTINGS_PERM, async (_req, res) => {
  res.json({ data: await settingRows() });
});

adminCoreRoutes.get('/settings/numbering', SETTINGS_PERM, async (_req, res) => {
  const seq = new Map((await prisma.sequence.findMany()).map((s) => [s.name, s.value]));
  res.json({
    data: refFormats().map((f) => {
      const issued = seq.get(f.kind);
      const nextNo = (issued ?? f.start - 1) + 1;
      return { kind: f.kind, prefix: f.prefix, pad: f.pad, first: `${f.prefix}${String(f.start).padStart(f.pad, '0')}`, next: `${f.prefix}${String(nextNo).padStart(f.pad, '0')}`, issued: issued === undefined ? 0 : issued - f.start + 1 };
    }),
    note: 'Numbers are issued atomically by the database and never reused. The format is fixed by the platform; only the counters advance.',
  });
});

adminCoreRoutes.get(
  '/settings/history',
  SETTINGS_PERM,
  validateQuery(z.object({ key: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })),
  async (req, res) => {
    const q = query<{ key?: string; limit: number }>(req);
    const rows = await prisma.platformSettingChange.findMany({ where: q.key ? { key: q.key } : undefined, orderBy: { changedAt: 'desc' }, take: q.limit });
    const names = await userName(rows.map((r) => r.changedBy));
    res.json({
      data: rows.map((r) => ({ id: r.id, key: r.key, label: settingDef(r.key)?.label ?? r.key, version: r.version, before: r.before, after: r.after, reason: r.reason, changedBy: names.get(r.changedBy) ?? 'Unknown', changedAt: r.changedAt.toISOString() })),
    });
  },
);

const settingBody = z.object({ value: z.union([z.boolean(), z.number(), z.string().max(80)]), reason: z.string().trim().min(3).max(500), version: z.number().int().min(0).optional() });

adminCoreRoutes.put('/settings/:key', SETTINGS_PERM, idempotent('setting.change'), validateBody(settingBody), async (req, res) => {
  const def = settingDef(param(req, 'key'));
  if (!def) throw HttpError.notFound('Unknown setting');
  const b = req.body as z.infer<typeof settingBody>;
  const v = validateSetting(def, b.value);
  if (!v.ok) throw HttpError.badRequest(`${def.label}: ${v.error}`);
  if (def.stepUp) await stepUp(req, res);
  await prisma.$transaction(async (tx) => {
    const row = await tx.platformSetting.findUnique({ where: { key: def.key } });
    if (b.version !== undefined && b.version !== (row?.version ?? 0)) throw HttpError.conflict('This setting was changed by someone else. Reload and try again.', 'version_conflict');
    let before: unknown = row?.value ?? def.default;
    if (def.policyKey) {
      const p = await tx.policy.findUnique({ where: { key: def.policyKey } });
      before = p?.value ?? def.default;
      if (JSON.stringify(before) === JSON.stringify(v.value)) throw HttpError.badRequest('That is already the current value');
      await tx.policy.upsert({ where: { key: def.policyKey }, create: { key: def.policyKey, value: v.value, updatedBy: req.user!.id }, update: { value: v.value, updatedBy: req.user!.id } });
    } else if (JSON.stringify(before) === JSON.stringify(v.value)) {
      throw HttpError.badRequest('That is already the current value');
    }
    const version = (row?.version ?? 0) + 1;
    await tx.platformSetting.upsert({ where: { key: def.key }, create: { key: def.key, value: v.value, version, updatedBy: req.user!.id }, update: { value: v.value, version, updatedBy: req.user!.id, updatedAt: new Date() } });
    await tx.platformSettingChange.create({ data: { key: def.key, version, before: before as Prisma.InputJsonValue, after: v.value, reason: b.reason, changedBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'platform_setting.changed', objectType: 'platform_setting', objectId: def.key, before: { value: before, version: version - 1 }, after: { value: v.value, version }, reason: b.reason });
  });
  clearSettingCache(def.key);
  res.json({ data: (await settingRows()).find((s) => s.key === def.key) });
});

// ================================================================ audit trail extras

adminCoreRoutes.get('/audit/facets', AUDIT, async (_req, res) => {
  const day = new Date(Date.now() - 86_400_000);
  const [actions, types, portals, total, last24, first, last] = await Promise.all([
    prisma.auditEvent.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { _count: { action: 'desc' } }, take: 300 }),
    prisma.auditEvent.groupBy({ by: ['objectType'], _count: { _all: true }, orderBy: { _count: { objectType: 'desc' } } }),
    prisma.auditEvent.groupBy({ by: ['portal'], _count: { _all: true } }),
    prisma.auditEvent.count(),
    prisma.auditEvent.count({ where: { occurredAt: { gte: day } } }),
    prisma.auditEvent.findFirst({ orderBy: { id: 'asc' }, select: { occurredAt: true } }),
    prisma.auditEvent.findFirst({ orderBy: { id: 'desc' }, select: { occurredAt: true, hash: true, id: true } }),
  ]);
  res.json({
    actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
    objectTypes: types.map((a) => ({ value: a.objectType, count: a._count._all })),
    portals: portals.filter((p) => p.portal).map((p) => ({ value: p.portal as string, count: p._count._all })),
    stats: { total, last24h: last24, firstAt: first?.occurredAt.toISOString() ?? null, lastAt: last?.occurredAt.toISOString() ?? null, headId: last?.id.toString() ?? null, headHash: last?.hash ?? null },
  });
});

adminCoreRoutes.get('/audit/events/:id', AUDIT, async (req, res) => {
  const idText = param(req, 'id');
  if (!/^\d{1,18}$/.test(idText)) throw HttpError.notFound('Event not found');
  const id = BigInt(idText);
  const e = await prisma.auditEvent.findUnique({ where: { id } });
  if (!e) throw HttpError.notFound('Event not found');
  const [prev, next, sameObject, names] = await Promise.all([
    prisma.auditEvent.findFirst({ where: { id: { lt: id } }, orderBy: { id: 'desc' }, select: { id: true, hash: true } }),
    prisma.auditEvent.findFirst({ where: { id: { gt: id } }, orderBy: { id: 'asc' }, select: { id: true, prevHash: true } }),
    prisma.auditEvent.count({ where: { objectType: e.objectType, objectId: e.objectId } }),
    userName([e.actorId]),
  ]);
  res.json({
    data: {
      id: e.id.toString(),
      at: e.occurredAt.toISOString(),
      actor: e.actorId ? names.get(e.actorId) ?? 'Unknown user' : 'System',
      actorId: e.actorId,
      role: e.actorRole,
      portal: e.portal,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      before: e.before,
      after: e.after,
      reason: e.reason,
      ip: e.ip,
      requestId: e.requestId,
      prevHash: e.prevHash,
      hash: e.hash,
      linkedToPrevious: prev ? prev.hash === e.prevHash : e.prevHash === '0'.repeat(64),
      linkedToNext: next ? next.prevHash === e.hash : null,
      previousId: prev?.id.toString() ?? null,
      nextId: next?.id.toString() ?? null,
      eventsOnObject: sameObject,
    },
  });
});

// ================================================================ retention

adminCoreRoutes.get('/retention/runs', SETTINGS_PERM, async (_req, res) => {
  const [runs, lock] = await Promise.all([prisma.purgeRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }), prisma.jobLock.findUnique({ where: { name: 'retention.purge' } })]);
  res.json({
    data: runs.map((r) => ({ id: r.id, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, dryRun: r.dryRun, triggeredBy: r.triggeredBy, result: r.result })),
    lastScheduledRunAt: lock?.lastRunAt?.toISOString() ?? null,
  });
});

/** Runs the purge now (default dry run: counts only). A live run is audited and needs a fresh authenticator code. */
adminCoreRoutes.post('/retention/run', SETTINGS_PERM, validateBody(z.object({ dryRun: z.boolean().default(true) })), async (req, res) => {
  const dryRun = (req.body as { dryRun: boolean }).dryRun;
  if (!dryRun) await stepUp(req, res);
  const result = await runRetentionPurge({ dryRun, triggeredBy: req.user!.id });
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: dryRun ? 'retention.dry_run' : 'retention.purged', objectType: 'retention', objectId: 'platform', after: result as unknown as Prisma.InputJsonValue }));
  res.json({ data: result });
});

// ================================================================ copilot

async function copilotEnabled() {
  return setting<boolean>('feature.copilot');
}

adminCoreRoutes.get('/copilot/suggestions', COPILOT, async (_req, res) => {
  res.json({ enabled: await copilotEnabled(), suggestions: SUGGESTIONS });
});

adminCoreRoutes.get('/copilot/history', COPILOT, async (req, res) => {
  const rows = await prisma.copilotQuery.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  res.json({ data: rows.map((r) => ({ id: r.id, question: r.question, intent: r.intent, answer: r.answer, sources: r.sources, engine: r.copilotEngine, toolCalls: r.copilotToolCalls, at: r.createdAt.toISOString() })) });
});

adminCoreRoutes.post('/copilot/ask', COPILOT, validateBody(z.object({ question: z.string().trim().min(3).max(500) })), async (req, res) => {
  if (!(await copilotEnabled())) throw HttpError.forbidden('The Copilot is switched off in platform settings', 'feature_disabled');
  const question = (req.body as { question: string }).question;
  const result = await askCopilot(question, [...req.user!.permissions]);
  const row = await prisma.copilotQuery.create({
    data: { userId: req.user!.id, question, intent: result.intent, answer: result.answer, sources: result.sources as unknown as Prisma.InputJsonValue, copilotToolCalls: (result.toolCalls ?? []) as unknown as Prisma.InputJsonValue, copilotEngine: result.engine ?? 'ROUTER' },
  });
  res.json({ data: { id: row.id, question, ...result, at: row.createdAt.toISOString() } });
});
