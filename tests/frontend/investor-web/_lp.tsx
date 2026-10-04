/**
 * Shared harness for LP portal tests: live-flag + session routes with real response shapes
 * (envelope `{success,data}`; counts as strings exactly as the API sends them) and a renderer that
 * mounts the real LpPortalProvider.
 */
import { Blob as NodeBlob } from 'node:buffer';
import { vi } from 'vitest';
import { configure } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { mockApi, ok, raw, renderWithProviders, type Routes, type MockApi } from '../_helpers';
import { LpPortalProvider } from '@/components/lp-portal/lp-portal-context';
import { LpStepUpProvider } from '@/components/lp-portal/step-up-dialog';

export const API = '/api/v1/lp-portal';

export const FUND_PE = {
  fundId: 'fund-growth-1',
  publicReference: 'FND-001',
  fundName: 'Growth Fund I',
  shortName: 'GF-I',
  operatingModel: 'PRIVATE_CAPITAL',
  currencyCode: 'USD',
  shareClass: null,
  asOfDate: '2026-06-30',
  valuationStatus: 'FINAL',
  investorAccountReference: 'ACC-1',
  commitmentAmount: '5000000.00',
};
export const FUND_OE = {
  fundId: 'fund-bal-1',
  publicReference: 'FND-002',
  fundName: 'Balanced Growth Fund',
  shortName: 'BGF',
  operatingModel: 'OPEN_ENDED',
  currencyCode: 'USD',
  shareClass: 'A',
  asOfDate: '2026-06-30',
  valuationStatus: 'FINAL',
  investorAccountReference: 'ACC-2',
  commitmentAmount: '0',
};

export function sessionData(over: Record<string, unknown> = {}) {
  return {
    client: { id: 'cli-a', legalName: 'Alpha Family Office', email: 'lp@alpha.test', investorId: 'INV-0001' },
    lpRole: 'MANAGER',
    presentationCurrency: 'USD',
    defaultAsOfDate: '2026-06-30',
    defaultValuationStatus: 'FINAL',
    funds: [FUND_PE, FUND_OE],
    // The real API sends these as strings.
    unreadCounts: { requests: '1', messages: '0', notices: '1', notifications: '0' },
    ...over,
  };
}

export const ALL_LIVE_FLAGS = {
  lp: Object.fromEntries(
    ['session', 'dashboard', 'capital', 'activity', 'dealing', 'performance', 'documents', 'notices', 'requests', 'organisation', 'settings', 'reports'].map((d) => [d, true]),
  ),
};

/** Base routes every LP screen needs. Spread first, then add per-screen routes. */
export function baseRoutes(over: { session?: Record<string, unknown> } = {}): Routes {
  return {
    'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
    [`GET ${API}/session`]: ok(sessionData(over.session)),
    [`GET ${API}/notifications`]: ok({ items: [] }),
    [`GET ${API}/realtime`]: ok({ enabled: false }),
  };
}

export function liveApi(routes: Routes = {}, over: { session?: Record<string, unknown> } = {}): MockApi {
  return mockApi({ ...baseRoutes(over), ...routes });
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <LpStepUpProvider>
      <LpPortalProvider>{children}</LpPortalProvider>
    </LpStepUpProvider>
  );
}

export function renderLp(ui: ReactElement) {
  return renderWithProviders(ui, { providers: [Providers] });
}

/** Paged list envelope data. */
export function list<T>(items: T[], extra: Record<string, unknown> = {}) {
  return { items, page: 1, pageSize: 50, total: items.length, totalPages: 1, ...extra };
}

export const lastOf = <T,>(arr: T[]): T => arr[arr.length - 1];

/**
 * jsdom's Blob and the Blob that fetch's Response produces are different classes, so the
 * `res instanceof Blob` check in the API proxy fails under test. Use one Blob class everywhere.
 */
export function useNodeBlob() {
  vi.stubGlobal('Blob', NodeBlob);
}

// The machine running these is slow and the screens are large: give async queries room.
configure({ asyncUtilTimeout: 6000 });
vi.setConfig({ testTimeout: 30_000 });
