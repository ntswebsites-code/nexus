import type { AuthUser } from '@matanho/shared';
import { raw, type ApiResult } from './mockApi';

export type Persona = 'admin' | 'ops' | 'investor' | 'company' | 'custodian' | 'applicant';

const PORTAL_BY_PERSONA: Record<Persona, string> = {
  admin: 'admin',
  ops: 'admin',
  investor: 'investor',
  company: 'company',
  custodian: 'custodian',
  applicant: 'onboarding',
};

/** Build an AuthUser. Override roles/permissions to test permission-gated UI. */
export function makeUser(persona: Persona = 'admin', over: Partial<AuthUser> = {}): AuthUser {
  return {
    id: `usr_${persona}`,
    email: `${persona}@example.test`,
    name: `Test ${persona[0].toUpperCase()}${persona.slice(1)}`,
    roles: [{ portal: PORTAL_BY_PERSONA[persona], key: persona, label: persona }],
    permissions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/**
 * Route(s) for GET /api/auth/me as `persona` (what useSessionUser and admin SessionProvider call).
 * Spread into mockApi routes:  mockApi({ ...loginAs('admin'), 'GET /api/v1/ops/funds': ok([]) })
 * loginAs(null) answers 401 (signed out); { mfa: 'verify' } models a half-authenticated session.
 */
export function loginAs(
  persona: Persona | null,
  opts: { user?: Partial<AuthUser>; mfa?: 'verify' | 'enroll' } = {},
): Record<string, ApiResult> {
  if (persona === null) {
    return { 'GET /api/auth/me': { status: 401, body: { error: { code: 'unauthenticated', message: 'Not signed in' } } } };
  }
  return { 'GET /api/auth/me': raw({ user: makeUser(persona, opts.user), ...(opts.mfa ? { mfa: opts.mfa } : {}) }) };
}
