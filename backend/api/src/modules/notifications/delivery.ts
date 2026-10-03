import { prisma } from '../../lib/prisma';
import { setting } from '../../lib/settings';

/**
 * Notification routing (GAP-008). Decides, per recipient, whether a notification goes to the in-app bell, to email
 * immediately, or into a daily/weekly digest. Inputs, in order of precedence:
 *  1. critical types follow the platform `notify.critical_channel` setting and ignore personal preferences;
 *  2. the platform `notify.email_enabled` switch (off = no email at all);
 *  3. the recipient's own preferences: LP `lp.prefs:*` settings (per-category email / in-app flags and digest
 *     frequency), investee/staff `notification_preferences` rows (channel email | in_app | digest_daily | digest_weekly).
 */
export const CRITICAL_TYPES = new Set(['risk.breach', 'recon.break_critical', 'access.change_pending', 'fin.margin_call', 'kyc.check.failed']);

export type EmailMode = 'now' | 'daily' | 'weekly' | 'off';
export interface Route {
  inApp: boolean;
  email: EmailMode;
}

/** LP preference category for a notification type (matches the `inApp*` / `email*` keys saved by the LP settings page). */
export function lpCategory(type: string): 'CapitalCalls' | 'Distributions' | 'Documents' | 'Messages' | 'Notices' | null {
  if (type.startsWith('capital')) return 'CapitalCalls';
  if (type.startsWith('distribution')) return 'Distributions';
  if (type.startsWith('document')) return 'Documents';
  if (type.startsWith('message') || type.startsWith('service_request')) return 'Messages';
  if (type.startsWith('dealing')) return 'CapitalCalls';
  if (type.startsWith('notice') || type.startsWith('lp_notice')) return 'Notices';
  return null;
}

/** Investee preference type (see `NOTIFICATION_TYPES` in the investee contract). */
export function investeeCategory(type: string): 'reporting.deadlines' | 'reporting.review' | 'term_sheets' | 'messages' | null {
  if (type === 'reporting.reminder') return 'reporting.deadlines';
  if (type.startsWith('reporting.')) return 'reporting.review';
  if (type.startsWith('term_sheets')) return 'term_sheets';
  if (type.startsWith('message')) return 'messages';
  return null;
}

interface PrefRow {
  channel: string;
  type: string;
  enabled: boolean;
}

/** Pure routing decision for one user; exported for tests. */
export function decideRoute(args: {
  type: string;
  wantsEmail: boolean;
  platformEmail: boolean;
  criticalChannel: string;
  prefs: PrefRow[];
  lp: Record<string, unknown> | null;
  /** Platform notification policy: false = only critical types are emailed (default true). */
  emailNonCritical?: boolean;
}): Route {
  const { type, prefs, lp } = args;
  if (CRITICAL_TYPES.has(type)) {
    const ch = args.criticalChannel;
    const email = args.platformEmail && args.wantsEmail !== false && (ch === 'email' || ch === 'in_app_email') ? 'now' : 'off';
    return { inApp: ch !== 'email', email };
  }
  let inApp = true;
  let email: EmailMode = args.wantsEmail && args.platformEmail && args.emailNonCritical !== false ? 'now' : 'off';
  const pref = (channel: string, t: string) => prefs.find((p) => p.channel === channel && p.type === t)?.enabled;

  const cat = investeeCategory(type);
  for (const t of [type, `${type.split('.')[0]}.*`, ...(cat ? [cat] : []), '*']) {
    if (pref('in_app', t) === false) inApp = false;
    if (pref('email', t) === false) email = 'off';
  }
  if (email !== 'off') {
    if (pref('digest_weekly', '*') === true) email = 'weekly';
    else if (pref('digest_daily', '*') === true) email = 'daily';
  }
  const lpCat = lpCategory(type);
  if (lp && lpCat) {
    if (lp[`inApp${lpCat}`] === false) inApp = false;
    if (lp[`email${lpCat}`] === false) email = 'off';
    else if (email === 'now' && (lp.digest === 'daily' || lp.digest === 'weekly')) email = lp.digest;
  }
  return { inApp, email };
}

/**
 * A member of several clients has one `lp.prefs:<clientId>` row per client, and a notification does not say which
 * client it concerns. A channel is therefore muted only when every row mutes it; the digest applies only when all
 * rows ask for the same digest.
 */
export function mergeLpPrefs(rows: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> | null {
  const list = rows.filter((r): r is Record<string, unknown> => !!r);
  if (!list.length) return null;
  if (list.length === 1) return list[0]!;
  const out: Record<string, unknown> = {};
  for (const k of new Set(list.flatMap((r) => Object.keys(r)))) {
    if (k === 'digest') out.digest = list.every((r) => r.digest === list[0]!.digest) ? list[0]!.digest : 'off';
    else out[k] = list.some((r) => r[k] !== false);
  }
  return out;
}

/** Loads preferences for the recipients and returns a route per user id. */
export async function routeNotifications(userIds: string[], type: string, wantsEmail: boolean): Promise<Map<string, Route>> {
  const [platformEmail, emailNonCritical, criticalChannel, prefs, lpRows] = await Promise.all([
    setting<boolean>('notify.email_enabled'),
    setting<boolean>('notify.email_non_critical'),
    setting<string>('notify.critical_channel'),
    prisma.notificationPreference.findMany({ where: { userId: { in: userIds } } }),
    prisma.setting.findMany({ where: { ownerId: { in: userIds }, key: { startsWith: 'lp.prefs:' } } }),
  ]);
  const out = new Map<string, Route>();
  for (const id of userIds) {
    const lpMerged = mergeLpPrefs(
      lpRows.filter((r) => r.ownerId === id).map((r) => (r.value as { notifications?: Record<string, unknown> } | null)?.notifications ?? null),
    );
    out.set(
      id,
      decideRoute({
        type,
        wantsEmail,
        platformEmail,
        emailNonCritical,
        criticalChannel,
        prefs: prefs.filter((p) => p.userId === id),
        lp: lpMerged,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------- preference API helpers

export const STAFF_NOTIFICATION_TYPES: { type: string; label: string }[] = [
  { type: 'order.*', label: 'Order approvals and routing' },
  { type: 'cash.*', label: 'Cash journals and accounts' },
  { type: 'recon.*', label: 'Reconciliation breaks' },
  { type: 'risk.breach', label: 'Risk and compliance breaches (critical)' },
  { type: 'kyc.*', label: 'KYC reviews' },
  { type: 'nav.*', label: 'NAV releases' },
  { type: 'research.*', label: 'Research and IC votes' },
  { type: 'reporting.*', label: 'Company reporting' },
  { type: 'access.*', label: 'Access change requests (critical)' },
];
