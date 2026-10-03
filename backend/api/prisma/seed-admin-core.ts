/**
 * Admin Core demo wiring: platform settings with a short change history (retention, notification digest) and an OPEN
 * quarterly access review that snapshots the current active staff. Idempotent: existing settings and an existing review
 * are left alone. Settings that map to policies (MFA, session timeout) are not touched.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-admin-core.ts   (standalone; run the role seed first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { writeAudit } from '../src/lib/audit';

const log = (m: string) => console.log(`[seed:admin-core] ${m}`);

const CHANGES: { key: string; value: boolean | number | string; reason: string }[] = [
  { key: 'retention.audit_years', value: 10, reason: 'Aligned audit retention with the SECZ record-keeping guidance' },
  { key: 'notify.digest_hour', value: 6, reason: 'Operations digest moved ahead of the 07:30 dealing cut-off' },
  { key: 'notify.critical_channel', value: 'in_app_email', reason: 'Breaches and failed controls go to both channels' },
];

export async function seedAdminCore() {
  const admin = await prisma.user.findFirst({ where: { roles: { some: { role: { portal: 'admin', key: 'system_admin' } } } }, orderBy: { createdAt: 'asc' } });
  const actor = admin ?? (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!actor) {
    log('no users yet: skipped');
    return;
  }
  const ctx = { actorId: actor.id, actorRole: 'System Administrator', portal: 'admin' as const };

  for (const c of CHANGES) {
    if (await prisma.platformSetting.findUnique({ where: { key: c.key } })) continue;
    await prisma.$transaction(async (tx) => {
      await tx.platformSetting.create({ data: { key: c.key, value: c.value, version: 1, updatedBy: actor.id } });
      await tx.platformSettingChange.create({ data: { key: c.key, version: 1, before: undefined, after: c.value, reason: c.reason, changedBy: actor.id } });
      await writeAudit(tx, ctx, { action: 'platform_setting.changed', objectType: 'platform_setting', objectId: c.key, after: { value: c.value, version: 1 }, reason: c.reason });
    });
    log(`setting ${c.key} = ${c.value}`);
  }

  if (!(await prisma.accessReview.findFirst())) {
    const users = await prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } },
      include: {
        roles: { where: { role: { portal: 'admin' } }, include: { role: { include: { permissions: true } } } },
        mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });
    if (users.length) {
      const due = new Date(Date.now() + 30 * 86_400_000);
      await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'accessReview');
        const quarter = Math.floor(new Date().getUTCMonth() / 3) + 1;
        const review = await tx.accessReview.create({ data: { ref, title: `Q${quarter} ${new Date().getUTCFullYear()} staff access recertification`, dueDate: new Date(due.toISOString().slice(0, 10) + 'T00:00:00Z'), openedBy: actor.id } });
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
        await writeAudit(tx, ctx, { action: 'access_review.opened', objectType: 'access_review', objectId: review.id, after: { ref, users: users.length } });
      });
      log(`opened access review for ${users.length} staff`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedAdminCore()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
