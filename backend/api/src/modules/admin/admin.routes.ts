import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { emailSchema } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { verifyAuditChain, writeAudit } from '../../lib/audit';
import { POLICY_DEFAULTS, getPolicies, type PolicyKey } from '../../lib/policy';
import { ctx, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { createInvitation } from '../identity/invitations';
import { MONETARY, privilegedPermissionAdds, privilegedRoleAdds, sodHits } from '../admin-core/admin-core.engine';
import { idempotent } from '../../lib/idempotency';

/** `/api/v1/admin` - staff access control, platform settings and audit evidence (SRD 7.2, 7.13, 11). */
export const adminRoutes = Router();
adminRoutes.use(requireAuth, requirePortalAccess('admin'));

const audit = (req: Request) => ctx(req, 'admin');
const RBAC = requirePermission('admin.rbac');
const SETTINGS = requirePermission('admin.settings');
const AUDIT = requirePermission('audit.view');

const SYSTEM_ADMIN = 'system_admin';
// MONETARY (the SoD blocklist) is shared with admin-core: see admin-core.engine.ts.

const staffRoleInclude = {
  roles: { where: { role: { portal: 'admin' } }, include: { role: { include: { permissions: true } } } },
  mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } },
} satisfies Prisma.UserInclude;
type StaffRow = Prisma.UserGetPayload<{ include: typeof staffRoleInclude }>;

function hhmm(d: Date | null) {
  if (!d) return 'Never';
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Harare' })
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Harare' });
}

function staffView(u: StaffRow) {
  const keys = u.roles.map((r) => r.role.key);
  const perms = new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)));
  const primary = keys.includes(SYSTEM_ADMIN) ? SYSTEM_ADMIN : keys[0] ?? '';
  return {
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    role: primary,
    roles: keys,
    access: !u.isActive ? 'Disabled' : primary === SYSTEM_ADMIN ? 'Privileged' : perms.size && [...perms].every((p) => p.endsWith('.view')) ? 'Read only' : 'Active',
    last: hhmm(u.lastLoginAt),
    mfa: u.mfaFactors.length > 0,
  };
}

async function staffUsers() {
  const [users, invites] = await Promise.all([
    prisma.user.findMany({ where: { roles: { some: { role: { portal: 'admin' } } } }, include: staffRoleInclude, orderBy: { name: 'asc' } }),
    prisma.invitation.findMany({ where: { portal: 'admin', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
  ]);
  return [
    ...users.map(staffView),
    ...invites.map((i) => ({
      id: `invite:${i.id}`,
      name: i.name ?? i.email,
      email: i.email,
      role: ((i.roleKeys as string[]) ?? [])[0] ?? '',
      roles: (i.roleKeys as string[]) ?? [],
      access: 'Invited',
      last: 'Invitation sent',
      mfa: false,
    })),
  ];
}

async function adminRoles() {
  return prisma.role.findMany({
    where: { portal: 'admin' },
    include: { permissions: true, _count: { select: { users: true } } },
    orderBy: [{ custom: 'asc' }, { label: 'asc' }],
  });
}

// ---------------------------------------------------------------- access context (any staff user)

/** Role labels/bundles and the caller's own roles - drives the legacy UI's role context. */
adminRoutes.get('/access-context', async (req, res) => {
  const roles = await adminRoles();
  const mine = req.user!.roles.filter((r) => r.portal === 'admin').map((r) => r.key);
  res.json({
    role: mine.includes(SYSTEM_ADMIN) ? SYSTEM_ADMIN : mine[0] ?? null,
    roles: mine,
    permissions: req.user!.permissions,
    roleLabels: Object.fromEntries(roles.map((r) => [r.key, r.label])),
    rolePermissions: Object.fromEntries(roles.map((r) => [r.key, r.permissions.map((p) => p.permission).sort()])),
  });
});

// ---------------------------------------------------------------- users

adminRoutes.get('/users', RBAC, async (_req, res) => {
  res.json({ data: await staffUsers() });
});

const addUserSchema = z.object({ name: z.string().trim().min(1).max(120), email: emailSchema, role: z.string().trim().min(1).max(64) });

/** R4-1: staff invitations are maker-checker change requests (`POST /admin-core/rbac/requests` kind STAFF_INVITE). */
adminRoutes.post('/users', RBAC, requireStepUp, validateBody(addUserSchema), async () => {
  throw HttpError.conflict('Staff invitations need an independent checker. Raise a STAFF_INVITE access change request (POST /api/v1/admin-core/rbac/requests).', 'approval_required');
});

const rolesSchema = z.object({ roles: z.array(z.string().max(64)).min(1).max(10) });

adminRoutes.put('/users/:id/roles', RBAC, requireStepUp, validateBody(rolesSchema), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req, 'id') }, include: staffRoleInclude });
  if (!user || !user.roles.length) throw HttpError.notFound('Staff user not found');
  const wanted = [...new Set((req.body as z.infer<typeof rolesSchema>).roles)];
  const roles = await prisma.role.findMany({ where: { portal: 'admin', key: { in: wanted } }, include: { permissions: true } });
  if (roles.length !== wanted.length) throw HttpError.badRequest('Unknown role');
  const before = user.roles.map((r) => r.role.key);
  if (user.id === req.user!.id && !roles.some((r) => r.permissions.some((p) => p.permission === 'admin.rbac'))) {
    throw HttpError.conflict('You cannot remove your own access-control permission', 'self_lockout');
  }
  if (before.includes(SYSTEM_ADMIN) && !wanted.includes(SYSTEM_ADMIN)) {
    const admins = await prisma.userRole.count({ where: { role: { portal: 'admin', key: SYSTEM_ADMIN }, user: { isActive: true } } });
    if (admins <= 1) throw HttpError.conflict('At least one active System Administrator must remain', 'last_admin');
  }
  const privileged = privilegedRoleAdds(
    user.roles.map((r) => ({ key: r.role.key, permissions: r.role.permissions.map((p) => p.permission) })),
    roles.map((r) => ({ key: r.key, permissions: r.permissions.map((p) => p.permission) })),
  );
  if (privileged.length) {
    throw HttpError.conflict(`Granting ${privileged.join(', ')} needs an independent checker. Raise an access change request instead.`, 'approval_required');
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: user.id, role: { portal: 'admin' } } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId: user.id, roleId: r.id })) });
    await writeAudit(tx, audit(req), { action: 'staff_user.roles_changed', objectType: 'user', objectId: user.id, before: { roles: before }, after: { roles: wanted } });
  });
  res.json({ data: await staffUsers() });
});

adminRoutes.patch('/users/:id', RBAC, requireStepUp, validateBody(z.object({ isActive: z.boolean() })), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!user) throw HttpError.notFound('Staff user not found');
  if (user.id === req.user!.id) throw HttpError.conflict('You cannot disable your own account', 'self_lockout');
  const isActive = req.body.isActive as boolean;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(tx, audit(req), { action: isActive ? 'staff_user.enabled' : 'staff_user.disabled', objectType: 'user', objectId: user.id, before: { isActive: user.isActive }, after: { isActive } });
  });
  res.json({ data: await staffUsers() });
});

/** Lost-device recovery: removes the user's factors; they re-enrol at next sign-in. */
adminRoutes.post('/users/:id/mfa-reset', RBAC, requireStepUp, validateBody(z.object({ reason: z.string().trim().min(3).max(500) })), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: param(req, 'id') } });
  if (!user) throw HttpError.notFound('Staff user not found');
  if (user.id === req.user!.id) throw HttpError.conflict('Ask another administrator to reset your own second factor', 'self_reset');
  await prisma.$transaction(async (tx) => {
    const removed = await tx.userMfaFactor.deleteMany({ where: { userId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await writeAudit(tx, audit(req), { action: 'staff_user.mfa_reset', objectType: 'user', objectId: user.id, after: { factorsRemoved: removed.count }, reason: req.body.reason });
  });
  res.json({ data: await staffUsers() });
});

// ---------------------------------------------------------------- roles & permissions

function roleView(r: Awaited<ReturnType<typeof adminRoles>>[number]) {
  return { key: r.key, label: r.label, locked: r.locked, custom: r.custom, users: r._count.users, permissions: r.permissions.map((p) => p.permission).sort() };
}

adminRoutes.get('/roles', RBAC, async (_req, res) => {
  res.json({ data: (await adminRoles()).map(roleView) });
});

adminRoutes.get('/permissions', RBAC, async (_req, res) => {
  const [rows, custom] = await Promise.all([
    prisma.rolePermission.findMany({ where: { role: { portal: 'admin' } }, distinct: ['permission'], select: { permission: true } }),
    prisma.customPermission.findMany({ orderBy: { code: 'asc' } }),
  ]);
  const codes = [...new Set([...rows.map((r) => r.permission), ...custom.map((c) => c.code)])].sort();
  res.json({ data: codes, protected: MONETARY, custom: custom.map((c) => ({ code: c.code, label: c.label, description: c.description })) });
});

const customPermSchema = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z_]{1,30}(\.[a-z_]{1,30}){1,2}$/, 'Use lowercase area.action, e.g. vendor.review'),
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

/** Defines a new permission code that roles can then carry. Codes already used by the platform cannot be redefined. */
adminRoutes.post('/permissions', RBAC, requireStepUp, idempotent('permission.define'), validateBody(customPermSchema), async (req, res) => {
  const b = req.body as z.infer<typeof customPermSchema>;
  if ((await prisma.customPermission.findUnique({ where: { code: b.code } })) || (await prisma.rolePermission.findFirst({ where: { permission: b.code } }))) {
    throw HttpError.conflict('That permission code already exists', 'permission_exists');
  }
  if (MONETARY.includes(b.code) || b.code.startsWith('admin.') || b.code.startsWith('lp.')) throw HttpError.badRequest('That code is reserved by the platform');
  await prisma.$transaction(async (tx) => {
    await tx.customPermission.create({ data: { code: b.code, label: b.label, description: b.description ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'permission.defined', objectType: 'permission', objectId: b.code, after: { label: b.label, description: b.description ?? null } });
  });
  res.status(201).json({ code: b.code, label: b.label, description: b.description ?? null });
});

adminRoutes.delete('/permissions/:code', RBAC, requireStepUp, async (req, res) => {
  const code = param(req, 'code');
  const row = await prisma.customPermission.findUnique({ where: { code } });
  if (!row) throw HttpError.notFound('Custom permission not found');
  const inUse = await prisma.rolePermission.count({ where: { permission: code } });
  if (inUse) throw HttpError.conflict(`Remove ${code} from ${inUse} role${inUse === 1 ? '' : 's'} first`, 'permission_in_use');
  await prisma.$transaction(async (tx) => {
    await tx.customPermission.delete({ where: { code } });
    await writeAudit(tx, audit(req), { action: 'permission.removed', objectType: 'permission', objectId: code, before: { label: row.label } });
  });
  res.json({ ok: true });
});

const newRoleSchema = z.object({ label: z.string().trim().min(2).max(120), template: z.string().max(64).default('blank') });

/** R4-1: role creation is a maker-checker change request (`POST /admin-core/rbac/requests` kind ROLE_CREATE). */
adminRoutes.post('/roles', RBAC, requireStepUp, validateBody(newRoleSchema), async () => {
  throw HttpError.conflict('New roles need an independent checker. Raise a ROLE_CREATE access change request (POST /api/v1/admin-core/rbac/requests).', 'approval_required');
});

/** Every code a role may carry: codes already granted somewhere in the catalogue plus administrator-defined ones. */
async function knownPermissionCodes() {
  const [rows, custom] = await Promise.all([prisma.rolePermission.findMany({ distinct: ['permission'], select: { permission: true } }), prisma.customPermission.findMany({ select: { code: true } })]);
  return new Set([...rows.map((r) => r.permission), ...custom.map((c) => c.code)]);
}

const permsSchema = z.object({ permissions: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/)).max(200) });

adminRoutes.put('/roles/:key/permissions', RBAC, requireStepUp, validateBody(permsSchema), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { portal_key: { portal: 'admin', key: param(req, 'key') } }, include: { permissions: true } });
  if (!role) throw HttpError.notFound('Role not found');
  if (role.locked || role.key === SYSTEM_ADMIN) throw HttpError.forbidden('System Administrator privileges are platform-only and cannot be edited', 'role_locked');
  const next = [...new Set((req.body as z.infer<typeof permsSchema>).permissions)].sort();
  const known = await knownPermissionCodes();
  const unknown = next.filter((p) => !known.has(p));
  if (unknown.length) throw HttpError.badRequest(`Unknown permission code${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Define a custom permission first.`);
  const before = role.permissions.map((p) => p.permission).sort();
  const mine = req.user!.roles.some((r) => r.portal === 'admin' && r.key === role.key);
  if (mine && before.includes('admin.rbac') && !next.includes('admin.rbac')) {
    throw HttpError.conflict('You cannot remove access control from a role you hold', 'self_lockout');
  }
  const privileged = privilegedPermissionAdds(before, next);
  if (privileged.length) {
    throw HttpError.conflict(`Granting ${privileged.join(', ')} needs an independent checker. Raise an access change request instead.`, 'approval_required');
  }
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (next.length) await tx.rolePermission.createMany({ data: next.map((permission) => ({ roleId: role.id, permission })) });
    await writeAudit(tx, audit(req), {
      action: 'role.permissions_changed',
      objectType: 'role',
      objectId: role.id,
      before: { permissions: before },
      after: { permissions: next, added: next.filter((p) => !before.includes(p)), removed: before.filter((p) => !next.includes(p)) },
    });
  });
  res.json({ role: { key: role.key, label: role.label, permissions: next } });
});

// ---------------------------------------------------------------- policy

const EXTRA_POLICY_KEY = 'access_policy_extra';

/** Policy in the prototype's `accessPolicyV8` shape (booleans map to independent / threshold). */
async function accessPolicy() {
  const [p, extra] = await Promise.all([getPolicies(), prisma.setting.findUnique({ where: { ownerId_key: { ownerId: 'platform', key: EXTRA_POLICY_KEY } } })]);
  const x = (extra?.value as { navApproval?: string; bankApproval?: string } | null) ?? {};
  return {
    orderApproval: p.order_approval ? 'independent' : 'threshold',
    cashApproval: p.cash_approval ? 'independent' : 'threshold',
    navApproval: x.navApproval ?? 'independent',
    bankApproval: x.bankApproval ?? 'dual',
    sessionTimeout: Number(p.session_idle_minutes),
    mfa: Boolean(p.mfa_required),
    policies: p,
  };
}

adminRoutes.get('/policy', async (_req, res) => {
  res.json(await accessPolicy());
});

const policySchema = z.object({
  orderApproval: z.enum(['independent', 'threshold']).optional(),
  cashApproval: z.enum(['independent', 'threshold']).optional(),
  navApproval: z.enum(['independent', 'dual']).optional(),
  bankApproval: z.string().max(32).optional(),
  sessionTimeout: z.number().int().min(5).max(240).optional(),
  mfa: z.boolean().optional(),
  policies: z
    .object({
      document_approval: z.boolean(),
      client_publish_approval: z.boolean(),
      kyc_dual_control: z.boolean(),
    })
    .partial()
    .optional(),
});

adminRoutes.put('/policy', RBAC, requireStepUp, validateBody(policySchema), async (req, res) => {
  const b = req.body as z.infer<typeof policySchema>;
  const before = await accessPolicy();
  const updates: Partial<Record<PolicyKey, boolean | number>> = { ...(b.policies ?? {}) };
  if (b.orderApproval) updates.order_approval = b.orderApproval === 'independent';
  if (b.cashApproval) updates.cash_approval = b.cashApproval === 'independent';
  if (b.sessionTimeout !== undefined) updates.session_idle_minutes = b.sessionTimeout;
  if (b.mfa !== undefined) updates.mfa_required = b.mfa;
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(updates)) {
      if (!(key in POLICY_DEFAULTS)) continue;
      await tx.policy.upsert({ where: { key }, create: { key, value, updatedBy: req.user!.id }, update: { value, updatedBy: req.user!.id } });
    }
    if (b.navApproval || b.bankApproval) {
      const value = { navApproval: b.navApproval ?? before.navApproval, bankApproval: b.bankApproval ?? before.bankApproval };
      await tx.setting.upsert({
        where: { ownerId_key: { ownerId: 'platform', key: EXTRA_POLICY_KEY } },
        create: { ownerId: 'platform', key: EXTRA_POLICY_KEY, value },
        update: { value },
      });
    }
    await writeAudit(tx, audit(req), { action: 'policy.updated', objectType: 'policy', objectId: 'platform', before: before.policies, after: updates });
  });
  res.json(await accessPolicy());
});

// ---------------------------------------------------------------- SoD scan & access review

interface Finding {
  severity: 'block' | 'warn' | 'ok';
  title: string;
  detail: string;
  action: string;
}

async function sodScan(): Promise<Finding[]> {
  const [p, roles, users] = await Promise.all([
    getPolicies(),
    adminRoles(),
    prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, include: staffRoleInclude }),
  ]);
  const out: Finding[] = [];
  if (!p.order_approval) out.push({ severity: 'block', title: 'Order maker-checker relaxed', detail: 'Order approval is not set to independent checker.', action: 'Policy review' });
  if (!p.cash_approval) out.push({ severity: 'block', title: 'Cash maker-checker relaxed', detail: 'Cash approval is not fully independent.', action: 'Policy review' });
  if (!p.document_approval) out.push({ severity: 'warn', title: 'Document approval relaxed', detail: 'Client documents can be published without an independent checker.', action: 'Policy review' });
  const admins = users.filter((u) => u.roles.some((r) => r.role.key === SYSTEM_ADMIN));
  if (admins.length > 2) out.push({ severity: 'block', title: 'Privileged account count', detail: `${admins.length} System Administrators are assigned.`, action: 'Review privileged access' });
  const sysRole = roles.find((r) => r.key === SYSTEM_ADMIN);
  const adminMoney = MONETARY.filter((m) => sysRole?.permissions.some((x) => x.permission === m));
  if (adminMoney.length) out.push({ severity: 'block', title: 'Platform admin monetary privilege', detail: adminMoney.join(', '), action: 'Remove immediately' });
  for (const r of roles) {
    for (const h of sodHits(r.permissions.map((x) => x.permission))) {
      out.push({ severity: 'warn', title: `Role ${r.label} combines ${h.a} and ${h.b}`, detail: h.why, action: 'Split role' });
    }
  }
  for (const u of users) {
    const perms = new Set(u.roles.flatMap((r) => r.role.permissions.map((x) => x.permission)));
    for (const h of sodHits(perms)) {
      const withinOneRole = u.roles.some((r) => sodHits(r.role.permissions.map((x) => x.permission)).some((x) => x.rule === h.rule));
      if (!withinOneRole) out.push({ severity: 'block', title: `${u.name ?? u.email} holds ${h.a} and ${h.b} through separate roles`, detail: h.why, action: 'Split roles' });
    }
    if (perms.has('admin.rbac') && MONETARY.some((m) => perms.has(m))) {
      out.push({ severity: 'block', title: 'Access control combined with money movement', detail: `${u.name ?? u.email} can change roles and move money through combined roles.`, action: 'Split roles' });
    }
    if ((perms.has('admin.rbac') || perms.has('cash.approve')) && !u.mfaFactors.length) {
      out.push({ severity: 'warn', title: 'Privileged user without MFA', detail: `${u.name ?? u.email} has not enrolled an authenticator.`, action: 'Enforce MFA' });
    }
  }
  if (!out.length) out.push({ severity: 'ok', title: 'No blocking SoD conflicts', detail: 'Independent approval policies are active and platform administrators have no monetary permissions.', action: 'Controlled' });
  return out;
}

adminRoutes.get('/sod-scan', RBAC, async (_req, res) => {
  const findings = await sodScan();
  res.json({ findings, blocking: findings.filter((f) => f.severity !== 'ok').length, scannedAt: new Date().toISOString() });
});

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
};

function sendCsv(res: Response, name: string, header: string[], rows: unknown[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('\uFEFF' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
}

adminRoutes.get('/access-review.csv', RBAC, async (req, res) => {
  const users = await prisma.user.findMany({ where: { roles: { some: { role: { portal: 'admin' } } } }, include: staffRoleInclude, orderBy: { email: 'asc' } });
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'access_review.exported', objectType: 'report', objectId: 'access-review', after: { users: users.length } }));
  sendCsv(
    res,
    `matanho-access-review-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Name', 'Email', 'Roles', 'Permissions', 'Active', 'MFA', 'Last sign-in'],
    users.map((u) => [
      u.name,
      u.email,
      u.roles.map((r) => r.role.label).join('; '),
      [...new Set(u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission)))].sort().join(' '),
      u.isActive ? 'Yes' : 'No',
      u.mfaFactors.length ? 'Yes' : 'No',
      u.lastLoginAt?.toISOString() ?? '',
    ]),
  );
});

// ---------------------------------------------------------------- settings

const WORKSPACE_KEY = 'workspace';

adminRoutes.get('/settings', async (_req, res) => {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: 'platform', key: WORKSPACE_KEY } } });
  res.json({ settings: row?.value ?? null, updatedAt: row?.updatedAt ?? null });
});

adminRoutes.put('/settings', SETTINGS, validateBody(z.object({ settings: z.record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])) })), async (req, res) => {
  const value = { ...(req.body.settings as Record<string, unknown>), lastSaved: new Date().toISOString() } as Prisma.InputJsonObject;
  const before = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: 'platform', key: WORKSPACE_KEY } } });
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.setting.upsert({
      where: { ownerId_key: { ownerId: 'platform', key: WORKSPACE_KEY } },
      create: { ownerId: 'platform', key: WORKSPACE_KEY, value },
      update: { value },
    });
    await writeAudit(tx, audit(req), { action: 'settings.updated', objectType: 'setting', objectId: WORKSPACE_KEY, before: before?.value ?? null, after: value });
    return r;
  });
  res.json({ settings: row.value, updatedAt: row.updatedAt });
});

// ---------------------------------------------------------------- audit evidence

const auditQuery = z.object({
  q: z.string().max(120).optional(),
  actor: z.string().max(120).optional(),
  action: z.string().max(80).optional(),
  objectType: z.string().max(64).optional(),
  objectId: z.string().max(64).optional(),
  portal: z.string().max(32).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  before: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
type AuditQuery = z.infer<typeof auditQuery>;

async function auditWhere(f: AuditQuery): Promise<Prisma.AuditEventWhereInput> {
  let actorIds: string[] | undefined;
  if (f.actor) {
    const users = await prisma.user.findMany({ where: { OR: [{ name: { contains: f.actor } }, { email: { contains: f.actor } }] }, select: { id: true } });
    actorIds = users.map((u) => u.id);
  }
  return {
    ...(actorIds ? { actorId: { in: actorIds } } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.objectType ? { objectType: f.objectType } : {}),
    ...(f.objectId ? { objectId: f.objectId } : {}),
    ...(f.portal ? { portal: f.portal } : {}),
    ...(f.from || f.to ? { occurredAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.before ? { id: { lt: f.before } } : {}),
    ...(f.q ? { OR: [{ action: { contains: f.q } }, { objectId: { contains: f.q } }, { reason: { contains: f.q } }, { objectType: { contains: f.q } }] } : {}),
  };
}

const humanAction = (a: string) => a.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function summarise(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  if (typeof o.status === 'string') return o.status;
  return Object.entries(o)
    .slice(0, 3)
    .map(([k, x]) => `${k}: ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`)
    .join(' · ')
    .slice(0, 160);
}

async function auditRows(f: AuditQuery, take: number) {
  const rows = await prisma.auditEvent.findMany({ where: await auditWhere(f), orderBy: { id: 'desc' }, take });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]));
  return rows.map((r) => ({
    id: r.id.toString(),
    at: r.occurredAt.toISOString(),
    user: r.actorId ? names.get(r.actorId) ?? 'Unknown user' : 'System',
    role: r.actorRole ?? (r.actorId ? '' : 'System'),
    portal: r.portal,
    action: r.action,
    actionLabel: humanAction(r.action),
    objectType: r.objectType,
    objectId: r.objectId,
    previous: summarise(r.before),
    next: summarise(r.after),
    before: r.before,
    after: r.after,
    reason: r.reason ?? '',
    ip: r.ip,
    requestId: r.requestId,
    hash: r.hash,
  }));
}

adminRoutes.get('/audit-events', AUDIT, validateQuery(auditQuery), async (req, res) => {
  const f = query<AuditQuery>(req);
  const data = await auditRows(f, f.limit);
  res.json({ data, nextBefore: data.length === f.limit ? data.at(-1)!.id : null });
});

adminRoutes.get('/audit-events.csv', AUDIT, validateQuery(auditQuery), async (req, res) => {
  const f = query<AuditQuery>(req);
  const data = await auditRows(f, 10_000);
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'audit.exported', objectType: 'report', objectId: 'audit-events', after: { rows: data.length, filters: { ...f, before: f.before?.toString() } } }));
  sendCsv(
    res,
    `matanho-audit-evidence-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Event', 'Time (UTC)', 'User', 'Role', 'Portal', 'Action', 'Object type', 'Object', 'Previous', 'New', 'Reason', 'IP', 'Request', 'Hash'],
    data.map((r) => [r.id, r.at, r.user, r.role, r.portal, r.action, r.objectType, r.objectId, r.before, r.after, r.reason, r.ip, r.requestId, r.hash]),
  );
});

adminRoutes.get('/audit-events/verify', AUDIT, async (_req, res) => {
  res.json(await verifyAuditChain());
});
