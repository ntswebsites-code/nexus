/**
 * Registry of every frontend portal that talks to the shared API.
 * The `id` is what the API uses to answer "may this user open this portal?".
 */
export const PORTAL_IDS = ['admin', 'investor', 'onboarding', 'company'] as const;

export type PortalId = (typeof PORTAL_IDS)[number];

export interface PortalDefinition {
  id: PortalId;
  name: string;
  audience: string;
  /** Default local development port. */
  devPort: number;
  /** Name of the environment variable holding the portal origin. */
  urlEnvVar: string;
}

export const PORTALS: Record<PortalId, PortalDefinition> = {
  admin: {
    id: 'admin',
    name: 'Nexus Admin Workspace',
    audience: 'Investment operations, risk, compliance and administration staff',
    devPort: 3100,
    urlEnvVar: 'ADMIN_PORTAL_URL',
  },
  investor: {
    id: 'investor',
    name: 'LP Portal',
    audience: 'Institutional investors / limited partners',
    devPort: 3101,
    urlEnvVar: 'INVESTOR_PORTAL_URL',
  },
  onboarding: {
    id: 'onboarding',
    name: 'Public Onboarding',
    audience: 'Prospective investors completing KYC applications',
    devPort: 3102,
    urlEnvVar: 'ONBOARDING_PORTAL_URL',
  },
  company: {
    id: 'company',
    name: 'Investee Portal',
    audience: 'Portfolio companies submitting monthly reporting',
    devPort: 3103,
    urlEnvVar: 'COMPANY_PORTAL_URL',
  },
};

export function isPortalId(value: unknown): value is PortalId {
  return typeof value === 'string' && (PORTAL_IDS as readonly string[]).includes(value);
}
