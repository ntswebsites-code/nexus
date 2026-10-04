import { describe, it, expect } from 'vitest';
import ExecutionsPage from '@/app/(portal)/executions/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNoUnmocked, expectNotCalled, fail, mockApi, ok, raw, screen, waitFor, within } from '../_helpers';
import { execution, renderPortal, shellRoutes } from './_support';

const EX = '/api/v1/custodian/executions';
const list = (items: unknown[]) => raw({ items });

async function openPage(extra: Record<string, unknown> = {}, shell = {}) {
  const api = mockApi({ ...shellRoutes(shell), [`GET ${EX}`]: list([execution()]), ...(extra as never) });
  const view = renderPortal(<ExecutionsPage />);
  await screen.findByText('CEX-10001');
  return { api, ...view };
}

describe('custodian executions: list', () => {
  it('renders real API fields: ref, trade reference, trade, quantity, price with currency, settlement, status', async () => {
    await openPage();
    const row = screen.getByText('CEX-10001').closest('tr')!;
    expect(within(row).getByText('TRD-1001')).toBeInTheDocument();
    expect(within(row).getByText('BUY DLTA.ZW')).toBeInTheDocument();
    expect(within(row).getByText('500')).toBeInTheDocument();
    expect(within(row).getByText('0.1840 USD')).toBeInTheDocument();
    expect(within(row).getByText('Received')).toHaveClass('cx-badge', 'info');
    expect(within(row).getByText('5 Oct 2026')).toBeInTheDocument();
    expect(within(row).getByText(/^1 Oct 2026, \d\d:\d\d$/)).toBeInTheDocument();
  });

  it('LPC-018: fractional quantities are shown in full, not rounded to a whole number', async () => {
    mockApi({
      ...shellRoutes(),
      [`GET ${EX}`]: list([execution({ id: 'a', ref: 'CEX-A', quantity: '0.5' }), execution({ id: 'b', ref: 'CEX-B', quantity: '1234.5678' }), execution({ id: 'c', ref: 'CEX-C', quantity: '40000' })]),
    });
    renderPortal(<ExecutionsPage />);
    expect(within((await screen.findByText('CEX-A')).closest('tr')!).getByText('0.5')).toBeInTheDocument();
    expect(within(screen.getByText('CEX-B').closest('tr')!).getByText('1,234.5678')).toBeInTheDocument();
    expect(within(screen.getByText('CEX-C').closest('tr')!).getByText('40,000')).toBeInTheDocument();
  });

  it('shows the amend count and only offers Amend/Cancel on amendable rows (Matched is read only)', async () => {
    mockApi({
      ...shellRoutes(),
      [`GET ${EX}`]: list([execution({ amendCount: 2 }), execution({ id: 'ex-2', ref: 'CEX-10002', status: 'Matched', amendable: false })]),
    });
    renderPortal(<ExecutionsPage />);
    const r1 = (await screen.findByText('CEX-10001')).closest('tr')!;
    const r2 = screen.getByText('CEX-10002').closest('tr')!;
    expect(within(r1).getByText(/amended 2x/)).toBeInTheDocument();
    expect(within(r1).getByRole('button', { name: 'Amend' })).toBeInTheDocument();
    expect(within(r2).queryByRole('button', { name: 'Amend' })).toBeNull();
    expect(within(r2).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(within(r2).getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('empty and error states', async () => {
    mockApi({ ...shellRoutes(), [`GET ${EX}`]: list([]) });
    const a = renderPortal(<ExecutionsPage />);
    expect(await screen.findByText('No executions match.')).toBeInTheDocument();
    a.unmount();
    mockApi({ ...shellRoutes(), [`GET ${EX}`]: fail(500, 'internal_error', 'The server had a problem') });
    renderPortal(<ExecutionsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server had a problem');
  });

  it('shows a loading state before the data arrives', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    mockApi({ ...shellRoutes(), [`GET ${EX}`]: async () => (await gate, { status: 200, body: { items: [] } }) });
    renderPortal(<ExecutionsPage />);
    await screen.findByRole('navigation', { name: 'Main' });
    expect(await screen.findByText('Loading...')).toBeInTheDocument();
    release();
    expect(await screen.findByText('No executions match.')).toBeInTheDocument();
  });

  it('a slow older response never overwrites a newer filtered one (deep link /executions?status=Exception)', async () => {
    window.history.replaceState(null, '', '/executions?status=Exception');
    let releaseOld: () => void = () => undefined;
    const old = new Promise<void>((r) => (releaseOld = r));
    mockApi({
      ...shellRoutes(),
      [`GET ${EX}`]: async (req) => {
        if (!req.query.get('status')) {
          await old;
          return { status: 200, body: { items: [execution({ id: 'all', ref: 'CEX-ALL', status: 'Matched' })] } };
        }
        return { status: 200, body: { items: [execution({ id: 'exc', ref: 'CEX-EXC', status: 'Exception' })] } };
      },
    });
    renderPortal(<ExecutionsPage />);
    await screen.findByText('CEX-EXC');
    releaseOld();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText('CEX-EXC')).toBeInTheDocument();
    expect(screen.queryByText('CEX-ALL')).toBeNull();
    window.history.replaceState(null, '', '/');
  });

  it('status and account filters refetch with the right query', async () => {
    const { api, user } = await openPage();
    await user.selectOptions(screen.getByLabelText('Status'), 'Exception');
    await waitFor(() => expect(api.calls(`GET ${EX}`).at(-1)!.query.get('status')).toBe('Exception'));
    await user.selectOptions(screen.getByLabelText('Account'), 'CUST-CL-00419');
    await waitFor(() => expect(api.calls(`GET ${EX}`).at(-1)!.query.get('accountRef')).toBe('CUST-CL-00419'));
    expect(api.calls(`GET ${EX}`).at(-1)!.query.get('status')).toBe('Exception');
  });

  it('text from the API is rendered as text (no HTML or formula interpretation)', async () => {
    mockApi({ ...shellRoutes(), [`GET ${EX}`]: list([execution({ tradeRef: '<img src=x onerror=alert(1)>', ticker: '=CMD()' })]) });
    const { container } = renderPortal(<ExecutionsPage />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('BUY =CMD()')).toBeInTheDocument();
  });

  it('permission: a user without submit rights sees the list but no New/Amend/Cancel, with an explanation', async () => {
    await openPage({}, { permissions: [] });
    expect(screen.queryByRole('button', { name: 'New execution' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Amend' })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});

describe('custodian executions: new execution', () => {
  async function fillAndOpen() {
    const ctx = await openPage();
    await ctx.user.click(screen.getByRole('button', { name: 'New execution' }));
    const dlg = await screen.findByRole('dialog', { name: 'New execution' });
    return { ...ctx, dlg };
  }
  const type = async (user: ReturnType<typeof renderPortal>['user'], dlg: HTMLElement, label: string, v: string) => user.type(within(dlg).getByLabelText(label), v);

  it('LPC-018: the form starts empty (no demo values), offers USD/ZWG/ZAR and allows fractional quantity', async () => {
    const { dlg } = await fillAndOpen();
    for (const l of ['Trade reference', 'Ticker', 'Quantity', 'Price', 'Broker (optional)']) expect(within(dlg).getByLabelText(l)).toHaveValue('');
    expect(within(dlg).getAllByRole('option', { name: /^(USD|ZWG|ZAR)$/ }).map((o) => o.textContent)).toEqual(['USD', 'ZWG', 'ZAR']);
    expect(within(dlg).getByLabelText('Quantity')).not.toHaveAttribute('min');
    expect(dlg.textContent).not.toMatch(/demo|prototype/i);
  });

  it('LPC-014: submits one execution with an ISO date-time (with Z) and an Idempotency-Key, closes the dialog, shows the success note and refetches', async () => {
    const { api, user, dlg } = await fillAndOpen();
    api.on(`POST ${EX}`, ok({ created: [execution()], duplicates: [] }, 201));
    const before = api.calls(`GET ${EX}`).length;
    await type(user, dlg, 'Trade reference', 'TRD-2002');
    await type(user, dlg, 'Ticker', 'DLTA.ZW');
    await type(user, dlg, 'Quantity', '0.5');
    await type(user, dlg, 'Price', '1.25');
    await user.selectOptions(within(dlg).getByLabelText('Side'), 'SELL');
    await user.selectOptions(within(dlg).getByLabelText('Currency'), 'ZAR');
    await user.click(within(dlg).getByRole('button', { name: 'Submit execution' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${EX}`));
    expectIdempotencyKey(req);
    expectBody(req, { executions: [{ tradeRef: 'TRD-2002', ticker: 'DLTA.ZW', quantity: '0.5', price: '1.25', side: 'SELL', currency: 'ZAR', accountRef: 'CUST-CL-00418' }] });
    expect((req.body as { executions: { executionAt: string }[] }).executions[0]!.executionAt).toMatch(/Z$/);
    expect(await screen.findByRole('status')).toHaveTextContent('Execution submitted');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.calls(`GET ${EX}`).length).toBeGreaterThan(before);
  });

  it('LPC-015: an API validation error is shown in the dialog, the button is usable again and the retry reuses the same Idempotency-Key', async () => {
    const { api, user, dlg } = await fillAndOpen();
    api.on(`POST ${EX}`, fail(400, 'validation_error', 'Quantity must be greater than zero', [{ path: 'executions.0.quantity', message: 'Quantity must be greater than zero' }]));
    await type(user, dlg, 'Trade reference', 'TRD-3');
    await type(user, dlg, 'Ticker', 'abc');
    await type(user, dlg, 'Quantity', '0');
    await type(user, dlg, 'Price', '1');
    await user.click(within(dlg).getByRole('button', { name: 'Submit execution' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Quantity must be greater than zero');
    expect(within(dlg).getByRole('button', { name: 'Submit execution' })).toBeEnabled();
    await user.click(within(dlg).getByRole('button', { name: 'Submit execution' }));
    await waitFor(() => expect(api.calls(`POST ${EX}`)).toHaveLength(2));
    const [a, b] = api.calls(`POST ${EX}`);
    expect(a!.idempotencyKey).toBeTruthy();
    expect(b!.idempotencyKey).toBe(a!.idempotencyKey);
  });

  it('LPC-013: spreadsheet-formula text refused by the API is reported with the server message and nothing is shown as stored', async () => {
    const { api, user, dlg } = await fillAndOpen();
    api.on(`POST ${EX}`, fail(400, 'validation_error', 'tradeRef: Text may not start with =, +, @ or - (spreadsheet formula)'));
    await type(user, dlg, 'Trade reference', '=CMD()1');
    await type(user, dlg, 'Ticker', 'abc');
    await type(user, dlg, 'Quantity', '10');
    await type(user, dlg, 'Price', '1');
    await user.click(within(dlg).getByRole('button', { name: 'Submit execution' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Text may not start with =');
    expect(screen.queryByText(/Execution submitted/)).toBeNull();
  });

  it('double submit sends one request while the first is in flight', async () => {
    const { api, user, dlg } = await fillAndOpen();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    api.on(`POST ${EX}`, async () => (await gate, { status: 201, body: { created: [], duplicates: [] } }));
    await type(user, dlg, 'Trade reference', 'TRD-4');
    await type(user, dlg, 'Ticker', 'abc');
    await type(user, dlg, 'Quantity', '10');
    await type(user, dlg, 'Price', '1');
    const btn = within(dlg).getByRole('button', { name: 'Submit execution' });
    await user.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await user.click(btn);
    release();
    await screen.findByText(/Execution submitted/);
    expect(api.calls(`POST ${EX}`)).toHaveLength(1);
  });

  it('required fields block the request (nothing is sent for an empty form)', async () => {
    const { api, user, dlg } = await fillAndOpen();
    await user.click(within(dlg).getByRole('button', { name: 'Submit execution' }));
    expectNotCalled(api, `POST ${EX}`);
  });

  it('dashboard deep link /executions?new=1 opens the New execution dialog', async () => {
    window.history.replaceState(null, '', '/executions?new=1');
    mockApi({ ...shellRoutes(), [`GET ${EX}`]: list([]) });
    renderPortal(<ExecutionsPage />);
    expect(await screen.findByRole('dialog', { name: 'New execution' })).toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('dashboard deep link /executions?status=Exception filters the list', async () => {
    window.history.replaceState(null, '', '/executions?status=Exception');
    const api = mockApi({ ...shellRoutes(), [`GET ${EX}`]: list([]) });
    renderPortal(<ExecutionsPage />);
    await waitFor(() => expect(api.calls(`GET ${EX}`).some((r) => r.query.get('status') === 'Exception')).toBe(true));
    expect(screen.getByLabelText('Status')).toHaveValue('Exception');
    window.history.replaceState(null, '', '/');
  });
});

describe('custodian executions: amend', () => {
  async function amend(over: Record<string, unknown> = {}) {
    const api = mockApi({ ...shellRoutes(), [`GET ${EX}`]: list([execution(over)]) });
    const view = renderPortal(<ExecutionsPage />);
    await screen.findByText('CEX-10001');
    await view.user.click(screen.getByRole('button', { name: 'Amend' }));
    const dlg = await screen.findByRole('dialog', { name: /Amend CEX-10001/ });
    return { api, ...view, dlg };
  }

  it.each([['500'], ['100'], ['40000'], ['10000'], ['500.50000000']])('LPC-017 blocker: quantity %s is pre-filled exactly as the API sent it (zeros are never stripped)', async (q) => {
    const { dlg } = await amend({ quantity: q });
    expect(within(dlg).getByLabelText('Quantity')).toHaveValue(q);
  });

  it('LPC-017 regression: changing only the price patches only the price (quantity 500 is not sent as 5)', async () => {
    const { api, user, dlg } = await amend({ quantity: '500' });
    api.on(`PATCH ${EX}/:id`, ok({ execution: execution(), changes: {} }));
    const price = within(dlg).getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '0.19');
    await user.type(within(dlg).getByLabelText(/Reason for the amendment/), 'Price corrected');
    await user.click(within(dlg).getByRole('button', { name: 'Save amendment' }));
    const [req] = await waitFor(() => expectCalled(api, `PATCH ${EX}/:id`));
    expect(req.path).toBe(`${EX}/ex-1`);
    expect(req.body).toEqual({ price: '0.19', reason: 'Price corrected' });
    expect(req.body).not.toHaveProperty('quantity');
    expectIdempotencyKey(req);
    expect(await screen.findByRole('status')).toHaveTextContent('CEX-10001 amended and returned to the matching queue.');
    expect(api.calls(`GET ${EX}`).length).toBeGreaterThanOrEqual(2);
  });

  it('changing the quantity sends the typed value, with zeros intact', async () => {
    const { api, user, dlg } = await amend({ quantity: '500' });
    api.on(`PATCH ${EX}/:id`, ok({ execution: execution() }));
    const q = within(dlg).getByLabelText('Quantity');
    await user.clear(q);
    await user.type(q, '5000');
    await user.type(within(dlg).getByLabelText(/Reason for the amendment/), 'Typo fix');
    await user.click(within(dlg).getByRole('button', { name: 'Save amendment' }));
    const [req] = await waitFor(() => expectCalled(api, `PATCH ${EX}/:id`));
    expect(req.body).toEqual({ quantity: '5000', reason: 'Typo fix' });
  });

  it('saving with no change asks for a change and sends nothing; the trade reference is not editable', async () => {
    const { api, user, dlg } = await amend();
    expect(within(dlg).queryByLabelText('Trade reference')).toBeNull();
    await user.type(within(dlg).getByLabelText(/Reason for the amendment/), 'No-op');
    await user.click(within(dlg).getByRole('button', { name: 'Save amendment' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Change at least one field.');
    expectNotCalled(api, `PATCH ${EX}/:id`);
  });

  it('LPC-015: a missing/short reason message from the API is shown verbatim and the dialog stays open', async () => {
    const { api, user, dlg } = await amend();
    api.on(`PATCH ${EX}/:id`, fail(400, 'validation_error', 'reason: Give a reason for the amendment'));
    await user.type(within(dlg).getByLabelText('Ticker'), 'X');
    await user.type(within(dlg).getByLabelText(/Reason for the amendment/), 'abc');
    await user.click(within(dlg).getByRole('button', { name: 'Save amendment' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Give a reason for the amendment');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a 409 (already matched meanwhile) is reported and the user can close the dialog with Escape', async () => {
    const { api, user, dlg } = await amend();
    api.on(`PATCH ${EX}/:id`, fail(409, 'invalid_transition', 'This execution can no longer be amended'));
    await user.type(within(dlg).getByLabelText('Ticker'), 'X');
    await user.type(within(dlg).getByLabelText(/Reason for the amendment/), 'late fix');
    await user.click(within(dlg).getByRole('button', { name: 'Save amendment' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('can no longer be amended');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('custodian executions: cancel and history', () => {
  it('cancel posts the reason to /cancel with an Idempotency-Key, refetches and confirms', async () => {
    const { api, user } = await openPage();
    api.on(`POST ${EX}/:id/cancel`, ok({ execution: execution({ status: 'Cancelled' }) }));
    const before = api.calls(`GET ${EX}`).length;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dlg = await screen.findByRole('dialog', { name: /Cancel CEX-10001/ });
    expect(within(dlg).getByText(/trade reference cannot be reused/)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText('Reason for the cancellation'), 'Booked in error');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel execution' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${EX}/:id/cancel`));
    expect(req.path).toBe(`${EX}/ex-1/cancel`);
    expect(req.body).toEqual({ reason: 'Booked in error' });
    expectIdempotencyKey(req);
    expect(await screen.findByRole('status')).toHaveTextContent('CEX-10001 cancelled.');
    expect(api.calls(`GET ${EX}`).length).toBeGreaterThan(before);
  });

  it('cancel without a reason sends nothing; an API error stays in the dialog', async () => {
    const { api, user } = await openPage();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel execution' }));
    expectNotCalled(api, `POST ${EX}/:id/cancel`);
    api.on(`POST ${EX}/:id/cancel`, fail(409, 'invalid_transition', 'Matched executions cannot be cancelled'));
    await user.type(within(dlg).getByLabelText('Reason for the cancellation'), 'because');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel execution' }));
    expect(await within(dlg).findByText('Matched executions cannot be cancelled')).toBeInTheDocument();
  });

  it('history modal lists events with who did it, the reason and the changed fields', async () => {
    const { api, user } = await openPage();
    api.on(`GET ${EX}/:id/history`, raw({
      execution: execution(),
      events: [
        { id: 'e1', executionId: 'ex-1', action: 'submitted', fromStatus: null, toStatus: 'Received', reason: null, changes: null, by: 'Your organisation', at: '2026-10-01T08:31:00.000Z' },
        { id: 'e2', executionId: 'ex-1', action: 'amended', fromStatus: 'Received', toStatus: 'Received', reason: 'Price corrected', changes: { price: { from: '0.184', to: '0.19' } }, by: 'Your organisation', at: '2026-10-01T09:00:00.000Z' },
        { id: 'e3', executionId: 'ex-1', action: 'exception', fromStatus: 'Received', toStatus: 'Exception', reason: 'Price outside band', changes: null, by: 'Matanho', at: '2026-10-01T10:00:00.000Z' },
      ],
    }));
    await user.click(screen.getByRole('button', { name: 'History' }));
    const dlg = await screen.findByRole('dialog', { name: /History of CEX-10001/ });
    expect(await within(dlg).findByText(/Price corrected/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Changed: price/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Price outside band/)).toBeInTheDocument();
    expect(within(dlg).getAllByText(/Your organisation|Matanho/).length).toBe(3);
    expectNoUnmocked();
  });
});
