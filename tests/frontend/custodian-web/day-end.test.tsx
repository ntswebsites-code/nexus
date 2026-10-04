import { describe, it, expect } from 'vitest';
import DayEndPage from '@/app/(portal)/day-end/page';
import { expectCalled, expectIdempotencyKey, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { attachFile, dayEnd, renderPortal, shellRoutes, stubLocation } from './_support';

const DE = '/api/v1/custodian/day-end';
const TOTALS = '/api/v1/custodian/control-totals';
const list = (items: unknown[]) => raw({ items });

async function open(items: unknown[], shell: Parameters<typeof shellRoutes>[0] = {}, extra: Record<string, never> = {}) {
  const api = mockApi({ ...shellRoutes(shell), [`GET ${DE}`]: list(items), ...extra });
  const view = renderPortal(<DayEndPage />);
  await screen.findByRole('heading', { name: 'Day-end packages' });
  return { api, ...view };
}
const row = (ref: string) => screen.getByText(ref).closest('tr')!;

describe('custodian day-end: list and actions by role', () => {
  it('renders real fields: ref, formatted date, account, currency, money, trade count, status', async () => {
    await open([dayEnd({ status: 'Received' })]);
    const r = await screen.findByText('CDE-10001').then((e) => e.closest('tr')!);
    expect(within(r).getAllByRole('cell').slice(0, 8).map((c) => c.textContent)).toEqual(['CDE-10001', '1 Oct 2026', 'CUST-CL-00418', 'USD', '125,000.50', '980,000.00', '3', 'Received']);
  });

  it('empty state and API error state', async () => {
    const a = await open([]);
    expect(await screen.findByText('No day-end packages yet.')).toBeInTheDocument();
    a.unmount();
    mockApi({ ...shellRoutes(), [`GET ${DE}`]: fail(500, 'internal_error', 'Could not load packages') });
    renderPortal(<DayEndPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load packages');
  });

  it('Submit is offered only on your own Drafts; Supersede on Received/Approved/Accepted only', async () => {
    await open([
      dayEnd({ id: 'a', ref: 'CDE-A', status: 'Draft', submittedById: 'usr-sub' }),
      dayEnd({ id: 'b', ref: 'CDE-B', status: 'Draft', submittedById: 'someone-else' }),
      dayEnd({ id: 'c', ref: 'CDE-C', status: 'Approved' }),
      dayEnd({ id: 'd', ref: 'CDE-D', status: 'Rejected' }),
    ]);
    await screen.findByText('CDE-A');
    expect(within(row('CDE-A')).getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(within(row('CDE-B')).queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(within(row('CDE-C')).getByRole('button', { name: 'Supersede' })).toBeInTheDocument();
    expect(within(row('CDE-D')).queryByRole('button', { name: 'Supersede' })).toBeNull();
    expect(within(row('CDE-A')).queryByRole('button', { name: 'Supersede' })).toBeNull();
  });

  it('maker-checker: an approver sees Approve on a package prepared by someone else', async () => {
    const { api, user } = await open([dayEnd({ status: 'Received', submittedById: 'preparer' })], { role: 'approver', id: 'usr-app' });
    api.on(`POST ${DE}/:id/approve`, raw({ package: dayEnd({ status: 'Approved' }) }));
    const r = await screen.findByText('CDE-10001').then((e) => e.closest('tr')!);
    await user.click(within(r).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${DE}/:id/approve`));
    expect(req.path).toBe(`${DE}/de-1/approve`);
    expect(await screen.findByRole('status')).toHaveTextContent('CDE-10001 approved and sent to Matanho for reconciliation.');
    expect(api.calls(`GET ${DE}`).length).toBeGreaterThanOrEqual(2);
  });

  it('maker-checker: your own submitted package shows a disabled Approve with the reason, never an active one', async () => {
    await open([dayEnd({ status: 'Received', submittedById: 'usr-app' })], { role: 'approver', id: 'usr-app' });
    const r = await screen.findByText('CDE-10001').then((e) => e.closest('tr')!);
    const btn = within(r).getByRole('button', { name: 'Approve' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription('You prepared this package; a different approver must approve it.');
  });

  it('a submitter (no approve permission) never gets an Approve button', async () => {
    await open([dayEnd({ status: 'Received', submittedById: 'preparer' })]);
    const r = await screen.findByText('CDE-10001').then((e) => e.closest('tr')!);
    expect(within(r).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('permission: without day-end rights there is no New package button and a read-only note explains why', async () => {
    await open([dayEnd()], { permissions: [] });
    expect(screen.queryByRole('button', { name: 'New day-end package' })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it('Submit posts to /submit, confirms, and refetches', async () => {
    const { api, user } = await open([dayEnd()]);
    api.on(`POST ${DE}/:id/submit`, raw({ package: dayEnd({ status: 'Received' }), controls: {} }));
    const r = await screen.findByText('CDE-10001').then((e) => e.closest('tr')!);
    await user.click(within(r).getByRole('button', { name: 'Submit' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${DE}/:id/submit`));
    expect(req.path).toBe(`${DE}/de-1/submit`);
    expectIdempotencyKey(req);
    expect(await screen.findByRole('status')).toHaveTextContent('CDE-10001 submitted. An approver in your organisation must approve it.');
  });

  it('LPC-011: a control-total mismatch (409) on Submit shows the server message and leaves the package a Draft', async () => {
    const { api, user } = await open([dayEnd({ tradeCount: 5 })]);
    api.on(`POST ${DE}/:id/submit`, fail(409, 'control_total_mismatch', 'Declared control totals do not match the executions received (trade count declared 5, received 0). Amend the executions or supersede this package.'));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('trade count declared 5, received 0');
    expect(within(row('CDE-10001')).getByText('Draft')).toBeInTheDocument();
  });

  it('segregation of duties from the server (403) is shown on Approve', async () => {
    const { api, user } = await open([dayEnd({ status: 'Received', submittedById: 'preparer' })], { role: 'approver', id: 'usr-app' });
    api.on(`POST ${DE}/:id/approve`, fail(403, 'segregation_of_duties', 'The submitter of a day-end package cannot approve it'));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The submitter of a day-end package cannot approve it');
  });
});

describe('custodian day-end: 401 handling (LPC-019)', () => {
  it('an expired session on any call redirects to /login?next=<path+query> instead of leaving a stale shell', async () => {
    const loc = stubLocation('/day-end', '?tab=1');
    const { api, user } = await open([dayEnd({ status: 'Received', submittedById: 'preparer' })], { role: 'approver', id: 'usr-app' });
    api.on(`POST ${DE}/:id/approve`, fail(401, 'unauthorized', 'Authentication required'));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/login?next=%2Fday-end%3Ftab%3D1'));
  });

  it('a wrong MFA/step-up code (401 with another code) does not log the user out', async () => {
    const loc = stubLocation('/day-end', '');
    const { api, user } = await open([dayEnd({ status: 'Received', submittedById: 'preparer' })], { role: 'approver', id: 'usr-app' });
    api.on(`POST ${DE}/:id/approve`, fail(401, 'mfa_invalid', 'That code is not correct'));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not correct');
    expect(loc.assign).not.toHaveBeenCalled();
  });

  it('on the login page itself a 401 never redirects again (no loop)', async () => {
    const loc = stubLocation('/login', '');
    mockApi({ ...shellRoutes(), [`GET ${DE}`]: fail(401, 'unauthorized', 'Authentication required') });
    renderPortal(<DayEndPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication required');
    expect(loc.assign).not.toHaveBeenCalled();
  });
});

describe('custodian day-end: new package', () => {
  async function openNew(extra: Record<string, never> = {}) {
    const ctx = await open([], {}, extra);
    await ctx.user.click(screen.getByRole('button', { name: 'New day-end package' }));
    const dlg = await screen.findByRole('dialog', { name: 'New day-end package' });
    return { ...ctx, dlg };
  }
  const fill = async (user: ReturnType<typeof renderPortal>['user'], dlg: HTMLElement) => {
    await user.type(within(dlg).getByLabelText('Closing cash'), '125000.50');
    await user.type(within(dlg).getByLabelText('Holdings market value'), '980000');
    await user.type(within(dlg).getByLabelText('Trade count'), '3');
    const file = within(dlg).getByLabelText(/Official day-end file/) as HTMLInputElement;
    expect(file).toBeRequired();
    await attachFile(user, file, new File(['%PDF-1.4'], 'dayend.pdf', { type: 'application/pdf' }));
  };

  it('LPC-020: saving creates a Draft only (the form closes and nothing is submitted); Submit is a separate step. Sends multipart fields + file with an Idempotency-Key', async () => {
    const { api, user, dlg } = await openNew({ [`POST ${DE}`]: { status: 201, body: { package: dayEnd(), warnings: [] } } } as never);
    await fill(user, dlg);
    await user.type(within(dlg).getByLabelText(/Total quantity/), '1500');
    await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${DE}`));
    expectIdempotencyKey(req);
    const fd = req.body as FormData;
    expect(fd.get('closingCash')).toBe('125000.50');
    expect(fd.get('holdingsMv')).toBe('980000');
    expect(fd.get('tradeCount')).toBe('3');
    expect(fd.get('tradeQuantity')).toBe('1500');
    expect(fd.get('accountRef')).toBe('CUST-CL-00418');
    expect(fd.get('currency')).toBe('USD');
    expect(fd.get('statementDate')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((fd.get('file') as File).name).toBe('dayend.pdf');
    expect(fd.has('supersedesId')).toBe(false);
    expect(await screen.findByRole('status')).toHaveTextContent('Draft saved. Submit it when the control totals agree.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expectNotCalled(api, `POST ${DE}/:id/submit`);
  });

  it('LPC-016: a duplicate-draft warning from the API is shown as a warning notice after saving', async () => {
    const { user, dlg } = await openNew({ [`POST ${DE}`]: { status: 201, body: { package: dayEnd(), warnings: ['Draft CDE-10000 already exists for this account, date and currency'] } } } as never);
    await fill(user, dlg);
    await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
    const note = await screen.findByText(/Draft CDE-10000 already exists/);
    expect(note).toHaveTextContent('Draft saved. Draft CDE-10000 already exists for this account, date and currency. Submit only one of them.');
    expect(note).toHaveClass('warn');
  });

  it('package_exists (409) stays in the dialog, the button recovers and a retry reuses the same Idempotency-Key', async () => {
    const { api, user, dlg } = await openNew({ [`POST ${DE}`]: fail(409, 'package_exists', 'Package CDE-9 already covers this account, date and currency; supersede it with a reason') } as never);
    await fill(user, dlg);
    await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Package CDE-9 already covers this account');
    await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.calls(`POST ${DE}`)).toHaveLength(2));
    const [a, b] = api.calls(`POST ${DE}`);
    expect(b!.idempotencyKey).toBe(a!.idempotencyKey);
  });

  it('double click on Save draft sends one request', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user, dlg } = await openNew({ [`POST ${DE}`]: async () => (await gate, { status: 201, body: { package: dayEnd(), warnings: [] } }) } as never);
    await fill(user, dlg);
    const btn = within(dlg).getByRole('button', { name: 'Save draft' });
    await user.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await user.click(btn);
    release();
    await screen.findByText(/Draft saved/);
    expect(api.calls(`POST ${DE}`)).toHaveLength(1);
  });

  it('statement date cannot be set in the future (max = today in Harare)', async () => {
    const { dlg } = await openNew();
    const max = (within(dlg).getByLabelText('Statement date') as HTMLInputElement).max;
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${max}T00:00:00Z`).getTime()).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000);
  });

  it('control totals: "Fill from executions received" loads the day, pre-fills count, quantity and notional and lists existing packages', async () => {
    const { api, user, dlg } = await openNew({
      [`GET ${TOTALS}`]: raw({
        date: '2026-10-01',
        items: [
          { accountRef: 'CUST-CL-00418', currency: 'USD', executions: 3, quantity: '1500.50000000', notional: '276.10', packages: [{ id: 'p1', ref: 'CDE-777', status: 'Received', currency: 'USD' }] },
          { accountRef: 'CUST-CL-00419', currency: null, executions: 0, quantity: '0.00000000', notional: '0.00', packages: [] },
        ],
      }),
    } as never);
    const date = within(dlg).getByLabelText('Statement date');
    await user.clear(date);
    await user.type(date, '2026-10-01');
    await user.click(within(dlg).getByRole('button', { name: 'Fill control totals from executions received' }));
    await waitFor(() => expect(within(dlg).getByLabelText('Trade count')).toHaveValue('3'));
    expect(api.calls(`GET ${TOTALS}`)[0]!.query.get('date')).toBe('2026-10-01');
    expect(within(dlg).getByLabelText(/Total quantity/)).toHaveValue('1500.50000000');
    expect(within(dlg).getByLabelText(/Total notional/)).toHaveValue('276.10');
    expect(within(dlg).getByText('CDE-777 (Received)')).toBeInTheDocument();
    expect(within(dlg).getByText('1,500.5')).toBeInTheDocument();
  });

  it('control totals for an account with no executions pre-fill a nil day-end (count 0, no quantity/notional)', async () => {
    const { user, dlg } = await openNew({
      [`GET ${TOTALS}`]: raw({ date: '2026-10-01', items: [{ accountRef: 'CUST-CL-00418', currency: null, executions: 0, quantity: '0.00000000', notional: '0.00', packages: [] }] }),
    } as never);
    await user.type(within(dlg).getByLabelText('Trade count'), '9');
    await user.click(within(dlg).getByRole('button', { name: 'Fill control totals from executions received' }));
    await waitFor(() => expect(within(dlg).getByLabelText('Trade count')).toHaveValue('0'));
    expect(within(dlg).getByLabelText(/Total quantity/)).toHaveValue('');
  });

  it('control totals error is shown in the dialog', async () => {
    const { user, dlg } = await openNew({ [`GET ${TOTALS}`]: fail(400, 'bad_request', 'Give the statement date as YYYY-MM-DD') } as never);
    await user.click(within(dlg).getByRole('button', { name: 'Fill control totals from executions received' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Give the statement date as YYYY-MM-DD');
  });
});

describe('custodian day-end: supersede', () => {
  it('locks account/date/currency, requires a reason, and sends supersedesId with the new figures', async () => {
    const ctx = await open([dayEnd({ status: 'Approved' })], {}, { [`POST ${DE}`]: { status: 201, body: { package: dayEnd({ id: 'new' }), warnings: [] } } } as never);
    await ctx.user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Supersede' }));
    const dlg = await screen.findByRole('dialog', { name: 'Supersede CDE-10001' });
    expect(within(dlg).getByLabelText('Statement date')).toBeDisabled();
    expect(within(dlg).getByLabelText('Account')).toBeDisabled();
    expect(within(dlg).getByLabelText('Currency')).toBeDisabled();
    expect(within(dlg).getByLabelText('Closing cash')).toHaveValue('125000.50');
    expect(within(dlg).getByLabelText(/Reason for superseding/)).toBeRequired();
    await ctx.user.type(within(dlg).getByLabelText(/Reason for superseding/), 'Bank corrected the closing cash');
    await attachFile(ctx.user, within(dlg).getByLabelText(/Official day-end file/) as HTMLInputElement, new File(['x'], 'v2.pdf'));
    await ctx.user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
    const [req] = await waitFor(() => expectCalled(ctx.api, `POST ${DE}`));
    const fd = req.body as FormData;
    expect(fd.get('supersedesId')).toBe('de-1');
    expect(fd.get('supersedeReason')).toBe('Bank corrected the closing cash');
    expect(fd.get('statementDate')).toBe('2026-10-01');
  });
});

describe('custodian day-end: controls and history', () => {
  it('shows file info, hash, the three control rows with Agrees/Differs and the Matanho review note', async () => {
    const { api, user } = await open([dayEnd({ status: 'Rejected' })]);
    api.on(`GET ${DE}/:id`, raw({
      package: dayEnd({ status: 'Rejected' }),
      controls: { executionsReceived: 2, tradeCount: 3, matches: false, quantity: { declared: '1500.00000000', received: '1500.00000000', matches: true }, notional: { declared: '276.00', received: '270.00', matches: false } },
      review: { decision: 'Rejected', note: 'Closing cash does not reconcile', at: '2026-10-02T09:00:00.000Z' },
    }));
    api.on(`GET ${DE}/:id/history`, raw({ package: { id: 'de-1', ref: 'CDE-10001' }, events: [{ action: 'created', reason: null, by: 'Your organisation', at: '2026-10-02T07:00:00.000Z' }, { action: 'rejected', reason: 'Closing cash does not reconcile', by: 'Matanho', at: '2026-10-02T09:00:00.000Z' }] }));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Controls and history' }));
    const dlg = await screen.findByRole('dialog', { name: /CDE-10001: CUST-CL-00418, 1 Oct 2026/ });
    expect(await within(dlg).findByText(/dayend.pdf \(20 KB\)/)).toBeInTheDocument();
    expect(within(dlg).getByText(`SHA-256 ${'cd'.repeat(32)}`)).toBeInTheDocument();
    const trade = within(dlg).getByRole('cell', { name: 'Trade count' }).closest('tr')!;
    expect(within(trade).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Trade count', '3', '2', 'Differs']);
    expect(within(within(dlg).getByRole('cell', { name: 'Quantity' }).closest('tr')!).getByText('Agrees')).toBeInTheDocument();
    expect(within(within(dlg).getByRole('cell', { name: 'Notional' }).closest('tr')!).getByText('Differs')).toBeInTheDocument();
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Matanho review: Rejected. Closing cash does not reconcile');
    await waitFor(() => expect(within(dlg).getByText(/created/)).toBeInTheDocument());
    expect(within(dlg).getAllByText(/Closing cash does not reconcile/).length).toBeGreaterThanOrEqual(2);
  });

  it('a package without a file shows the statement-feed wording', async () => {
    const { api, user } = await open([dayEnd({ file: null, sha256: null })]);
    api.on(`GET ${DE}/:id`, raw({ package: dayEnd({ file: null, sha256: null }), controls: { executionsReceived: 3, tradeCount: 3, matches: true }, review: null }));
    api.on(`GET ${DE}/:id/history`, raw({ events: [] }));
    await user.click(within(await screen.findByText('CDE-10001').then((e) => e.closest('tr')!)).getByRole('button', { name: 'Controls and history' }));
    expect(await screen.findByText(/File: none \(statement feed\)/)).toBeInTheDocument();
    expect(screen.queryByText(/SHA-256/)).toBeNull();
    expectNotCalled(api, `POST ${DE}/:id/approve`);
  });
});
