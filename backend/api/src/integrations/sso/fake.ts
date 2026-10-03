import { config } from '../../config';
import { hmacHex, safeEqualHex } from '../../lib/crypto';
import type { SsoAdapter } from './types';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

/** Mint a fake authorization code for an email (used by the dev IdP page and tests). */
export const fakeSsoCode = (email: string) => `fake.${b64(email)}.${hmacHex(`sso:${email}`)}`;

/** Development-only: refuses to run in production regardless of flags. */
export class FakeSso implements SsoAdapter {
  async beginLogin({ state, redirectUri }: { state: string; redirectUri: string }) {
    if (config.isProduction) throw new Error('The fake SSO identity provider is disabled in production');
    const q = new URLSearchParams({ state, redirect_uri: redirectUri });
    return { authorizeUrl: `${config.publicApiUrl}/api/v1/integrations/sso/fake-idp?${q.toString()}` };
  }
  async completeLogin({ code }: { code: string }) {
    if (config.isProduction) throw new Error('The fake SSO identity provider is disabled in production');
    const [prefix, enc, sig] = code.split('.');
    const email = enc ? unb64(enc) : '';
    if (prefix !== 'fake' || !email || !sig || !/^[0-9a-f]{64}$/.test(sig) || !safeEqualHex(hmacHex(`sso:${email}`), sig)) throw new Error('Invalid SSO code');
    return { subject: `fake|${email}`, email, name: email.split('@')[0] ?? email };
  }
  async health() {
    return config.isProduction ? { ok: false, detail: 'Fake SSO is disabled in production' } : { ok: true, detail: 'Fake dev-only identity provider page' };
  }
}
