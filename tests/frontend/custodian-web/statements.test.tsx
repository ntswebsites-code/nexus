import { describe, it, expect, vi } from 'vitest';
import StatementsPage from '@/app/(portal)/statements/page';
import { expectCalled, expectIdempotencyKey, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { renderPortal, shellRoutes } from './_support';

const ST = '/api/v1/custodian/statements';
const HOLD = '/api/v1/custodian/holdings';

const fileRow = (over: Record<string, unknown> = {}) => ({
  id: 'f1', adapter: 'file-drop', filename: 'stmt-0930.csv', format: 'CSV', accountRef: 'CUST-CL-00418', statementDate: '2026-10-01', currency: 'USD', closingCash: '125000.50', holdingsMv: '980000.00',
  status: 'Imported', tradesImported: 4, tradesSkipped: 1, holdingsCount: 2, dayEndRef: 'CDE-10005', warnings: [], error: null, createdAt: '2026-10-01T06:00:00.000Z', ...over,
});
const holding = (over: Record<string, unknown> = {}) => ({ accountRef: 'CUST-CL-00418', statementDate: '2026-10-01', ticker: 'DLTA.ZW', isin: 'ZW0009012345', quantity: '12000.5', price: '0.1840', marketValue: '2208.09', currency: 'USD', ...over });
const checkOk = {
  valid: true,
  format: 'CSV',
  problems: [],
  statements: [{ accountRef: 'CUST-CL-00418', statementDate: '2026-10-01', currency: 'USD', closingCash: '125000.50', holdings: 2, holdingsMv: '980000.00', trades: 5, newTrades: 4, duplicateTrades: 1, warnings: ['Closing cash differs from the previous day by more than 20%'] }],
};

async function open(extra: Record<string, never> = {}, shell = {}) {
  const api = mockApi({
    ...shellRoutes(shell),
    [`GET ${ST}`]: raw({ mode: 'file-drop', formats: ['CSV', 'MT940', 'JSON'], adapterError: null, files: [fileRow()], statements: [] }),
    [`GET ${HOLD}`]: raw({ date: '2026-10-01', items: [holding()] }),
    ...extra,
  });
  const view = renderPortal(<StatementsPage />);
  await screen.findByText('stmt-0930.csv');
  return { api, ...view };
}
const fileInput = () => screen.getByLabelText('Statement file') as HTMLInputElement;
const stmt = (name = 'stmt.csv', body = 'a,b\n1,2\n') => new File([body], name, { type: 'text/csv' });

describe('custodian statements and holdings', () => {
  it('lists statement files (real fields) and the latest holdings with the statement date and unrounded quantities', async () => {
    await open();
    const r = screen.getByText('stmt-0930.csv').closest('tr')!;
    expect(within(r).getAllByRole('cell').slice(0, 8).map((c) => c.textContent)).toEqual(['stmt-0930.csv', 'CSV', 'CUST-CL-00418', '1 Oct 2026', '4 (+1 skipped)', '2', 'CDE-10005', 'Imported']);
    expect(screen.getByText('Latest holdings (statement of 1 Oct 2026)')).toBeInTheDocument();
    const h = screen.getByText('DLTA.ZW').closest('tr')!;
    expect(within(h).getByText('12,000.5')).toBeInTheDocument();
    expect(within(h).getByText('0.1840')).toBeInTheDocument();
    expect(within(h).getByText('2,208.09')).toBeInTheDocument();
    expect(within(h).getByText('ZW0009012345')).toBeInTheDocument();
  });

  it('empty states', async () => {
    mockApi({ ...shellRoutes(), [`GET ${ST}`]: raw({ mode: 'file-drop', adapterError: null, files: [], statements: [] }), [`GET ${HOLD}`]: raw({ date: null, items: [] }) });
    renderPortal(<StatementsPage />);
    expect(await screen.findByText('No statement files yet.')).toBeInTheDocument();
    expect(await screen.findByText('No holdings reported yet.')).toBeInTheDocument();
  });

  it('a not-configured live adapter is shown as a warning, not a crash', async () => {
    await open({ [`GET ${ST}`]: raw({ mode: 'live', adapterError: 'The custodian feed is not configured', files: [], statements: [] }) } as never).catch(() => undefined);
    expect(await screen.findByText('The custodian feed is not configured')).toHaveClass('warn');
  });

  it('account filter refetches holdings for that account', async () => {
    const { api, user } = await open();
    await user.selectOptions(screen.getByLabelText('Account'), 'CUST-CL-00419');
    await waitFor(() => expect(api.calls(`GET ${HOLD}`).at(-1)!.query.get('accountRef')).toBe('CUST-CL-00419'));
  });

  it('a failed file shows its error next to the status', async () => {
    mockApi({ ...shellRoutes(), [`GET ${ST}`]: raw({ mode: 'file-drop', adapterError: null, files: [fileRow({ status: 'Failed', error: 'Unknown account ACC-X' })], statements: [] }), [`GET ${HOLD}`]: raw({ date: null, items: [] }) });
    renderPortal(<StatementsPage />);
    const r = (await screen.findByText('stmt-0930.csv')).closest('tr')!;
    expect(within(r).getByText('Failed')).toHaveClass('bad');
    expect(within(r).getByText('Unknown account ACC-X')).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: 'Holdings' })).toBeNull();
  });

  it('Holdings button opens the holdings of that file with its warnings', async () => {
    mockApi({ ...shellRoutes(), [`GET ${ST}`]: raw({ mode: 'file-drop', adapterError: null, files: [fileRow({ warnings: ['2 lines had no price'] })], statements: [] }), [`GET ${HOLD}`]: raw({ date: null, items: [] }), [`GET ${ST}/files/:id`]: raw({ file: fileRow(), holdings: [holding({ ticker: 'MIMO.ZW', quantity: '300' })] }) });
    const { user } = renderPortal(<StatementsPage />);
    await user.click(await screen.findByRole('button', { name: 'Holdings' }));
    const dlg = await screen.findByRole('dialog', { name: 'Holdings in stmt-0930.csv' });
    expect(await within(dlg).findByText('MIMO.ZW')).toBeInTheDocument();
    expect(within(dlg).getByText('2 lines had no price')).toBeInTheDocument();
  });

  it('permission: without upload rights the upload card is replaced by a read-only note and files stay visible', async () => {
    await open({}, { permissions: [] });
    expect(screen.queryByLabelText('Statement file')).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText('stmt-0930.csv')).toBeInTheDocument();
  });

  it('templates download through the API (data.filename / data.content)', async () => {
    const { api, user } = await open({ [`GET ${ST}/template/:f`]: raw({ data: { format: 'MT940', filename: 'template-mt940.sta', content: ':20:TEMPLATE' } }) } as never);
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'MT940 template' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.calls(`GET ${ST}/template/:f`)[0]!.path).toBe(`${ST}/template/MT940`);
    expect(await (blob as unknown as Blob).text()).toBe(':20:TEMPLATE');
    click.mockRestore();
  });

  describe('upload flow', () => {
    it('Validate is disabled until a file is chosen; Upload until a clean validation', async () => {
      await open();
      expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Upload validated statement' })).toBeDisabled();
    });

    it('validate posts filename, content and chosen format and shows the per-statement summary with warnings', async () => {
      const { api, user } = await open({ [`POST ${ST}/validate`]: raw(checkOk) } as never);
      await user.upload(fileInput(), stmt('stmt.csv', 'acct,date\nX,2026-10-01\n'));
      await user.selectOptions(screen.getByLabelText(/Format/), 'CSV');
      await user.click(await screen.findByRole('button', { name: 'Validate' }).then(async (b) => (await waitFor(() => expect(b).toBeEnabled()), b)));
      const [req] = await waitFor(() => expectCalled(api, `POST ${ST}/validate`));
      expect(req.body).toEqual({ filename: 'stmt.csv', content: 'acct,date\nX,2026-10-01\n', format: 'CSV' });
      expect(await screen.findByText(/The statement is valid \(CSV\)/)).toBeInTheDocument();
      const s = screen.getByText('Closing cash differs from the previous day by more than 20%').closest('tr')!;
      expect(within(s).getAllByRole('cell').slice(0, 7).map((c) => c.textContent)).toEqual(['CUST-CL-00418', '1 Oct 2026', 'USD', '125,000.50', '2', '980,000.00', '5 (4)']);
      expect(screen.getByRole('button', { name: 'Upload validated statement' })).toBeEnabled();
    });

    it('format is omitted when left on Detect', async () => {
      const { api, user } = await open({ [`POST ${ST}/validate`]: raw(checkOk) } as never);
      await user.upload(fileInput(), stmt());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Validate' }));
      const [req] = await waitFor(() => expectCalled(api, `POST ${ST}/validate`));
      expect(req.body).not.toHaveProperty('format');
    });

    it('a rejected statement (422 statement_rejected) lists every problem and keeps Upload disabled', async () => {
      const { user } = await open({
        [`POST ${ST}/validate`]: fail(422, 'statement_rejected', 'Account ACC-X is not yours; Closing cash missing', { problems: ['Account ACC-X is not serviced by your organisation', 'Closing cash is missing on line 4'], statements: [] }),
      } as never);
      await user.upload(fileInput(), stmt());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Validate' }));
      const note = await screen.findByRole('alert');
      expect(within(note).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Account ACC-X is not serviced by your organisation', 'Closing cash is missing on line 4']);
      expect(screen.getByRole('button', { name: 'Upload validated statement' })).toBeDisabled();
    });

    it('LPC-class: a file over 1 MB is refused in the browser with a message and nothing is sent', async () => {
      const { api, user } = await open();
      await user.upload(fileInput(), new File([new Uint8Array(1_000_001)], 'big.csv', { type: 'text/csv' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The file is larger than 1 MB.');
      expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
      expectNotCalled(api, `POST ${ST}/validate`);
    });

    it('upload sends the same body with an Idempotency-Key, summarises what was loaded, clears the form and refreshes files and holdings', async () => {
      const { api, user } = await open({
        [`POST ${ST}/validate`]: raw(checkOk),
        [`POST ${ST}`]: { status: 201, body: { data: { fileId: 'f2', format: 'CSV', statements: [{ accountRef: 'CUST-CL-00418', statementDate: '2026-10-01', tradesImported: 4, holdings: 2, dayEndRef: 'CDE-10006' }] } } },
      } as never);
      await user.upload(fileInput(), stmt());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Validate' }));
      const up = screen.getByRole('button', { name: 'Upload validated statement' });
      await waitFor(() => expect(up).toBeEnabled());
      const filesBefore = api.calls(`GET ${ST}`).length;
      const holdBefore = api.calls(`GET ${HOLD}`).length;
      await user.click(up);
      const [req] = await waitFor(() => expectCalled(api, `POST ${ST}`));
      expectIdempotencyKey(req);
      expect(req.body).toMatchObject({ filename: 'stmt.csv' });
      expect(await screen.findByText(/Loaded 1 statement: 4 new trades, 2 holdings lines, day-end packages CDE-10006 awaiting approval\./)).toBeInTheDocument();
      expect(screen.queryByText(/The statement is valid/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Validate' })).toBeDisabled();
      await waitFor(() => expect(api.calls(`GET ${ST}`).length).toBeGreaterThan(filesBefore));
      expect(api.calls(`GET ${HOLD}`).length).toBeGreaterThan(holdBefore);
    });

    it('a duplicate upload (same content) is refused by the server and the message is shown', async () => {
      const { user } = await open({
        [`POST ${ST}/validate`]: raw(checkOk),
        [`POST ${ST}`]: fail(409, 'duplicate_file', 'This statement file was already uploaded'),
      } as never);
      await user.upload(fileInput(), stmt());
      await waitFor(() => expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: 'Validate' }));
      const up = screen.getByRole('button', { name: 'Upload validated statement' });
      await waitFor(() => expect(up).toBeEnabled());
      await user.click(up);
      expect(await screen.findByRole('alert')).toHaveTextContent('This statement file was already uploaded');
    });
  });
});
