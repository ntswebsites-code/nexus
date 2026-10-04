import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpSubscriptionsRedemptionsScreen } from '@/components/lp-portal/screens/lp-subscriptions-redemptions-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectIdempotencyKey, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_OE } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

const OVERVIEW = {
  fundId: FUND_OE.fundId, shareClass: 'A', asOfDate: '2026-06-30', valuationStatus: 'FINAL', navPerUnit: '1.2500', accountValue: '2600000.00',
  unitsHeld: '2080000.0000', availableToRedeemValue: '2000000.00', availableUnits: '1600000.0000', pendingSubscriptions: '0', pendingRedemptions: '0',
  rules: {
    minBalanceAmount: '100000.00', minBalanceUnits: '80000', noticeDays: 5, dealingFrequency: 'MONTHLY', nextEligibleDealingDate: '2026-08-01', settlementLagDays: 3,
    subscription: { mgmtFeeRate: '0.01', otherFeeFlat: '0', maxFileMb: 10 }, redemption: { feeRate: '0.005', modes: ['AMOUNT', 'UNITS', 'FULL'] },
  },
  compliance: { accreditedInvestor: true, kycStatus: 'APPROVED', noUnsettledCapitalCalls: true, noLegalHolds: true, blockers: [] },
};
const BANKS = [{ id: 'bank-1', label: 'First Bank ****4321', bankName: 'First Bank', accountName: 'Alpha', accountNumberMasked: '****4321', currencyCode: 'USD', isDefault: true, fundId: null, status: 'ACTIVE' }];
const req = (over: Record<string, unknown> = {}) => ({
  id: 'DR-100', fundId: FUND_OE.fundId, fundName: 'Balanced Growth Fund', shareClass: 'A', requestType: 'SUBSCRIPTION', status: 'AWAITING_FUNDS', amount: '50000.00', units: '40000.0000',
  redemptionMode: null, currencyCode: 'USD', requestedDealingDate: '2026-08-01', estimateSnapshotId: 'snap-0', isEstimate: true, createdAt: '2026-07-01T10:00:00Z', ...over,
});
const REQS = [req(), req({ id: 'DR-101', requestType: 'REDEMPTION', status: 'SUBMITTED', amount: '10000.00', units: '8000.0000', redemptionMode: 'AMOUNT' })];
const SUB_EST = { estimateSnapshotId: 'snap-sub', navPerUnit: '1.25', estimatedUnits: '39600.0000', managementFee: '400.00', otherFees: '0.00', estimatedTotalInvestment: '50400.00', isEstimate: true, disclaimer: 'Estimate only' };
const RED_EST = { estimateSnapshotId: 'snap-red', estimatedUnitsToCancel: '8000.0000', estimatedSettlementAmount: '9950.00', earliestDealingDate: '2026-08-01', estimatedSettlementDate: '2026-08-04', noticeDays: 5, aboveMinBalance: true, isEstimate: true, redemptionFee: '50.00', disclaimer: 'Estimate only' };

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/dealing/overview`]: ok(OVERVIEW),
    [`GET ${API}/dealing/bank-accounts`]: ok(BANKS),
    [`GET ${API}/dealing/requests`]: ok(list(REQS)),
    [`POST ${API}/dealing/subscriptions/estimate`]: ok(SUB_EST),
    [`POST ${API}/dealing/redemptions/estimate`]: ok(RED_EST),
    [`POST ${API}/dealing/subscriptions`]: ok(req({ id: 'DR-200' }), 201),
    [`POST ${API}/dealing/redemptions`]: ok(req({ id: 'DR-201', requestType: 'REDEMPTION' }), 201),
    ...over,
  } as never;
}
beforeEach(() => vi.clearAllMocks());
const ready = () => screen.findByText('New Subscription Request');
const subSection = () => screen.getByText('New Subscription Request').closest('section') as HTMLElement;
const redSection = () => screen.getByText('New Redemption Request').closest('section') as HTMLElement;

describe('Subscriptions and redemptions', () => {
  it('loads the overview for the OPEN-ENDED fund only (LPC-007: never the private fund) and renders real fields', async () => {
    const api = liveApi(routes());
    renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await waitFor(() => expectCalled(api, `GET ${API}/dealing/overview`));
    for (const key of [`GET ${API}/dealing/overview`, `GET ${API}/dealing/bank-accounts`, `GET ${API}/dealing/requests`]) {
      api.calls(key).forEach((r) => expect(r.query.get('fundId')).toBe(FUND_OE.fundId));
    }
    expect(await screen.findByText('DR-100')).toBeInTheDocument();
    expect(screen.getByText('DR-101')).toBeInTheDocument();
    // enum values are title-cased, fund shown by name, never an id
    expect(screen.getAllByText('Awaiting Funds').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Balanced Growth Fund').length).toBeGreaterThan(0);
    expect(screen.queryByText(FUND_OE.fundId)).not.toBeInTheDocument();
    expectNoUnmocked();
  });

  it('LPC-007: a session with only a private-capital fund shows the empty state and calls no dealing endpoint', async () => {
    const { FUND_PE } = await import('./_lp');
    const api = liveApi(routes(), { session: { funds: [FUND_PE] } });
    renderLp(<LpSubscriptionsRedemptionsScreen />);
    expect(await screen.findByText(/No open-ended funds are available/)).toBeInTheDocument();
    expect(api.calls(`GET ${API}/dealing/overview`)).toHaveLength(0);
    expect(api.calls(`GET ${API}/dealing/requests`)).toHaveLength(0);
  });

  it('overview load failure shows the API message with a working Retry', async () => {
    let broken = true;
    liveApi(routes({ [`GET ${API}/dealing/overview`]: () => (broken ? fail(500, 'INTERNAL', 'Dealing unavailable') : ok(OVERVIEW)) }));
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    expect(await screen.findByText(/Dealing unavailable/)).toBeInTheDocument();
    broken = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('submit is disabled until an amount is entered and the estimate has arrived', async () => {
    liveApi(routes());
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    const submit = within(subSection()).getByRole('button', { name: 'Review Subscription Request' });
    expect(submit).toBeDisabled();
    await user.click(within(subSection()).getAllByRole('textbox')[0]);
    await user.paste('50000');
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('subscription: estimate in fund currency, then idempotent submit with snapshot, bank and amount; history refetched', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await waitFor(() => expect(within(subSection()).getByRole('button', { name: 'Review Subscription Request' })).toBeDisabled());
    await user.click(within(subSection()).getAllByRole('textbox')[0]);
    await user.paste('50000');
    const submit = within(subSection()).getByRole('button', { name: 'Review Subscription Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    const [est] = expectCalled(api, `POST ${API}/dealing/subscriptions/estimate`);
    expect(est.body).toMatchObject({ fundId: FUND_OE.fundId, amount: '50000.00', currency: 'USD' });
    const before = api.calls(`GET ${API}/dealing/requests`).length;
    await user.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Subscription submitted.', { description: 'DR-200' }));
    const [sub] = expectCalled(api, `POST ${API}/dealing/subscriptions`);
    expectIdempotencyKey(sub);
    expect(sub.body).toMatchObject({ fundId: FUND_OE.fundId, amount: '50000.00', currency: 'USD', bankAccountId: 'bank-1', estimateSnapshotId: 'snap-sub', requestedDealingDate: '2026-08-01' });
    await waitFor(() => expect(api.calls(`GET ${API}/dealing/requests`).length).toBeGreaterThan(before));
    // estimate is consumed: a second submit is not possible without a fresh estimate
    await waitFor(() => expect(within(subSection()).getByRole('button', { name: 'Review Subscription Request' })).toBeDisabled());
  });

  it('DEALING-CCY the subscription estimate uses the FUND currency even when the display currency differs (the API rejects any other currency)', async () => {
    const api = liveApi(routes(), { session: { presentationCurrency: 'ZIG' } });
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(subSection()).getAllByRole('textbox')[0]);
    await user.paste('1000');
    await waitFor(() => expectCalled(api, `POST ${API}/dealing/subscriptions/estimate`));
    expect((expectCalled(api, `POST ${API}/dealing/subscriptions/estimate`)[0].body as Record<string, string>).currency).toBe('USD');
  });

  it('estimate failure shows the API message and keeps submit disabled', async () => {
    liveApi(routes({ [`POST ${API}/dealing/subscriptions/estimate`]: fail(400, 'LP_VALIDATION', 'Subscriptions in this fund are in USD', { currency: 'USD' }) }));
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(subSection()).getAllByRole('textbox')[0]);
    await user.paste('1000');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(within(subSection()).getByRole('button', { name: 'Review Subscription Request' })).toBeDisabled();
  });

  it('expired estimate on submit: error toast, estimate cleared, no duplicate submission', async () => {
    const api = liveApi(routes({ [`POST ${API}/dealing/subscriptions`]: fail(409, 'LP_ESTIMATE_EXPIRED', 'Estimate has expired - re-run estimate', { fieldErrors: { amount: 'Estimate expired - refresh estimate' } }) }));
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(subSection()).getAllByRole('textbox')[0]);
    await user.paste('50000');
    const submit = within(subSection()).getByRole('button', { name: 'Review Subscription Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(api.calls(`POST ${API}/dealing/subscriptions`)).toHaveLength(1);
    await waitFor(() => expect(within(subSection()).getByRole('button', { name: 'Review Subscription Request' })).toBeDisabled());
  });

  it('redemption by amount: estimate then idempotent submit with mode AMOUNT', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    const sec = redSection();
    expect(within(sec).getByRole('button', { name: 'Review Redemption Request' })).toBeDisabled();
    await user.click(within(sec).getAllByRole('textbox')[0]);
    await user.paste('10000');
    const submit = within(sec).getByRole('button', { name: 'Review Redemption Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(expectCalled(api, `POST ${API}/dealing/redemptions/estimate`)[0].body).toMatchObject({ mode: 'AMOUNT', amount: '10000.00', full: false, fundId: FUND_OE.fundId });
    await user.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Redemption submitted.', { description: 'DR-201' }));
    const [r] = expectCalled(api, `POST ${API}/dealing/redemptions`);
    expectIdempotencyKey(r);
    expect(r.body).toMatchObject({ mode: 'AMOUNT', amount: '10000.00', estimateSnapshotId: 'snap-red', full: false });
  });

  it('full redemption sends full:true with no amount typed', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(redSection()).getByRole('button', { name: 'Full Redemption' }));
    const submit = within(redSection()).getByRole('button', { name: 'Review Redemption Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(expectCalled(api, `POST ${API}/dealing/redemptions/estimate`)[0].body).toMatchObject({ mode: 'FULL', full: true });
  });

  it('redemption that breaches the minimum balance cannot be submitted', async () => {
    const api = liveApi(routes({ [`POST ${API}/dealing/redemptions/estimate`]: ok({ ...RED_EST, aboveMinBalance: false }) }));
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(redSection()).getAllByRole('textbox')[0]);
    await user.paste('1999999');
    const submit = within(redSection()).getByRole('button', { name: 'Review Redemption Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(toast.error).toHaveBeenCalledWith('Redemption would breach the minimum balance.');
    expect(api.calls(`POST ${API}/dealing/redemptions`)).toHaveLength(0);
  });

  it('redemption server rejection is surfaced and not reported as success', async () => {
    liveApi(routes({ [`POST ${API}/dealing/redemptions`]: fail(400, 'LP_VALIDATION', 'MODE redemptions are not offered by this fund', { mode: 'Not available' }) }));
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    await user.click(within(redSection()).getAllByRole('textbox')[0]);
    await user.paste('10000');
    const submit = within(redSection()).getByRole('button', { name: 'Review Redemption Request' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalledWith('Redemption submitted.', expect.anything());
  });

  it('non-numeric characters are ignored in the amount field', async () => {
    liveApi(routes());
    const { user } = renderLp(<LpSubscriptionsRedemptionsScreen />);
    await ready();
    const input = within(subSection()).getAllByRole('textbox')[0] as HTMLInputElement;
    await user.click(input);
    await user.paste('12ab');
    expect(input.value).toBe('');
  });
});
