import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';

/**
 * Per-user saved views and preferences (FR-PORT-009 saved portfolio filters, FR-IBOR-007 IBOR column chooser).
 * Mounted at `/api/v1/views`. Every row belongs to the signed-in user: reads, writes and deletes are always scoped
 * to `req.user.id`, so one user can never see or remove another user's view. A scope names the screen and the
 * permission that screen needs; the view config is a small JSON object validated per scope.
 */
export const viewsRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];

export const IBOR_COLUMN_GROUPS = ['position', 'valuation', 'settlement', 'cost', 'availability', 'control'] as const;

const SCOPES: Record<string, { perms: string[]; config: z.ZodTypeAny }> = {
  'portfolio.list': {
    perms: ['portfolio.view'],
    config: z
      .object({
        q: z.string().trim().max(100).optional(),
        strategy: z.string().trim().max(40).optional(),
        riskProfile: z.string().trim().max(16).optional(),
        currency: z.string().trim().max(3).optional(),
        status: z.string().trim().max(16).optional(),
        managerId: z.string().trim().max(36).optional(),
      })
      .strict(),
  },
  'ibor.columns': {
    perms: ['portfolio.view'],
    config: z.object({ groups: z.array(z.enum(IBOR_COLUMN_GROUPS)).min(1, 'Keep at least one column group').max(IBOR_COLUMN_GROUPS.length) }).strict(),
  },
};

const scopeOf = (scope: string) => {
  const s = SCOPES[scope];
  if (!s) throw HttpError.badRequest('Validation failed', [{ path: 'scope', message: `Unknown view scope. Use one of: ${Object.keys(SCOPES).join(', ')}` }]);
  return s;
};
const canUse = (req: Parameters<typeof param>[0], scope: string) => {
  if (!scopeOf(scope).perms.some((p) => req.user!.permissions.includes(p))) throw HttpError.forbidden('Your role cannot use saved views for this screen', 'forbidden');
};

const view = (v: Prisma.UserSavedViewGetPayload<object>) => ({ id: v.id, scope: v.scope, name: v.name, config: v.config, isDefault: v.isDefault, updatedAt: v.updatedAt.toISOString() });

const listQuery = z.object({ scope: z.string().trim().min(1).max(32) });
viewsRoutes.get('/', ...staff, validateQuery(listQuery), async (req, res) => {
  const { scope } = query<z.infer<typeof listQuery>>(req);
  canUse(req, scope);
  const rows = await prisma.userSavedView.findMany({ where: { userId: req.user!.id, scope }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], take: 100 });
  res.json({ data: rows.map(view), total: rows.length });
});

const saveBody = z.object({ scope: z.string().trim().min(1).max(32), name: z.string().trim().min(1, 'Name the view').max(80), config: z.unknown(), isDefault: z.boolean().default(false) }).strict();
/** Creates the view or replaces the config of the user's view with the same name. */
viewsRoutes.put('/', ...staff, validateBody(saveBody), idempotent('views.save', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof saveBody>;
  canUse(req, b.scope);
  const parsed = scopeOf(b.scope).config.safeParse(b.config);
  if (!parsed.success) throw HttpError.badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: `config.${i.path.join('.')}`, message: i.message })));
  const userId = req.user!.id;
  const row = await prisma.$transaction(async (tx) => {
    const count = await tx.userSavedView.count({ where: { userId, scope: b.scope } });
    const existing = await tx.userSavedView.findUnique({ where: { userId_scope_name: { userId, scope: b.scope, name: b.name } } });
    if (!existing && count >= 50) throw HttpError.conflict('You can keep up to 50 saved views per screen. Delete one first.', 'limit_reached');
    if (b.isDefault) await tx.userSavedView.updateMany({ where: { userId, scope: b.scope, isDefault: true }, data: { isDefault: false } });
    const config = parsed.data as Prisma.InputJsonValue;
    const saved = existing
      ? await tx.userSavedView.update({ where: { id: existing.id }, data: { config, isDefault: b.isDefault } })
      : await tx.userSavedView.create({ data: { userId, scope: b.scope, name: b.name, config, isDefault: b.isDefault } });
    await writeAudit(tx, audit(req), { action: existing ? 'view.updated' : 'view.created', objectType: 'saved_view', objectId: saved.id, after: { scope: b.scope, name: b.name, isDefault: b.isDefault } });
    return saved;
  });
  res.status(200).json({ data: view(row) });
});

viewsRoutes.delete('/:id', ...staff, async (req, res) => {
  const row = await prisma.userSavedView.findFirst({ where: { id: param(req, 'id'), userId: req.user!.id } });
  if (!row) throw HttpError.notFound('Saved view not found');
  canUse(req, row.scope);
  await prisma.$transaction(async (tx) => {
    await tx.userSavedView.delete({ where: { id: row.id } });
    await writeAudit(tx, audit(req), { action: 'view.deleted', objectType: 'saved_view', objectId: row.id, before: { scope: row.scope, name: row.name } });
  });
  res.json({ data: { id: row.id, deleted: true } });
});
