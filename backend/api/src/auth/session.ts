import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config';
import { prisma } from '../lib/prisma';

/** 256-bit random opaque token (URL-safe). This is the only thing the browser holds. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    // Portals live on different ports/subdomains of the same site, so Lax is
    // sufficient for credentialed fetches; state-changing routes also pass the
    // Origin allow-list check (see middleware/originGuard).
    sameSite: 'lax',
    path: '/',
    domain: config.session.cookieDomain,
    expires,
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(config.session.cookieName, token, cookieOptions(expiresAt));
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.session.cookieName, cookieOptions());
}

export function readSessionToken(req: Request): string | undefined {
  const value = req.cookies?.[config.session.cookieName];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function createSession(userId: string, req: Request, opts: { mfaPending?: boolean } = {}) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + config.session.ttlMs);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ipAddress: req.ip?.slice(0, 45) ?? null,
      mfaPending: opts.mfaPending ?? false,
    },
  });
  return { token, expiresAt };
}

/** Ends every session for a user (password reset, deactivation). */
export async function destroyUserSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Housekeeping: drop expired rows. Called opportunistically on login. */
export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
