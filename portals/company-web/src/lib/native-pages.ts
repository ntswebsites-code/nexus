import { isLiveAction, type InvesteeActionKey } from '@/lib/investee/api';

/**
 * Investee pages with a native React screen (D-14). A native page renders only when its loader key is live;
 * otherwise the route falls back to the V8 runtime and its "Demo data" ribbon, exactly as before.
 */
export const NATIVE_PAGES: Record<string, { title: string; requires: InvesteeActionKey }> = {
  '/requests': { title: 'Capital requests', requires: 'requests.list' },
  '/forecasts': { title: 'Forecasts', requires: 'forecast' },
  '/governance': { title: 'Governance', requires: 'governance' },
  '/data-room': { title: 'Data room', requires: 'vault' },
};

/** Sidebar order and labels, shared by the native shell (runtime pages keep the runtime's own sidebar). */
export const PORTAL_NAV: { path: string; label: string }[] = [
  { path: '/', label: 'Dashboard' },
  { path: '/reports', label: 'Reporting centre' },
  { path: '/kpis', label: 'KPIs' },
  { path: '/forecasts', label: 'Forecasts' },
  { path: '/requests', label: 'Capital requests' },
  { path: '/terms', label: 'Term sheets' },
  { path: '/cap-table', label: 'Cap table' },
  { path: '/governance', label: 'Governance' },
  { path: '/signatures', label: 'Signatures' },
  { path: '/data-room', label: 'Data room' },
  { path: '/messages', label: 'Messages' },
  { path: '/team', label: 'Team' },
  { path: '/settings', label: 'Settings' },
];

export function cleanPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function nativePageFor(pathname: string) {
  return NATIVE_PAGES[cleanPath(pathname)] ?? null;
}

export function isNativeLive(pathname: string, liveActions: readonly string[]): boolean {
  const page = nativePageFor(pathname);
  return page !== null && isLiveAction(page.requires, liveActions);
}
