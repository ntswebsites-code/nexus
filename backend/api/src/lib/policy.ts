import { prisma } from './prisma';

/** Policy defaults (SRD 7.2 / 13.3). Stored values in `policies` override these. */
export const POLICY_DEFAULTS = {
  order_approval: true,
  cash_approval: true,
  document_approval: true,
  client_publish_approval: true,
  mfa_required: false,
  kyc_dual_control: true,
  /** When true a KYC approval needs an approved risk assessment (Onboarding & KYC page). */
  kyc_risk_assessment_required: false,
  session_idle_minutes: 30,
} as const;

export type PolicyKey = keyof typeof POLICY_DEFAULTS;

export async function getPolicies(): Promise<Record<PolicyKey, boolean | number>> {
  const rows = await prisma.policy.findMany();
  const out: Record<string, boolean | number> = { ...POLICY_DEFAULTS };
  for (const row of rows) {
    if (row.key in POLICY_DEFAULTS) out[row.key] = row.value as boolean | number;
  }
  return out as Record<PolicyKey, boolean | number>;
}

const cache = new Map<PolicyKey, { value: boolean | number; at: number }>();

/** Policy read for hot paths (every authenticated request); at most 30s stale. */
export async function cachedPolicy(key: PolicyKey): Promise<boolean | number> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const value = await policy(key);
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function policy(key: PolicyKey): Promise<boolean | number> {
  const row = await prisma.policy.findUnique({ where: { key } });
  return (row?.value as boolean | number | undefined) ?? POLICY_DEFAULTS[key];
}
