/**
 * Admin shell and security seed (WP-4): administrator-defined permission codes and a welcome notification so the bell is not empty on a fresh UAT database.
 * Idempotent: custom permissions are upserted by code; the preference and the welcome notification are created once.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-admin-shell.ts   (standalone; run the role seed first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';

const log = (m: string) => console.log(`[seed:admin-shell] ${m}`);

const CUSTOM_PERMISSIONS = [
  { code: 'vendor.review', label: 'Review vendor due diligence', description: 'Example of an administrator-defined permission: attach to a role from RBAC & Controls.' },
  { code: 'board.pack.view', label: 'View board packs', description: 'Read-only access to assembled board packs.' },
];

export async function seedAdminShell() {
  const admin = await prisma.user.findFirst({ where: { roles: { some: { role: { portal: 'admin', key: 'system_admin' } } } }, orderBy: { createdAt: 'asc' } });
  const actorId = admin?.id ?? (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id;
  if (!actorId) {
    log('no users yet: skipped');
    return;
  }
  for (const p of CUSTOM_PERMISSIONS) {
    await prisma.customPermission.upsert({
      where: { code: p.code },
      create: { ...p, createdBy: actorId },
      update: { label: p.label, description: p.description },
    });
  }
  log(`custom permissions: ${CUSTOM_PERMISSIONS.map((p) => p.code).join(', ')}`);

  if (admin) {
    const welcomed = await prisma.notification.findFirst({ where: { userId: admin.id, type: 'shell.welcome' } });
    if (!welcomed) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'shell.welcome',
          title: 'Notification centre is live',
          body: 'Approvals, breaches and breaks now arrive here. Choose in-app, email or a daily digest under your profile.',
          link: '/ops/profile',
        },
      });
      log('welcome notification created');
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAdminShell()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
