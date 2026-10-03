import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { param, ctx } from '../../lib/http';
import { writeAudit } from '../../lib/audit';
import { validateBody } from '../../middleware/validate';
import { requireAuth } from '../../middleware/requireAuth';
import { CRITICAL_TYPES, STAFF_NOTIFICATION_TYPES } from './delivery';

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  unread: z.enum(['1', '0', 'true', 'false']).optional(),
});

/** Bell list. `page/pageSize/total` (NFR-PERF-005); `items` and `unread` keep the shape older callers read. */
notificationsRoutes.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = { userId: req.user!.id, ...(q.unread === '1' || q.unread === 'true' ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ items, unread, page: q.page, pageSize: q.pageSize, total });
});

notificationsRoutes.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: param(req, 'id'), userId: req.user!.id, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ ok: true });
});

notificationsRoutes.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- preferences

const CHANNELS = ['in_app', 'email'] as const;

async function preferenceView(userId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const enabled = (channel: string, type: string) => rows.find((r) => r.channel === channel && r.type === type)?.enabled ?? true;
  const digest = rows.find((r) => r.channel === 'digest_weekly' && r.type === '*')?.enabled ? 'weekly' : rows.find((r) => r.channel === 'digest_daily' && r.type === '*')?.enabled ? 'daily' : 'off';
  return {
    digest,
    types: STAFF_NOTIFICATION_TYPES.map((t) => ({
      type: t.type,
      label: t.label,
      critical: [...CRITICAL_TYPES].some((c) => c === t.type || (t.type.endsWith('*') && c.startsWith(t.type.slice(0, -1)))) && ['risk.breach', 'access.*'].includes(t.type),
      channels: Object.fromEntries(CHANNELS.map((c) => [c, enabled(c, t.type)])),
    })),
  };
}

notificationsRoutes.get('/preferences', async (req, res) => {
  res.json(await preferenceView(req.user!.id));
});

const prefBody = z.object({
  digest: z.enum(['off', 'daily', 'weekly']).optional(),
  preferences: z
    .array(z.object({ type: z.string().max(64), channel: z.enum(CHANNELS), enabled: z.boolean() }))
    .max(64)
    .default([]),
});

notificationsRoutes.put('/preferences', validateBody(prefBody), async (req, res) => {
  const b = req.body as z.infer<typeof prefBody>;
  const allowed = new Set(STAFF_NOTIFICATION_TYPES.map((t) => t.type));
  const items = b.preferences.filter((p) => allowed.has(p.type));
  const userId = req.user!.id;
  await prisma.$transaction(async (tx) => {
    for (const p of items) {
      await tx.notificationPreference.upsert({
        where: { userId_channel_type: { userId, channel: p.channel, type: p.type } },
        create: { userId, channel: p.channel, type: p.type, enabled: p.enabled },
        update: { enabled: p.enabled },
      });
    }
    if (b.digest) {
      for (const [channel, on] of [['digest_daily', b.digest === 'daily'], ['digest_weekly', b.digest === 'weekly']] as const) {
        await tx.notificationPreference.upsert({
          where: { userId_channel_type: { userId, channel, type: '*' } },
          create: { userId, channel, type: '*', enabled: on },
          update: { enabled: on },
        });
      }
    }
    await writeAudit(tx, ctx(req), { action: 'user.notification_preferences.updated', objectType: 'user', objectId: userId, after: { digest: b.digest ?? null, changed: items.length } });
  });
  res.json(await preferenceView(userId));
});
