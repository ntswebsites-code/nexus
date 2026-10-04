import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpCapitalActivityScreen } from '@/components/lp-portal/screens/lp-capital-activity-screen';
import { toast } from 'sonner';
import { ok, fail, raw, screen, waitFor, within, expectCalled, expectIdempotencyKey, expectNoUnmocked } from '../_helpers';
import { API, liveApi, renderLp, list, sessionData, useNodeBlob } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const CALL_OPEN = {
  id: 'cc-013', callNo: 13, fundId: 'fund-growth-1', fundName: 'Growth Fund I', issueDate: '2026-05-01', dueDate: '2099-06-01',
  currencyCode: 'USD', amount: '200000.00', paid: '50000.00', outstanding: '150000.00', status: 'ISSUED', acknowledgedAt: null,
};
const CALL_PAID = {
  id: 'cc-012', callNo: 12, fundId: 'fund-growth-1', fundName: 'Growth Fund I', issueDate: '2026-03-01', dueDate: '2026-04-01',
  currencyCode: 'USD', amount: '1150000.00', paid: '1150000.00', outstanding: '0.00', status: 'PAID', acknowledgedAt: '2026-03-02T00:00:00Z',
};
const DETAIL = (c: typeof CALL_OPEN) => ({
  ...c,
  wiring: { bankName: 'First Bank', accountName: 'Growth Fund I Ltd', accountNumber: null, accountNumberMasked: '****1234', abaRouting: '021000021', reference: 'GF1-CALL-13', raw: null },
  timeline: [{ code: 'CALL_ISSUED', at: '2026-05-01T00:00:00Z', completed: true }, { code: 'PAYMENT_RECEIVED', at: null, completed: false }],
});
const SUMMARY = { openCount: 1, outstanding: '150000.00', overdue: '0.00', paidYtd: '999.00', currencyCode: 'USD', paidCallCount: 1, dueSoonCount: 0, dueSoonAmount: '0', totalDistributions: '750000.00', upcomingDistributionNotices: { count: 2 } };
const DISTS = [
  { id: 'd8', reference: 'DIST-008', fundId: 'fund-growth-1', fundName: 'Growth Fund I', paymentDate: '2026-02-01', type: 'Exit Proceeds', currencyCode: 'USD', gross: '500000.00', adjustments: '-5000.00', netPaid: '495000.00', status: 'PAID', destinationBankMasked: '****9', documentId: 'doc-d8' },
  { id: 'd7', reference: 'DIST-007', fundId: 'fund-growth-1', fundName: 'Growth Fund I', paymentDate: '2026-01-01', type: 'Dividend', currencyCode: 'USD', gross: '10000.00', adjustments: '0.00', netPaid: '10000.00', status: 'PAID', destinationBankMasked: null, documentId: null },
];

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/capital-calls/summary`]: ok(SUMMARY),
    [`GET ${API}/capital-calls/:id/documents`]: ok([{ id: 'doc-n13', name: 'Call Notice 13', category: 'CALL_NOTICE', publishedDate: '2026-05-01', checksumSha256: 'x', status: 'PUBLISHED' }]),
    [`GET ${API}/capital-calls/:id`]: (_r: unknown, p: Record<string, string>) => ok(DETAIL(p.id === 'cc-012' ? CALL_PAID : CALL_OPEN)),
    [`GET ${API}/capital-calls`]: ok(list([CALL_OPEN, CALL_PAID])),
    [`GET ${API}/distributions`]: ok(list(DISTS)),
    ...over,
  } as never;
}

const pdf = () => new File(['%PDF'], 'wire-proof.pdf', { type: 'application/pdf' });
async function pickFile(user: ReturnType<typeof renderLp>['user'], container: HTMLElement, file = pdf()) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  await user.upload(input, file);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('Capital calls: list and KPIs', () => {
  it('renders calls with fund names and money, selects the first call and loads its detail + notice docs', async () => {
    const api = liveApi(routes());
    renderLp(<LpCapitalActivityScreen />);
    expect((await screen.findAllByText('$150,000')).length).toBeGreaterThan(0);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Growth Fund I')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Issued')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Paid')).toBeInTheDocument();
    expect(screen.queryByText('fund-growth-1')).not.toBeInTheDocument();
    await screen.findByText('****1234'); // masked account number from detail
    expect(screen.getByText('021000021')).toBeInTheDocument();
    expectCalled(api, `GET ${API}/capital-calls/cc-013`);
    expectCalled(api, `GET ${API}/capital-calls/cc-013/documents`);
    expect(api.calls(`GET ${API}/capital-calls`)[0].query.get('pageSize')).toBe('50');
    expectNoUnmocked();
  });

  it('LPC-023: Paid Calls KPI equals the sum of calls listed as Paid (not the YTD figure) and distribution types are as reported', async () => {
    const { user } = (liveApi(routes()), renderLp(<LpCapitalActivityScreen />));
    const kpi = (await screen.findByText('Paid Calls')).parentElement!;
    expect(kpi).toHaveTextContent('$1.15M'); // 1,150,000 from CC-012; paidYtd (999) must not be shown
    expect(kpi).not.toHaveTextContent('$999');
    await user.click(screen.getByRole('button', { name: 'Distributions' }));
    expect(await screen.findByText('Exit Proceeds')).toBeInTheDocument();
    expect(screen.getByText('Dividend')).toBeInTheDocument();
    expect(screen.getByText('DIST-008')).toBeInTheDocument();
    expect(screen.getByText('DIST-007')).toBeInTheDocument();
  });

  it('upcoming distribution notices footer is pluralised from the API', async () => {
    liveApi(routes());
    renderLp(<LpCapitalActivityScreen />);
    expect(await screen.findByText('2 Upcoming Notices')).toBeInTheDocument();
  });

  it('?call= deep link selects that call and loads its detail', async () => {
    const api = liveApi(routes());
    renderLp(<LpCapitalActivityScreen initialCallId="cc-012" />);
    await screen.findByText('****1234');
    expectCalled(api, `GET ${API}/capital-calls/cc-012`);
    expect(api.calls(`GET ${API}/capital-calls/cc-013`)).toHaveLength(0);
  });

  it('?tab=distributions opens on distributions', async () => {
    liveApi(routes());
    renderLp(<LpCapitalActivityScreen initialTab="distributions" />);
    expect(await screen.findByText('Exit Proceeds')).toBeInTheDocument();
  });

  it('empty state: no calls, no crash, notice actions disabled', async () => {
    liveApi(routes({ [`GET ${API}/capital-calls`]: ok(list([])), [`GET ${API}/distributions`]: ok(list([])), [`GET ${API}/capital-calls/summary`]: ok({ ...SUMMARY, openCount: 0, outstanding: '0' }) }));
    renderLp(<LpCapitalActivityScreen />);
    expect(await screen.findByRole('heading', { name: /Capital Calls & Distributions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit Payment Confirmation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Notice' })).toBeDisabled();
  });

  it('error state (one list failing while the other loads) shows the API message instead of a silent empty table; Try Again refetches', async () => {
    let n = 0;
    const api = liveApi(routes({ [`GET ${API}/capital-calls`]: () => (++n === 1 ? fail(500, 'internal', 'Service down') : ok(list([CALL_OPEN]))) }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    expect(await screen.findByText(/Service down/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect((await screen.findAllByText('$150,000')).length).toBeGreaterThan(0);
    expect(api.calls(`GET ${API}/capital-calls`).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Payment confirmation (LPC-003 / LPC-026)', () => {
  async function openDialog() {
    const api = liveApi(routes());
    const r = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await pickFile(r.user, r.container);
    const dialog = await screen.findByRole('dialog');
    return { api, dialog, ...r };
  }

  it('LPC-026: picking a file opens a dialog with amount prefilled to the outstanding balance, notes, and the file name', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByText('wire-proof.pdf')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Amount paid')).toHaveValue('150000');
    expect(within(dialog).getByLabelText('Notes (optional)')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Call No\. 13/);
    expect(dialog).toHaveTextContent('150,000.00');
  });

  it('LPC-003: amount above outstanding is rejected client side and nothing is uploaded', async () => {
    const { api, dialog, user } = await openDialog();
    const amount = within(dialog).getByLabelText('Amount paid');
    await user.clear(amount);
    await user.type(amount, '99999999');
    await user.click(within(dialog).getByRole('button', { name: 'Submit confirmation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('cannot exceed the outstanding balance');
    expect(api.calls(`POST ${API}/capital-calls/cc-013/payment-confirmations`)).toHaveLength(0);
  });

  it.each(['', '0', '-5', 'abc', '12.345', '1,000'])('LPC-003: invalid amount %j is rejected with a field message and no request', async (bad) => {
    const { api, dialog, user } = await openDialog();
    const amount = within(dialog).getByLabelText('Amount paid');
    await user.clear(amount);
    if (bad) await user.type(amount, bad);
    await user.click(within(dialog).getByRole('button', { name: 'Submit confirmation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('positive number');
    expect(api.calls(`POST ${API}/capital-calls/cc-013/payment-confirmations`)).toHaveLength(0);
  });

  it('valid amount uploads multipart (file, amountClaimed, notes) with an Idempotency-Key, toasts, closes and refetches', async () => {
    const { api, dialog, user } = await openDialog();
    api.on(`POST ${API}/capital-calls/cc-013/payment-confirmations`, ok({ id: 'pc1', fileName: 'wire-proof.pdf', sha256: 'x', amountClaimed: '150000.00', uploadedAt: 'now' }, 201));
    await user.type(within(dialog).getByLabelText('Notes (optional)'), '  wired today ');
    await user.click(within(dialog).getByRole('button', { name: 'Submit confirmation' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [req] = expectCalled(api, `POST ${API}/capital-calls/cc-013/payment-confirmations`);
    expectIdempotencyKey(req);
    const fd = req.body as FormData;
    expect(fd.get('amountClaimed')).toBe('150000');
    expect(fd.get('notes')).toBe('wired today');
    expect((fd.get('file') as File).name).toBe('wire-proof.pdf');
    expect(vi.mocked(toast.success).mock.calls[0][0]).toContain('wire-proof.pdf');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.calls(`GET ${API}/capital-calls`).length).toBeGreaterThanOrEqual(2)); // refreshed after mutation
  });

  it('LPC-003 server rejection (already PAID / exceeds) is shown inside the dialog, which stays open', async () => {
    const { api, dialog, user } = await openDialog();
    api.on(`POST ${API}/capital-calls/cc-013/payment-confirmations`, {
      status: 400,
      body: { success: false, code: 'LP_VALIDATION', message: 'Amount exceeds the outstanding balance', fieldErrors: { amountClaimed: 'Amount exceeds the outstanding balance' } },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Submit confirmation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Amount exceeds the outstanding balance');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('double submit: while the upload is in flight the button is disabled so only one POST is sent', async () => {
    const { api, dialog, user } = await openDialog();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.on(`POST ${API}/capital-calls/cc-013/payment-confirmations`, async () => {
      await gate;
      return ok({ id: 'pc1', fileName: 'f', sha256: 'x', amountClaimed: '1', uploadedAt: 'n' }, 201);
    });
    const submit = within(dialog).getByRole('button', { name: 'Submit confirmation' });
    await user.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    await user.click(submit);
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(api.calls(`POST ${API}/capital-calls/cc-013/payment-confirmations`)).toHaveLength(1);
  });

  it('retry after a network/5xx failure reuses the SAME Idempotency-Key (no duplicate confirmation)', async () => {
    const { api, dialog, user } = await openDialog();
    let n = 0;
    api.on(`POST ${API}/capital-calls/cc-013/payment-confirmations`, () => (++n === 1 ? fail(500, 'internal', 'Gateway timeout') : ok({ id: 'pc1', fileName: 'f', sha256: 'x', amountClaimed: '1', uploadedAt: 'n' }, 201)));
    const submit = within(dialog).getByRole('button', { name: 'Submit confirmation' });
    await user.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Gateway timeout');
    await user.click(submit);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const reqs = api.calls(`POST ${API}/capital-calls/cc-013/payment-confirmations`);
    expect(reqs).toHaveLength(2);
    expect(reqs[0].idempotencyKey).toBe(reqs[1].idempotencyKey);
  });

  it('Cancel closes the dialog without a request', async () => {
    const { api, dialog, user } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.calls(`POST ${API}/capital-calls/cc-013/payment-confirmations`)).toHaveLength(0);
  });
});

describe('Acknowledge, notices, permissions', () => {
  it('Acknowledge sends one idempotent POST, toasts, disables itself and refreshes', async () => {
    const api = liveApi(routes({ [`POST ${API}/capital-calls/cc-013/acknowledge`]: ok({ acknowledgedAt: '2026-06-01T00:00:00Z' }) }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Capital call acknowledged'));
    expectIdempotencyKey(expectCalled(api, `POST ${API}/capital-calls/cc-013/acknowledge`)[0]);
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDisabled();
    await waitFor(() => expect(api.calls(`GET ${API}/capital-calls`).length).toBeGreaterThanOrEqual(2));
  });

  it('acknowledge failure surfaces the API message and does not mark the call acknowledged', async () => {
    liveApi(routes({ [`POST ${API}/capital-calls/cc-013/acknowledge`]: fail(409, 'LP_CONFLICT', 'Already acknowledged elsewhere') }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Already acknowledged elsewhere'));
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
  });

  it('step-up end to end: LP_STEP_UP_REQUIRED opens the MFA dialog; a valid code retries the acknowledge with the same key', async () => {
    let n = 0;
    const api = liveApi(
      routes({
        [`POST ${API}/capital-calls/cc-013/acknowledge`]: () => (++n === 1 ? fail(403, 'LP_STEP_UP_REQUIRED', 'Confirm this action with your code') : ok({ acknowledgedAt: 'now' })),
        'POST /api/v1/auth/mfa/step-up': ok({}),
      }),
    );
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    const dlg = await screen.findByTestId('lp-step-up-dialog');
    await user.type(within(dlg).getByLabelText('Authentication code'), '12');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('6-digit');
    const field = within(dlg).getByLabelText('Authentication code');
    await user.clear(field);
    await user.type(field, '123 456');
    await user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Capital call acknowledged'));
    const [step] = expectCalled(api, 'POST /api/v1/auth/mfa/step-up');
    expect(step.body).toEqual({ code: '123456' });
    const acks = api.calls(`POST ${API}/capital-calls/cc-013/acknowledge`);
    expect(acks).toHaveLength(2);
    expect(acks[0].idempotencyKey).toBe(acks[1].idempotencyKey);
  });

  it('step-up cancelled: the acknowledge fails visibly and is not retried', async () => {
    const api = liveApi(routes({ [`POST ${API}/capital-calls/cc-013/acknowledge`]: fail(403, 'LP_STEP_UP_REQUIRED', 'Confirm this action with your code') }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    const dlg = await screen.findByTestId('lp-step-up-dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(api.calls(`POST ${API}/capital-calls/cc-013/acknowledge`)).toHaveLength(1);
  });

  it('viewer role cannot acknowledge or submit payment confirmation (controls disabled), but can still download the notice', async () => {
    liveApi(routes(), { session: { lpRole: 'VIEWER' } });
    renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Submit Payment Confirmation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download Notice' })).toBeEnabled();
  });

  it('a viewer who somehow selects a file does not get the upload dialog', async () => {
    liveApi(routes(), { session: { lpRole: 'VIEWER' } });
    const { user, container } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await pickFile(user, container);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Download Notice fetches the notice blob and toasts; failure toasts the API message', async () => {
    useNodeBlob();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    const api = liveApi(routes({ [`GET ${API}/capital-calls/cc-013/notice/download`]: ok({ pdf: 1 }) }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'Download Notice' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Call No. 13')));
    expectCalled(api, `GET ${API}/capital-calls/cc-013/notice/download`);
    api.on(`GET ${API}/capital-calls/cc-013/notice/download`, fail(404, 'LP_NOT_FOUND', 'Notice not found'));
    await user.click(screen.getByRole('button', { name: 'Download Notice' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notice not found'));
  });

  it('View Notice navigates to the linked document in the Document Centre', async () => {
    const { router } = await import('../_helpers');
    liveApi(routes());
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(screen.getByRole('button', { name: 'View Notice' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/lp-portal/documents?document=doc-n13'));
  });

  it('distribution statement download passes the fund scope and as-of date', async () => {
    useNodeBlob();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    const api = liveApi(routes({ [`GET ${API}/distributions/statement/download`]: ok({}) }));
    const { user } = renderLp(<LpCapitalActivityScreen initialTab="distributions" />);
    await screen.findByText('Exit Proceeds');
    await user.click(screen.getByRole('button', { name: /Download Statement|Statement/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Downloaded distribution statement'));
    expect(api.calls(`GET ${API}/distributions/statement/download`)[0].query.get('asOfDate')).toBe('2026-06-30');
  });
});
