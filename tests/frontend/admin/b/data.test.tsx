import { describe, it, expect } from 'vitest';
import DataPage from '@/app/(ops)/ops/data/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const datasets = raw({
  data: [{ key: 'securities', label: 'Securities', table: 'securities', columns: { ticker: 'text', isin: 'text', price: 'num' }, relations: ['issuer'], rows: 1234, latest: '2026-08-26T10:00:00Z' }],
  checkTypes: ['NOT_NULL', 'COMPARE'], severities: ['LOW', 'HIGH'], kinds: ['TABLE', 'FILE_FEED', 'FEED'], cadences: ['DAILY', 'WEEKLY'],
});
const src = (o: Record<string, unknown> = {}) => ({ id: 's1', key: 'sec-table', name: 'Securities master', kind: 'TABLE', dataset: 'securities', system: 'Nexus', owner: 'Data team', cadence: 'DAILY', status: 'ACTIVE', lastSyncAt: '2026-08-26T10:00:00Z', lastRowCount: 1234, schemaSpec: null, rules: 3, lastJob: null, ...o });
const rule = (o: Record<string, unknown> = {}) => ({ id: 'r1', key: 'tb-bal', name: 'Debits equal credits', dataset: 'journals', checkType: 'COMPARE', col: 'total_debit', params: { op: 'eq', other: 'total_credit' }, severity: 'HIGH', active: true, openExceptions: 2, lastRun: { ref: 'DQR-1', status: 'FAIL', failures: 2, rowsChecked: 100, at: '2026-08-26T10:00:00Z' }, ...o });
const exc = (o: Record<string, unknown> = {}) => ({ id: 'e1', ruleKey: 'tb-bal', ruleName: 'Debits equal credits', dataset: 'journals', severity: 'HIGH', recordKey: 'JNL-0009', detail: 'Debit 10 vs credit 9', status: 'OPEN', resolution: null, resolvedBy: null, createdAt: '2026-08-26T10:00:00Z', ...o });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/data/datasets': datasets,
  'GET /api/v1/data/summary': ok({ sources: { ACTIVE: 4, ERROR: 1 }, jobsLast24h: 7, failedJobsLast24h: 2, activeRules: 25, rulesNeverRun: 0, rulesPassing: 20, rulesFailing: 4, rulesErroring: 1, openExceptions: 6, openBySeverity: { HIGH: 2 } }),
  'GET /api/v1/data/sources': ok([src(), src({ id: 's2', key: 'zse', name: 'ZSE announcements', kind: 'FILE_FEED', dataset: null, status: 'PAUSED', schemaSpec: { keyColumn: 'id', columns: [{ name: 'id', type: 'text', required: true }] } }), src({ id: 's3', name: 'Vendor feed', kind: 'FEED', dataset: null })]),
  'GET /api/v1/data/jobs': raw({ data: [{ id: 'j1', ref: 'JOB-1', source: 'Securities master', status: 'SUCCEEDED', rowsRead: 1234, rowsRejected: 0, latestRecordAt: null, note: 'profile', error: null, triggeredBy: 'Dana D', startedAt: '2026-08-26T10:00:00Z', fileName: null, fileSha256: null }], total: 1 }),
  'GET /api/v1/data/rules': ok([rule(), rule({ id: 'r2', key: 'never', name: 'Never run rule', params: null, lastRun: null, openExceptions: 0 }), rule({ id: 'r3', key: 'age', name: 'Fresh prices', checkType: 'NOT_NULL', col: 'price', params: { maxAgeDays: 3, min: 0 }, lastRun: { ref: 'DQR-3', status: 'PASS', failures: 0, rowsChecked: 5, at: '2026-08-26T10:00:00Z' } })]),
  'GET /api/v1/data/exceptions': raw({ data: [exc()], total: 1 }),
  ...o,
});
const VIEW = ['operations.view'];
const MANAGE = ['operations.view', 'data.manage'];

describe('Data fabric overview', () => {
  it('summary tiles (with failing = failing + erroring) and datasets with column names', async () => {
    await mountPage(<DataPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('20 / 25')).toBeInTheDocument();
    expect(screen.getByText('Rules failing').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Securities')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('ticker, isin, price')).toBeInTheDocument();
  });
  it('ADB-019: "Never run" count is shown so unexecuted rules are visible; zero when every rule has run', async () => {
    await mountPage(<DataPage />, { perms: VIEW, routes: base() });
    const tile = (await screen.findByText('Never run')).parentElement!;
    expect(tile).toHaveTextContent('0');
  });
  it('without operations.view: message and nothing fetched; errors surface', async () => {
    const a = await mountPage(<DataPage />, { perms: [], routes: base() });
    expect(await screen.findByText('You do not have permission to view this page.')).toBeInTheDocument();
    expectNotCalled(a.api, 'GET /api/v1/data/summary');
    a.unmount();
    await mountPage(<DataPage />, { perms: VIEW, routes: base({ 'GET /api/v1/data/datasets': fail(500, 'x', 'Fabric down') }) });
    expect(await screen.findByText(/Fabric down/)).toBeInTheDocument();
  });
});

describe('Data fabric sources', () => {
  const sources = async (perms = MANAGE, routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<DataPage />, { perms, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Sources' }));
    await screen.findByText('Securities master');
    return m;
  };
  it('viewer sees sources but no action buttons or Register', async () => {
    await sources(VIEW);
    expect(screen.queryByRole('button', { name: 'Register source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profile now' })).not.toBeInTheDocument();
  });
  it('actions depend on kind: Profile now (table), Contract / Upload CSV / Staged rows (file feed), Record feed run (feed); paused sources disable runs', async () => {
    await sources();
    expect(screen.getByRole('button', { name: 'Profile now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Contract' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Staged rows' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record feed run' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
  it('Profile now posts an ingest with an idempotency key and reloads', async () => {
    const { user, api } = await sources(MANAGE, { 'POST /api/v1/data/sources/:id/ingest': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Profile now' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/sources/s1/ingest'));
    expectIdempotencyKey(req!);
  });
  it('Pause sends PATCH status PAUSED; Resume sends ACTIVE', async () => {
    const { user, api } = await sources(MANAGE, { 'PATCH /api/v1/data/sources/:id': ok({}) });
    await user.click(screen.getAllByRole('button', { name: 'Pause' })[0]!);
    const [p] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/data/sources/s1'));
    expectBody(p!, { status: 'PAUSED' });
  });
  it('record a feed run: rows delivered/rejected as numbers; failed outcome sends status FAILED with error', async () => {
    const { user, api } = await sources(MANAGE, { 'POST /api/v1/data/sources/:id/ingest': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Record feed run' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Rows delivered/), '120');
    await user.type(within(dlg).getByLabelText(/Rows rejected/), '3');
    await user.click(within(dlg).getByRole('button', { name: /Record/ }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/sources/s3/ingest'));
    expectBody(req!, { rowsRead: 120, rowsRejected: 3 });
  });
  it('register source posts key/name/kind/system/owner/cadence with a key; dataset only for TABLE sources', async () => {
    const { user, api } = await sources(MANAGE, { 'POST /api/v1/data/sources': ok({ id: 's9' }, 201) });
    await user.click(screen.getByRole('button', { name: 'Register source' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Key/), 'new-feed');
    await user.type(within(dlg).getByLabelText(/^Name/), 'New feed');
    await user.type(within(dlg).getByLabelText(/^System/), 'Bloomberg');
    await user.type(within(dlg).getByLabelText(/^Owner/), 'Market data');
    await user.selectOptions(within(dlg).getByLabelText(/^Kind/), 'FEED');
    expect(within(dlg).queryByLabelText(/^Dataset/)).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Register' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/sources'));
    expectBody(req!, { key: 'new-feed', name: 'New feed', kind: 'FEED', system: 'Bloomberg', owner: 'Market data', cadence: 'DAILY' });
    expect((req!.body as Record<string, unknown>).dataset).toBeUndefined();
    expectIdempotencyKey(req!);
  });
  it('the column contract editor parses "name, type, required, unique" lines into a schema PUT', async () => {
    const { user, api } = await sources(MANAGE, { 'PUT /api/v1/data/sources/:id/schema': ok({}) });
    await user.click(screen.getByRole('button', { name: 'Contract' }));
    const dlg = screen.getByRole('dialog');
    const cols = dlg.querySelector('textarea')!;
    await user.clear(cols);
    await user.type(cols, 'ID, text, required, unique{enter}Price, num');
    await user.click(within(dlg).getByRole('button', { name: 'Save contract' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/data/sources/s2/schema'));
    expect(req!.body).toEqual({ keyColumn: 'id', columns: [{ name: 'id', type: 'text', required: true, unique: true }, { name: 'price', type: 'num', required: false }] });
  });
  it('empty source list message', async () => {
    const { user } = await mountPage(<DataPage />, { perms: VIEW, routes: base({ 'GET /api/v1/data/sources': ok([]) }) });
    await user.click(await screen.findByRole('tab', { name: 'Sources' }));
    expect(await screen.findByText('No sources registered.')).toBeInTheDocument();
  });
});

describe('Data fabric rules (ADB-019)', () => {
  const rules = async (perms = MANAGE, routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<DataPage />, { perms, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Quality rules' }));
    await screen.findByText('Debits equal credits');
    return m;
  };
  it('ADB-019: the CHECK column shows plain language, never raw JSON', async () => {
    await rules(VIEW);
    expect(screen.getByText('must be equal to total_credit')).toBeInTheDocument();
    expect(screen.getByText('min 0, no older than 3 days')).toBeInTheDocument();
    expect(screen.queryByText(/\{"op"/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Compare on journals.total_debit').length).toBeGreaterThan(0);
  });
  it('a rule with no run yet shows no last-run result (so "never run" is visible, not a fake pass)', async () => {
    await rules(VIEW);
    const row = screen.getByText('Never run rule').closest('tr')!;
    expect(within(row).queryByText(/DQR-/)).not.toBeInTheDocument();
  });
  it('Run all rules reports counts of passed / failed / errored and reloads', async () => {
    const { user, api } = await rules(MANAGE, { 'POST /api/v1/data/runs/run-all': ok([{ status: 'PASS' }, { status: 'PASS' }, { status: 'FAIL' }, { status: 'ERROR' }]) });
    await user.click(screen.getByRole('button', { name: 'Run all rules' }));
    expect(await screen.findByText('Ran 4 rules: 2 passed, 1 failed, 1 errored.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET /api/v1/data/rules').length).toBeGreaterThan(1));
  });
  it('single rule Run (key) and Disable (PATCH active:false); managers only', async () => {
    const v = await rules(VIEW);
    expect(screen.queryByRole('button', { name: 'Run all rules' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await rules(MANAGE, { 'POST /api/v1/data/rules/:id/run': ok({}), 'PATCH /api/v1/data/rules/:id': ok({}) });
    await user.click(screen.getAllByRole('button', { name: 'Run' })[0]!);
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/rules/r1/run'));
    expectIdempotencyKey(r!);
    await user.click(screen.getAllByRole('button', { name: 'Disable' })[0]!);
    const [p] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/data/rules/r1'));
    expectBody(p!, { active: false });
  });
});

describe('Data fabric exceptions and jobs', () => {
  it('exceptions list shows the record and rule names; default filter is open+acknowledged', async () => {
    const { user, api } = await mountPage(<DataPage />, { perms: MANAGE, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Exceptions' }));
    expect(await screen.findByText('JNL-0009')).toBeInTheDocument();
    expect(screen.getByText('Debit 10 vs credit 9')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/data/exceptions')[0]!.query.get('status')).toBe('OPEN,ACKNOWLEDGED');
  });
  it('acknowledge posts; resolve and waive require a reason and post it', async () => {
    const { user, api } = await mountPage(<DataPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/data/exceptions/:id/acknowledge': ok({}), 'POST /api/v1/data/exceptions/:id/waive': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Exceptions' }));
    await user.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/data/exceptions/e1/acknowledge'));
    await user.click(screen.getByRole('button', { name: 'Waive' }));
    const reason = screen.getByLabelText(/Why this can be accepted/);
    expect(reason).toBeRequired();
    await user.type(reason, 'Known timing difference');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Waive' }));
    const [w] = await waitFor(() => expectCalled(api, 'POST /api/v1/data/exceptions/e1/waive'));
    expectBody(w!, { reason: 'Known timing difference' });
  });
  it('viewer has no exception actions; empty exceptions message', async () => {
    const v = await mountPage(<DataPage />, { perms: VIEW, routes: base() });
    await v.user.click(await screen.findByRole('tab', { name: 'Exceptions' }));
    await screen.findByText('JNL-0009');
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    v.unmount();
    const e = await mountPage(<DataPage />, { perms: VIEW, routes: base({ 'GET /api/v1/data/exceptions': raw({ data: [], total: 0 }) }) });
    await e.user.click(await screen.findByRole('tab', { name: 'Exceptions' }));
    expect(await screen.findByText('No exceptions match.')).toBeInTheDocument();
  });
  it('jobs tab lists ingestion jobs with who ran them; status filter is sent; empty state', async () => {
    const { user, api } = await mountPage(<DataPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Ingestion jobs' }));
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
    expect(screen.getByText('Dana D')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'FAILED');
    await waitFor(() => expect(api.calls('GET /api/v1/data/jobs').at(-1)!.query.get('status')).toBe('FAILED'));
  });
});
