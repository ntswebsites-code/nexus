import { describe, it, expect, vi } from 'vitest';
import DataPage from '@/app/(ops)/ops/data/page';
import { upload, openLink, saveText, Pager, SimpleTable, Tone, label, when, dayOf, Tiles } from '@/ops/suite';
import { mountPage } from './_kit';
import { ok, raw, fail, mockApi, renderWithProviders, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey } from '../../_helpers';

describe('ops/suite helpers', () => {
  it('upload posts multipart (file + non-empty fields) with credentials and returns json.data', async () => {
    const m = mockApi({ 'POST /api/v1/x/upload': raw({ data: { id: 'u1' } }, 201) });
    const out = await upload<{ id: string }>('/api/v1/x/upload', new File(['a'], 'a.csv'), { kind: 'k', empty: '' });
    expect(out).toEqual({ id: 'u1' });
    const fd = m.requests[0]!.body as FormData;
    expect(fd.get('kind')).toBe('k');
    expect(fd.has('empty')).toBe(false);
    expect(fd.get('file')).toBeInstanceOf(File);
  });
  it('upload errors keep the server code/message; network failure is friendly', async () => {
    mockApi({ 'POST /api/v1/x/upload': fail(413, 'too_large', 'File too large') });
    await expect(upload('/api/v1/x/upload', new File(['a'], 'a.csv'))).rejects.toMatchObject({ status: 413, code: 'too_large', message: 'File too large' });
    mockApi({});
    await expect(upload('/api/v1/none', new File(['a'], 'a.csv'))).rejects.toMatchObject({ code: 'network_error' });
  });
  it('openLink asks for a signed link then opens it noopener', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApi({ 'GET /api/v1/files/1/link': raw({ data: { url: 'https://signed.example/f' } }) });
    await openLink('/api/v1/files/1/link');
    expect(open).toHaveBeenCalledWith('https://signed.example/f', '_blank', 'noopener');
    open.mockRestore();
  });
  it('saveText creates a blob URL, clicks a download anchor with the filename', () => {
    const created: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => (created.push(b), 'blob:1');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    let name = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    saveText('filing.csv', 'a,b');
    expect(name).toBe('filing.csv');
    expect(created[0]!.type).toBe('text/csv');
    click.mockRestore();
  });
  it('Pager shows the range, disables at the ends and reports the new offset', async () => {
    const onChange = vi.fn();
    const { user, rerender } = renderWithProviders(<Pager offset={0} limit={25} total={60} onChange={onChange} />);
    expect(screen.getByText('1-25 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenCalledWith(25);
    rerender(<Pager offset={50} limit={25} total={60} onChange={onChange} />);
    expect(screen.getByText('51-60 of 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    rerender(<Pager offset={0} limit={25} total={0} onChange={onChange} />);
    expect(screen.getByText('0 rows')).toBeInTheDocument();
  });
  it('SimpleTable, Tone, label, Tiles, when/dayOf', () => {
    renderWithProviders(
      <>
        <SimpleTable columns={['A', 'B']} rows={[['x', null], ['y', 2]]} />
        <SimpleTable columns={['A']} rows={[]} />
        <Tone value="PASS_WITH_FINDINGS" />
        <Tone value="Unknown thing" />
        <Tiles items={[{ label: 'Open', value: 3, tone: 'red' }]} />
      </>,
    );
    expect(screen.getByText('x')).toBeInTheDocument();
    expect(screen.getByText('No rows.')).toBeInTheDocument();
    expect(screen.getByText('pass with findings')).toHaveClass('amber');
    expect(screen.getByText('unknown thing')).toHaveClass('grey');
    expect(label('MONTH_TO_DATE')).toBe('Month to date');
    expect(dayOf('2026-08-26T10:00:00Z')).toBe('2026-08-26');
    expect(dayOf(null)).toBe('-');
    expect(when(undefined)).toBe('-');
  });
});

describe('Data fabric: schedules, exception queue and lineage tab', () => {
  const routes = (o: Record<string, unknown> = {}) => ({
    'GET /api/v1/data/datasets': raw({ data: [], checkTypes: [], severities: [], kinds: [], cadences: ['DAILY', 'WEEKLY'] }),
    'GET /api/v1/data/schedules': raw({ data: [{ id: 'sc1', ruleId: 'r1', ruleKey: 'tb-bal', ruleName: 'Debits equal credits', dataset: 'journals', severity: 'HIGH', cadence: 'DAILY', enabled: true, nextRunAt: '2026-09-04T00:00:00Z', lastRunAt: null, lastRunRef: null, lastStatus: null, due: true }], cadences: ['DAILY'] }),
    'GET /api/v1/data/rules': raw({ data: [{ id: 'r1', key: 'tb-bal', name: 'Debits equal credits' }] }),
    'GET /api/v1/data/exception-queue': raw({ data: [{ id: 'q1', ruleKey: 'tb-bal', dataset: 'journals', severity: 'HIGH', recordKey: 'JNL-9', detail: 'Debit 10 vs credit 9', status: 'OPEN', createdAt: '2026-08-26T10:00:00Z', ownerId: null, owner: null, dueOn: null, overdue: true, escalationLevel: 1 }] }),
    'GET /api/v1/data/staff': raw({ data: [{ id: 'st1', name: 'Dana D' }] }),
    'GET /api/v1/data/lineage': raw({ data: { nodes: [{ key: 'journals', label: 'Journals', feed: false, rules: 2, failing: 1, openExceptions: 3, downstream: 1, upstream: 0 }], edges: [{ id: 'e1', from: 'journals', to: 'reports', kind: 'FEEDS', description: 'Trial balance' }] } }),
    ...o,
  });
  const open = async (perms = ['operations.view', 'data.manage'], r: Record<string, unknown> = {}) => {
    const m = await mountPage(<DataPage />, { perms, routes: routes(r) });
    await m.user.click(await screen.findByRole('tab', { name: 'Schedules & lineage' }));
    return m;
  };
  it('lists scheduled rules, the owner-less exception queue (overdue/escalation) and lineage links with failing counts', async () => {
    await open();
    expect(await screen.findByText('Debits equal credits')).toBeInTheDocument();
    expect(await screen.findByText('JNL-9')).toBeInTheDocument();
    expect(await screen.findByText('Trial balance')).toBeInTheDocument();
    expect(screen.getByText('With failing rules').parentElement).toHaveTextContent('1');
  });
  it('managers can run due schedules (POST) and remove a schedule after an in-app confirm (DELETE)', async () => {
    const { user, api } = await open(undefined, { 'POST /api/v1/data/schedules/run-due': ok({}), 'DELETE /api/v1/data/rules/:id/schedule': raw({}) });
    await user.click(await screen.findByRole('button', { name: 'Run due now' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/data/schedules/run-due'));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(within(screen.getByRole('dialog')).getByText('Remove this schedule?')).toBeInTheDocument();
    expect(api.calls('DELETE /api/v1/data/rules/r1/schedule')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/data/rules/r1/schedule'));
  });
  it('viewers do not get management buttons', async () => {
    await open(['operations.view']);
    await screen.findByText('Debits equal credits');
    expect(screen.queryByRole('button', { name: 'Run due now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add link' })).not.toBeInTheDocument();
  });
  it('assigning an exception posts owner, due date and note with an idempotency key', async () => {
    const { user, api } = await open(undefined, { 'POST /api/v1/data/exceptions/:id/assign': ok({}) });
    await user.click(await screen.findByRole('button', { name: /Assign/ }));
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(within(dlg).getByRole('combobox'), 'st1');
    await user.click(within(dlg).getByRole('button', { name: /Assign|Save/ }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/exceptions/q1/assign'));
    expectBody(req!, { ownerId: 'st1' });
    expectIdempotencyKey(req!);
  });
});
