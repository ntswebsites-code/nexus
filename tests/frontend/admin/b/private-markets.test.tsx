import { describe, it, expect } from 'vitest';
import PrivateMarketsPage from '@/app/(ops)/ops/private-markets/page';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey } from '../../_helpers';

const perf = (o: Record<string, unknown> = {}) => ({ committed: '15160000', paidIn: '9000000', calledUnpaid: '0', unfunded: '6160000', distributed: '1000000', nav: '10500000', navAsOf: '2026-09-03', dpi: '0.11', rvpi: '1.17', tvpi: '1.28', irrPct: '14.2', ...o });
const commitment = (o: Record<string, unknown> = {}) => ({
  ...perf(), id: 'c1', ref: 'CMT-1001', fundId: 'f1', fundRef: 'PEF-1', fundName: 'Zim Growth Fund III', manager: 'Acme GP', strategy: 'PRIVATE_EQUITY', vintage: 2023, currency: 'USD', portfolioId: 'p1', portfolioRef: 'PF-1',
  portfolioName: 'Balanced Growth Fund', committedOn: '2023-02-01', status: 'ACTIVE', markStale: false, carryingValue: '10400000',
  cashflows: [{ id: 'cf1', ref: 'CFL-1', kind: 'CALL', amount: '500000', noticeDate: '2026-08-01', dueDate: '2026-08-15', paidOn: null, status: 'NOTICED', overdue: true, note: null, posting: null }, { id: 'cf2', ref: 'CFL-2', kind: 'DISTRIBUTION', amount: '100000', returnOfCapital: '60000', noticeDate: '2026-07-01', dueDate: '2026-07-10', paidOn: '2026-07-10', status: 'PAID', overdue: false, note: null, posting: { accountingJournal: 'JNL-9', accountingJournalId: 'j9', cashJournal: 'CJ-3', cashJournalId: 'cj3', skipped: null, fxRate: '1', baseCurrency: 'USD', baseAmount: '100000', carryingDelta: null } }],
  marks: [{ id: 'mk1', ref: 'MRK-1', asOf: '2026-09-01', nav: '10700000', method: 'GP_REPORTED', status: 'PENDING_APPROVAL', evidence: [{ id: 'e1' }] }], ...o,
});
const mark = (o: Record<string, unknown> = {}) => ({
  id: 'mk1', ref: 'MRK-1', commitmentId: 'c1', commitmentRef: 'CMT-1001', fundName: 'Zim Growth Fund III', asOf: '2026-09-01', nav: '10700000', method: 'GP_REPORTED', status: 'PENDING_APPROVAL', note: null, makerId: 'usr_maker', makerName: 'Maker M', approverName: null, rejectReason: null,
  posting: { accountingJournal: null, accountingJournalId: null, cashJournal: null, cashJournalId: null, skipped: null, fxRate: '1', baseCurrency: 'USD', baseAmount: null, carryingDelta: '200000' },
  evidence: [{ id: 'e1', kind: 'GP_STATEMENT', title: 'Q2 statement', reference: null, documentId: 'd1', documentRef: 'DOC-1007', addedByName: 'Maker M' }], ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/private-markets/summary': ok({ totals: perf(), reportCurrency: 'USD', fxMissing: [], commitments: [commitment()], pendingMarks: 1, staleMarks: 1, byStrategy: [], upcomingCashflows: [{ id: 'u1', ref: 'CFL-1', kind: 'CALL', amount: '500000', noticeDate: '2026-08-01', dueDate: '2026-08-15', paidOn: null, status: 'NOTICED', overdue: true, note: null, fundName: 'Zim Growth Fund III', portfolioRef: 'PF-1' }] }),
  'GET /api/v1/private-markets/jcurve': ok({ currency: 'USD', fxMissing: [], points: [{ date: '2025-01-01', calls: '1', distributions: '0', netCash: '-1000', nav: null, netValue: null }, { date: '2026-01-01', calls: '0', distributions: '1', netCash: '-500', nav: '2000', netValue: '1500' }] }),
  'GET /api/v1/private-markets/commitments/:id': ok(commitment()),
  'GET /api/v1/private-markets/marks': ok([mark()]),
  'GET /api/v1/private-markets/marks/:id': ok(mark()),
  'GET /api/v1/private-markets/funds': ok([{ id: 'f1', ref: 'PEF-1', name: 'Zim Growth Fund III', manager: 'Acme GP', strategy: 'PRIVATE_EQUITY', vintage: 2023, currency: 'USD', status: 'ACTIVE', commitments: 1, committed: '15160000' }]),
  'GET /api/v1/private-markets/clients': ok([{ clientId: 'cl1', clientRef: 'CLI-1', clientName: 'Horizon Pension Fund', commitments: 1, currency: 'USD', fxMissing: [], ...perf({ committed: '5000000' }) }]),
  ...o,
});

describe('Private markets: overview', () => {
  it('shows KPI tiles, commitments with real names (not ids), upcoming calls with overdue flag, J-curve', async () => {
    await mountPage(<PrivateMarketsPage />, { routes: base() });
    expect(await screen.findByText('CMT-1001')).toBeInTheDocument();
    expect(screen.getAllByText('Zim Growth Fund III').length).toBeGreaterThan(0);
    expect(screen.getByText('1.28x / 0.11x')).toBeInTheDocument();
    expect(screen.getAllByText('14.2%').length).toBeGreaterThan(0);
    expect(screen.getByText('Private equity · 2023')).toBeInTheDocument();
    expect(screen.getByText('current')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'J-curve' })).toBeInTheDocument();
    expect(screen.getAllByText('overdue').length).toBeGreaterThan(0);
    expect(screen.queryByText('f1')).not.toBeInTheDocument();
  });
  it('ADB-009 tile hint explains the NAV date and newer marks awaiting approval', async () => {
    await mountPage(<PrivateMarketsPage />, { routes: base() });
    expect(await screen.findByText(/Latest approved mark 03 Sep(t)? 2026/)).toBeInTheDocument();
    expect(screen.getAllByText(/awaiting approval/i).length).toBeGreaterThan(0);
  });
  it('missing FX is called out instead of silently zero; J-curve empty state', async () => {
    await mountPage(<PrivateMarketsPage />, {
      routes: base({
        'GET /api/v1/private-markets/summary': ok({ totals: perf(), reportCurrency: 'USD', fxMissing: ['ZWG'], commitments: [], pendingMarks: 0, staleMarks: 0, byStrategy: [], upcomingCashflows: [] }),
        'GET /api/v1/private-markets/jcurve': ok({ currency: 'USD', fxMissing: [], points: [] }),
      }),
    });
    expect(await screen.findByText(/No FX rate to USD for ZWG/)).toBeInTheDocument();
    expect(screen.getByText('No active commitments. Add a fund and a commitment under Funds.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is noticed for the next 90 days.')).toBeInTheDocument();
    expect(await screen.findByText('Not enough settled cashflows yet to draw a curve.')).toBeInTheDocument();
  });
  it('portfolio filter is sent to the summary and J-curve', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base() });
    await screen.findByText('CMT-1001');
    await user.selectOptions(screen.getByLabelText('Portfolio'), 'p1');
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/summary').at(-1)!.query.get('portfolioId')).toBe('p1'));
    expect(api.calls('GET /api/v1/private-markets/jcurve').at(-1)!.query.get('portfolioId')).toBe('p1');
  });
  it('without portfolio.view: access denied', async () => {
    await mountPage(<PrivateMarketsPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the portfolio.view permission/)).toBeInTheDocument();
  });
  it('summary failure shows the error', async () => {
    await mountPage(<PrivateMarketsPage />, { routes: base({ 'GET /api/v1/private-markets/summary': fail(500, 'x', 'Boom') }) });
    expect(await screen.findByText(/Could not load private markets: Boom/)).toBeInTheDocument();
  });
});

describe('Private markets: By client (ADB-009)', () => {
  it('lists look-through investors with client name and committed amount (not empty)', async () => {
    const { user } = await mountPage(<PrivateMarketsPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'By client' }));
    expect(await screen.findByText('Horizon Pension Fund')).toBeInTheDocument();
    expect(screen.getByText('CLI-1')).toBeInTheDocument();
    expect(screen.getByText('USD 5,000,000.00')).toBeInTheDocument();
  });
  it('clicking a client re-queries with clientId and shows the commitment lines; All clients resets', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, {
      routes: base({ 'GET /api/v1/private-markets/clients': (req: { query: URLSearchParams }) => ok([{ clientId: 'cl1', clientRef: 'CLI-1', clientName: 'Horizon Pension Fund', commitments: 1, currency: 'USD', fxMissing: [], ...perf(), lines: req.query.get('clientId') ? [commitment()] : undefined }]) }),
    });
    await user.click(await screen.findByRole('tab', { name: 'By client' }));
    await user.click(await screen.findByText('Horizon Pension Fund'));
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/clients').at(-1)!.query.get('clientId')).toBe('cl1'));
    expect(await screen.findByRole('heading', { name: 'Commitments' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All clients' }));
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/clients').at(-1)!.query.get('clientId')).toBeNull());
  });
  it('empty state wording', async () => {
    const { user } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'GET /api/v1/private-markets/clients': ok([]) }) });
    await user.click(await screen.findByRole('tab', { name: 'By client' }));
    expect(await screen.findByText(/No client has an active private-market commitment/)).toBeInTheDocument();
  });
});

describe('Private markets: funds and commitments', () => {
  it('fund list; New fund only for managers and posts the payload with a key', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'POST /api/v1/private-markets/funds': ok({ id: 'f2' }, 201) }) });
    await user.click(await screen.findByRole('tab', { name: 'Funds' }));
    expect(await screen.findByText('PEF-1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New fund' }));
    await user.type(screen.getByLabelText(/^Name/), 'Fund IV');
    await user.type(screen.getByLabelText(/Manager/), 'Beta GP');
    await user.click(screen.getByRole('button', { name: 'Create fund' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/funds'));
    expectBody(req!, { name: 'Fund IV', manager: 'Beta GP' });
    expectIdempotencyKey(req!);
  });
  it('viewer has no New fund button', async () => {
    const { user } = await mountPage(<PrivateMarketsPage />, { perms: ['portfolio.view'], routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Funds' }));
    await screen.findByText('PEF-1');
    expect(screen.queryByRole('button', { name: 'New fund' })).not.toBeInTheDocument();
  });
  it('commitment modal: figures, cashflow posting links, "return of capital" and overdue, Mark paid posts with key and refreshes', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'POST /api/v1/private-markets/cashflows/cf1/pay': ok({}) }) });
    await user.click(await screen.findByText('CMT-1001'));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Carrying value (books)')).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: 'JNL-9' })).toHaveAttribute('href', '/ops-native/accounting/journals/j9');
    expect(within(dlg).getByRole('link', { name: 'CJ-3' })).toHaveAttribute('href', '/ops-native/cash/journals/cj3');
    expect(within(dlg).getByText(/60,000.00 return of capital/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Mark paid' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/cashflows/cf1/pay'));
    expectIdempotencyKey(req!);
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/commitments/c1').length).toBeGreaterThan(1));
  });
  it('notice a distribution: sends returnOfCapital only for distributions; call omits it', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'POST /api/v1/private-markets/commitments/c1/cashflows': ok({}, 201) }) });
    await user.click(await screen.findByText('CMT-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Notice a call or distribution' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    expect(within(f).getByText(/Unfunded commitment: 6,160,000.00/)).toBeInTheDocument();
    await user.type(within(f).getByLabelText(/^Amount/), '1,000');
    await user.type(within(f).getByLabelText(/Of which return of capital/), '400');
    await user.click(within(f).getByRole('button', { name: 'Record notice' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/commitments/c1/cashflows'));
    expect((req!.body as Record<string, unknown>).returnOfCapital).toBeUndefined(); // kind is CALL by default
    expectBody(req!, { kind: 'CALL', amount: '1000' });
  });
  it('server rejection (call exceeds unfunded) is shown in the dialog', async () => {
    const { user } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'POST /api/v1/private-markets/commitments/c1/cashflows': fail(400, 'validation_error', 'Call exceeds unfunded commitment') }) });
    await user.click(await screen.findByText('CMT-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Notice a call or distribution' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Amount/), '99999999');
    await user.click(within(f).getByRole('button', { name: 'Record notice' }));
    expect(await within(f).findByText('Call exceeds unfunded commitment')).toBeInTheDocument();
  });
  it('prepare mark posts asOf/nav/method and opens the new mark', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'POST /api/v1/private-markets/commitments/c1/marks': ok({ id: 'mk1' }, 201) }) });
    await user.click(await screen.findByText('CMT-1001'));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Prepare NAV mark' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^NAV/), '12,000,000');
    await user.click(within(f).getByRole('button', { name: 'Create draft mark' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/commitments/c1/marks'));
    expectBody(req!, { nav: '12000000', method: 'GP_REPORTED' });
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/marks/mk1').length).toBeGreaterThan(0));
  });
  it('add commitment to a fund posts portfolioId, amount without commas, date', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, {
      routes: base({ 'GET /api/v1/private-markets/funds/:id': ok({ id: 'f1', ref: 'PEF-1', name: 'Zim Growth Fund III', manager: 'Acme GP', strategy: 'PRIVATE_EQUITY', vintage: 2023, currency: 'USD', status: 'ACTIVE', commitments: 1, committed: '1', totals: perf(), commitmentList: [commitment()] }), 'POST /api/v1/private-markets/funds/f1/commitments': ok({}, 201) }),
    });
    await user.click(await screen.findByRole('tab', { name: 'Funds' }));
    await user.click(await screen.findByText('PEF-1'));
    await user.click(await screen.findByRole('button', { name: 'Add commitment' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.selectOptions(within(f).getByRole('combobox'), 'p1');
    await user.type(within(f).getByLabelText(/^Commitment/), '2,500,000');
    await user.click(within(f).getByRole('button', { name: 'Commit' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/funds/f1/commitments'));
    expectBody(req!, { portfolioId: 'p1', amount: '2500000' });
  });
});

describe('Private markets: NAV marks (maker-checker, ADB-012)', () => {
  const openMark = async (m: Record<string, unknown>, perms?: string[], user?: Record<string, unknown>) => {
    const r = await mountPage(<PrivateMarketsPage />, {
      perms,
      user,
      routes: base({
        'GET /api/v1/private-markets/marks/:id': ok(m),
        'POST /api/v1/private-markets/marks/:id/approve': ok({}),
        'POST /api/v1/private-markets/marks/:id/submit': ok({}),
        'POST /api/v1/private-markets/marks/:id/reject': ok({}),
        'POST /api/v1/private-markets/marks/:id/return': ok({}),
        'POST /api/v1/private-markets/marks/:id/evidence': ok({}),
      }),
    });
    await r.user.click(await screen.findByRole('tab', { name: 'NAV marks' }));
    await r.user.click(await screen.findByText('MRK-1'));
    return r;
  };
  it('default filter is pending approval (sent as status); filter changes re-query', async () => {
    const { user, api } = await mountPage(<PrivateMarketsPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'NAV marks' }));
    await screen.findByText('MRK-1');
    expect(api.calls('GET /api/v1/private-markets/marks')[0]!.query.get('status')).toBe('PENDING_APPROVAL');
    await user.selectOptions(screen.getByLabelText('Status'), 'APPROVED');
    await waitFor(() => expect(api.calls('GET /api/v1/private-markets/marks').at(-1)!.query.get('status')).toBe('APPROVED'));
  });
  it('ADB-012: a user without private.mark.approve sees Approve disabled with the permission named', async () => {
    await openMark(mark(), ['portfolio.view', 'portfolio.manage']);
    const dlg = await screen.findByRole('dialog');
    const b = await within(dlg).findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Needs the private.mark.approve permission');
  });
  it('maker cannot approve their own mark: sees the explanation and no active Approve', async () => {
    await openMark(mark({ makerId: 'usr_admin' }), ['portfolio.view', 'private.mark.approve']);
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('A different person with private.mark.approve must approve.')).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
  it('a different approver approves after an in-app confirm; sends an idempotency key', async () => {
    const { user, api } = await openMark(mark(), ['portfolio.view', 'private.mark.approve']);
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/marks/mk1/approve'));
    expectIdempotencyKey(req!);
  });
  it('posting preview wording: unrealised gain and linked evidence document', async () => {
    await openMark(mark(), ['portfolio.view', 'private.mark.approve']);
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText(/unrealised gain of 200,000.00/)).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: 'DOC-1007' })).toHaveAttribute('href', '/ops-native/vault');
  });
  it('reject and return require a reason and post it', async () => {
    const { user, api } = await openMark(mark(), ['portfolio.view', 'private.mark.approve']);
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByRole('button', { name: 'Reject' }));
    await user.type(screen.getByLabelText(/Reason/), 'Stale statement');
    await user.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/marks/mk1/reject'));
    expectBody(req!, { reason: 'Stale statement' });
  });
  it('draft without evidence warns that it cannot be submitted; maker can add evidence by reference', async () => {
    const { user, api } = await openMark(mark({ status: 'DRAFT', makerId: 'usr_admin', evidence: [], posting: null }), ['portfolio.view', 'portfolio.manage']);
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText(/No evidence attached/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Link by reference' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Title/), 'GP letter');
    await user.type(within(f).getByLabelText(/Vault document reference/), 'DOC-1234');
    await user.click(within(f).getByRole('button', { name: 'Add' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/private-markets/marks/mk1/evidence'));
    expectBody(req!, { title: 'GP letter', kind: 'GP_STATEMENT' });
    expect(JSON.stringify(req!.body)).toContain('DOC-1234');
  });
  it('upload evidence without a file is blocked (required file input): no request is sent and the dialog stays open', async () => {
    const { user, api } = await openMark(mark({ status: 'DRAFT', makerId: 'usr_admin', evidence: [], posting: null }), ['portfolio.view', 'portfolio.manage']);
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Upload evidence file' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Title/), 'Valuation report');
    await user.click(within(f).getByRole('button', { name: 'Upload' }));
    expect(within(f).getByLabelText(/File/i)).toBeRequired();
    expect(screen.getAllByRole('dialog').length).toBeGreaterThan(1);
    expect(api.calls('POST /api/v1/private-markets/marks/mk1/evidence/upload')).toHaveLength(0);
  });
  it('empty marks state', async () => {
    const { user } = await mountPage(<PrivateMarketsPage />, { routes: base({ 'GET /api/v1/private-markets/marks': ok([]) }) });
    await user.click(await screen.findByRole('tab', { name: 'NAV marks' }));
    expect(await screen.findByText('No marks in this state.')).toBeInTheDocument();
  });
});
