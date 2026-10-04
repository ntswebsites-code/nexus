import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { Shell } from '@/components/Shell';
import { ok, raw, renderWithProviders, type Routes } from '../_helpers';

/** Real shapes of GET /api/v1/custodian/me (custodian.routes.ts) */
export const SUBMIT = ['custodian.executions.submit', 'custodian.dayend.submit'];
export const APPROVE = [...SUBMIT, 'custodian.dayend.approve'];

export function me(role: 'submitter' | 'approver' = 'submitter', permissions = role === 'approver' ? APPROVE : SUBMIT, id = 'usr-sub') {
  return {
    user: { id, name: 'Sam Submitter', email: 'sam@stanbic.test' },
    role,
    permissions,
    counterparty: { id: 'cp-1', ref: 'CP-0001', name: 'Stanbic Custodial Services', type: 'Custodian', accounts: ['CUST-CL-00418', 'CUST-CL-00419'] },
  };
}

/** Routes every page needs: the shell's /me and the unread badge. */
export function shellRoutes(opts: { role?: 'submitter' | 'approver'; permissions?: string[]; id?: string; unread?: number } = {}): Routes {
  return {
    'GET /api/v1/custodian/me': raw(me(opts.role ?? 'submitter', opts.permissions, opts.id)),
    'GET /api/v1/notifications': raw({ items: [], unread: opts.unread ?? 0, page: 1, pageSize: 1, total: 0 }),
  };
}

/** Renders a page inside the real Shell (it supplies the /me context the pages read). */
export function renderPortal(page: ReactElement) {
  return renderWithProviders(<Shell>{page}</Shell>);
}

/** Replaces window.location (jsdom cannot navigate); returns the spies. */
export function stubLocation(pathname = '/', search = '') {
  const assign = vi.fn();
  const replace = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { pathname, search, assign, replace, href: `http://localhost${pathname}${search}` } });
  return { assign, replace };
}

export const execution = (over: Record<string, unknown> = {}) => ({
  id: 'ex-1',
  ref: 'CEX-10001',
  tradeRef: 'TRD-1001',
  executionAt: '2026-10-01T08:30:00.000Z',
  accountRef: 'CUST-CL-00418',
  ticker: 'DLTA.ZW',
  isin: null,
  side: 'BUY',
  quantity: '500',
  price: '0.184',
  currency: 'USD',
  settlementDate: '2026-10-05',
  broker: 'IH Securities',
  note: null,
  status: 'Received',
  amendable: true,
  batchId: null,
  amendCount: 0,
  amendedAt: null,
  cancelledAt: null,
  submittedById: 'usr-sub',
  submittedAt: '2026-10-01T08:31:00.000Z',
  ...over,
});

export const dayEnd = (over: Record<string, unknown> = {}) => ({
  id: 'de-1',
  ref: 'CDE-10001',
  accountRef: 'CUST-CL-00418',
  statementDate: '2026-10-01',
  currency: 'USD',
  closingCash: '125000.50',
  holdingsMv: '980000.00',
  tradeCount: 3,
  tradeQuantity: '1500.00000000',
  tradeNotional: '276.00',
  file: { name: 'dayend.pdf', size: 20480, sha256: 'ab'.repeat(32) },
  sha256: 'cd'.repeat(32),
  note: null,
  status: 'Draft',
  supersedesId: null,
  supersedeReason: null,
  submittedById: 'usr-sub',
  approvedById: null,
  approvedAt: null,
  submittedAt: '2026-10-02T07:00:00.000Z',
  ...over,
});

export { ok };

/**
 * Attaches a file the way a user would. jsdom's constraint validation ignores files set by user-event (it reports
 * valueMissing for a `required` file input), which would block the form submit that a real browser allows once a
 * file is chosen; so the required flag is dropped after the file is attached (assert `toBeRequired()` before).
 */
export async function attachFile(user: { upload: (el: HTMLElement, f: File) => Promise<void> }, input: HTMLInputElement, file: File) {
  await user.upload(input, file);
  input.required = false;
}
