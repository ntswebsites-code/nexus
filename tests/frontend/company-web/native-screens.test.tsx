import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within, mockApi, setRoute, expectCalled, expectNotCalled, expectBody, expectIdempotencyKey, fail, ok, raw, type Routes, type RecordedRequest } from '../_helpers';
import { PortalSwitch } from '@/components/PortalSwitch';
import { RequestsScreen } from '@/components/native/RequestsScreen';
import { ForecastsScreen } from '@/components/native/ForecastsScreen';
import { GovernanceScreen, defaultDue, healthTone } from '@/components/native/GovernanceScreen';
import type { ReactNode } from 'react';
import { DataRoomScreen } from '@/components/native/DataRoomScreen';
import { healthyRoutes, P } from './_fixtures';
import { installBrowserStubs } from './_portal';

/**
 * Native investee screens (D-14) for the S7 features: capital requests with the tranche panel, draft submit,
 * resubmit and RFQ/PO states (BR-229/270/272/273); forecast versions, P&L and stale-version refusal
 * (BR-208/209/263); governance reserved matters, notice period and compliance health (CMP-030, BR-218, BR-221).
 * Shapes follow backend/api/src/modules/investee-portal/workspace/{requisitions,drawdown,forecast,records,compliance}.ts.
 */

const ME = 'usr_tariro';

function base(over: Routes = {}, liveActions: string[] = ['all']): Routes {
  return {
    'GET /api/v1/platform/flags': raw({ lp: {}, investee: { liveActions }, custodian: { live: false }, onboarding: { live: false } }),
    'GET /api/auth/me': raw({ user: { id: ME, email: 'tariro@kuda.test', name: 'Tariro Moyo', roles: [], permissions: [], createdAt: '2026-01-01T00:00:00.000Z' } }),
    [`GET ${P}/profile`]: ok({ id: ME, name: 'Tariro Moyo', company: { id: 'PC-101', name: 'Kuda Logistics', fundName: 'Matanho Growth Partners I' } }),
    ...over,
  };
}

const tranche = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  source: 'tranche',
  configured: true,
  committed: 500000,
  reserved: 350000,
  available: 150000,
  approvedThisQuarter: 100000,
  totalApproved: 250000,
  ...over,
});

const req = (over: Record<string, unknown> = {}) => ({
  id: 'REQ-0001',
  title: 'Fleet expansion',
  description: 'Five trucks',
  status: 'SUBMITTED',
  priority: 'High',
  sourcingCategory: 'Drawdown: Growth capital',
  currency: 'USD',
  estimatedAmount: 100000,
  needBy: '2026-11-30',
  createdByName: 'Tariro Moyo',
  createdById: ME,
  createdAt: '2026-10-01T08:00:00.000Z',
  note: '',
  submittedAt: '2026-10-01T08:00:00.000Z',
  approvedAt: null,
  rfqSentAt: null,
  poRef: null,
  hoursPending: 10,
  slaBreached: false,
  canResubmit: false,
  ...over,
});

const pnlMonth = (over: Record<string, number> = {}) => ({
  totalRevenue: 1000,
  grossProfit: 800,
  ebitda: 300,
  ebitdaMargin: 30,
  openingCash: 5000,
  operatingCash: 300,
  capex: 0,
  financing: 0,
  closingCash: 5300,
  minimumCash: 1000,
  liquidityHeadroom: 4300,
  ...over,
});

const MONTHS = [
  { key: '2026-07', label: 'Jul 2026', stage: 'actual-locked', locked: false },
  { key: '2026-08', label: 'Aug 2026', stage: 'actual-locked', locked: false },
  { key: '2026-09', label: 'Sep 2026', stage: 'actual-locked', locked: false },
  { key: '2026-10', label: 'Oct 2026', stage: 'actual-open', locked: false },
  { key: '2026-11', label: 'Nov 2026', stage: 'forecast', locked: true },
  { key: '2026-12', label: 'Dec 2026', stage: 'forecast', locked: false },
];

const forecastView = (over: Record<string, unknown> = {}) => ({
  scenario: 'Base case',
  months: MONTHS,
  actuals: { '2026-10': 900 },
  forecast: {},
  lockedPeriods: ['2026-11'],
  scenarios: {},
  activeRevenue: 0,
  workingVersion: 3,
  latestSubmittedVersion: 2,
  submittedVersions: [
    { versionNo: 2, scenario: 'Base case', submittedAt: '2026-09-30T10:00:00.000Z', sha256: 'b'.repeat(64) },
    { versionNo: 1, scenario: 'Downside', submittedAt: '2026-08-30T10:00:00.000Z', sha256: 'a'.repeat(64) },
  ],
  cells: { merchantRevenue: { '2026-10': 600 }, openingCash: { '2026-10': 5000 } },
  pnl: {
    firstForecastMonth: '2026-10',
    months: { '2026-10': pnlMonth(), '2026-11': pnlMonth({ liquidityHeadroom: -250 }), '2026-12': pnlMonth() },
    annual: pnlMonth({ totalRevenue: 3000 }),
  },
  ...over,
});

const governanceView = (over: Record<string, unknown> = {}) => ({
  consents: [{ id: 'CON-0001', title: 'New overdraft', basis: 'New debt', submitted: '2026-09-01', due: '2026-09-15', owner: 'Tariro Moyo', status: 'Approved', note: 'Approved at IC' }],
  actions: [{ id: 'a1', title: 'Appoint auditor', owner: 'CFO', due: '2026-10-31', evidence: '', status: 'Open', meetingId: null }],
  meetings: [],
  reservedMatters: [
    { name: 'New debt', detail: 'Borrowing above the agreed facility.', noticeDays: 21 },
    { name: 'Share capital', detail: 'Issue, transfer or buyback.', noticeDays: 14 },
  ],
  calendar: [{ title: 'Q3 2026 report', due: '2026-10-20', status: 'open', kind: 'reporting' }],
  metrics: { pendingConsents: 0, openActions: 1, upcomingMeetings: 0, complianceHealth: { due: 4, onTime: 3, ratio: 75 } },
  ...over,
});

async function mount(path: string, page: ReactNode, routes: Routes) {
  setRoute(path);
  const api = mockApi(routes);
  const user = userEvent.setup();
  const r = render(<PortalSwitch>{page}</PortalSwitch>);
  return { api, user, ...r };
}

const alertText = async () => (await screen.findByRole('alert')).textContent ?? '';
const statusText = () => screen.getAllByRole('status').map((n) => n.textContent).join(' | ');

beforeEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

// ------------------------------------------------------------------------------------------------ switch

describe('PortalSwitch: native screens behind the live allowlist', () => {
  it('renders the native requests screen with the shell sidebar when requests.list is live', async () => {
    const { api } = await mount('/requests', <RequestsScreen />, base({ [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche() }) }));
    expect(await screen.findByRole('heading', { name: 'Capital requests', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Portal pages' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capital requests' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Reporting centre' })).toHaveAttribute('href', '/reports');
    expect(await screen.findByText('Kuda Logistics')).toBeInTheDocument();
    expectCalled(api, `GET ${P}/procurement`);
    expect(document.querySelector('.investee-portal-v8-root')).toBeNull();
  });

  it('falls back to the V8 runtime when the page key is not live, and never mounts the native page', async () => {
    const routes = healthyRoutes({}, ['dashboard']);
    const { api } = await mount('/requests', <RequestsScreen />, routes);
    await waitFor(() => expect(document.querySelector('.investee-portal-v8-root')).not.toBeNull());
    expect(screen.queryByRole('navigation', { name: 'Portal pages' })).toBeNull();
    expectNotCalled(api, `GET ${P}/procurement`);
  });

  it('falls back to the runtime (and its retry panel) when the flags call fails', async () => {
    const routes = healthyRoutes({ 'GET /api/v1/platform/flags': fail(500, 'internal', 'boom') });
    await mount('/forecasts', <ForecastsScreen />, routes);
    await waitFor(() => expect(document.querySelector('.investee-portal-v8-root')).not.toBeNull());
    expect(screen.queryByRole('navigation', { name: 'Portal pages' })).toBeNull();
  });

  it('does not fetch flags for a runtime-only route', async () => {
    const { api } = await mount('/kpis', null, healthyRoutes());
    await waitFor(() => expect(document.querySelector('.investee-portal-v8-root')).not.toBeNull());
    // Only the runtime's own flags call is made (one), not an extra one from the switch.
    await waitFor(() => expect(api.calls('GET /api/v1/platform/flags').length).toBeGreaterThan(0));
    expect(api.calls('GET /api/v1/platform/flags')).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ requests

describe('Capital requests (BR-229, BR-270, BR-272, BR-273)', () => {
  it('shows the tranche panel: committed, reserved, available and approved figures', async () => {
    await mount('/requests', <RequestsScreen />, base({ [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche() }) }));
    const panel = await screen.findByRole('region', { name: 'Investment tranche' });
    await waitFor(() => expect(panel.textContent).toContain('USD 500,000'));
    expect(panel.textContent).toContain('USD 350,000');
    expect(panel.textContent).toContain('USD 150,000');
    expect(panel.textContent).toContain('Approved this quarter');
    expect(panel.textContent).toContain('Agreed tranche');
  });

  it('says so when no tranche is on record (the check is not applied)', async () => {
    await mount('/requests', <RequestsScreen />, base({ [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche({ configured: false, committed: 0, available: 0, reserved: 0 }) }) }));
    expect(await screen.findByText(/No investment tranche is on record/)).toBeInTheDocument();
  });

  it('submits a new request with the full body and an Idempotency-Key, then reloads', async () => {
    const routes = base({
      [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche() }),
      [`POST ${P}/procurement`]: ok(req({ id: 'REQ-0002' }), 201),
    });
    const { api, user } = await mount('/requests', <RequestsScreen />, routes);
    await screen.findByRole('region', { name: 'New request' });
    await user.type(screen.getByLabelText('Title'), 'Warehouse racking');
    await user.selectOptions(screen.getByLabelText('Type'), 'Procurement');
    await user.type(screen.getByLabelText('Amount'), '40000');
    await user.type(screen.getByLabelText('Need by'), '2026-12-15');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expectCalled(api, `POST ${P}/procurement`));
    const [call] = api.calls(`POST ${P}/procurement`) as RecordedRequest[];
    expectBody(call!, { title: 'Warehouse racking', type: 'Procurement', category: 'Growth capital', amount: 40000, needBy: '2026-12-15', priority: 'Medium', draft: false });
    expectIdempotencyKey(call!);
    await waitFor(() => expect(statusText()).toContain('Request submitted for VC executive review'));
    expect(api.calls(`GET ${P}/procurement`).length).toBe(2);
  }, 20000);

  it('warns before submitting more than is available, and shows the server refusal with the available amount', async () => {
    const routes = base({
      [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche() }),
      [`POST ${P}/procurement`]: fail(409, 'tranche_exceeded', 'Drawdown Request Exceeds Available Investment Tranche.', { committed: 500000, reserved: 350000, available: 150000, requested: 200000 }),
    });
    const { user } = await mount('/requests', <RequestsScreen />, routes);
    await screen.findByRole('region', { name: 'New request' });
    await user.type(screen.getByLabelText('Title'), 'Too much');
    await user.type(screen.getByLabelText('Amount'), '200000');
    expect(screen.getByRole('alert').textContent).toContain('more than the USD 150,000 still available');
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    await waitFor(() => {
      const alerts = screen.getAllByRole('alert').map((a) => a.textContent).join(' ');
      expect(alerts).toContain('Drawdown Request Exceeds Available Investment Tranche.');
      expect(alerts).toContain('Available: 150,000; requested: 200,000');
    });
  });

  it('saves a draft (draft: true) and submits the saved draft through /procurement/:ref/submit', async () => {
    const routes = base({
      [`GET ${P}/procurement`]: ok({ requisitions: [req({ id: 'REQ-0009', status: 'DRAFT', submittedAt: null })], tranche: tranche() }),
      [`POST ${P}/procurement`]: ok(req({ id: 'REQ-0010', status: 'DRAFT' }), 201),
      [`POST ${P}/procurement/REQ-0009/submit`]: ok(req({ id: 'REQ-0009' })),
    });
    const { api, user } = await mount('/requests', <RequestsScreen />, routes);
    await screen.findByText('REQ-0009');
    await user.type(screen.getByLabelText('Title'), 'Later idea');
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() => expectCalled(api, `POST ${P}/procurement`));
    expectBody(api.calls(`POST ${P}/procurement`)[0]!, { draft: true });

    const rowEl = screen.getByText('REQ-0009').closest('tr') as HTMLElement;
    expect(within(rowEl).getByText('Draft')).toBeInTheDocument();
    await user.click(within(rowEl).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expectCalled(api, `POST ${P}/procurement/REQ-0009/submit`));
    expectIdempotencyKey(api.calls(`POST ${P}/procurement/REQ-0009/submit`)[0]!);
  });

  it('shows every review state as a readable chip, with RFQ and PO progress and the SLA wait', async () => {
    await mount(
      '/requests',
      <RequestsScreen />,
      base({
        [`GET ${P}/procurement`]: ok({
          requisitions: [
            req({ id: 'REQ-1', status: 'SUBMITTED', slaBreached: true, hoursPending: 52 }),
            req({ id: 'REQ-2', status: 'RFQ_SENT', approvedAt: '2026-10-02T08:00:00.000Z', rfqSentAt: '2026-10-03T08:00:00.000Z' }),
            req({ id: 'REQ-3', status: 'CONVERTED_TO_PO', approvedAt: '2026-10-02T08:00:00.000Z', poRef: 'PO-7781' }),
            req({ id: 'REQ-4', status: 'RETURNED', note: 'Attach two quotes', canResubmit: true }),
          ],
          tranche: tranche(),
        }),
      }),
    );
    const rowOf = async (ref: string) => (await screen.findByText(ref)).closest('tr') as HTMLElement;
    expect((await rowOf('REQ-1')).textContent).toContain('Pending VC executive review');
    expect((await rowOf('REQ-1')).textContent).toContain('Waiting 52 h');
    expect((await rowOf('REQ-2')).textContent).toContain('RFQ sent to suppliers');
    expect((await rowOf('REQ-2')).textContent).toContain('RFQ 2026-10-03');
    expect((await rowOf('REQ-3')).textContent).toContain('Converted to purchase order');
    expect((await rowOf('REQ-3')).textContent).toContain('PO PO-7781');
    expect((await rowOf('REQ-4')).textContent).toContain('Returned for changes');
    expect((await rowOf('REQ-4')).textContent).toContain('Reviewer: Attach two quotes');
    expect(within(await rowOf('REQ-1')).queryByRole('button')).toBeNull();
  });

  it('resubmits a returned request with the edited fields', async () => {
    const routes = base({
      [`GET ${P}/procurement`]: ok({ requisitions: [req({ id: 'REQ-4', status: 'RETURNED', note: 'Lower the amount', canResubmit: true })], tranche: tranche() }),
      [`POST ${P}/procurement/REQ-4/resubmit`]: ok(req({ id: 'REQ-4', estimatedAmount: 80000 })),
    });
    const { api, user } = await mount('/requests', <RequestsScreen />, routes);
    const rowEl = (await screen.findByText('REQ-4')).closest('tr') as HTMLElement;
    await user.click(within(rowEl).getByRole('button', { name: 'Edit and resubmit' }));
    const form = screen.getByRole('region', { name: 'Edit and resubmit REQ-4' });
    const amount = within(form).getByLabelText('Amount');
    expect(amount).toHaveValue(100000);
    await user.clear(amount);
    await user.type(amount, '80000');
    await user.click(within(form).getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expectCalled(api, `POST ${P}/procurement/REQ-4/resubmit`));
    expectBody(api.calls(`POST ${P}/procurement/REQ-4/resubmit`)[0]!, { title: 'Fleet expansion', type: 'Drawdown', category: 'Growth capital', amount: 80000, currency: 'USD', needBy: '2026-11-30', priority: 'High' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Edit and resubmit REQ-4' })).toBeNull());
  }, 20000);

  it('keeps the edit form open and explains an unchanged resubmission', async () => {
    const routes = base({
      [`GET ${P}/procurement`]: ok({ requisitions: [req({ id: 'REQ-4', status: 'REJECTED', canResubmit: true })], tranche: tranche() }),
      [`POST ${P}/procurement/REQ-4/resubmit`]: fail(409, 'unchanged_resubmission', 'Change the request before resubmitting it; the content is the same as the version that was reviewed'),
    });
    const { user } = await mount('/requests', <RequestsScreen />, routes);
    const rowEl = (await screen.findByText('REQ-4')).closest('tr') as HTMLElement;
    await user.click(within(rowEl).getByRole('button', { name: 'Edit and resubmit' }));
    await user.click(screen.getByRole('button', { name: 'Resubmit' }));
    expect(await alertText()).toContain('Change the request before resubmitting it');
    expect(screen.getByRole('region', { name: 'Edit and resubmit REQ-4' })).toBeInTheDocument();
  });

  it('offers resubmit only to the requester (the server enforces it too)', async () => {
    await mount('/requests', <RequestsScreen />, base({ [`GET ${P}/procurement`]: ok({ requisitions: [req({ id: 'REQ-5', status: 'RETURNED', canResubmit: true, createdById: 'usr_other' })], tranche: tranche() }) }));
    const rowEl = (await screen.findByText('REQ-5')).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(rowEl).queryByRole('button', { name: 'Edit and resubmit' })).toBeNull());
  });

  it('hides the create form when requests.create is not live', async () => {
    await mount('/requests', <RequestsScreen />, base({ [`GET ${P}/procurement`]: ok({ requisitions: [], tranche: tranche() }) }, ['requests.list', 'profile']));
    await screen.findByRole('region', { name: 'Investment tranche' });
    expect(screen.queryByRole('region', { name: 'New request' })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ forecasts

describe('Forecasts (BR-208, BR-209, BR-263)', () => {
  it('shows working and submitted versions, the server P&L and flags negative liquidity headroom', async () => {
    await mount('/forecasts', <ForecastsScreen />, base({ [`GET ${P}/forecast`]: ok(forecastView()) }));
    expect(await screen.findByText('Working version 3')).toBeInTheDocument();
    expect(screen.getByText('Last submitted: version 2')).toBeInTheDocument();
    const pnl = screen.getByRole('region', { name: /P&L and cash roll-forward/ });
    expect(pnl.textContent).toContain('Closing cash');
    expect(pnl.textContent).toContain('3,000');
    const negative = within(pnl).getByText('-250');
    expect(negative).toHaveStyle({ fontWeight: '600' });
  });

  it('only accepts opening cash for the first forecast month and makes locked months read-only', async () => {
    await mount('/forecasts', <ForecastsScreen />, base({ [`GET ${P}/forecast`]: ok(forecastView()) }));
    await screen.findByText('Working version 3');
    expect(screen.getByLabelText('Opening cash (first month only) Oct 2026')).toHaveValue(5000);
    expect(screen.queryByLabelText('Opening cash (first month only) Nov 2026')).toBeNull();
    expect(screen.getByLabelText('Merchant revenue Nov 2026')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Merchant revenue Dec 2026')).not.toHaveAttribute('readonly');
    expect(screen.queryByLabelText('Merchant revenue Sep 2026')).toBeNull();
  });

  it('saves only the edited cells with the loaded baseVersion', async () => {
    const routes = base({ [`GET ${P}/forecast`]: ok(forecastView()), [`PUT ${P}/forecast`]: ok(forecastView({ cells: { merchantRevenue: { '2026-10': 600, '2026-12': 750 } } })) });
    const { api, user } = await mount('/forecasts', <ForecastsScreen />, routes);
    await screen.findByText('Working version 3');
    expect(screen.getByRole('button', { name: 'Save working version' })).toBeDisabled();
    await user.type(screen.getByLabelText('Merchant revenue Dec 2026'), '750');
    await user.selectOptions(screen.getByLabelText('Scenario'), 'Upside');
    expect(screen.getByRole('button', { name: /Submit version 3/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save working version' }));
    await waitFor(() => expectCalled(api, `PUT ${P}/forecast`));
    expect(api.calls(`PUT ${P}/forecast`)[0]!.body).toEqual({ scenario: 'Upside', cells: { merchantRevenue: { '2026-12': 750 } }, baseVersion: 3 });
    await waitFor(() => expect(statusText()).toContain('Working version 3 saved'));
  });

  it('on a stale version (409 version_conflict) blocks editing and offers a reload', async () => {
    const routes = base({ [`GET ${P}/forecast`]: ok(forecastView()), [`PUT ${P}/forecast`]: fail(409, 'version_conflict', 'Forecast version 3 was already submitted; reload to edit working version 4') });
    const { api, user } = await mount('/forecasts', <ForecastsScreen />, routes);
    await screen.findByText('Working version 3');
    await user.type(screen.getByLabelText('Capital expenditure Dec 2026'), '10');
    await user.click(screen.getByRole('button', { name: 'Save working version' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('Someone submitted this forecast'));
    expect(screen.getByLabelText('Capital expenditure Dec 2026')).toHaveAttribute('readonly');
    api.on(`GET ${P}/forecast`, ok(forecastView({ workingVersion: 4, latestSubmittedVersion: 3 })));
    await user.click(screen.getByRole('button', { name: 'Reload the working version' }));
    expect(await screen.findByText('Working version 4')).toBeInTheDocument();
  });

  it('submits the working version (POST /forecast/submit with an Idempotency-Key)', async () => {
    const routes = base({ [`GET ${P}/forecast`]: ok(forecastView()), [`POST ${P}/forecast/submit`]: ok(forecastView({ workingVersion: 4, latestSubmittedVersion: 3 })) });
    const { api, user } = await mount('/forecasts', <ForecastsScreen />, routes);
    await screen.findByText('Working version 3');
    await user.click(screen.getByRole('button', { name: 'Submit version 3 to the fund' }));
    await waitFor(() => expectCalled(api, `POST ${P}/forecast/submit`));
    expectIdempotencyKey(api.calls(`POST ${P}/forecast/submit`)[0]!);
    expect(await screen.findByText('Working version 4')).toBeInTheDocument();
  });

  it('explains an unchanged submission', async () => {
    const routes = base({ [`GET ${P}/forecast`]: ok(forecastView()), [`POST ${P}/forecast/submit`]: fail(409, 'unchanged_forecast', 'No changes since version 2; edit the working version before submitting again') });
    const { user } = await mount('/forecasts', <ForecastsScreen />, routes);
    await screen.findByText('Working version 3');
    await user.click(screen.getByRole('button', { name: 'Submit version 3 to the fund' }));
    expect(await alertText()).toContain('No changes since version 2');
  });

  it('opens a submitted version and shows its frozen P&L', async () => {
    const routes = base({
      [`GET ${P}/forecast`]: ok(forecastView()),
      [`GET ${P}/forecast/versions/1`]: ok({ versionNo: 1, scenario: 'Downside', submittedAt: '2026-08-30T10:00:00.000Z', sha256: 'a'.repeat(64), submittedBy: ME, data: { scenario: 'Downside', cells: {}, pnl: { firstForecastMonth: '2026-09', months: { '2026-09': pnlMonth({ totalRevenue: 777 }) }, annual: pnlMonth({ totalRevenue: 777 }) } } }),
    });
    const { api, user } = await mount('/forecasts', <ForecastsScreen />, routes);
    const versions = await screen.findByRole('region', { name: 'Submitted versions' });
    const rowEl = within(versions).getByText('Version 1').closest('tr') as HTMLElement;
    expect(rowEl.textContent).toContain('aaaaaaaaaaaa');
    await user.click(within(rowEl).getByRole('button', { name: 'View' }));
    await waitFor(() => expectCalled(api, `GET ${P}/forecast/versions/1`));
    expect(await within(versions).findByText('Version 1 (Downside) as submitted')).toBeInTheDocument();
    expect(within(versions).getAllByText('777').length).toBeGreaterThan(0);
  });

  it('locks a month through the workspace lock endpoint', async () => {
    const routes = base({ [`GET ${P}/forecast`]: ok(forecastView()), [`POST ${P}/forecast/lock`]: ok(forecastView()) });
    const { api, user } = await mount('/forecasts', <ForecastsScreen />, routes);
    await screen.findByText('Working version 3');
    await user.click(screen.getByRole('button', { name: 'Lock Dec 2026' }));
    await waitFor(() => expectCalled(api, `POST ${P}/forecast/lock`));
    expectBody(api.calls(`POST ${P}/forecast/lock`)[0]!, { periods: ['2026-12'] });
  });

  it('is read-only when forecast.save is not live', async () => {
    await mount('/forecasts', <ForecastsScreen />, base({ [`GET ${P}/forecast`]: ok(forecastView()) }, ['forecast']));
    await screen.findByText('Working version 3');
    expect(screen.queryByRole('button', { name: 'Save working version' })).toBeNull();
    expect(screen.getByLabelText('Merchant revenue Dec 2026')).toHaveAttribute('readonly');
  });
});

// ------------------------------------------------------------------------------------------------ governance

describe('Governance (CMP-030, BR-218, BR-221)', () => {
  it('shows compliance health with its basis, and the reserved matters with notice periods', async () => {
    await mount('/governance', <GovernanceScreen />, base({ [`GET ${P}/governance`]: ok(governanceView()) }));
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 reports on time in the last 12 months')).toBeInTheDocument();
    const matters = screen.getByRole('region', { name: 'Reserved matters' });
    expect(within(matters).getByText('New debt').closest('tr')!.textContent).toContain('21 days');
    expect(within(matters).getByText('Share capital').closest('tr')!.textContent).toContain('14 days');
  });

  it('says when no reporting obligation fell due', async () => {
    await mount('/governance', <GovernanceScreen />, base({ [`GET ${P}/governance`]: ok(governanceView({ metrics: { pendingConsents: 0, openActions: 0, complianceHealth: { due: 0, onTime: 0, ratio: null } } })) }));
    expect(await screen.findByText('No obligations due')).toBeInTheDocument();
  });

  it('previews the default due date from the chosen matter notice period and posts the consent request', async () => {
    const routes = base({ [`GET ${P}/governance`]: ok(governanceView()), [`POST ${P}/governance/consents`]: ok(governanceView(), 201) });
    const { api, user } = await mount('/governance', <GovernanceScreen />, routes);
    await screen.findByRole('region', { name: 'Request investor consent' });
    await user.type(screen.getByLabelText('Consent title'), 'Revolving facility');
    await user.selectOptions(screen.getByLabelText('Reserved matter'), 'New debt');
    expect(screen.getByText(new RegExp(`due on ${defaultDue(21)} \\(21 days notice\\)`))).toBeInTheDocument();
    await user.type(screen.getByLabelText('Note to the fund'), 'USD 250k facility');
    await user.click(screen.getByRole('button', { name: 'Request consent' }));
    await waitFor(() => expectCalled(api, `POST ${P}/governance/consents`));
    const call = api.calls(`POST ${P}/governance/consents`)[0]!;
    expect(call.body).toEqual({ title: 'Revolving facility', basis: 'New debt', note: 'USD 250k facility' });
    expectIdempotencyKey(call);
  }, 20000);

  it('accepts an "Other" basis and an explicit decision date', async () => {
    const routes = base({ [`GET ${P}/governance`]: ok(governanceView()), [`POST ${P}/governance/consents`]: ok(governanceView(), 201) });
    const { api, user } = await mount('/governance', <GovernanceScreen />, routes);
    await screen.findByRole('region', { name: 'Request investor consent' });
    await user.type(screen.getByLabelText('Consent title'), 'Office lease');
    await user.selectOptions(screen.getByLabelText('Reserved matter'), 'Other');
    await user.type(screen.getByLabelText('Other basis'), 'Material contract');
    await user.type(screen.getByLabelText('Decision needed by'), '2099-01-15');
    await user.click(screen.getByRole('button', { name: 'Request consent' }));
    await waitFor(() => expectCalled(api, `POST ${P}/governance/consents`));
    expect(api.calls(`POST ${P}/governance/consents`)[0]!.body).toEqual({ title: 'Office lease', basis: 'Material contract', due: '2099-01-15' });
  }, 20000);

  it('lists consents with their status, the calendar and board actions', async () => {
    await mount('/governance', <GovernanceScreen />, base({ [`GET ${P}/governance`]: ok(governanceView()) }));
    const consents = await screen.findByRole('region', { name: 'Consent requests' });
    expect(within(consents).getByText('CON-0001').closest('tr')!.textContent).toContain('Approved');
    expect(screen.getByRole('region', { name: 'Governance calendar' }).textContent).toContain('Q3 2026 report');
    expect(screen.getByRole('region', { name: 'Board actions' }).textContent).toContain('Appoint auditor');
  });

  it('shows the consent server error', async () => {
    const routes = base({ [`GET ${P}/governance`]: ok(governanceView()), [`POST ${P}/governance/consents`]: fail(400, 'validation', 'The decision date cannot be in the past') });
    const { user } = await mount('/governance', <GovernanceScreen />, routes);
    await screen.findByRole('region', { name: 'Request investor consent' });
    await user.type(screen.getByLabelText('Consent title'), 'Something');
    await user.selectOptions(screen.getByLabelText('Reserved matter'), 'Share capital');
    await user.click(screen.getByRole('button', { name: 'Request consent' }));
    expect(await alertText()).toContain('The decision date cannot be in the past');
  });
});

// ------------------------------------------------------------------------------------------------ data room

describe('Data room (CMP-038, INO-021, D-15)', () => {
  const vaultDoc = (over: Record<string, unknown> = {}) => ({ id: 'doc_1', ref: 'DOC-0001', name: 'Board deck.pdf', fileName: 'Board deck.pdf', documentType: 'company', type: 'company', uploadedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', status: 'Published', version: 2, ...over });
  const versions = {
    id: 'doc_1',
    ref: 'DOC-0001',
    name: 'Board deck.pdf',
    version: 2,
    versions: [
      { version: 2, fileName: 'Board deck v2.pdf', size: 20480, mime: 'application/pdf', sha256: 'c'.repeat(64), uploadedById: ME, uploadedAt: '2026-09-02T09:00:00.000Z' },
      { version: 1, fileName: 'Board deck.pdf', size: 512, mime: 'application/pdf', sha256: 'd'.repeat(64), uploadedById: ME, uploadedAt: '2026-09-01T09:00:00.000Z' },
    ],
  };
  const vaultRoutes = (over: Routes = {}) =>
    base({
      [`GET ${P}/vault`]: ok({ documents: [vaultDoc(), vaultDoc({ id: 'doc_2', ref: 'DOC-0002', name: 'Payroll.xlsx', fileName: 'Payroll.xlsx', version: 1 })] }),
      [`GET ${P}/vault/:id/versions`]: ok(versions),
      [`GET ${P}/vault/:id/download-url`]: (r) => ok({ url: `http://api.test/api/v1/files/f1/download?exp=1&sig=x${r.query.get('inline') ? '&inline=1' : ''}`, expiresIn: 300, name: 'Board deck v2.pdf', version: 2, inline: r.query.get('inline') === '1' }),
      ...over,
    });

  it('lists documents with their version and offers preview only for previewable types', async () => {
    await mount('/data-room', <DataRoomScreen />, vaultRoutes());
    const docRow = (await screen.findByText('DOC-0001')).closest('tr') as HTMLElement;
    expect(docRow.textContent).toContain('v2');
    expect(within(docRow).getByRole('button', { name: 'Preview Board deck.pdf' })).toBeInTheDocument();
    const xlsRow = screen.getByText('DOC-0002').closest('tr') as HTMLElement;
    expect(within(xlsRow).queryByRole('button', { name: /Preview/ })).toBeNull();
    expect(within(xlsRow).getByRole('button', { name: 'Download Payroll.xlsx' })).toBeInTheDocument();
  });

  it('downloads through a signed link and previews with inline=1 in a new tab', async () => {
    const stubs = installBrowserStubs();
    const opened: string[] = [];
    const origOpen = window.open;
    window.open = ((url: string) => {
      opened.push(url);
      return null;
    }) as typeof window.open;
    const clicked: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(`${this.download}|${this.href}`);
    };
    try {
      const { api, user } = await mount('/data-room', <DataRoomScreen />, vaultRoutes());
      await user.click(await screen.findByRole('button', { name: 'Download Board deck.pdf' }));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toContain('Board deck v2.pdf|http://api.test/api/v1/files/f1/download');
      await user.click(screen.getByRole('button', { name: 'Preview Board deck.pdf' }));
      await waitFor(() => expect(opened).toHaveLength(1));
      expect(opened[0]).toContain('inline=1');
      const calls = api.calls(`GET ${P}/vault/:id/download-url`);
      expect(calls[0]!.query.get('inline')).toBeNull();
      expect(calls[1]!.query.get('inline')).toBe('1');
    } finally {
      window.open = origOpen;
      HTMLAnchorElement.prototype.click = origClick;
      stubs.restore();
    }
  });

  it('shows the version history, downloads an older version and uploads a new version', async () => {
    const routes = vaultRoutes({ [`POST ${P}/vault/:id/versions`]: ok({ ...versions, version: 3, versions: [{ ...versions.versions[0]!, version: 3, fileName: 'Board deck v3.pdf' }, ...versions.versions] }, 201) });
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    try {
      const { api, user } = await mount('/data-room', <DataRoomScreen />, routes);
      await user.click(await screen.findByRole('button', { name: 'Versions of Board deck.pdf' }));
      const panel = await screen.findByRole('region', { name: 'Versions of Board deck.pdf' });
      expect(within(panel).getByText('v2 (current)')).toBeInTheDocument();
      expect(within(panel).getByText('20.0 KB')).toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Download version 1' }));
      await waitFor(() => expect(api.calls(`GET ${P}/vault/:id/download-url`).at(-1)!.query.get('version')).toBe('1'));
      const file = new File(['%PDF-1.4 new'], 'Board deck v3.pdf', { type: 'application/pdf' });
      await user.upload(within(panel).getByLabelText('New version file'), file);
      await waitFor(() => expectCalled(api, `POST ${P}/vault/:id/versions`));
      const post = api.calls(`POST ${P}/vault/:id/versions`)[0]!;
      expect(post.path.endsWith('/vault/doc_1/versions')).toBe(true);
      expect(post.body).toBeInstanceOf(FormData);
      expect(((post.body as FormData).get('file') as File).name).toBe('Board deck v3.pdf');
      expectIdempotencyKey(post);
      expect(await within(panel).findByText('v3 (current)')).toBeInTheDocument();
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  }, 20000);

  it('withdraws a document only with a reason, then reloads the list', async () => {
    const routes = vaultRoutes({ [`POST ${P}/vault/:id/withdraw`]: ok({ id: 'doc_2', status: 'Withdrawn' }) });
    const { api, user } = await mount('/data-room', <DataRoomScreen />, routes);
    await user.click(await screen.findByRole('button', { name: 'Withdraw Payroll.xlsx' }));
    const form = screen.getByRole('region', { name: 'Withdraw Payroll.xlsx' });
    expect(within(form).getByRole('button', { name: 'Withdraw' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Reason for withdrawing'), 'Uploaded by mistake');
    await user.click(within(form).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expectCalled(api, `POST ${P}/vault/:id/withdraw`));
    expectBody(api.calls(`POST ${P}/vault/:id/withdraw`)[0]!, { reason: 'Uploaded by mistake' });
    await waitFor(() => expect(statusText()).toContain('Payroll.xlsx withdrawn from the workspace'));
    expect(api.calls(`GET ${P}/vault`).length).toBe(2);
  }, 20000);

  it('explains a refusal (legal hold)', async () => {
    const routes = vaultRoutes({ [`POST ${P}/vault/:id/withdraw`]: fail(409, 'legal_hold', 'This document is on legal hold and cannot be withdrawn') });
    const { user } = await mount('/data-room', <DataRoomScreen />, routes);
    await user.click(await screen.findByRole('button', { name: 'Withdraw Board deck.pdf' }));
    await user.type(screen.getByLabelText('Reason for withdrawing'), 'Old');
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await alertText()).toContain('on legal hold');
  });

  it('uploads a document with an optional name', async () => {
    const routes = vaultRoutes({ [`POST ${P}/vault`]: ok(vaultDoc({ id: 'doc_3' }), 201) });
    const { api, user } = await mount('/data-room', <DataRoomScreen />, routes);
    await screen.findByText('DOC-0001');
    await user.upload(screen.getByLabelText('File'), new File(['%PDF-1.4'], 'Minutes.pdf', { type: 'application/pdf' }));
    await user.type(screen.getByLabelText('Document name'), 'September minutes');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expectCalled(api, `POST ${P}/vault`));
    const form = api.calls(`POST ${P}/vault`)[0]!.body as FormData;
    expect((form.get('file') as File).name).toBe('Minutes.pdf');
    expect(form.get('name')).toBe('September minutes');
  }, 20000);

  it('hides upload, new version and withdraw when vault.upload is not live', async () => {
    await mount('/data-room', <DataRoomScreen />, base({ [`GET ${P}/vault`]: ok({ documents: [vaultDoc()] }) }, ['vault']));
    await screen.findByText('DOC-0001');
    expect(screen.queryByRole('region', { name: 'Upload a document' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
  });
});

describe('helpers', () => {
  it('healthTone grades the on-time ratio', () => {
    expect(healthTone(null)).toBe('neutral');
    expect(healthTone(100)).toBe('good');
    expect(healthTone(85)).toBe('warn');
    expect(healthTone(50)).toBe('bad');
  });
  it('defaultDue adds the notice days', () => {
    expect(defaultDue(14, new Date('2026-10-01T12:00:00Z'))).toBe('2026-10-15');
  });
});
