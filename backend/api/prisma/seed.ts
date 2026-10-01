/**
 * Seeds the role/permission catalog discovered in the prototype and,
 * optionally, a first user so someone can sign in.
 *
 *   npm run db:seed
 *
 * Optional environment variables (never commit real values):
 *   SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME
 *   SEED_USER_ROLES   comma list of "<portal>:<roleKey>", e.g. admin:system_admin,investor:admin
 *   SEED_USERS_FILE   path to a JSON array of { email, password, name?, roles: ["portal:key"] }
 *   SEED_RESET_PASSWORDS=1  overwrite passwords of existing users (otherwise only new users get one)
 *   SEED_DEMO=1       load the V56 prototype demo client and company (see prisma/seed-demo.ts)
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

const LOCKED_ROLES = new Set(['admin:system_admin']);
const CATALOG_SETTING = { ownerId: 'platform', key: 'role_catalog_applied' };

/**
 * Adds catalog roles and any catalog permissions not applied before. Permissions an
 * administrator removed in the RBAC screen stay removed; only locked roles are forced
 * back to the catalog bundle.
 */
async function seedCatalog() {
  const catalog = JSON.parse(readFileSync(path.join(here, 'seed', 'role-catalog.json'), 'utf8')) as {
    roles: CatalogRole[];
  };
  const stored = await prisma.setting.findUnique({ where: { ownerId_key: CATALOG_SETTING } });
  const applied = (stored?.value ?? {}) as Record<string, string[]>;
  const next: Record<string, string[]> = {};
  let added = 0;

  for (const r of catalog.roles) {
    const id = `${r.portal}:${r.key}`;
    const locked = LOCKED_ROLES.has(id);
    const role = await prisma.role.upsert({
      where: { portal_key: { portal: r.portal, key: r.key } },
      update: { label: r.label, locked },
      create: { portal: r.portal, key: r.key, label: r.label, locked },
    });
    if (locked) await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permission: { notIn: r.permissions } } });
    const before = new Set(applied[id] ?? []);
    const fresh = locked ? r.permissions : r.permissions.filter((p) => !before.has(p));
    if (fresh.length) {
      const res = await prisma.rolePermission.createMany({
        data: fresh.map((permission) => ({ roleId: role.id, permission })),
        skipDuplicates: true,
      });
      added += res.count;
    }
    next[id] = r.permissions;
  }
  await prisma.setting.upsert({
    where: { ownerId_key: CATALOG_SETTING },
    update: { value: next },
    create: { ...CATALOG_SETTING, value: next },
  });
  console.log(`[seed] roles synced: ${catalog.roles.length} (${added} permission grants added)`);
}

interface SeedUser {
  email: string;
  password: string;
  name?: string;
  /** "<portal>:<roleKey>" entries; may be empty for role-less portals. */
  roles: string[];
}

async function upsertUser(input: SeedUser) {
  const email = input.email.trim().toLowerCase();
  if (input.password.length < 10) throw new Error(`Password for ${email} must be at least 10 characters`);

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  const existing = await prisma.user.findUnique({ where: { email } });
  const resetPassword = !existing?.passwordHash || process.env.SEED_RESET_PASSWORDS === '1';
  const passwordHash = resetPassword ? await bcrypt.hash(input.password, rounds) : undefined;
  const user = existing
    ? await prisma.user.update({ where: { email }, data: { isActive: true, ...(passwordHash ? { passwordHash } : {}) } })
    : await prisma.user.create({ data: { email, passwordHash: passwordHash!, name: input.name?.trim() || null } });

  const wanted = input.roles.map((s) => s.trim()).filter(Boolean);
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
  console.log(`[seed] user ${email} ready with roles: ${wanted.join(', ') || '(none)'}`);
}

async function seedUser() {
  const email = process.env.SEED_USER_EMAIL?.trim();
  const password = process.env.SEED_USER_PASSWORD;
  if (!email || !password) {
    console.log('[seed] SEED_USER_EMAIL / SEED_USER_PASSWORD not set - skipping single user');
    return;
  }
  await upsertUser({
    email,
    password,
    name: process.env.SEED_USER_NAME,
    roles: (process.env.SEED_USER_ROLES ?? 'admin:system_admin').split(','),
  });
}

async function seedUsersFile() {
  const file = process.env.SEED_USERS_FILE?.trim();
  if (!file) return;
  const users = JSON.parse(readFileSync(file, 'utf8')) as SeedUser[];
  for (const u of users) await upsertUser({ ...u, roles: u.roles ?? [] });
}

try {
  await seedCatalog();
  await seedUser();
  await seedUsersFile();
  if (process.env.SEED_DEMO === '1') {
    const { seedDemo } = await import('./seed-demo');
    await seedDemo();
  }
} finally {
  await prisma.$disconnect();
}
