import { Router } from 'express';
import { LP_DOMAINS, type LpDomain, type PlatformFlags } from '@matanho/shared';
import { config } from '../../config';

/**
 * `/api/v1/platform` - public runtime flags. Portals read these to decide which domains call
 * the live API; anything not live renders the "Demo data" ribbon. Rollback = change the env
 * list and restart the API.
 */
export const platformRoutes = Router();

export function platformFlags(): PlatformFlags {
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

platformRoutes.get('/flags', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(platformFlags());
});
