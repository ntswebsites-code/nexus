import { describe, it, expect } from 'vitest';
import FinancingPage from '@/app/(ops)/ops/financing/page';
import { mountPage } from './_kit';
import { ok, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey } from '../../_helpers';

// Package S2: margin disposition with an independent checker (FR-FIN-002, FR-FIN-004, BR-070).

const margin = { drawn: '500000', counted: '800000', coverage: '1.60', state: 'OK', excess: '100000', callAmount: '0', availableToDraw: '200000' };
const facility = {
  id: 'fa1', ref: 'FAC-1001', name: 'Margin line A', type: 'MARGIN_LOAN', lender: 'Big Bank', portfolioId: 'p1', portfolioRef: 'PF-1', portfolioName: 'Balanced Growth Fund', poolId: 'pl1', poolRef: 'POOL-1', poolName: 'Core pool', currency: 'USD', limitAmount: '1000000', ratePct: '8',
  initialRatio: '1.5', maintenanceRatio: '1.25', callDueDays: 2, status: 'ACTIVE', makerId: 'usr_other', makerName: 'Maker M', approverName: 'Approver A', margin, openCalls: 1, overdueCalls: 0, version: 4,
  valuation: { marketValue: '1000000', afterHaircut: '800000', counted: '800000', ineligible: '0', warnings: [], lines: [] }, movements: [], calls: [],
};
const disposition = (o: Record<string, unknown> = {}) => ({
  kind: 'FUNDED', outcome: null, reason: 'Wired to the lender today', proposedBy: 'usr_other', proposedByName: 'Maker M', proposedAt: '2026-10-01T09:00:00Z', priorStatus: 'ACKNOWLEDGED', counterpartyEvidenceRef: null, houseCalcAmount: null, houseCalcNote: null,
  fundingLedgerId: 'led-1', fundingAmount: '120000', expectationId: 'exp-1', journalId: null, ...o,
});
const call = (o: Record<string, unknown> = {}) => ({
  id: 'mc1', ref: 'MC-0001', facilityId: 'fa1', portfolioId: 'p1', facilityRef: 'FAC-1001', facilityName: 'Margin line A', lender: 'Big Bank', currency: 'USD', status: 'ACKNOWLEDGED', calledAmount: '120000', drawn: '500000', eligibleValue: '600000', coverageRatio: '1.2', coverageAfter: null,
  dueAt: '2026-10-09T00:00:00Z', overdue: false, issuedBy: 'usr_other', issuedByName: 'Issuer I', acknowledgedByName: 'Ack A', resolvedByName: null, resolution: null, disposition: null, current: { ...margin, state: 'DEFICIT', callAmount: '90000' }, ...o,
});
const base = (c: ReturnType<typeof call>, extra: Record<string, unknown> = {}) => ({
  'GET /api/v1/financing/summary': ok({ facilities: 1, pendingApproval: 0, inDeficit: 1, warning: 0, openCalls: 1, overdueCalls: 0, exposure: [], watchlist: [] }),
  'GET /api/v1/financing/facilities': ok([facility]),
  'GET /api/v1/financing/calls': ok([c]),
  'GET /api/v1/financing/calls/:id': ok(c),
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/cash/ledgers': ok([{ id: 'led-1', ref: 'CLG-1001', name: 'Operating bank', currency: 'USD' }, { id: 'led-2', ref: 'CLG-1002', name: 'ZWG bank', currency: 'ZWG' }]),
  'POST /api/v1/financing/calls/:id/disposition': ok({}),
  'POST /api/v1/financing/calls/:id/disposition/approve': ok({}),
  'POST /api/v1/financing/calls/:id/disposition/return': ok({}),
  ...extra,
});
const PERMS = ['risk.view', 'financing.manage', 'financing.approve'];
const openCall = async (c: ReturnType<typeof call>, perms = PERMS) => {
  const m = await mountPage(<FinancingPage />, { perms, routes: base(c) });
  await m.user.click(await screen.findByRole('tab', { name: 'Margin calls' }));
  await m.user.click(await screen.findByText('MC-0001'));
  return { ...m, dlg: await screen.findByRole('dialog') };
};

describe('Financing: margin disposition', () => {
  it('Record funding offers only bank ledgers in the facility currency and posts a FUNDED proposal with a key', async () => {
    const { user, api, dlg } = await openCall(call());
    await user.click(await within(dlg).findByRole('button', { name: 'Record funding' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await within(d).findByRole('option', { name: /CLG-1001 Operating bank \(USD\)/ });
    expect(within(d).queryByRole('option', { name: /ZWG bank/ })).not.toBeInTheDocument();
    await user.selectOptions(within(d).getByLabelText('Bank ledger'), 'led-1');
    await user.type(within(d).getByLabelText('Reason'), 'Wired to the lender today');
    await user.click(within(d).getByRole('button', { name: 'Send to checker' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/disposition'));
    expectBody(req!, { kind: 'FUNDED', fundingLedgerId: 'led-1', fundingAmount: '120000', reason: 'Wired to the lender today' });
    expectIdempotencyKey(req!);
  });

  it('Resolve dispute needs the counterparty evidence and the house calculation', async () => {
    const { user, api, dlg } = await openCall(call({ status: 'DISPUTED' }));
    expect(within(dlg).queryByRole('button', { name: 'Record funding' })).not.toBeInTheDocument();
    await user.click(await within(dlg).findByRole('button', { name: 'Resolve dispute' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(within(d).getByLabelText(/^Counterparty evidence/)).toBeRequired();
    expect(within(d).getByLabelText(/House-calculated amount/)).toBeRequired();
    expect(within(d).getByLabelText(/House calculation/)).toBeRequired();
    await user.selectOptions(within(d).getByLabelText('Outcome'), 'CALL_WITHDRAWN');
    await user.type(within(d).getByLabelText(/House-calculated amount/), '0');
    await user.type(within(d).getByLabelText(/^Counterparty evidence/), 'Lender statement 2026-10-01');
    await user.type(within(d).getByLabelText(/House calculation/), 'Recomputed at the closing price');
    await user.type(within(d).getByLabelText('Reason'), 'Lender used a stale price');
    await user.click(within(d).getByRole('button', { name: 'Send to checker' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/disposition'));
    expectBody(req!, { kind: 'DISPUTE_RESOLVED', outcome: 'CALL_WITHDRAWN', houseCalcAmount: '0', counterpartyEvidenceRef: 'Lender statement 2026-10-01', houseCalcNote: 'Recomputed at the closing price' });
  });

  it('another approver sees the pending proposal, its expectation, and can approve it', async () => {
    const { user, api, dlg } = await openCall(call({ status: 'PENDING_CHECK', disposition: disposition() }));
    expect(await within(dlg).findByText(/Awaiting an independent checker/)).toHaveTextContent(/funding of 120,000.00 USD proposed by Maker M/);
    expect(within(dlg).getByText(/A cash expectation was raised/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Record funding' })).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Approve disposition' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    await user.click(within(d).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/disposition/approve'));
    expectIdempotencyKey(req!);
  });

  it('the proposer cannot approve their own proposal (maker-checker) but can return it with a reason', async () => {
    const { user, api, dlg } = await openCall(call({ status: 'PENDING_CHECK', disposition: disposition({ proposedBy: 'usr_admin', proposedByName: 'Test Admin' }) }));
    expect(await within(dlg).findByText(/You proposed this, so a different approver must approve it/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Approve disposition' })).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Return disposition' }));
    await user.type(screen.getByLabelText(/Reason/), 'Wrong ledger chosen');
    await user.click(screen.getAllByRole('button', { name: 'Return' }).at(-1)!);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/financing/calls/mc1/disposition/return'));
    expectBody(req!, { reason: 'Wrong ledger chosen' });
  });

  it('a funded call shows its journal link and offers no further actions', async () => {
    const { dlg } = await openCall(call({ status: 'FUNDED', disposition: disposition({ journalId: 'cj-1' }) }));
    expect(await within(dlg).findByText(/A cash journal is linked to it/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Record funding' })).not.toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Approve disposition' })).not.toBeInTheDocument();
  });
});
