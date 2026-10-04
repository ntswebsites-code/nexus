import type { ReactElement } from 'react';
import { SessionProvider } from '@/ops/session';
import { navigationMock } from '../../_helpers/next-mocks';
import { loginAs, mockApi, raw, renderWithProviders, setRoute, type Routes } from '../../_helpers';

/** Every permission code the admin console A screens gate on. */
export const ALL_PERMS = [
  'accounting.close', 'accounting.post', 'accounting.reopen', 'audit.view',
  'capital.approve', 'capital.create', 'capital.settle', 'capital.view',
  'cash.approve', 'cash.close', 'cash.import', 'cash.journal.approve', 'cash.journal.create', 'cash.reservation', 'cash.view',
  'clients.edit', 'clients.view', 'corporate_actions.manage', 'custodian.review', 'custodian.view', 'dashboard.view',
  'dealing.approve', 'dealing.process', 'dealing.view', 'distributions.approve', 'distributions.create', 'distributions.settle',
  'funds.manage', 'funds.view', 'notices.create', 'notices.publish', 'notices.view', 'operations.view', 'operations.task.manage',
  'orders.approve', 'orders.create', 'orders.route', 'orders.view', 'portfolio.manage', 'portfolio.view',
  'private.mark.approve', 'recon.manage', 'recon.signoff', 'reports.approve', 'reports.create', 'reports.view',
  'research.edit', 'risk.manage', 'risk.view', 'term_sheets.approve', 'term_sheets.create', 'term_sheets.view', 'valuation.maker', 'valuation.release', 'valuation.run', 'valuation.view',
];

export const without = (...drop: string[]) => ALL_PERMS.filter((p) => !drop.includes(p));

/** `{ data }` body, the shape every staff list/detail route answers with (api.get strips it, apiRequest keeps it). */
export const D = (data: unknown, extra: Record<string, unknown> = {}) => raw({ data, ...extra });
export const created = (data: unknown) => raw({ data }, 201);

export interface MountOpts {
  perms?: string[];
  routes?: Routes;
  params?: Record<string, string>;
  path?: string;
  search?: string;
}

/** Renders a real page inside the real SessionProvider with the network mocked. */
export function mountPage(ui: ReactElement, { perms = ALL_PERMS, routes = {}, params = {}, path = '/ops', search = '' }: MountOpts = {}) {
  setRoute(path, search);
  (navigationMock as { useParams: () => unknown }).useParams = () => params;
  window.history.replaceState({}, '', `${path}${search ? `?${search}` : ''}`);
  const api = mockApi({ ...loginAs('admin', { user: { permissions: perms } }), ...routes });
  const view = renderWithProviders(ui, { providers: [SessionProvider] });
  return { api, ...view };
}

export const PF = {
  id: 'pf-1', ref: 'PF-1001', name: 'Growth Portfolio', type: 'Discretionary', baseCurrency: 'USD', clientId: null, managerUserId: null, benchmark: 'MSCI World', status: 'Active', version: 1, asOf: '2026-10-01',
  marketValueBase: '21635767.69', securitiesValueBase: '19801207.69', cashBase: '1834560.00', cashPct: '8.48', positionCount: 12, largestPositionTicker: 'DLTA', largestPositionPct: '75.30', warnings: 0, mandate: {},
};
export const SEC = {
  id: 'sec-1', ticker: 'DLTA', isin: 'ZW0000000001', name: 'Delta Corporation', market: 'VFEX', assetClass: 'Equity', currency: 'USD', boardLot: 100, sector: 'Consumer', status: 'Active',
  latestPrice: { price: '1.250000', priceDate: '2026-10-01', source: 'VFEX' }, previousPrice: null, change: null, changePct: null,
};

/** The API's real validation envelope: `error.details` (path/message list) plus the `fieldErrors` map (errorHandler.ts). */
export function validationFail(fields: Record<string, string>) {
  return {
    status: 400,
    body: {
      success: false, code: 'bad_request', message: 'Validation failed', fieldErrors: fields,
      error: { code: 'bad_request', message: 'Validation failed', details: Object.entries(fields).map(([path, message]) => ({ path, message })), fieldErrors: fields },
    },
  };
}
