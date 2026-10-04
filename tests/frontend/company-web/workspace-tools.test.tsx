import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { screen, waitFor, within, mockApi, expectCalled, expectNotCalled, expectBody, expectIdempotencyKey, fail, ok, raw, type Routes } from '../_helpers';
import { WorkspaceTools } from '@/components/WorkspaceTools';
import { installBrowserStubs } from './_portal';
import { P } from './_fixtures';

/**
 * Workspace tools (/workspace): cap-table transactions with maker-checker, board packs and forecast locks,
 * signature requests, share links, KPI export and access review. Shapes follow
 * backend/api/src/modules/investee-portal/workspace/*.ts.
 */

const W = `${P}`;
const ME = 'usr_tariro';

const tx = (over: Record<string, unknown> = {}) => ({
  id: 'CTX-0006',
  makerId: 'usr_chipo',
  kind: 'ISSUANCE',
  status: 'PENDING_APPROVAL',
  holder: 'Angel Fund',
  fromHolder: null,
  className: 'Ordinary',
  shares: 50000,
  consideration: 100000,
  currency: 'USD',
  effectiveDate: '2026-09-15',
  maker: 'Chipo Dube',
  glStatus: 'NONE',
  glRef: null,
  glNote: null,
  ...over,
});

const cap = (over: Record<string, unknown> = {}) => ({
  derived: false,
  pendingTransactions: 1,
  shareholders: [
    { id: 'h1', name: 'Founders Pool', type: 'Ordinary', shares: 700000, pct: 70 },
    { id: 'h2', name: 'Matanho Growth Partners I', type: 'Series A Preferred', shares: 300000, pct: 30 },
  ],
  classes: [{ id: 'c1', name: 'Ordinary', outstanding: 700000, preference: 'None' }],
  ...over,
});

const doc = { id: 'doc_1', name: 'Shareholder agreement' };

function routes(over: Routes = {}): Routes {
  return {
    'GET /api/v1/platform/flags': raw({ lp: {}, investee: { liveActions: ['all'] }, custodian: { live: false }, onboarding: { live: false } }),
    'GET /api/auth/me': raw({ user: { id: ME, email: 'tariro@kuda.test', name: 'Tariro Moyo', roles: [], permissions: [], createdAt: '2026-01-01T00:00:00.000Z' } }),
    [`GET ${W}/vault`]: ok({ documents: [doc] }),
    [`GET ${W}/cap-table`]: ok(cap()),
    [`GET ${W}/cap-table/transactions`]: ok({ transactions: [tx(), tx({ id: 'CTX-0007', makerId: ME, maker: 'Tariro Moyo', holder: 'ESOP', shares: 1000, consideration: 0 })] }),
    [`GET ${W}/cap-table/certificates`]: ok({ certificates: [{ id: 'CERT-001', holder: 'Founders Pool', className: 'Ordinary', shares: 700000, issuedOn: '2026-01-01', sha256: 'a'.repeat(64) }] }),
    ...over,
  };
}

async function open(r: Routes = routes()) {
  const api = mockApi(r);
  const user = userEvent.setup();
  render(<WorkspaceTools />);
  await waitFor(() => expect(api.calls(`GET ${W}/vault`).length).toBeGreaterThan(0));
  return { api, user };
}
const tab = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));
const status = () => screen.getByRole('status', { name: '' }).textContent;
const alertText = async () => (await screen.findAllByRole('status')).map((n) => n.textContent).join(' | ');
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

beforeEach(() => {
  installBrowserStubs();
});

describe('Workspace tools shell', () => {
  it('shows a clear blocked message when the workspace action is not live (no API calls to workspace)', async () => {
    const api = mockApi(routes({ 'GET /api/v1/platform/flags': raw({ investee: { liveActions: ['dashboard'] } }) }));
    render(<WorkspaceTools />);
    expect(await screen.findByText(/Workspace tools are not enabled for this environment/)).toBeInTheDocument();
    expectNotCalled(api, `GET ${W}/cap-table`);
    expectNotCalled(api, `GET ${W}/vault`);
  });

  it('shows a reload message when the flags call fails', async () => {
    mockApi(routes({ 'GET /api/v1/platform/flags': fail(500, 'internal', 'boom') }));
    render(<WorkspaceTools />);
    expect(await screen.findByText('Live settings could not be loaded. Reload the page.')).toBeInTheDocument();
  });

  it('has a link back to the portal and six sections; search needs two characters then lists hits with their page link', async () => {
    const { api, user } = await open(
      routes({ [`GET ${W}/search`]: ok({ hits: [{ type: 'share_link', id: 'h9', title: 'Shareholder agreement', subtitle: 'Shared with Angel Fund', page: '/data-room' }] }) }),
    );
    expect(screen.getByRole('link', { name: 'Back to the portal' })).toHaveAttribute('href', '/');
    for (const t of ['Cap table', 'Board and forecast', 'Signature requests', 'Share links', 'KPIs and export', 'Access and MFA']) {
      expect(screen.getByRole('button', { name: t })).toBeInTheDocument();
    }
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toBeDisabled();
    await user.type(screen.getByLabelText('Search the workspace'), 'sh');
    expect(search).toBeEnabled();
    await user.click(search);
    const [req] = expectCalled(api, `GET ${W}/search`);
    expect(req.query.get('q')).toBe('sh');
    expect(await screen.findByText('Search results (1)')).toBeInTheDocument();
    expect(screen.getByText('share link')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/data-room');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Search results (1)')).toBeNull();
  });
});

describe('INO-007/INO-008/INO-013: cap table register, transactions, maker-checker', () => {
  it('INO-013: tables say Loading until data arrives, never "Nothing recorded yet" first', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = mockApi(routes({ [`GET ${W}/cap-table/transactions`]: async () => { await gate; return ok({ transactions: [] }); } }));
    render(<WorkspaceTools />);
    await waitFor(() => expect(api.calls(`GET ${W}/cap-table/transactions`)).toHaveLength(1));
    const section = screen.getByRole('heading', { name: 'Transactions' }).closest('section') as HTMLElement;
    expect(within(section).getByText('Loading...')).toBeInTheDocument();
    expect(within(section).queryByText('Nothing recorded yet.')).toBeNull();
    release();
    expect(await within(section).findByText('Nothing recorded yet.')).toBeInTheDocument();
  });

  it('renders the register with holder names (not ids), class, share counts and percentages, plus the pending banner and certificates', async () => {
    await open();
    const regSection = screen.getByRole('heading', { name: 'Register' }).closest('section') as HTMLElement;
    const reg = (await within(regSection).findByText('Founders Pool')).closest('tr') as HTMLElement;
    expect(reg.textContent).toContain('700,000');
    expect(reg.textContent).toContain('70%');
    expect(within(regSection).getByText('Matanho Growth Partners I').closest('tr')!.textContent).toContain('Series A Preferred');
    expect(await screen.findByText('1 transaction(s) wait for approval.')).toBeInTheDocument();
    const cert = (await screen.findByText('CERT-001')).closest('tr') as HTMLElement;
    expect(cert.textContent).toContain('aaaaaaaaaaaa');
  });

  it('a derived register is labelled as an estimate from the term sheet', async () => {
    await open(routes({ [`GET ${W}/cap-table`]: ok(cap({ derived: true })) }));
    expect(await screen.findByText('Register (estimated from the term sheet)')).toBeInTheDocument();
  });

  it('maker sees Withdraw (and "Entered by you") on their own pending entry; others get Approve/Reject', async () => {
    await open();
    const own = (await screen.findByText('CTX-0007')).closest('tr') as HTMLElement;
    expect(within(own).getByText('Entered by you')).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Approve' })).toBeNull();
    const other = screen.getByText('CTX-0006').closest('tr') as HTMLElement;
    expect(within(other).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(other.textContent).toContain('pending approval');
    expect(other.textContent).toContain('USD 100,000');
  });

  it('INO-008: Withdraw posts /cap-table/transactions/:ref/withdraw with an Idempotency-Key, confirms and re-fetches the register', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/withdraw`]: ok({ id: 'CTX-0007', status: 'WITHDRAWN' }) }));
    await user.click(within((await screen.findByText('CTX-0007')).closest('tr') as HTMLElement).getByRole('button', { name: 'Withdraw' }));
    const [req] = expectCalled(api, `POST ${W}/cap-table/transactions/:ref/withdraw`);
    expect(req.path.endsWith('/CTX-0007/withdraw')).toBe(true);
    expectIdempotencyKey(req);
    expect(await screen.findByText('Transaction withdrawn')).toBeInTheDocument();
    await waitFor(() => expect(api.calls(`GET ${W}/cap-table/transactions`).length).toBe(2));
    expect(api.calls(`GET ${W}/cap-table`).length).toBe(2);
  });

  it('INO-008: double-clicking Withdraw does not send two requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/withdraw`]: async () => { await gate; return ok({ id: 'CTX-0007', status: 'WITHDRAWN' }); } }));
    const btn = within((await screen.findByText('CTX-0007')).closest('tr') as HTMLElement).getByRole('button', { name: 'Withdraw' });
    await user.dblClick(btn);
    release();
    expect(await screen.findByText('Transaction withdrawn')).toBeInTheDocument();
    expect(api.calls(`POST ${W}/cap-table/transactions/:ref/withdraw`)).toHaveLength(1);
  });

  it('INO-008: withdrawing a transaction that was already decided shows the API conflict message', async () => {
    const { user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/withdraw`]: fail(409, 'invalid_state', 'A APPROVED transaction cannot be withdrawn') }));
    await user.click(within((await screen.findByText('CTX-0007')).closest('tr') as HTMLElement).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText(/cannot be withdrawn/)).toBeInTheDocument();
  });

  it('Approve posts decision APPROVE and refreshes; Reject posts REJECT', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/decide`]: ok({ id: 'CTX-0006', status: 'APPROVED' }) }));
    const row = (await screen.findByText('CTX-0006')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Approve' }));
    let calls = expectCalled(api, `POST ${W}/cap-table/transactions/:ref/decide`);
    expect(calls[0].path.endsWith('/CTX-0006/decide')).toBe(true);
    expectBody(calls[0], { decision: 'APPROVE' });
    expectIdempotencyKey(calls[0]);
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    await user.click(within(screen.getByText('CTX-0006').closest('tr') as HTMLElement).getByRole('button', { name: 'Reject' }));
    calls = api.calls(`POST ${W}/cap-table/transactions/:ref/decide`);
    expect(calls).toHaveLength(2);
    expectBody(calls[1], { decision: 'REJECT' });
  });

  it('INO-017: approving without a fresh factor opens the step-up dialog, confirms the code and replays the approval', async () => {
    let n = 0;
    const { api, user } = await open(
      routes({
        [`POST ${W}/cap-table/transactions/:ref/decide`]: () => (++n === 1 ? fail(401, 'step_up_required', 'Confirm your authentication code to continue') : ok({ id: 'CTX-0006', status: 'APPROVED' })),
        'POST /api/auth/mfa/step-up': raw({ ok: true }),
      }),
    );
    await user.click(within((await screen.findByText('CTX-0006')).closest('tr') as HTMLElement).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent("Confirm it's you");
    expect(dialog).toHaveTextContent('Confirm your authentication code to continue');
    await user.type(screen.getByLabelText('Authentication code'), '12');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/auth/mfa/step-up');
    await user.type(screen.getByLabelText('Authentication code'), '3456');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expectBody(expectCalled(api, 'POST /api/auth/mfa/step-up')[0], { code: '123456' });
    expect(api.calls(`POST ${W}/cap-table/transactions/:ref/decide`)).toHaveLength(2);
    // the replay reuses the same Idempotency-Key as the first attempt
    const [a, b] = api.calls(`POST ${W}/cap-table/transactions/:ref/decide`);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('INO-017: no authenticator enrolled -> the dialog starts enrolment and shows the setup key', async () => {
    let n = 0;
    const { api, user } = await open(
      routes({
        [`POST ${W}/cap-table/transactions/:ref/decide`]: () => (++n === 1 ? fail(401, 'mfa_enrolment_required', 'Set up two-factor sign-in first') : ok({ id: 'CTX-0006' })),
        'POST /api/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }),
        'POST /api/auth/mfa/verify': raw({ user: { id: ME } }),
      }),
    );
    await user.click(within((await screen.findByText('CTX-0006')).closest('tr') as HTMLElement).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByTestId('mfa-setup-key')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expectCalled(api, 'POST /api/auth/mfa/enroll');
    await user.type(screen.getByLabelText('Authentication code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expectBody(expectCalled(api, 'POST /api/auth/mfa/verify')[0], { code: '654321' });
    expect(api.calls(`POST ${W}/cap-table/transactions/:ref/decide`)).toHaveLength(2);
  });

  it('cancelling the step-up dialog tells the user the action was not done and sends no second request', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/decide`]: fail(401, 'step_up_required', 'Confirm your code') }));
    await user.click(within((await screen.findByText('CTX-0006')).closest('tr') as HTMLElement).getByRole('button', { name: 'Approve' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Signing was cancelled/)).toBeInTheDocument();
    expect(api.calls(`POST ${W}/cap-table/transactions/:ref/decide`)).toHaveLength(1);
  });

  it('a wrong step-up code shows the API message inside the dialog and keeps it open', async () => {
    const { user } = await open(
      routes({
        [`POST ${W}/cap-table/transactions/:ref/decide`]: fail(401, 'step_up_required', 'Confirm your code'),
        'POST /api/auth/mfa/step-up': fail(401, 'invalid_code', 'That code is not correct'),
      }),
    );
    await user.click(within((await screen.findByText('CTX-0006')).closest('tr') as HTMLElement).getByRole('button', { name: 'Approve' }));
    await user.type(await screen.findByLabelText('Authentication code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('That code is not correct')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Submit sends a new issuance with a number of shares and optional price, then clears the form and re-fetches', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions`]: ok({ id: 'CTX-0008' }, 201) }));
    await screen.findByText('CTX-0006');
    await user.type(screen.getByPlaceholderText('Holder'), 'Seed Investor');
    await user.clear(screen.getByPlaceholderText('Share class'));
    await user.type(screen.getByPlaceholderText('Share class'), 'Series A Preferred');
    await user.type(screen.getByPlaceholderText('Shares'), '2500');
    await user.type(screen.getByPlaceholderText('Price / share'), '1.5');
    await user.type(screen.getByPlaceholderText('Note'), 'Bridge');
    const before = api.calls(`GET ${W}/cap-table/transactions`).length;
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const [req] = expectCalled(api, `POST ${W}/cap-table/transactions`);
    expectBody(req, { kind: 'ISSUANCE', holder: 'Seed Investor', className: 'Series A Preferred', shares: 2500, pricePerShare: 1.5, note: 'Bridge' });
    expect((req.body as Record<string, unknown>).fromHolder).toBeUndefined();
    expectIdempotencyKey(req);
    expect(await screen.findByText('Transaction submitted for a second person to approve')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Holder')).toHaveValue('');
    await waitFor(() => expect(api.calls(`GET ${W}/cap-table/transactions`).length).toBe(before + 1));
  });

  it('a transfer asks for the from-holder and sends fromHolder', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions`]: ok({ id: 'CTX-0009' }, 201) }));
    await screen.findByText('CTX-0006');
    await user.selectOptions(screen.getByLabelText('Kind'), 'TRANSFER');
    expect(screen.getByPlaceholderText('To holder')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('To holder'), 'Angel Fund');
    await user.type(screen.getByPlaceholderText('From holder'), 'Founders Pool');
    await user.type(screen.getByPlaceholderText('Shares'), '10');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expectBody(expectCalled(api, `POST ${W}/cap-table/transactions`)[0], { kind: 'TRANSFER', holder: 'Angel Fund', fromHolder: 'Founders Pool', shares: 10 });
  });

  it('API validation errors on a transaction are shown with the field names and the entered values are kept', async () => {
    const { user } = await open(
      routes({ [`POST ${W}/cap-table/transactions`]: fail(409, 'insufficient_shares', 'Founders Pool holds 700000 Ordinary shares, fewer than 900000') }),
    );
    await screen.findByText('CTX-0006');
    await user.type(screen.getByPlaceholderText('Holder'), 'Seed Investor');
    await user.type(screen.getByPlaceholderText('Shares'), '900000');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/fewer than 900000/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Holder')).toHaveValue('Seed Investor');
    expect(screen.getByPlaceholderText('Shares')).toHaveValue(900000);
  });

  it('a certificate download asks for a signed URL and opens it in a new tab with noopener', async () => {
    const open_ = vi.fn();
    vi.stubGlobal('open', open_);
    const { api, user } = await open(routes({ [`GET ${W}/cap-table/certificates/:no/download-url`]: ok({ url: 'https://files.test/cert.pdf?sig=1' }) }));
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    expect(expectCalled(api, `GET ${W}/cap-table/certificates/:no/download-url`)[0].path.endsWith('/CERT-001/download-url')).toBe(true);
    await waitFor(() => expect(open_).toHaveBeenCalledWith('https://files.test/cert.pdf?sig=1', '_blank', 'noopener'));
  });

  it('exit waterfall posts the exit value and renders class and holder proceeds', async () => {
    const { api, user } = await open(
      routes({
        [`POST ${W}/cap-table/waterfall`]: ok({
          distributed: 5000000,
          classes: [{ name: 'Series A Preferred', shares: 300000, preferencePaid: 1000000, residual: 800000, total: 1800000, perShare: 6, converted: false }],
          holders: [{ holder: 'Matanho Growth Partners I', className: 'Series A Preferred', shares: 300000, payout: 1800000 }],
        }),
      }),
    );
    await screen.findByText('CTX-0006');
    await user.type(screen.getByPlaceholderText('Exit value'), '5000000');
    await user.click(screen.getByRole('button', { name: 'Calculate' }));
    expectBody(expectCalled(api, `POST ${W}/cap-table/waterfall`)[0], { exitValue: 5000000 });
    expect(await screen.findByText('Distributed 5,000,000.')).toBeInTheDocument();
    const holderRow = screen.getAllByText('Matanho Growth Partners I').map((e) => e.closest('tr')).find((r) => r?.textContent?.includes('1,800,000')) as HTMLElement;
    expect(holderRow).toBeTruthy();
  });
});

describe('INO-013: confirmations survive the background reload', () => {
  it('after Withdraw the confirmation stays visible once the register re-fetch finishes (it is not replaced by "Loaded")', async () => {
    const { api, user } = await open(routes({ [`POST ${W}/cap-table/transactions/:ref/withdraw`]: ok({ id: 'CTX-0007', status: 'WITHDRAWN' }) }));
    await user.click(within((await screen.findByText('CTX-0007')).closest('tr') as HTMLElement).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.calls(`GET ${W}/cap-table/transactions`).length).toBe(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('status').textContent).toBe('Transaction withdrawn');
  });
});

describe('Board and forecast tab', () => {
  const boardRoutes = (over: Routes = {}) =>
    routes({
      [`GET ${W}/governance/meetings`]: ok({
        meetings: [
          { id: 'm1', ref: 'MTG-1', title: 'Q3 board', meetingAt: '2026-10-20T09:00:00.000Z', status: 'SCHEDULED', packStatus: 'DRAFT', packSha256: null, pack: [{ id: 'p1', documentId: 'doc_1', name: 'Shareholder agreement' }] },
          { id: 'm2', ref: 'MTG-2', title: 'Q2 board', meetingAt: '2026-07-20T09:00:00.000Z', status: 'HELD', packStatus: 'PUBLISHED', packSha256: 'b'.repeat(64), pack: [] },
        ],
      }),
      [`GET ${W}/governance`]: ok({ actions: [{ id: 'a1', title: 'Hire a CFO', owner: 'Chipo Dube', due: '2026-11-01', status: 'Open' }, { id: 'a2', title: 'File returns', owner: 'Tariro Moyo', due: '2026-09-01', status: 'Complete' }] }),
      [`GET ${W}/forecast`]: ok({ months: [{ key: '2026-09', label: 'Sep 2026', stage: 'actual-open', locked: false }, { key: '2026-10', label: 'Oct 2026', stage: 'forecast', locked: true }], lockedPeriods: ['2026-10'] }),
      ...over,
    });

  it('lists meetings with pack state (draft vs published hash) and actions with Complete only on open ones', async () => {
    const { user } = await open(boardRoutes());
    await tab(user, 'Board and forecast');
    expect(await screen.findByText('Q3 board')).toBeInTheDocument();
    expect(screen.getByText(/Pack: draft/)).toBeInTheDocument();
    expect(screen.getByText('bbbbbbbbbbbb')).toBeInTheDocument();
    expect(within(rowOf('Hire a CFO')).getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(within(rowOf('File returns')).queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('scheduling a meeting posts title/date/location with an Idempotency-Key and re-fetches meetings', async () => {
    const { api, user } = await open(boardRoutes({ [`POST ${W}/governance/meetings`]: ok({ id: 'm3' }, 201) }));
    await tab(user, 'Board and forecast');
    await screen.findByText('Q3 board');
    await user.type(screen.getByPlaceholderText('Meeting title'), 'Strategy day');
    await user.type(screen.getByLabelText('Date'), '2026-12-01');
    await user.type(screen.getByPlaceholderText('Location'), 'Harare');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const [req] = expectCalled(api, `POST ${W}/governance/meetings`);
    expectBody(req, { title: 'Strategy day', meetingAt: '2026-12-01', location: 'Harare' });
    expectIdempotencyKey(req);
    expect(await screen.findByText('Meeting scheduled')).toBeInTheDocument();
    await waitFor(() => expect(api.calls(`GET ${W}/governance/meetings`).length).toBe(2));
  });

  it('adds a document to a draft pack, publishes only when the pack has documents', async () => {
    const { api, user } = await open(
      boardRoutes({
        [`POST ${W}/governance/meetings/:id/pack`]: ok({}, 201),
        [`POST ${W}/governance/meetings/:id/publish`]: ok({}),
      }),
    );
    await tab(user, 'Board and forecast');
    await screen.findByText('Q3 board');
    const addBtn = within(screen.getByText('Q3 board').closest('div')!.parentElement as HTMLElement).getByRole('button', { name: 'Add' });
    expect(addBtn).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Document for the pack'), 'doc_1');
    await user.click(addBtn);
    expectBody(expectCalled(api, `POST ${W}/governance/meetings/:id/pack`)[0], { documentId: 'doc_1' });
    await user.click(screen.getByRole('button', { name: 'Publish pack' }));
    const [pub] = expectCalled(api, `POST ${W}/governance/meetings/:id/publish`);
    expect(pub.path.endsWith('/m1/publish')).toBe(true);
    expectIdempotencyKey(pub);
  });

  it('records a board action and marks one complete (PATCH status COMPLETE)', async () => {
    const { api, user } = await open(boardRoutes({ [`POST ${W}/governance/actions`]: ok({ id: 'a3' }, 201), [`PATCH ${W}/governance/actions/:id`]: ok({}) }));
    await tab(user, 'Board and forecast');
    await screen.findByText('Hire a CFO');
    await user.type(screen.getByPlaceholderText('New action'), 'Renew insurance');
    await user.type(screen.getByPlaceholderText('Owner'), 'Chipo Dube');
    await user.click(within(screen.getByRole('heading', { name: 'Board actions' }).closest('section') as HTMLElement).getAllByRole('button', { name: 'Add' }).at(-1)!);
    expectBody(expectCalled(api, `POST ${W}/governance/actions`)[0], { title: 'Renew insurance', owner: 'Chipo Dube' });
    await user.click(within(rowOf('Hire a CFO')).getByRole('button', { name: 'Complete' }));
    const [patch] = expectCalled(api, `PATCH ${W}/governance/actions/:id`);
    expect(patch.path.endsWith('/a1')).toBe(true);
    expectBody(patch, { status: 'COMPLETE' });
  });

  it('forecast months: locking posts /forecast/lock, an already locked month offers unlock; permission errors surface', async () => {
    const { api, user } = await open(
      boardRoutes({
        [`POST ${W}/forecast/lock`]: ok({}),
        [`POST ${W}/forecast/unlock`]: fail(403, 'forbidden', 'Your access profile cannot unlock forecast months'),
      }),
    );
    await tab(user, 'Board and forecast');
    await user.click(await screen.findByRole('button', { name: /^Sep 2026/ }));
    expectBody(expectCalled(api, `POST ${W}/forecast/lock`)[0], { periods: ['2026-09'] });
    await user.click(screen.getByRole('button', { name: /Oct 2026 \(locked\)/ }));
    expectBody(expectCalled(api, `POST ${W}/forecast/unlock`)[0], { periods: ['2026-10'] });
    expect(await screen.findByText('Your access profile cannot unlock forecast months')).toBeInTheDocument();
  });
});

describe('INO-011: signature requests', () => {
  const sigRoutes = (over: Routes = {}) =>
    routes({
      [`GET ${W}/signature-requests`]: ok({
        requests: [
          { id: 'sr1', ref: 'SIG-0001', title: 'Shareholder agreement', status: 'PENDING', expiresAt: '2026-11-01T00:00:00.000Z', reminderCount: 0, signers: [{ id: 's1', name: 'Ada Moyo', email: 'ada@x.test', status: 'PENDING' }] },
          { id: 'sr2', ref: 'SIG-0002', title: 'NDA', status: 'COMPLETED', expiresAt: '2026-10-01T00:00:00.000Z', reminderCount: 1, signers: [{ id: 's2', name: 'Bo', email: 'bo@x.test', status: 'SIGNED' }] },
        ],
      }),
      ...over,
    });

  it('lists requests with signer status; Remind/Void are offered only while PENDING', async () => {
    const { user } = await open(sigRoutes());
    await tab(user, 'Signature requests');
    const pending = (await screen.findByText('SIG-0001')).closest('tr') as HTMLElement;
    expect(pending.textContent).toContain('Ada Moyo: pending');
    expect(within(pending).getByRole('button', { name: 'Remind' })).toBeInTheDocument();
    const done = screen.getByText('SIG-0002').closest('tr') as HTMLElement;
    expect(within(done).queryByRole('button', { name: 'Remind' })).toBeNull();
    expect(done.textContent).toContain('completed');
  });

  it('says what is missing (no document / no signer) instead of doing nothing, and sends nothing', async () => {
    const { api, user } = await open(sigRoutes());
    await tab(user, 'Signature requests');
    await screen.findByText('SIG-0001');
    await user.click(screen.getByRole('button', { name: 'Send for signature' }));
    expect(await screen.findByText('Choose the document to send for signature.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Document'), 'doc_1');
    await user.click(screen.getByRole('button', { name: 'Send for signature' }));
    expect(await screen.findByText(/Add at least one signer/)).toBeInTheDocument();
    expectNotCalled(api, `POST ${W}/signature-requests`);
  });

  it('sends a request with parsed signers (Name, email per line) and re-fetches', async () => {
    const { api, user } = await open(sigRoutes({ [`POST ${W}/signature-requests`]: ok({ id: 'sr3' }, 201) }));
    await tab(user, 'Signature requests');
    await screen.findByText('SIG-0001');
    await user.selectOptions(screen.getByLabelText('Document'), 'doc_1');
    await user.type(screen.getByPlaceholderText('Title (optional)'), 'SHA v2');
    await user.type(screen.getByPlaceholderText(/One signer per line/), 'Ada Moyo, ada@x.test{enter}bo@x.test');
    await user.click(screen.getByRole('button', { name: 'Send for signature' }));
    const [req] = expectCalled(api, `POST ${W}/signature-requests`);
    expectBody(req, { documentId: 'doc_1', title: 'SHA v2', signers: [{ name: 'Ada Moyo', email: 'ada@x.test' }, { name: 'bo', email: 'bo@x.test' }] });
    expectIdempotencyKey(req);
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    await waitFor(() => expect(api.calls(`GET ${W}/signature-requests`).length).toBe(2));
  });

  it('INO-011: field-level API details are shown (signer e-mail named)', async () => {
    const { user } = await open(
      sigRoutes({ [`POST ${W}/signature-requests`]: fail(400, 'validation_error', 'Validation failed', [{ path: 'signers.0.email', message: 'Invalid email address' }]) }),
    );
    await tab(user, 'Signature requests');
    await screen.findByText('SIG-0001');
    await user.selectOptions(screen.getByLabelText('Document'), 'doc_1');
    await user.type(screen.getByPlaceholderText(/One signer per line/), 'Ada, not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send for signature' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/signers\.0\.email|Invalid email/i));
    expect(screen.getByRole('status').textContent).not.toMatch(/\(400\)/);
  });

  it('Remind posts /remind; Void asks for a reason and posts it (cancelling the prompt sends nothing)', async () => {
    const prompt = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('Wrong document');
    vi.stubGlobal('prompt', prompt);
    const { api, user } = await open(sigRoutes({ [`POST ${W}/signature-requests/:id/remind`]: ok({}), [`POST ${W}/signature-requests/:id/void`]: ok({}) }));
    await tab(user, 'Signature requests');
    const row = (await screen.findByText('SIG-0001')).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Remind' }));
    expect(expectCalled(api, `POST ${W}/signature-requests/:id/remind`)[0].path.endsWith('/sr1/remind')).toBe(true);
    await user.click(within(row).getByRole('button', { name: 'Void' }));
    expectNotCalled(api, `POST ${W}/signature-requests/:id/void`);
    await user.click(within(row).getByRole('button', { name: 'Void' }));
    expectBody(expectCalled(api, `POST ${W}/signature-requests/:id/void`)[0], { reason: 'Wrong document' });
  });
});

describe('INO-014: share links', () => {
  const linkRoutes = (over: Routes = {}) =>
    routes({
      [`GET ${W}/share-links`]: ok({ links: [{ id: 'l1', documentName: 'Shareholder agreement', recipient: 'Angel Fund', status: 'ACTIVE', expiresAt: '2026-10-10T00:00:00.000Z', accessCount: 3 }, { id: 'l2', documentName: 'Old deck', recipient: 'X', status: 'REVOKED', expiresAt: '2026-09-10T00:00:00.000Z', accessCount: 0 }] }),
      ...over,
    });

  it('lists links with recipient, status, opens; Revoke only on active links and DELETEs by id', async () => {
    const { api, user } = await open(linkRoutes({ [`DELETE ${W}/share-links/:id`]: { status: 204 } }));
    await tab(user, 'Share links');
    const active = (await screen.findByText('Angel Fund')).closest('tr') as HTMLElement;
    expect(active.textContent).toContain('active');
    expect(active.textContent).toContain('3');
    expect(within(screen.getByText('Old deck').closest('tr') as HTMLElement).queryByRole('button', { name: 'Revoke' })).toBeNull();
    await user.click(within(active).getByRole('button', { name: 'Revoke' }));
    expect(expectCalled(api, `DELETE ${W}/share-links/:id`)[0].path.endsWith('/l1')).toBe(true);
    expect(await screen.findByText('Link revoked')).toBeInTheDocument();
  });

  it('creates a link, shows the fresh portal landing URL with Copy and Open (not a raw API file URL) and the "cannot be shown again" notice', async () => {
    const url = 'http://localhost:3002/sign/share/tok_abc123';
    const { api, user } = await open(linkRoutes({ [`POST ${W}/share-links`]: ok({ id: 'l3', url }, 201) }));
    await tab(user, 'Share links');
    await screen.findByText('Angel Fund');
    await user.selectOptions(screen.getByLabelText('Document'), 'doc_1');
    await user.type(screen.getByPlaceholderText('Recipient (person or firm)'), 'Bank Ltd');
    await user.type(screen.getByPlaceholderText('E-mail the link to (optional)'), 'bank@x.test');
    await user.selectOptions(screen.getByLabelText('Expires after'), '3');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    const [req] = expectCalled(api, `POST ${W}/share-links`);
    expectBody(req, { documentId: 'doc_1', recipient: 'Bank Ltd', recipientEmail: 'bank@x.test', expiresInDays: 3 });
    expectIdempotencyKey(req);
    expect(await screen.findByText(/only a fingerprint is stored/)).toBeInTheDocument();
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', url);
    expect(url).toContain('/sign/share/');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(url));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('an API refusal (e.g. unsupported file type) is shown and no link is displayed', async () => {
    const { user } = await open(linkRoutes({ [`POST ${W}/share-links`]: fail(400, 'unsupported_type', 'Only PDF, image and text files can be watermarked') }));
    await tab(user, 'Share links');
    await screen.findByText('Angel Fund');
    await user.selectOptions(screen.getByLabelText('Document'), 'doc_1');
    await user.type(screen.getByPlaceholderText('Recipient (person or firm)'), 'Bank Ltd');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByText(/Only PDF, image and text files/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });
});

describe('INO-009: KPI history and export', () => {
  const kpiRoutes = () =>
    routes({
      [`GET ${W}/kpis/history`]: ok({ rows: [{ period: 'Aug 2026', status: 'accepted', values: { revenue: 120000, revenueGrowthPct: 4.5, grossMarginPct: null, netMarginPct: 12.5, cashFlowNet: 8000, runwayMonths: 14 } }] }),
      [`GET ${W}/kpis/export`]: { status: 200, body: undefined },
    });

  it('renders the real KPI columns with numbers and blanks for missing values (no NaN/undefined)', async () => {
    const { user } = await open(kpiRoutes());
    await tab(user, 'KPIs and export');
    const row = (await screen.findByText('Aug 2026')).closest('tr') as HTMLElement;
    expect(row.textContent).toContain('120,000');
    expect(row.textContent).toContain('4.5');
    expect(row.textContent).toContain('14');
    expect(row.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('Export CSV / Excel request /kpis/export?format= and save kpi-history.<ext>', async () => {
    const stubs = installBrowserStubs();
    const { api, user } = await open(kpiRoutes());
    await tab(user, 'KPIs and export');
    await screen.findByText('Aug 2026');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(stubs.downloads.map((d) => d.name)).toContain('kpi-history.csv'));
    await user.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(stubs.downloads.map((d) => d.name)).toContain('kpi-history.xlsx'));
    expect(api.calls(`GET ${W}/kpis/export`).map((r) => r.query.get('format'))).toEqual(['csv', 'xlsx']);
  });

  it('a failed export shows the API message and downloads nothing', async () => {
    const stubs = installBrowserStubs();
    const { user } = await open(routes({ [`GET ${W}/kpis/history`]: ok({ rows: [] }), [`GET ${W}/kpis/export`]: fail(500, 'internal', 'Export failed on the server') }));
    await tab(user, 'KPIs and export');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Export failed on the server/)).toBeInTheDocument();
    expect(stubs.downloads).toHaveLength(0);
  });
});

describe('INO-017/INO-020: access and MFA tab', () => {
  const access = () => ({
    members: [
      { userId: 'u1', name: 'Tariro Moyo', email: 'tariro@kuda.test', profile: 'report_contributor', status: 'active', mfa: false, lastLoginAt: '2026-09-30T10:00:00.000Z' },
      { userId: 'u2', name: 'Chipo Dube', email: 'chipo@kuda.test', profile: 'executive_approver', status: 'active', mfa: true, lastLoginAt: null },
      { userId: 'u3', name: null, email: 'new@kuda.test', profile: 'read_only', status: 'invited', mfa: false, lastLoginAt: null },
    ],
    coverage: { active: 2, mfa: 1, pct: 50 },
    reviewDue: true,
    lastReview: { reviewedAt: '2026-05-01T00:00:00.000Z' },
  });

  it('shows MFA coverage, humanised profiles, names not ids, review-due warning; invited members have no revoke box', async () => {
    const { user } = await open(routes({ [`GET ${W}/access`]: ok(access()) }));
    await tab(user, 'Access and MFA');
    expect(await screen.findByText('1 of 2 active members have two-factor sign-in (50%).')).toBeInTheDocument();
    expect(screen.getByText('Last access review: 2026-05-01 (more than 90 days ago)')).toBeInTheDocument();
    const r = screen.getByText(/Chipo Dube chipo@kuda.test/).closest('tr') as HTMLElement;
    expect(r.textContent).toContain('executive approver');
    expect(r.textContent).toContain('never');
    expect(screen.queryByLabelText('Revoke new@kuda.test')).toBeNull();
    expect(screen.getByLabelText('Revoke chipo@kuda.test')).toBeInTheDocument();
  });

  it('Record review sends CERTIFIED for everyone except ticked members (REVOKED), with Idempotency-Key, and reloads', async () => {
    const { api, user } = await open(routes({ [`GET ${W}/access`]: ok(access()), [`POST ${W}/access/reviews`]: ok({}, 201) }));
    await tab(user, 'Access and MFA');
    await user.click(await screen.findByLabelText('Revoke chipo@kuda.test'));
    await user.click(screen.getByRole('button', { name: 'Record review' }));
    const [req] = expectCalled(api, `POST ${W}/access/reviews`);
    expectBody(req, { decisions: [{ userId: 'u1', decision: 'CERTIFIED' }, { userId: 'u2', decision: 'REVOKED' }] });
    expectIdempotencyKey(req);
    expect(await screen.findByText('Access review recorded')).toBeInTheDocument();
    await waitFor(() => expect(api.calls(`GET ${W}/access`).length).toBe(2));
    expect(screen.getByLabelText('Revoke chipo@kuda.test')).not.toBeChecked();
  });

  it('"Set up two-factor authentication" opens enrolment and refreshes coverage once confirmed', async () => {
    const { api, user } = await open(
      routes({
        [`GET ${W}/access`]: ok(access()),
        'POST /api/auth/mfa/enroll': raw({ secret: 'ABCDEFGH', otpauthUri: 'otpauth://totp/x' }),
        'POST /api/auth/mfa/verify': raw({ user: { id: ME } }),
      }),
    );
    await tab(user, 'Access and MFA');
    await user.click(await screen.findByRole('button', { name: 'Set up two-factor authentication' }));
    expect(await screen.findByTestId('mfa-setup-key')).toHaveTextContent('ABCDEFGH');
    await user.type(screen.getByLabelText('Authentication code'), '111111');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(api.calls(`GET ${W}/access`).length).toBe(2));
  });

  it('a profile without manage_company gets the API refusal text (403) when recording the review', async () => {
    const { user } = await open(routes({ [`GET ${W}/access`]: ok(access()), [`POST ${W}/access/reviews`]: fail(403, 'insufficient_profile', 'Your access profile cannot do this') }));
    await tab(user, 'Access and MFA');
    await user.click(await screen.findByRole('button', { name: 'Record review' }));
    expect(await screen.findByText(/Your access profile cannot do this/)).toBeInTheDocument();
  });
});
