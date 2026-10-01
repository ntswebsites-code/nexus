import type { Prisma } from '@prisma/client';
import type { AuthUser, LoginRequest, PortalId, RegisterRequest } from '@matanho/shared';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { HttpError } from '../lib/errors';
import { cachedPolicy } from '../lib/policy';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';

/**
 * Explicit column selection: `passwordHash` is never part of a value that can
 * reach a controller or a response.
 */
const userWithAccess = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  createdAt: true,
  roles: {
    select: {
      role: {
        select: {
          portal: true,
          key: true,
          label: true,
          permissions: { select: { permission: true } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type UserWithAccess = Prisma.UserGetPayload<{ select: typeof userWithAccess }>;

export function toAuthUser(user: UserWithAccess): AuthUser {
  const roles = user.roles.map(({ role }) => ({
    portal: role.portal,
    key: role.key,
    label: role.label,
  }));
  const permissions = [
    ...new Set(user.roles.flatMap(({ role }) => role.permissions.map((p) => p.permission))),
  ].sort();
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function registerUser(input: RegisterRequest): Promise<AuthUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) {
    throw HttpError.conflict('An account with this email already exists', 'email_taken');
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: { email: input.email, passwordHash, name: input.name ?? null },
      select: userWithAccess,
    });
    return toAuthUser(user);
  } catch (error) {
    // Lost a race with a concurrent registration for the same email.
    if ((error as { code?: string }).code === 'P2002') {
      throw HttpError.conflict('An account with this email already exists', 'email_taken');
    }
    throw error;
  }
}

export function userHasPortalAccess(user: AuthUser, portal: PortalId): boolean {
  return user.roles.some((r) => r.portal === portal);
}

/**
 * Verifies credentials. Returns the same generic error for "unknown email",
 * "wrong password" and "disabled account" so accounts cannot be enumerated.
 */
export async function verifyCredentials(input: LoginRequest): Promise<AuthUser> {
  const record = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...userWithAccess, passwordHash: true },
  });

  const passwordOk = await verifyPassword(input.password, record?.passwordHash ?? DUMMY_HASH);
  if (!record || !passwordOk || !record.isActive) {
    throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');
  }

  const { passwordHash: _omit, ...safe } = record;
  void _omit;
  const user = toAuthUser(safe);

  if (input.portal && !userHasPortalAccess(user, input.portal)) {
    throw HttpError.forbidden(
      'This account is not authorised to use this portal',
      'portal_access_denied',
    );
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export interface ResolvedSession {
  user: AuthUser;
  session: { id: string; mfaPending: boolean; mfaVerifiedAt: Date | null };
}

/**
 * Resolves a session token hash (or null if missing, expired, idle too long or
 * the account is disabled). Absolute lifetime is `expiresAt`; idle lifetime is
 * the `session_idle_minutes` policy (capped by SESSION_IDLE_MINUTES) since `lastUsedAt` (SRD 7.1).
 */
export async function resolveSession(tokenHash: string): Promise<ResolvedSession | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      mfaPending: true,
      mfaVerifiedAt: true,
      user: { select: userWithAccess },
    },
  });
  if (!session) return null;
  const now = Date.now();
  // Idle window: the stricter of the deployment ceiling and the admin session policy.
  const policyIdleMs = Number(await cachedPolicy('session_idle_minutes')) * 60_000;
  const idleMs = policyIdleMs > 0 ? Math.min(policyIdleMs, config.session.idleMs) : config.session.idleMs;
  if (session.expiresAt.getTime() <= now || now - session.lastUsedAt.getTime() > idleMs) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.user.isActive) return null;

  // Throttle writes: touch at most once a minute.
  if (now - session.lastUsedAt.getTime() > 60_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    user: toAuthUser(session.user),
    session: { id: session.id, mfaPending: session.mfaPending, mfaVerifiedAt: session.mfaVerifiedAt },
  };
}

export async function findUserBySessionHash(tokenHash: string): Promise<AuthUser | null> {
  return (await resolveSession(tokenHash))?.user ?? null;
}

export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: userWithAccess });
  return user ? toAuthUser(user) : null;
}
