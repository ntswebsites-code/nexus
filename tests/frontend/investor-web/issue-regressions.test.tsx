/** Regression tests for the LP issues that have no screen-specific file: LPC-005, LPC-006, LPC-009. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LpPortalDashboardScreen } from '@/components/lp-portal/screens/lp-portal-dashboard-screen';
import SignaturesPage from '@/app/(lp)/lp-portal/signatures/page';
import { ok, fail, raw, mockApi } from '../_helpers';
import { API, liveApi, renderLp } from './_lp';

vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const KPIS = { totalCommitment: '5000000.00', paidIn: '1250000.00', called: '1500000.00', outstandingCalled: '250000.00', unfunded: '3500000.00', currentNav: '2000000.00', distributions: '300000.00', netIrr: '0.1870', tvpi: '1.84', dpi: '0.24', rvpi: '1.60', investmentCount: 1 };
const dash = { asOfDate: '2026-06-30', valuationStatus: 'FINAL', kpis: KPIS, openEndedSummary: null };

describe('LP issue regressions', () => {
  it('LPC-009: dashboard KPI card states its scope (private capital funds only) so it is not read as total holdings', async () => {
    liveApi({
      [`GET ${API}/dashboard/actions`]: ok({ items: [] }), [`GET ${API}/dashboard/activity/recent`]: ok({ items: [] }),
      [`GET ${API}/dashboard`]: ok(dash), [`GET ${API}/performance/history`]: ok({ points: [] }), [`GET ${API}/documents`]: ok({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 }),
    } as never);
    renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText('Private capital funds · 1 investment in view')).toBeInTheDocument();
  });

  it('LPC-006: a 400 for an invalid asOfDate on the dashboard shows the API message with Try Again, not an empty page', async () => {
    const api = liveApi({
      [`GET ${API}/dashboard/actions`]: ok({ items: [] }), [`GET ${API}/dashboard/activity/recent`]: ok({ items: [] }),
      [`GET ${API}/dashboard`]: { status: 400, body: { success: false, code: 'LP_VALIDATION', message: 'asOfDate must be a valid date (YYYY-MM-DD)', fieldErrors: { asOfDate: 'Invalid date' } } },
      [`GET ${API}/performance/history`]: ok({ points: [] }), [`GET ${API}/documents`]: ok({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 }),
    } as never);
    renderLp(<LpPortalDashboardScreen />);
    expect(await screen.findByText(/asOfDate must be a valid date/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(api.calls(`GET ${API}/dashboard`).length).toBeGreaterThan(0);
  });

  it('LPC-005: the e-sign error envelope ({error:{code,message,details}}) surfaces its message in the signing panel', async () => {
    const E = '/api/v1/esign/me/requests';
    const me = { id: 'sg-1', status: 'PENDING', name: 'Ann Alpha', roleLabel: 'Signatory', signedAt: null };
    const req = { id: 'es-1', ref: 'ESG-1', title: 'Doc', message: '', status: 'PENDING', expiresAt: '2099-01-01T00:00:00Z', completedAt: null, hasSealed: false, actionable: true, me, signers: [{ name: 'Ann Alpha', roleLabel: 'Signatory', status: 'PENDING', signedAt: null }], myFields: [{ kind: 'SIGNATURE', page: 1, label: null }] };
    mockApi({
      [`GET ${E}`]: raw({ data: [req] }),
      [`GET ${E}/es-1`]: raw({ request: { ...req, consent: { text: 'I agree.' } }, actionable: true }),
      [`GET ${E}/:id/document`]: raw({}),
      [`POST ${E}/es-1/sign`]: fail(400, 'bad_request', 'Validation failed', [{ path: 'mode', message: 'Invalid option' }]),
    } as never);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() }));
    const user = userEvent.setup();
    render(<SignaturesPage />);
    await user.click(await screen.findByRole('button', { name: 'Review and sign' }));
    await screen.findByText('Your signature');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Sign document' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => /Validation failed/.test(a.textContent ?? ''))).toBe(true);
  });
});
