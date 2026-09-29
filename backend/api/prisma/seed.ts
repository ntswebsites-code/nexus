/**
 * Seeds the role/permission catalog discovered in the prototype and,
 * optionally, a first user so someone can sign in.
 *
 *   npm run db:seed
 *
 * Optional environment variables (never commit real values):
 *   SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME
 *   SEED_USER_ROLES   comma list of "<portal>:<roleKey>", e.g. admin:system_admin,investor:admin
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const here = path.dirname(fileURLToPath(import.meta.url));

interface CatalogRole {
  portal: string;
  key: string;
  label: string;
  permissions: string[];
}

async function seedCatalog() {
  const catalog = JSON.parse(readFileSync(path.join(here, 'seed', 'role-catalog.json'), 'utf8')) as {
    roles: CatalogRole[];
  };

  for (const r of catalog.roles) {
    const role = await prisma.role.upsert({
      where: { portal_key: { portal: r.portal, key: r.key } },
      update: { label: r.label },
      create: { portal: r.portal, key: r.key, label: r.label },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: r.permissions.map((permission) => ({ roleId: role.id, permission })),
      skipDuplicates: true,
    });
  }
  console.log(`[seed] roles synced: ${catalog.roles.length}`);
}

async function seedUser() {
  const email = process.env.SEED_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    console.log('[seed] SEED_USER_EMAIL / SEED_USER_PASSWORD not set - skipping user creation');
    return;
  }
  if (password.length < 10) throw new Error('SEED_USER_PASSWORD must be at least 10 characters');

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const passwordHash = await bcrypt.hash(password, rounds);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, isActive: true },
    create: { email, passwordHash, name: process.env.SEED_USER_NAME?.trim() || null },
  });

  const wanted = (process.env.SEED_USER_ROLES ?? 'admin:system_admin')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const spec of wanted) {
    const [portal, key] = spec.split(':');
    const role = await prisma.role.findUnique({ where: { portal_key: { portal, key } } });
    if (!role) throw new Error(`Unknown role "${spec}" - see prisma/seed/role-catalog.json`);
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
  console.log(`[seed] user ${email} ready with roles: ${wanted.join(', ')}`);
}

try {
  await seedCatalog();
  await seedUser();
} finally {
  await prisma.$disconnect();
}
