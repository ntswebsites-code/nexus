import { LP_DOMAINS, type LpDomain, type PlatformFlags } from '@matanho/shared';
import { config } from '../config';
import { prisma } from './prisma';

/**
 * Build-plan S26: portal data flags and demo-mode switches kept in `platform_settings` (key `portal.flags`), so staff
 * can flip a portal domain between live and demo without an env change and API restart. The env lists
 * (LP_LIVE_DOMAINS, INVESTEE_LIVE_ACTIONS, CUSTODIAN_LIVE, ONBOARDING_LIVE) stay the defaults; an override only applies
 * where staff set one, and `demoMode` forces every portal to demo data at once (the switch to flip in a demo).
 */
export const PORTAL_FLAGS_KEY = 'portal.flags';

export interface PortalFlagOverrides {
  /** Forces every portal domain to demo data when true. */
  demoMode: boolean;
  /** Per LP domain: true/false overrides the env default; absent means "use the env". */
  lp: Partial<Record<LpDomain, boolean>>;
  /** Investee live actions; null means "use the env list". */
  investeeLiveActions: string[] | null;
  custodianLive: boolean | null;
  onboardingLive: boolean | null;
}

export function normaliseOverrides(raw: unknown): PortalFlagOverrides {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<PortalFlagOverrides>;
  const lp: Partial<Record<LpDomain, boolean>> = {};
  for (const d of LP_DOMAINS) {
    const v = o.lp?.[d];
    if (typeof v === 'boolean') lp[d] = v;
  }
  return {
    demoMode: o.demoMode === true,
    lp,
    investeeLiveActions: Array.isArray(o.investeeLiveActions) ? o.investeeLiveActions.filter((a): a is string => typeof a === 'string').slice(0, 50) : null,
    custodianLive: typeof o.custodianLive === 'boolean' ? o.custodianLive : null,
    onboardingLive: typeof o.onboardingLive === 'boolean' ? o.onboardingLive : null,
  };
}

export function envFlags(): PlatformFlags {
  const live = new Set(config.flags.lpLiveDomains);
  const all = live.has('all') || live.has('*');
  return {
    lp: Object.fromEntries(LP_DOMAINS.map((d) => [d, all || live.has(d)])) as Record<LpDomain, boolean>,
    investee: { liveActions: config.flags.investeeLiveActions },
    custodian: { live: config.flags.custodianLive },
    onboarding: { live: config.flags.onboardingLive },
    storage: { backend: config.storage.backend },
  };
}

/** Pure merge of env defaults and staff overrides. */
export function mergeFlags(env: PlatformFlags, o: PortalFlagOverrides): PlatformFlags {
  if (o.demoMode) {
    return { ...env, lp: Object.fromEntries(LP_DOMAINS.map((d) => [d, false])) as Record<LpDomain, boolean>, investee: { liveActions: [] }, custodian: { live: false }, onboarding: { live: false } };
  }
  return {
    ...env,
    lp: Object.fromEntries(LP_DOMAINS.map((d) => [d, o.lp[d] ?? env.lp[d]])) as Record<LpDomain, boolean>,
    investee: { liveActions: o.investeeLiveActions ?? env.investee.liveActions },
    custodian: { live: o.custodianLive ?? env.custodian.live },
    onboarding: { live: o.onboardingLive ?? env.onboarding.live },
  };
}

const TTL_MS = 5_000;
let cached: { at: number; value: PortalFlagOverrides } | null = null;

export async function loadOverrides(): Promise<{ overrides: PortalFlagOverrides; version: number }> {
  const row = await prisma.platformSetting.findUnique({ where: { key: PORTAL_FLAGS_KEY } });
  const overrides = normaliseOverrides(row?.value);
  cached = { at: Date.now(), value: overrides };
  return { overrides, version: row?.version ?? 0 };
}

export function clearPortalFlagCache() {
  cached = null;
}

/** Effective flags served to the portals; falls back to the env defaults if the database cannot be read. */
export async function effectiveFlags(): Promise<PlatformFlags> {
  try {
    const o = cached && Date.now() - cached.at < TTL_MS ? cached.value : (await loadOverrides()).overrides;
    return mergeFlags(envFlags(), o);
  } catch {
    return envFlags();
  }
}
