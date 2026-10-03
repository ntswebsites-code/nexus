/**
 * Admin shell and security seed (WP-4): administrator-defined permission codes and a welcome notification so the bell is not empty on a fresh UAT database.
 * Idempotent: custom permissions are upserted by code; the preference and the welcome notification are created once.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-admin-shell.ts   (standalone; run the role seed first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';

const log = (m: string) => console.log(`[seed:admin-shell] ${m}`);

const CUSTOM_PERMISSIONS = [
  { code: 'vendor.review', label: 'Review vendor due diligence', description: 'Example of an administrator-defined permission: attach to a role from RBAC & Controls.' },
  { code: 'board.pack.view', label: 'View board packs', description: 'Read-only access to assembled board packs.' },
];

/**
 * ISS-ADB-020: the shipped role catalogue is separation-of-duties clean. Databases seeded earlier still hold
 * the old grants. Seeding is additive (prisma/seed.ts never revokes), so removing them is an explicit,
 * opt-in migration: run with SEED_APPLY_ROLE_RETIREMENTS=1. Every affected role and permission is logged.
 * Safety: `admin.settings` is only withdrawn from System Administrator when at least one active user holds
 * the Platform Settings Administrator role, so Settings can never be orphaned.
 */
async function retireCataloguePermissions() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed', 'role-catalog.json');
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as { retiredPermissions?: { roles?: Record<string, string[]> } };
  const plan = Object.entries(catalog.retiredPermissions?.roles ?? {});
  if (process.env.SEED_APPLY_ROLE_RETIREMENTS !== '1') {
    if (plan.length) log('role retirements available but not applied (set SEED_APPLY_ROLE_RETIREMENTS=1 to revoke legacy grants)');
    return;
  }
  const settingsHolders = await prisma.userRole.count({
    where: { role: { portal: 'admin', key: 'settings_admin' }, user: { isActive: true } },
  });
  for (const [id, perms] of plan) {
    const [portal, key] = id.split(':');
    const role = await prisma.role.findUnique({ where: { portal_key: { portal: portal!, key: key! } } });
    if (!role) continue;
    const allowed = perms.filter((p) => {
      if (p === 'admin.settings' && settingsHolders === 0) {
        log(`SKIPPED ${id}: admin.settings kept because no active user holds admin:settings_admin`);
        return false;
      }
      return true;
    });
    if (!allowed.length) continue;
    const res = await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { in: allowed } } });
    if (res.count) log(`SoD: ${id} lost ${res.count} grant(s): ${allowed.join(', ')}`);
  }
}

export async function seedAdminShell() {
  await retireCataloguePermissions();
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
