import type { AdapterBase, AdapterMeta } from '../core/types';

export interface SsoIdentity {
  subject: string;
  email: string;
  name: string;
}

export interface SsoAdapter extends AdapterBase {
  beginLogin(input: { state: string; redirectUri: string }): Promise<{ authorizeUrl: string }>;
  completeLogin(input: { code: string }): Promise<SsoIdentity>;
}

export const meta: AdapterMeta = {
  name: 'sso',
  label: 'Staff SSO (OIDC / SAML)',
  gap: 'GAP-A10',
  description: 'Single sign-on for staff. The fake is a development-only identity provider page.',
  requiredEnv: ['SSO_ISSUER_URL', 'SSO_CLIENT_ID', 'SSO_CLIENT_SECRET'],
  vendorCalls: {
    beginLogin: 'Build the OIDC authorization URL from SSO_ISSUER_URL discovery (code flow with PKCE)',
    completeLogin: 'Exchange the code at the token endpoint, verify the ID token, map claims to a staff user',
  },
};
