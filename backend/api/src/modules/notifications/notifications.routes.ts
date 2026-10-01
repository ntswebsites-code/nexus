import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { param } from '../../lib/http';
import { requireAuth } from '../../middleware/requireAuth';

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth);

notificationsRoutes.get('/', async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  res.json({ items, unread });
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
