/** Investee portal page id -> route path. Routes sit at the root of company.nexus.matanho.com. */
export const IP8_PAGE_TO_PATH: Record<string, string> = {
  dashboard: '/',
  kpis: '/kpis',
  reports: '/reports',
  forecasts: '/forecasts',
  terms: '/terms',
  'cap-table': '/cap-table',
  governance: '/governance',
  signatures: '/signatures',
  requests: '/requests',
  'data-room': '/data-room',
  messages: '/messages',
  team: '/team',
  settings: '/settings',
};

const IP8_PATH_TO_PAGE: Record<string, string> = Object.fromEntries(
  Object.entries(IP8_PAGE_TO_PATH).map(([page, path]) => [path, page]),
);

export const IP8_ROUTE_SEGMENTS = Object.keys(IP8_PAGE_TO_PATH).filter((page) => page !== 'dashboard');

export function pathToIp8Page(pathname: string): string {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return IP8_PATH_TO_PAGE[clean] ?? 'dashboard';
}
