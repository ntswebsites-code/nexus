import { Router } from 'express';
import { z } from 'zod';
import { passwordSchema } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { hashPassword, verifyPassword } from '../../auth/password';
import { hashToken, readSessionToken } from '../../auth/session';
import { KINDS, canSee, kindDef, loadRecord, searchKind, type SearchHit } from './registry';

/**
 * `/api/v1/shell` - services behind the admin console chrome (SRD 5A.0, 5A.29, 5A.30): global search, record detail,
 * the signed-in user's profile, password change, session management and the role focus lens.
 */
export const shellRoutes = Router();
shellRoutes.use(requireAuth, requirePortalAccess('admin'));

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'admin');

// ---------------------------------------------------------------- global search

const searchQuery = z.object({ q: z.string().trim().min(2).max(80), limit: z.coerce.number().int().min(1).max(50).default(24) });

shellRoutes.get('/search', async (req, res) => {
  const parsed = searchQuery.safeParse(req.query);
  if (!parsed.success) throw HttpError.badRequest('Type at least two characters to search');
  const { q, limit } = parsed.data;
  const perms = new Set(req.user!.permissions);
  const kinds = KINDS.filter((k) => canSee(k, perms));
  const perKind = Math.max(3, Math.ceil(limit / 4));
  const groups = await Promise.all(kinds.map((k) => searchKind(k, q, perKind).catch(() => [] as SearchHit[])));
  const lower = q.toLowerCase();
  const rank = (h: SearchHit) => (h.ref?.toLowerCase() === lower ? 0 : h.ref?.toLowerCase().startsWith(lower) ? 1 : h.title.toLowerCase().startsWith(lower) ? 2 : 3);
  const hits = groups.flat().sort((a, b) => rank(a) - rank(b) || a.kindLabel.localeCompare(b.kindLabel)).slice(0, limit);
  res.json({ query: q, hits, kinds: kinds.length });
});

// ---------------------------------------------------------------- record detail

shellRoutes.get('/record/:kind/:id', async (req, res) => {
  const k = kindDef(param(req, 'kind'));
  if (!k) throw HttpError.notFound('Unknown record type');
  const perms = new Set(req.user!.permissions);
  if (!canSee(k, perms)) throw HttpError.forbidden('Your role does not include this record', 'permission_denied');
  const id = param(req, 'id');
  const record = await loadRecord(k, id);
  if (!record) throw HttpError.notFound('Record not found');
  const history = perms.has('audit.view')
    ? await prisma.auditEvent.findMany({ where: { objectId: id }, orderBy: { id: 'desc' }, take: 15, select: { id: true, occurredAt: true, action: true, actorRole: true, reason: true } })
    : null;
  res.json({
    record,
    history: history?.map((h) => ({ id: h.id.toString(), at: h.occurredAt.toISOString(), action: h.action, role: h.actorRole, reason: h.reason })) ?? null,
  });
});

// ---------------------------------------------------------------- profile

shellRoutes.get('/me', async (req, res) => {
  const user = req.user!;
  const current = readSessionToken(req);
  const currentHash = current ? hashToken(current) : null;
  const [row, factor, sessions, focus, policyRow] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true, createdAt: true } }),
    prisma.userMfaFactor.findFirst({ where: { userId: user.id, verifiedAt: { not: null } }, select: { verifiedAt: true } }),
    prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() }, mfaPending: false }, orderBy: { lastUsedAt: 'desc' }, take: 20 }),
    prisma.setting.findUnique({ where: { ownerId_key: { ownerId: user.id, key: 'ops.role_focus' } } }),
    prisma.policy.findUnique({ where: { key: 'mfa_required' } }),
  ]);
  const adminRoles = user.roles.filter((r) => r.portal === 'admin');
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    roles: adminRoles.map((r) => ({ key: r.key, label: r.label })),
    permissions: user.permissions,
    lastLoginAt: row?.lastLoginAt?.toISOString() ?? null,
    memberSince: row?.createdAt.toISOString() ?? null,
    mfa: { enrolled: !!factor, enrolledAt: factor?.verifiedAt?.toISOString() ?? null, required: Boolean(policyRow?.value ?? false) },
    roleFocus: (focus?.value as { role?: string } | null)?.role ?? null,
    sessions: sessions.map((s) => ({
      id: s.id,
      current: s.tokenHash === currentHash,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      userAgent: s.userAgent,
      ip: s.ipAddress,
    })),
  });
});

const nameSchema = z.object({ name: z.string().trim().min(1).max(120) });

shellRoutes.put('/me', validateBody(nameSchema), async (req, res) => {
  const name = (req.body as z.infer<typeof nameSchema>).name;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user!.id }, data: { name } });
    await writeAudit(tx, audit(req), { action: 'user.profile_updated', objectType: 'user', objectId: req.user!.id, before: { name: req.user!.name }, after: { name } });
  });
  res.json({ ok: true, name });
});

const passwordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

/** Changes the signed-in user's password; every other session is signed out. */
shellRoutes.post('/me/password', idempotent('user.password_change', { required: false }), validateBody(passwordBody), async (req, res) => {
  const b = req.body as z.infer<typeof passwordBody>;
  const row = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { passwordHash: true } });
  if (!row?.passwordHash || !(await verifyPassword(b.currentPassword, row.passwordHash))) {
    throw new HttpError(400, 'invalid_current_password', 'Your current password is not correct');
  }
  if (b.currentPassword === b.newPassword) throw HttpError.badRequest('Choose a password you have not used just now');
  const passwordHash = await hashPassword(b.newPassword);
  const token = readSessionToken(req);
  const keep = token ? hashToken(token) : '';
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: req.user!.id }, data: { passwordHash } });
    const gone = await tx.session.deleteMany({ where: { userId: req.user!.id, tokenHash: { not: keep } } });
    await writeAudit(tx, audit(req), { action: 'auth.password.changed', objectType: 'user', objectId: req.user!.id, after: { otherSessionsRevoked: gone.count } });
    return gone.count;
  });
  res.json({ ok: true, otherSessionsRevoked: revoked });
});

shellRoutes.delete('/me/sessions/:id', async (req, res) => {
  const id = param(req, 'id');
  const token = readSessionToken(req);
  const target = await prisma.session.findFirst({ where: { id, userId: req.user!.id } });
  if (!target) throw HttpError.notFound('Session not found');
  if (token && target.tokenHash === hashToken(token)) throw HttpError.conflict('That is this browser. Use Sign out instead.', 'current_session');
  await prisma.$transaction(async (tx) => {
    await tx.session.delete({ where: { id } });
    await writeAudit(tx, audit(req), { action: 'auth.session.revoked', objectType: 'session', objectId: id, after: { userId: req.user!.id } });
  });
  res.json({ ok: true });
});

shellRoutes.post('/me/sessions/revoke-others', async (req, res) => {
  const token = readSessionToken(req);
  const keep = token ? hashToken(token) : '';
  const count = await prisma.$transaction(async (tx) => {
    const gone = await tx.session.deleteMany({ where: { userId: req.user!.id, tokenHash: { not: keep } } });
    await writeAudit(tx, audit(req), { action: 'auth.sessions.revoked_others', objectType: 'user', objectId: req.user!.id, after: { count: gone.count } });
    return gone.count;
  });
  res.json({ ok: true, revoked: count });
});

// ---------------------------------------------------------------- role focus

const focusBody = z.object({ role: z.string().max(64).nullable() });

/**
 * Role focus is a viewing lens, not an authorisation change: the navigation shows what the chosen role would see, which
 * lets a user holding several roles work in one hat. Every API call is still checked against all of the user's roles.
 */
shellRoutes.put('/me/role-focus', validateBody(focusBody), async (req, res) => {
  const role = (req.body as z.infer<typeof focusBody>).role;
  const mine = req.user!.roles.filter((r) => r.portal === 'admin');
  if (role && !mine.some((r) => r.key === role)) throw HttpError.badRequest('You do not hold that role');
  let permissions: string[] | null = null;
  if (role) {
    const rows = await prisma.rolePermission.findMany({ where: { role: { portal: 'admin', key: role } }, select: { permission: true } });
    permissions = rows.map((r) => r.permission).sort();
  }
  await prisma.setting.upsert({
    where: { ownerId_key: { ownerId: req.user!.id, key: 'ops.role_focus' } },
    create: { ownerId: req.user!.id, key: 'ops.role_focus', value: { role } },
    update: { value: { role } },
  });
  res.json({ role, permissions });
});

shellRoutes.get('/me/role-focus', async (req, res) => {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: req.user!.id, key: 'ops.role_focus' } } });
  const role = (row?.value as { role?: string | null } | null)?.role ?? null;
  const mine = req.user!.roles.filter((r) => r.portal === 'admin');
  if (!role || !mine.some((r) => r.key === role)) return res.json({ role: null, permissions: null, roles: mine.map((r) => ({ key: r.key, label: r.label })) });
  const rows = await prisma.rolePermission.findMany({ where: { role: { portal: 'admin', key: role } }, select: { permission: true } });
  res.json({ role, permissions: rows.map((r) => r.permission).sort(), roles: mine.map((r) => ({ key: r.key, label: r.label })) });
});
