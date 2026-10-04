import { Router } from 'express';
import { z } from 'zod';
import { LP_DOMAINS, type PlatformFlags } from '@matanho/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { ctx } from '../../lib/http';
import { clearPortalFlagCache, effectiveFlags, envFlags, loadOverrides, mergeFlags, normaliseOverrides, PORTAL_FLAGS_KEY } from '../../lib/portal-flags';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';

/**
 * `/api/v1/platform` - public runtime flags. Portals read these to decide which domains call
 * the live API; anything not live renders the "Demo data" ribbon. The env lists are the defaults; staff can override
 * them (and force demo mode) from /ops/portal-flags (build-plan S26), stored in `platform_settings`.
 */
export const platformRoutes = Router();

export async function platformFlags(): Promise<PlatformFlags> {
  return effectiveFlags();
}

platformRoutes.get('/flags', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await effectiveFlags());
});

const STAFF = [requireAuth, requirePortalAccess('admin'), requirePermission('admin.settings')];

platformRoutes.get('/flags/admin', ...STAFF, async (_req, res) => {
  const { overrides, version } = await loadOverrides();
  const row = await prisma.platformSetting.findUnique({ where: { key: PORTAL_FLAGS_KEY } });
  const env = envFlags();
  res.json({ env, overrides, effective: mergeFlags(env, overrides), version, updatedAt: row?.updatedAt.toISOString() ?? null, lpDomains: LP_DOMAINS });
});

const body = z
  .object({
    demoMode: z.boolean(),
    lp: z.record(z.string(), z.boolean()).default({}),
    investeeLiveActions: z.array(z.string().trim().min(1).max(60)).max(50).nullable().default(null),
    custodianLive: z.boolean().nullable().default(null),
    onboardingLive: z.boolean().nullable().default(null),
    reason: z.string().trim().min(3).max(500),
    version: z.number().int().min(0).optional(),
  })
  .strict();

platformRoutes.put('/flags/admin', ...STAFF, requireStepUp, validateBody(body), idempotent('platform.flags.set', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof body>;
  const unknown = Object.keys(b.lp).filter((k) => !(LP_DOMAINS as readonly string[]).includes(k));
  if (unknown.length) throw HttpError.badRequest('Validation failed', [{ path: 'lp', message: `Unknown domain: ${unknown.join(', ')}` }]);
  const next = normaliseOverrides({ demoMode: b.demoMode, lp: b.lp, investeeLiveActions: b.investeeLiveActions, custodianLive: b.custodianLive, onboardingLive: b.onboardingLive });
  await prisma.$transaction(async (tx) => {
    const row = await tx.platformSetting.findUnique({ where: { key: PORTAL_FLAGS_KEY } });
    if (b.version !== undefined && b.version !== (row?.version ?? 0)) throw HttpError.conflict('The flags were changed by someone else. Reload and try again.', 'version_conflict');
    const before = normaliseOverrides(row?.value);
    if (JSON.stringify(before) === JSON.stringify(next)) throw HttpError.badRequest('Nothing changed');
    const version = (row?.version ?? 0) + 1;
    const value = next as unknown as Prisma.InputJsonValue;
    await tx.platformSetting.upsert({
      where: { key: PORTAL_FLAGS_KEY },
      create: { key: PORTAL_FLAGS_KEY, value, version, updatedBy: req.user!.id },
      update: { value, version, updatedBy: req.user!.id, updatedAt: new Date() },
    });
    await tx.platformSettingChange.create({ data: { key: PORTAL_FLAGS_KEY, version, before: before as unknown as Prisma.InputJsonValue, after: value, reason: b.reason, changedBy: req.user!.id } });
    await writeAudit(tx, ctx(req, 'admin'), { action: 'platform.flags_changed', objectType: 'platform_setting', objectId: PORTAL_FLAGS_KEY, before: { ...before, version: version - 1 }, after: { ...next, version }, reason: b.reason });
  });
  clearPortalFlagCache();
  const { overrides, version } = await loadOverrides();
  const env = envFlags();
  res.json({ env, overrides, effective: mergeFlags(env, overrides), version });
});
