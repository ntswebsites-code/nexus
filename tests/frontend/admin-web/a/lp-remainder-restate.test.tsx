import { describe, it, expect } from 'vitest';
import FundPage from '@/app/(ops)/ops/funds/[id]/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const fund = (over: Record<string, unknown> = {}) => ({
  id: 'f-1', ref: 'FND-001', name: 'Agri Growth Fund I', shortName: 'AGFI', publicReference: null, operatingModel: 'PRIVATE_CAPITAL', currency: 'USD', vintage: 2025, status: 'Active', portalVisible: true,
  defaultShareClass: null, navPerUnit: null, totalNav: null, asOfDate: '2026-09-30', valuationStatus: 'FINAL', totalCommitted: '50000000.00', commitmentCount: 4, version: 3, ...over,
});
const routes = (f = fund(), extra = {}) => ({ 'GET /api/v1/ops/funds/f-1': D({ ...f, commitments: [] }), 'GET /api/v1/clients': D([]), ...extra });

describe('Restate valuation (BR-143)', () => {
  it('a FINAL fund can be restated: a reason is required, the version is sent and the call carries a key', async () => {
    const { api, user } = mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes(fund(), { 'POST /api/v1/ops/funds/f-1/restate': created({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Restate valuation' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'short');
    await user.click(within(d).getByRole('button', { name: 'Restate' }));
    expectNotCalled(api, 'POST /api/v1/ops/funds/f-1/restate');
    await user.clear(within(d).getByLabelText('Reason'));
    await user.type(within(d).getByLabelText('Reason'), 'Audit adjustment to the Q3 valuation');
    await user.click(within(d).getByRole('button', { name: 'Restate' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/funds/f-1/restate'));
    expectBody(req, { reason: 'Audit adjustment to the Q3 valuation', version: 3 });
    expectIdempotencyKey(req);
  });

  it('is not offered for a PROVISIONAL fund or without funds.manage', async () => {
    mountPage(<FundPage />, { params: { id: 'f-1' }, routes: routes(fund({ valuationStatus: 'PROVISIONAL' })) });
    await screen.findByRole('button', { name: 'Edit fund' });
    expect(screen.queryByRole('button', { name: 'Restate valuation' })).not.toBeInTheDocument();
  });

  it('read-only users see no Restate button', async () => {
    mountPage(<FundPage />, { params: { id: 'f-1' }, perms: without('funds.manage'), routes: routes() });
    await screen.findByText('Agri Growth Fund I');
    expect(screen.queryByRole('button', { name: 'Restate valuation' })).not.toBeInTheDocument();
  });
});
