import { describe, it, expect, vi } from 'vitest';
import BulkUploadPage from '@/app/(portal)/executions/upload/page';
import { expectCalled, expectIdempotencyKey, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { attachFile, renderPortal, shellRoutes } from './_support';

const BULK = '/api/v1/custodian/executions/bulk';
const BATCHES = '/api/v1/custodian/executions-batches';
const csv = (name = 'trades.csv', body = 'tradeRef,executionAt\nT1,2026-10-01T08:00:00Z\n') => new File([body], name, { type: 'text/csv' });

const validReport = { valid: true, rowCount: 3, newCount: 3, duplicates: [], control: {}, totals: { count: 3, quantity: '1500.50000000', notional: '276.10' } };
const batch = { id: 'b1', ref: 'CBT-10001', fileName: 'old.csv', rowCount: 4, acceptedCount: 3, duplicateCount: 1, rejectedCount: 0, controlStatus: 'OK', status: 'Accepted', submittedAt: '2026-10-01T08:00:00.000Z' };

async function open(extra: Record<string, never> = {}, shell = {}) {
  const api = mockApi({ ...shellRoutes(shell), [`GET ${BATCHES}`]: raw({ items: [] }), ...extra });
  const view = renderPortal(<BulkUploadPage />);
  await screen.findByRole('heading', { name: 'Bulk upload' });
  return { api, ...view };
}
const fileInput = () => screen.getByLabelText(/Executions CSV/) as HTMLInputElement;

describe('custodian bulk upload', () => {
  it('without submit permission only an explanation is shown (no upload controls)', async () => {
    mockApi({ ...shellRoutes({ permissions: [] }) });
    renderPortal(<BulkUploadPage />);
    expect(await screen.findByText('Your role cannot submit executions.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Executions CSV/)).toBeNull();
  });

  it('downloads a CSV template with the expected header columns', async () => {
    const { user } = await open();
    let blob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Download CSV template' }));
    expect(click).toHaveBeenCalled();
    expect(await (blob as unknown as Blob).text()).toBe('tradeRef,executionAt,accountRef,ticker,side,quantity,price,currency,settlementDate,broker\n');
    click.mockRestore();
  });

  it('Upload is disabled until a file has been validated successfully', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Upload validated file' })).toBeDisabled();
    expect(fileInput()).toBeRequired();
  });

  it('validate sends a dry run (multipart: file, trimmed declared totals, dryRun=true) and shows totals and the new-row count', async () => {
    const { api, user } = await open({ [`POST ${BULK}`]: raw({ ...validReport, duplicates: [{ ref: 'CEX-9', tradeRef: 'T9', status: 'Received' }] }) } as never);
    await attachFile(user, fileInput(), csv());
    await user.type(screen.getByLabelText('Declared row count (optional)'), ' 3 ');
    await user.type(screen.getByLabelText('Declared total quantity (optional)'), '1500.5');
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    const [req] = await waitFor(() => expectCalled(api, `POST ${BULK}`));
    const fd = req.body as FormData;
    expect(fd.get('dryRun')).toBe('true');
    expect(fd.get('declaredCount')).toBe('3');
    expect(fd.get('declaredQuantity')).toBe('1500.5');
    expect(fd.has('declaredNotional')).toBe(false);
    expect((fd.get('file') as File).name).toBe('trades.csv');
    expect(await screen.findByText(/The file is valid: 3 rows, 3 new, 1 already submitted \(they will be skipped\)/)).toBeInTheDocument();
    expect(screen.getByText(/Totals in the file: 3 rows, quantity 1,500.5, notional 276.10/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Validation result: trades.csv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload validated file' })).toBeEnabled();
  });

  it('after a valid dry run, upload sends dryRun=false with an Idempotency-Key, confirms the stored count and reloads recent uploads', async () => {
    const { api, user } = await open({ [`POST ${BULK}`]: (req) => (((req.body as FormData).get('dryRun') === 'true') ? { status: 200, body: validReport } : { status: 201, body: { batch, created: [{}, {}, {}], duplicates: [], control: {} } }) } as never);
    await attachFile(user, fileInput(), csv());
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    await user.click(await screen.findByRole('button', { name: 'Upload validated file' }).then(async (b) => (await waitFor(() => expect(b).toBeEnabled()), b)));
    await waitFor(() => expect(api.calls(`POST ${BULK}`)).toHaveLength(2));
    const real = api.calls(`POST ${BULK}`)[1]!;
    expect((real.body as FormData).get('dryRun')).toBe('false');
    expectIdempotencyKey(real);
    expect(await screen.findByRole('status')).toHaveTextContent('Uploaded: 3 executions stored.');
    expect(screen.queryByText(/Validation result/)).toBeNull();
    expect(api.calls(`GET ${BATCHES}`).length).toBeGreaterThanOrEqual(2);
  });

  it('LPC-013: formula-injection and other row errors from the server are listed per row with field and message; nothing can be uploaded', async () => {
    const { user } = await open({
      [`POST ${BULK}`]: fail(422, 'invalid_rows', 'The file has invalid rows', {
        valid: false,
        rowCount: 2,
        errors: [
          { row: 2, field: 'tradeRef', message: 'Text may not start with =, +, @ or - (spreadsheet formula)' },
          { row: 3, field: 'executionAt', message: 'Use an ISO date-time with a time zone, e.g. 2026-10-02T09:30:00Z' },
          { row: 3, message: 'Execution time is in the future' },
        ],
        control: {},
        totals: { count: 0, quantity: '0.00000000', notional: '0.00' },
      }),
    } as never);
    await attachFile(user, fileInput(), csv('bad.csv'));
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file has invalid rows');
    const table = screen.getByRole('columnheader', { name: 'Problem' }).closest('table')!;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('tradeRef')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/spreadsheet formula/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('executionAt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload validated file' })).toBeDisabled();
  });

  it('LPC-011 style control totals: a differing declared total is shown as Differs next to the figure found in the file', async () => {
    const { user } = await open({
      [`POST ${BULK}`]: fail(422, 'control_total_mismatch', 'Declared control totals do not match the file', {
        valid: false,
        rowCount: 3,
        errors: [],
        control: { count: { declared: '4', actual: '3', matches: false }, quantity: { declared: '1500.00000000', actual: '1500.00000000', matches: true } },
        totals: { count: 3, quantity: '1500.00000000', notional: '276.00' },
      }),
    } as never);
    await attachFile(user, fileInput(), csv());
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    const count = (await screen.findByRole('cell', { name: 'count' })).closest('tr')!;
    expect(within(count).getByText('Differs')).toBeInTheDocument();
    expect(within(count).getAllByRole('cell').map((c) => c.textContent)).toEqual(['count', '4', '3', 'Differs']);
    expect(within(screen.getByRole('cell', { name: 'quantity' }).closest('tr')!).getByText('Agrees')).toBeInTheDocument();
    expect(screen.getByText('Declared control totals do not match the file')).toBeInTheDocument();
  });

  it('a non-validation failure (not a CSV, 400) is shown as a plain error and no report', async () => {
    const { user } = await open({ [`POST ${BULK}`]: fail(400, 'bad_request', 'The file must be a CSV') } as never);
    await attachFile(user, fileInput(), csv('notes.txt'));
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file must be a CSV');
    expect(screen.queryByText(/Validation result/)).toBeNull();
  });

  it('choosing another file clears the previous validation result and disables Upload again', async () => {
    const { user } = await open({ [`POST ${BULK}`]: raw(validReport) } as never);
    await attachFile(user, fileInput(), csv());
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    await screen.findByText(/The file is valid/);
    await attachFile(user, fileInput(), csv('other.csv'));
    expect(screen.queryByText(/The file is valid/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload validated file' })).toBeDisabled();
  });

  it('a rejected real upload (422 with details) shows the report and refreshes recent uploads', async () => {
    const calls: string[] = [];
    const { api, user } = await open({
      [`POST ${BULK}`]: (req) => {
        const dry = (req.body as FormData).get('dryRun') === 'true';
        calls.push(dry ? 'dry' : 'real');
        return dry ? { status: 200, body: validReport } : { status: 422, body: { error: { code: 'invalid_rows', message: 'The file has invalid rows; nothing was stored', details: { valid: false, rowCount: 3, errors: [{ row: 2, message: 'Trade reference T2 repeats row 1' }], control: {} } } } };
      },
    } as never);
    await attachFile(user, fileInput(), csv());
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    const up = screen.getByRole('button', { name: 'Upload validated file' });
    await waitFor(() => expect(up).toBeEnabled());
    const before = api.calls(`GET ${BATCHES}`).length;
    await user.click(up);
    expect(await screen.findByText('The file has invalid rows; nothing was stored')).toBeInTheDocument();
    expect(screen.getByText('Trade reference T2 repeats row 1')).toBeInTheDocument();
    expect(calls).toEqual(['dry', 'real']);
    await waitFor(() => expect(api.calls(`GET ${BATCHES}`).length).toBeGreaterThan(before));
  });

  it('Recent uploads table renders the real batch fields; empty state otherwise', async () => {
    mockApi({ ...shellRoutes(), [`GET ${BATCHES}`]: raw({ items: [batch] }) });
    renderPortal(<BulkUploadPage />);
    const row = (await screen.findByText('CBT-10001')).closest('tr')!;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(0, 7)).toEqual(['CBT-10001', 'old.csv', '4', '3', '1', 'OK', 'Accepted']);
  });

  it('empty recent uploads', async () => {
    await open();
    expect(await screen.findByText('No bulk uploads yet.')).toBeInTheDocument();
  });

  it('validating without choosing a file sends nothing', async () => {
    const { api, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Validate file' }));
    expectNotCalled(api, `POST ${BULK}`);
  });
});
