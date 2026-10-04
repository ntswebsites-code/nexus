import { describe, it, expect } from 'vitest';
import UsersPage from '@/app/(portal)/users/page';
import NotificationsPage from '@/app/(portal)/notifications/page';
import HistoryPage from '@/app/(portal)/history/page';
import DashboardPage from '@/app/(portal)/page';
import { expectCalled, expectIdempotencyKey, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { dayEnd, execution, renderPortal, shellRoutes } from './_support';

const U = '/api/v1/custodian/users';
const N = '/api/v1/notifications';

const person = (over: Record<string, unknown> = {}) => ({ userId: 'u1', name: 'Pat Preparer', email: 'pat@stanbic.test', role: 'submitter', status: 'active', lastLoginAt: '2026-10-01T07:00:00.000Z', you: false, since: '2026-01-01T00:00:00.000Z', ...over });

describe('custodian users and roles', () => {
  const open = async (canManage: boolean, items = [person({ userId: 'me', name: 'Sam', email: 'sam@stanbic.test', role: 'approver', you: true }), person()], extra: Record<string, never> = {}) => {
    const api = mockApi({ ...shellRoutes({ role: canManage ? 'approver' : 'submitter' }), [`GET ${U}`]: raw({ canManage, items }), ...extra });
    const view = renderPortal(<UsersPage />);
    await screen.findByText('pat@stanbic.test');
    return { api, ...view };
  };

  it('lists people with role, status badge, last sign-in (or never) and marks you', async () => {
    await open(false, [person(), person({ userId: 'u2', email: 'new@stanbic.test', name: null, lastLoginAt: null, status: 'inactive', role: 'approver' })]);
    const r = screen.getByText('pat@stanbic.test').closest('tr')!;
    expect(within(r).getByText('Pat Preparer')).toBeInTheDocument();
    expect(within(r).getByText('submitter')).toBeInTheDocument();
    expect(within(r).getByText('active')).toHaveClass('ok');
    const r2 = screen.getByText('new@stanbic.test').closest('tr')!;
    expect(within(r2).getByText('never')).toBeInTheDocument();
    expect(within(r2).getByText('inactive')).toHaveClass('muted');
  });

  it('a user who cannot manage sees the list but no Change access / invite form', async () => {
    await open(false);
    expect(screen.queryByRole('button', { name: 'Change access' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Invite a colleague' })).toBeNull();
  });

  it('a manager cannot change their own access (no button on the "you" row)', async () => {
    await open(true);
    expect(screen.getByText('sam@stanbic.test').closest('tr')!.textContent).toContain('(you)');
    expect(within(screen.getByText('sam@stanbic.test').closest('tr')!).queryByRole('button', { name: 'Change access' })).toBeNull();
    expect(within(screen.getByText('pat@stanbic.test').closest('tr')!).getByRole('button', { name: 'Change access' })).toBeInTheDocument();
  });

  it('invite sends email and role (name omitted when blank) with an Idempotency-Key, then confirms and clears the form', async () => {
    const { api, user } = await open(true, undefined, { [`POST ${U}/invite`]: { status: 201, body: { ok: true } } } as never);
    await user.type(screen.getByLabelText('Email'), 'new.colleague@stanbic.test');
    await user.selectOptions(screen.getByLabelText('Role'), 'approver');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${U}/invite`));
    expect(req.body).toEqual({ email: 'new.colleague@stanbic.test', role: 'approver' });
    expectIdempotencyKey(req);
    expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent to new.colleague@stanbic.test. It is valid for 7 days.');
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('an invalid email is blocked by the browser; an API refusal is shown and the email stays for correction', async () => {
    const { api, user } = await open(true, undefined, { [`POST ${U}/invite`]: fail(409, 'already_member', 'That person already has access') } as never);
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expectNotCalled(api, `POST ${U}/invite`);
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'pat@stanbic.test');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That person already has access');
    expect(screen.getByLabelText('Email')).toHaveValue('pat@stanbic.test');
  });

  it('change access patches only what changed, with the reason and an Idempotency-Key, and refetches the list', async () => {
    const { api, user } = await open(true, undefined, { [`PATCH ${U}/:id`]: raw({ ok: true }) } as never);
    await user.click(within(screen.getByText('pat@stanbic.test').closest('tr')!).getByRole('button', { name: 'Change access' }));
    const dlg = await screen.findByRole('dialog', { name: 'Change access for pat@stanbic.test' });
    await user.selectOptions(within(dlg).getByLabelText('Status'), 'inactive');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Left the team');
    const before = api.calls(`GET ${U}`).length;
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    const [req] = await waitFor(() => expectCalled(api, `PATCH ${U}/:id`));
    expect(req.path).toBe(`${U}/u1`);
    expect(req.body).toEqual({ reason: 'Left the team', status: 'inactive' });
    expectIdempotencyKey(req);
    expect(await screen.findByRole('status')).toHaveTextContent('Access updated for pat@stanbic.test.');
    await waitFor(() => expect(api.calls(`GET ${U}`).length).toBeGreaterThan(before));
  });

  it('change access requires a reason and shows API errors in the page', async () => {
    const { api, user } = await open(true, undefined, { [`PATCH ${U}/:id`]: fail(409, 'last_approver', 'At least one active approver is required') } as never);
    await user.click(within(screen.getByText('pat@stanbic.test').closest('tr')!).getByRole('button', { name: 'Change access' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expectNotCalled(api, `PATCH ${U}/:id`);
    await user.type(within(dlg).getByLabelText(/Reason/), 'Promote');
    await user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('At least one active approver is required');
  });
});

describe('custodian notifications', () => {
  const notice = (over: Record<string, unknown> = {}) => ({ id: 'n1', type: 'custodian.dayend.submitted', title: 'Day-end package CDE-10001 awaits your approval', body: 'CUST-CL-00418 · 2026-10-01 · USD', link: null, readAt: null, createdAt: '2026-10-02T07:00:00.000Z', ...over });
  async function open(items: unknown[], unread: number) {
    const api = mockApi({ ...shellRoutes({ unread }), [`GET ${N}`]: (req) => ({ status: 200, body: { items: req.query.get('pageSize') === '1' ? [] : items, unread, page: 1, pageSize: 100, total: items.length } }), [`POST ${N}/read-all`]: raw({ ok: true }), [`POST ${N}/:id/read`]: raw({ ok: true }) });
    const view = renderPortal(<NotificationsPage />);
    await screen.findByRole('heading', { name: 'Notifications' });
    return { api, ...view };
  }

  it('renders title, body and time; unread rows have Mark read, read rows do not', async () => {
    await open([notice(), notice({ id: 'n2', title: 'Old news', body: null, readAt: '2026-10-02T08:00:00.000Z' })], 1);
    const r1 = (await screen.findByText(/awaits your approval/)).closest('tr')!;
    expect(r1).toHaveClass('cx-unread');
    expect(within(r1).getByText('CUST-CL-00418 · 2026-10-01 · USD')).toBeInTheDocument();
    expect(within(r1).getByRole('button', { name: 'Mark read' })).toBeInTheDocument();
    expect(within(screen.getByText('Old news').closest('tr')!).queryByRole('button', { name: 'Mark read' })).toBeNull();
  });

  it('Mark read posts to /:id/read and reloads', async () => {
    const { api, user } = await open([notice()], 1);
    const before = api.calls(`GET ${N}`).length;
    await user.click(await screen.findByRole('button', { name: 'Mark read' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${N}/:id/read`));
    expect(req.path).toBe(`${N}/n1/read`);
    await waitFor(() => expect(api.calls(`GET ${N}`).length).toBeGreaterThan(before));
  });

  it('Mark all read is disabled when nothing is unread and posts to /read-all otherwise', async () => {
    const a = await open([notice({ readAt: '2026-10-02T08:00:00.000Z' })], 0);
    expect(await screen.findByRole('button', { name: 'Mark all read' })).toBeDisabled();
    a.unmount();
    const { api, user } = await open([notice()], 2);
    const btn = await screen.findByRole('button', { name: 'Mark all read' });
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await waitFor(() => expectCalled(api, `POST ${N}/read-all`));
  });

  it('empty state and mark failure message', async () => {
    const a = await open([], 0);
    expect(await screen.findByText('You have no notifications.')).toBeInTheDocument();
    a.unmount();
    const { api, user } = await open([notice()], 1);
    api.on(`POST ${N}/:id/read`, fail(500, 'internal_error', 'Could not update the notification'));
    await user.click(await screen.findByRole('button', { name: 'Mark read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update the notification');
  });
});

describe('custodian status history', () => {
  const ev = (over: Record<string, unknown> = {}) => ({ id: 'e1', executionId: 'ex-1', action: 'submitted', fromStatus: null, toStatus: 'Received', reason: null, changes: null, by: 'Your organisation', at: '2026-10-01T08:31:00.000Z', ref: 'CEX-10001', tradeRef: 'TRD-1001', ...over });

  it('shows execution ref (not an id), trade reference, from-to status, who and why; requests 200 newest events', async () => {
    const api = mockApi({ ...shellRoutes(), '/api/v1/custodian/history': raw({ items: [ev(), ev({ id: 'e2', action: 'exception', fromStatus: 'Received', toStatus: 'Exception', by: 'Matanho', reason: 'Price outside band' })] }) });
    renderPortal(<HistoryPage />);
    const r = (await screen.findByText('Price outside band')).closest('tr')!;
    expect(within(r).getAllByRole('cell').map((c) => c.textContent)).toEqual([expect.stringMatching(/Oct 2026/), 'CEX-10001', 'TRD-1001', 'exception', 'Received to Exception', 'Matanho', 'Price outside band']);
    expect(within(r).getByText('Exception')).toHaveClass('bad');
    expect(api.calls('GET /api/v1/custodian/history')[0]!.query.get('limit')).toBe('200');
    expect(screen.queryByText(/ex-1/)).toBeNull();
  });

  it('empty and error states', async () => {
    mockApi({ ...shellRoutes(), '/api/v1/custodian/history': raw({ items: [] }) });
    const a = renderPortal(<HistoryPage />);
    expect(await screen.findByText('No history yet.')).toBeInTheDocument();
    a.unmount();
    mockApi({ ...shellRoutes(), '/api/v1/custodian/history': fail(500, 'internal_error', 'History unavailable') });
    renderPortal(<HistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('History unavailable');
  });
});

describe('custodian dashboard', () => {
  const dash = (over: Record<string, unknown> = {}) => ({
    counterparty: { ref: 'CP-0001', name: 'Stanbic Custodial Services', type: 'Custodian', accounts: ['CUST-CL-00418'] },
    role: 'submitter',
    executions: { Received: 3, Matched: 5, Exception: 1, Queried: 2 },
    submittedToday: 4,
    draftPackages: 2,
    unreadNotifications: 6,
    awaitingApproval: [dayEnd({ status: 'Received' })],
    rejectedPackages: [{ ...dayEnd({ status: 'Rejected', ref: 'CDE-REJ' }), review: { decision: 'Rejected', note: 'Cash does not reconcile', at: '2026-10-02T09:00:00.000Z' } }],
    exceptions: [execution({ status: 'Exception', quantity: '2500.75' })],
    lastStatement: { filename: 'stmt-0930.csv', statementDate: '2026-10-01', at: '2026-10-01T06:00:00.000Z' },
    feed: { mode: 'file-drop' },
    ...over,
  });
  const open = async (d = dash(), shell = {}) => {
    mockApi({ ...shellRoutes(shell), '/api/v1/custodian/dashboard': raw(d) });
    return renderPortal(<DashboardPage />);
  };

  it('shows counterparty name, accounts, KPI tiles with links, exceptions with unrounded quantity, drafts, approvals, rejection note, latest statement', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Stanbic Custodial Services' })).toBeInTheDocument();
    expect(screen.getByText(/Reference CP-0001\. Accounts: CUST-CL-00418\. Statement channel: file-drop/)).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label).closest('a')!;
    expect(within(tile('Submitted today')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Exceptions and queries')).getByText('3')).toBeInTheDocument();
    expect(tile('Matched')).toHaveAttribute('href', '/executions?status=Matched');
    expect(within(tile('Packages awaiting approval')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2,500.75')).toBeInTheDocument();
    expect(screen.getByText(/You have 2 day-end drafts not yet submitted/)).toBeInTheDocument();
    expect(screen.getByText(/CDE-REJ \(CUST-CL-00418, 1 Oct 2026\): Cash does not reconcile/)).toBeInTheDocument();
    expect(screen.getByText(/stmt-0930.csv, statement date 1 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Submit executions' })).toHaveAttribute('href', '/executions?new=1');
  });

  it('empty dashboard: friendly empty states, no drafts card, and no Submit link without permission', async () => {
    await open(dash({ executions: {}, draftPackages: 0, awaitingApproval: [], rejectedPackages: [], exceptions: [], lastStatement: null, counterparty: { ref: 'CP-0001', name: 'Stanbic', type: 'Custodian', accounts: [] } }), { permissions: [] });
    expect(await screen.findByText('No exceptions or queries from Matanho operations.')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting for approval.')).toBeInTheDocument();
    expect(screen.getByText(/No statement has been loaded yet/)).toBeInTheDocument();
    expect(screen.getByText(/Accounts: none configured/)).toBeInTheDocument();
    expect(screen.queryByText('Drafts')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Submit executions' })).toBeNull();
  });

  it('a single draft uses the singular', async () => {
    await open(dash({ draftPackages: 1 }));
    expect(await screen.findByText(/You have 1 day-end draft not yet submitted/)).toBeInTheDocument();
  });
});

describe('custodian shell', () => {
  it('shows the signed-in user, counterparty and role, the nav, and an unread badge', async () => {
    mockApi({ ...shellRoutes({ unread: 7 }), '/api/v1/custodian/history': raw({ items: [] }) });
    renderPortal(<HistoryPage />);
    expect(await screen.findByText(/Sam Submitter · Stanbic Custodial Services · submitter/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Dashboard', 'Executions', 'Bulk upload', 'Day-end', 'Statements and holdings', 'History', 'Users and roles', 'Notifications7']);
    expect(within(nav).getByRole('link', { name: 'Notifications7' })).toHaveAttribute('href', '/notifications');
  });

  it('when /me fails the page shows the error and a Sign out button instead of an empty shell', async () => {
    mockApi({ 'GET /api/v1/custodian/me': fail(403, 'forbidden', 'Your account is not linked to a custodian'), 'GET /api/v1/notifications': raw({ items: [], unread: 0 }), 'POST /api/auth/logout': raw({ ok: true }) });
    renderPortal(<HistoryPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your account is not linked to a custodian');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});
