import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import type { LpNotificationPreferences, LpSettings } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { policy } from '../../../lib/policy';
import { writeAudit } from '../../../lib/audit';
import { lp, requireLp, type LpContext } from '../lp.context';
import { LpError, lpOk } from '../lp.http';
import { asRecord, lpAudit } from '../services/common';

/** Domain `settings` (WS1). Preferences are per member and client (`settings` row owned by the user). */
export const lpSettingsRoutes = Router();

const BOOL_KEYS = [
  'emailCapitalCalls',
  'emailDistributions',
  'emailDocuments',
  'emailMessages',
  'emailNotices',
  'inAppCapitalCalls',
  'inAppDistributions',
  'inAppDocuments',
  'inAppMessages',
  'inAppNotices',
] as const;
const DIGESTS = ['daily', 'weekly', 'off'] as const;
const AS_OF = ['LATEST', 'LATEST_FINAL', 'QUARTER_END'] as const;
const CURRENCIES = ['USD', 'ZIG'] as const;

interface Prefs {
  notifications: LpNotificationPreferences;
  presentationCurrency: string;
  defaultAsOfPreference: string;
}

const prefKey = (ctx: LpContext) => `lp.prefs:${ctx.client.id}`;

export async function loadPrefs(ctx: LpContext): Promise<Prefs> {
  const row = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: ctx.userId, key: prefKey(ctx) } } });
  const v = asRecord(row?.value);
  const n = asRecord(v.notifications);
  const notifications = Object.fromEntries(BOOL_KEYS.map((k) => [k, typeof n[k] === 'boolean' ? n[k] : true])) as unknown as LpNotificationPreferences;
  notifications.digest = DIGESTS.includes(n.digest as (typeof DIGESTS)[number]) ? (n.digest as LpNotificationPreferences['digest']) : 'weekly';
  return {
    notifications,
    presentationCurrency: typeof v.presentationCurrency === 'string' ? v.presentationCurrency : ctx.client.baseCurrency,
    defaultAsOfPreference: typeof v.defaultAsOfPreference === 'string' ? v.defaultAsOfPreference : 'LATEST',
  };
}

async function savePrefs(req: Request, ctx: LpContext, before: Prefs, after: Prefs) {
  await prisma.$transaction(async (tx) => {
    const value = after as unknown as Prisma.InputJsonValue;
    await tx.setting.upsert({
      where: { ownerId_key: { ownerId: ctx.userId, key: prefKey(ctx) } },
      create: { ownerId: ctx.userId, key: prefKey(ctx), value },
      update: { value },
    });
    await writeAudit(tx, lpAudit(req), { action: 'lp_settings.updated', objectType: 'user', objectId: ctx.userId, before: before as object, after: after as object });
  });
}

async function mfaInfo(ctx: LpContext): Promise<LpSettings['mfa']> {
  const factor = await prisma.userMfaFactor.findFirst({ where: { userId: ctx.userId, verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' } });
  return {
    requireMfaForLp: Boolean(await policy('mfa_required')),
    issuerName: 'Matanho Nexus',
    enabled: !!factor,
    enabledAt: factor?.verifiedAt?.toISOString() ?? null,
    manageUrl: '/lp-portal/settings?tab=security',
    sessionsUrl: '/lp-portal/settings?tab=security',
    passwordUrl: '/lp-portal/settings?tab=security',
  };
}

lpSettingsRoutes.get('/settings', requireLp('lp.settings.view'), async (req, res) => {
  const ctx = lp(req);
  const [prefs, mfa] = await Promise.all([loadPrefs(ctx), mfaInfo(ctx)]);
  const data: LpSettings = { notifications: prefs.notifications, mfa, presentationCurrency: prefs.presentationCurrency, defaultAsOfPreference: prefs.defaultAsOfPreference };
  lpOk(req, res, data);
});

lpSettingsRoutes.get('/settings/mfa', requireLp('lp.settings.view'), async (req, res) => {
  lpOk(req, res, await mfaInfo(lp(req)));
});

function applyDisplay(b: Record<string, unknown>, prefs: Prefs, fieldErrors: Record<string, string>) {
  if (b.presentationCurrency !== undefined) {
    const c = String(b.presentationCurrency).toUpperCase();
    if (!CURRENCIES.includes(c as (typeof CURRENCIES)[number])) fieldErrors.presentationCurrency = `Use one of ${CURRENCIES.join(', ')}`;
    else prefs.presentationCurrency = c;
  }
  if (b.defaultAsOfPreference !== undefined) {
    const a = String(b.defaultAsOfPreference).toUpperCase();
    if (!AS_OF.includes(a as (typeof AS_OF)[number])) fieldErrors.defaultAsOfPreference = `Use one of ${AS_OF.join(', ')}`;
    else prefs.defaultAsOfPreference = a;
  }
}

lpSettingsRoutes.patch('/settings/notifications', requireLp('lp.settings.view'), async (req, res) => {
  const ctx = lp(req);
  const b = asRecord(req.body);
  const before = await loadPrefs(ctx);
  const after: Prefs = { ...before, notifications: { ...before.notifications } };
  const fieldErrors: Record<string, string> = {};
  for (const k of BOOL_KEYS) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'boolean') fieldErrors[k] = 'Must be true or false';
    else after.notifications[k] = b[k] as boolean;
  }
  const digest = b.digest ?? b.emailDigest;
  if (digest !== undefined) {
    const d = String(digest).toLowerCase();
    if (!DIGESTS.includes(d as (typeof DIGESTS)[number])) fieldErrors.digest = 'Use daily, weekly or off';
    else after.notifications.digest = d as LpNotificationPreferences['digest'];
  }
  applyDisplay(b, after, fieldErrors);
  if (Object.keys(fieldErrors).length) throw LpError.validation('Check the notification settings', fieldErrors);
  await savePrefs(req, ctx, before, after);
  lpOk(req, res, after.notifications, 'Notification preferences saved');
});

lpSettingsRoutes.patch('/settings/display', requireLp('lp.settings.view'), async (req, res) => {
  const ctx = lp(req);
  const before = await loadPrefs(ctx);
  const after: Prefs = { ...before, notifications: { ...before.notifications } };
  const fieldErrors: Record<string, string> = {};
  applyDisplay(asRecord(req.body), after, fieldErrors);
  if (Object.keys(fieldErrors).length) throw LpError.validation('Check the display settings', fieldErrors);
  await savePrefs(req, ctx, before, after);
  lpOk(req, res, { presentationCurrency: after.presentationCurrency, defaultAsOfPreference: after.defaultAsOfPreference }, 'Display preferences saved');
});
