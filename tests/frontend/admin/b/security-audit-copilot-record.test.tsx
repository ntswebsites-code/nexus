import { describe, it, expect, vi, beforeEach } from 'vitest';
import SecurityPage from '@/app/(ops)/ops/security/page';
import AuditPage from '@/app/(ops)/ops/audit/page';
import CopilotPage from '@/app/(ops)/ops/copilot/page';
import RecordPage from '@/app/(ops)/ops/record/[kind]/[id]/page';
import { mountPage } from './_kit';
import { setParams } from './_params';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

vi.mock('next/navigation', async () => {
  const m = (await import('../../_helpers/next-mocks')).navigationMock;
  const p = await import('./_params');
  return { ...m, useParams: () => p.params.current };
});
beforeEach(() => setParams({}));

// ------------------------------------------------------------------ security
const secBase = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin/permissions': raw({ data: ['orders.create'], protected: ['orders.approve'], custom: [{ code: 'vendor.review', label: 'Review vendors', description: null }] }),
  'GET /api/v1/admin-core/sod/rules': raw({ data: [{ id: 'SOD-1', a: 'orders.create', b: 'orders.approve', why: 'Maker is not checker' }], blocklist: ['orders.approve', 'valuation.release'], privileged: [] }),
  'GET /api/v1/admin-core/retention/runs': raw({ data: [{ id: 'rr1', startedAt: '2026-09-01T02:00:00Z', finishedAt: null, dryRun: true, triggeredBy: 'worker', result: { dryRun: true, sessionsDeleted: 4, passwordResetsDeleted: 0, invitationsDeleted: 0, idempotencyKeysDeleted: 9, outboxEventsDeleted: 2, notificationsDeleted: 1, digestLogsDeleted: 0, auditRetentionYears: 7, auditFloor: '2019', documentsEligibleForDisposal: 0 } }], lastScheduledRunAt: '2026-09-01T02:00:00Z' }),
  ...o,
});

describe('Security controls', () => {
  it('SoD catalogue shows the rule count computed from the data and the blocklist size (ADB-020)', async () => {
    await mountPage(<SecurityPage />, { perms: ['admin.rbac', 'admin.settings'], routes: secBase() });
    expect(await screen.findByText(/these 2 money and approval permissions/)).toBeInTheDocument();
    expect(screen.getByText(/1 permission pairs must not meet/)).toBeInTheDocument();
    expect(screen.getByText('SOD-1')).toBeInTheDocument();
  });
  it('sections the user lacks permission for explain the missing permission instead of silently vanishing (ADB-012 pattern)', async () => {
    const { api } = await mountPage(<SecurityPage />, { perms: ['admin.rbac'], routes: secBase() });
    expect(await screen.findByText('The retention job needs the admin.settings permission.')).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/admin-core/retention/runs');
    const b = await mountPage(<SecurityPage />, { perms: ['admin.settings'], routes: secBase() });
    expect(await screen.findByText('Custom permission codes need the admin.rbac permission.')).toBeInTheDocument();
    expectNotCalled(b.api, 'GET /api/v1/admin/permissions');
  });
  it('ADA-014: removing a permission code uses an in-app confirm dialog (not window.confirm), then DELETEs it', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const { user, api } = await mountPage(<SecurityPage />, { perms: ['admin.rbac'], routes: secBase({ 'DELETE /api/v1/admin/permissions/:code': raw({ ok: true }) }) });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/Remove vendor.review\? Roles must no longer carry it\./)).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expectNotCalled(api, 'DELETE /api/v1/admin/permissions/vendor.review');
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/admin/permissions/vendor.review'));
  });
  it('cancelling the remove dialog sends nothing; a server refusal is shown', async () => {
    const { user, api } = await mountPage(<SecurityPage />, { perms: ['admin.rbac'], routes: secBase({ 'DELETE /api/v1/admin/permissions/:code': fail(409, 'conflict', 'A role still carries this code') }) });
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expectNotCalled(api, 'DELETE /api/v1/admin/permissions/vendor.review');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/A role still carries this code/)).toBeInTheDocument();
  });
  it('define permission posts the code with a key; the pattern rejects uppercase before submit', async () => {
    const { user, api } = await mountPage(<SecurityPage />, { perms: ['admin.rbac'], routes: secBase({ 'POST /api/v1/admin/permissions': ok({}, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Define permission' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByLabelText(/^Code/)).toHaveAttribute('pattern', expect.stringContaining('[a-z]'));
    await user.type(within(dlg).getByLabelText(/^Code/), 'Vendor.Approve');
    expect((within(dlg).getByLabelText(/^Code/) as HTMLInputElement).validity.patternMismatch).toBe(true);
    await user.clear(within(dlg).getByLabelText(/^Code/));
    await user.type(within(dlg).getByLabelText(/^Code/), 'vendor.approve');
    await user.type(within(dlg).getByLabelText(/^Label/), 'Approve vendors');
    await user.click(within(dlg).getByRole('button', { name: 'Define permission' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin/permissions'));
    expectBody(req!, { code: 'vendor.approve', label: 'Approve vendors' });
    expectIdempotencyKey(req!);
  });
  it('ADA-014: retention Run now asks an in-app confirm; Dry run does not; results are summarised', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    const result = { dryRun: false, sessionsDeleted: 5, passwordResetsDeleted: 1, invitationsDeleted: 0, idempotencyKeysDeleted: 3, outboxEventsDeleted: 2, notificationsDeleted: 0, digestLogsDeleted: 0, auditRetentionYears: 7, auditFloor: '2019', documentsEligibleForDisposal: 0 };
    const { user, api } = await mountPage(<SecurityPage />, { perms: ['admin.settings'], routes: secBase({ 'POST /api/v1/admin-core/retention/run': (r: { body: { dryRun: boolean } }) => raw({ data: { ...result, dryRun: r.body.dryRun } }) }) });
    await user.click(await screen.findByRole('button', { name: 'Dry run' }));
    const [dry] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/retention/run'));
    expectBody(dry!, { dryRun: true });
    expectIdempotencyKey(dry!);
    expect(await screen.findByText(/Dry run: 5 sessions/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(within(screen.getByRole('dialog')).getByText(/Delete expired sessions, tokens/)).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(api.calls('POST /api/v1/admin-core/retention/run')).toHaveLength(1);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(api.calls('POST /api/v1/admin-core/retention/run')).toHaveLength(2));
    expectBody(api.calls('POST /api/v1/admin-core/retention/run')[1]!, { dryRun: false });
    expect(await screen.findByText(/Purged: 5 sessions/)).toBeInTheDocument();
  });
  it('run history labels the scheduler vs an administrator and live vs dry', async () => {
    await mountPage(<SecurityPage />, { perms: ['admin.settings'], routes: secBase() });
    expect(await screen.findByText('Scheduler')).toBeInTheDocument();
    expect(screen.getByText('Dry run', { selector: 'td' })).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ record
describe('Record page', () => {
  const rec = (o: Record<string, unknown> = {}) => raw({ record: { kind: 'order', kindLabel: 'Order', id: 'o1', ref: 'ORD-1001', title: 'Buy 100 ABC', status: 'PENDING', route: '/ops/orders/o1', fields: [{ label: 'Quantity', value: '100' }, { label: 'Created', value: '2026-08-26T10:00:00Z' }], ...o }, history: [{ id: 'a1', at: '2026-08-26T10:00:00Z', action: 'order.created', role: 'Dealer', reason: 'Client request' }] });
  it('ADB-028(c): shows only the fields the API sends (no internal ids/counters), formats ISO dates, links to the module', async () => {
    setParams({ kind: 'order', id: 'o1' });
    await mountPage(<RecordPage />, { routes: { 'GET /api/v1/shell/record/:kind/:id': rec() } });
    expect(await screen.findByText('Buy 100 ABC')).toBeInTheDocument();
    expect(screen.getAllByText('ORD-1001').length).toBeGreaterThan(0);
    expect(screen.getByText('Quantity')).toBeInTheDocument();
    expect(screen.queryByText(/accounts count/i)).not.toBeInTheDocument();
    expect(screen.queryByText('2026-08-26T10:00:00Z')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in module' })).toHaveAttribute('href', '/ops/orders/o1');
    expect(screen.getByText('order.created')).toBeInTheDocument();
    expect(screen.getByText('“Client request”')).toBeInTheDocument();
  });
  it('history is omitted for roles without audit.view (API sends null); documents get a Preview button', async () => {
    setParams({ kind: 'document', id: 'd1' });
    await mountPage(<RecordPage />, { routes: { 'GET /api/v1/shell/record/:kind/:id': raw({ record: { kind: 'document', kindLabel: 'Document', id: 'd1', ref: 'DOC-1', title: 'Mandate.pdf', status: null, route: '/ops/vault', fields: [] }, history: null }) } });
    expect(await screen.findByRole('button', { name: 'Preview file' })).toBeInTheDocument();
    expect(screen.queryByText('Recent activity')).not.toBeInTheDocument();
  });
  it('unknown / forbidden records show a clear message; ids are URL-decoded for the API call', async () => {
    setParams({ kind: 'order', id: 'a%2Fb' });
    const { api } = await mountPage(<RecordPage />, { routes: { 'GET /api/v1/shell/record/:kind/:id': fail(404, 'not_found', 'Record not found') } });
    expect(await screen.findByText(/Not found/)).toBeInTheDocument();
    expect(api.requests.some((r) => r.path.includes('/shell/record/order/a%2Fb'))).toBe(true);
  });
  it('403 says the role cannot view it', async () => {
    setParams({ kind: 'payroll', id: 'x' });
    await mountPage(<RecordPage />, { routes: { 'GET /api/v1/shell/record/:kind/:id': fail(403, 'permission_denied', 'Your role does not include this record') } });
    expect(await screen.findByText(/You do not have permission to view the record/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ audit
const evt = (id: string, o: Record<string, unknown> = {}) => ({ id, at: '2026-08-26T10:00:00Z', user: 'Ann Auditor', role: 'Compliance', portal: 'admin', action: 'nav.release', actionLabel: 'Release NAV', objectType: 'nav_run', objectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', previous: 'MAKER_REVIEWED', next: 'RELEASED', before: null, after: null, reason: 'Month end', ip: null, requestId: null, ...o });
const aBase = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin-core/audit/facets': ok({ actions: [{ value: 'nav.release', count: 3 }], objectTypes: [{ value: 'nav_run', count: 3 }], portals: [{ value: 'admin', count: 9 }], stats: { total: 1234, last24h: 12, firstAt: '2026-01-01T00:00:00Z', lastAt: '2026-08-26T10:00:00Z', headId: '1234', headHash: 'abcdef0123456789abcdef' } }),
  'GET /api/v1/admin/audit-events': raw({ data: [evt('1001'), evt('1000', { action: 'order.approve' })], nextBefore: '1000' }),
  ...o,
});

describe('Audit trail', () => {
  it('shows stats, events with who/what/change/reason; long object ids are shortened', async () => {
    await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase() });
    expect(await screen.findByText('#1001')).toBeInTheDocument();
    expect(screen.getByText(/1,234 events · 12 in the last 24 hours/)).toBeInTheDocument();
    expect(screen.getAllByText('Ann Auditor')).toHaveLength(2);
    expect(screen.getAllByText('“Month end”')).toHaveLength(2);
    expect(screen.getAllByText('nav_run aaaaaaaa…')).toHaveLength(2);
  });
  it('search sends filters (including ISO date bounds); Clear resets them', async () => {
    const { user, api } = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase() });
    await screen.findByText('#1001');
    await user.type(screen.getByLabelText('Search'), 'release');
    await user.type(screen.getByLabelText('User'), 'ann');
    await user.selectOptions(screen.getByLabelText('Action'), 'nav.release');
    await user.type(screen.getByLabelText('From'), '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const q = api.calls('GET /api/v1/admin/audit-events').at(-1)!.query;
      expect(q.get('q')).toBe('release');
      expect(q.get('actor')).toBe('ann');
      expect(q.get('action')).toBe('nav.release');
      expect(q.get('from')).toMatch(/^2026-08-01T|^2026-07-31T/);
      expect(q.get('limit')).toBe('50');
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.calls('GET /api/v1/admin/audit-events').at(-1)!.query.get('q')).toBeNull());
  });
  it('clicking an object filters to every event on it; Load older events pages with `before`', async () => {
    const { user, api } = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase() });
    await user.click((await screen.findAllByTitle('Show every event on this object'))[0]!);
    await waitFor(() => {
      const q = api.calls('GET /api/v1/admin/audit-events').at(-1)!.query;
      expect(q.get('objectType')).toBe('nav_run');
      expect(q.get('objectId')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });
    await user.click(await screen.findByRole('button', { name: 'Load older events' }));
    await waitFor(() => expect(api.calls('GET /api/v1/admin/audit-events').at(-1)!.query.get('before')).toBe('1000'));
  });
  it('Verify chain reports intact vs broken with counts', async () => {
    const a = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin/audit-events/verify': ok({ checked: 1234, brokenAt: null }) }) });
    await a.user.click(await screen.findByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText(/Chain intact: 1,234 events recomputed/)).toBeInTheDocument();
    a.unmount();
    const b = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin/audit-events/verify': ok({ checked: 10, brokenAt: '77' }) }) });
    await b.user.click(await screen.findByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText(/Chain broken at event 77 after 10 intact events/)).toBeInTheDocument();
  });
  it('event drawer shows before/after, chain links and navigates to the previous event', async () => {
    const detail = (id: string) => ok({ id, at: '2026-08-26T10:00:00Z', actor: 'Ann Auditor', role: 'Compliance', portal: 'admin', action: 'nav.release', objectType: 'nav_run', objectId: 'x', before: { status: 'A' }, after: { status: 'B' }, reason: 'Why', ip: '1.1.1.1', requestId: 'req-1', prevHash: 'p'.repeat(64), hash: 'h'.repeat(64), linkedToPrevious: true, linkedToNext: null, eventsOnObject: 3, previousId: id === '1001' ? '1000' : null, nextId: null });
    const { user, api } = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin-core/audit/events/:id': (_r: unknown, p: Record<string, string>) => detail(p.id) }) });
    await user.click(await screen.findByRole('button', { name: '#1001' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText(/"status": "B"/)).toBeInTheDocument();
    expect(within(dlg).getByText('latest')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Next event' })).toBeDisabled();
    await user.click(within(dlg).getByRole('button', { name: 'Previous event' }));
    await waitFor(() => expectCalled(api, 'GET /api/v1/admin-core/audit/events/1000'));
  });
  it('export CSV failure is reported, not swallowed', async () => {
    const { user } = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin/audit-events.csv': fail(403, 'forbidden', 'Export not allowed') }) });
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Export not allowed')).toBeInTheDocument();
  });
  it('empty result, error and no-permission states', async () => {
    const a = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin/audit-events': raw({ data: [], nextBefore: null }) }) });
    expect(await screen.findByText('No audit events match.')).toBeInTheDocument();
    a.unmount();
    const b = await mountPage(<AuditPage />, { perms: ['audit.view'], routes: aBase({ 'GET /api/v1/admin/audit-events': fail(500, 'x', 'Audit store down') }) });
    expect(await screen.findByText('Audit store down')).toBeInTheDocument();
    b.unmount();
    const c = await mountPage(<AuditPage />, { perms: [], routes: aBase() });
    expect(await screen.findByText(/Ask an administrator for the audit.view permission/)).toBeInTheDocument();
    expectNotCalled(c.api, 'GET /api/v1/admin/audit-events');
  });
});

// ------------------------------------------------------------------ copilot
const reply = (q: string, o: Record<string, unknown> = {}) => ok({ id: `c-${q}`, question: q, intent: 'positions', answer: 'You hold 12 positions.', table: { columns: ['Ticker', 'Qty'], rows: [['ABC', '100']] }, sources: [{ label: 'IBOR', endpoint: '/ibor/ledger', rows: 12, href: '/ops/ibor', asOf: '2026-08-26T10:00:00Z' }], engine: 'ROUTER', toolCalls: [{ tool: 'positions', permission: null, status: 'OK', rows: 12 }, { tool: 'cash', permission: 'cash.view', status: 'DENIED', rows: 0 }], at: '2026-08-26T10:00:00Z', ...o });
const cBase = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin-core/copilot/suggestions': ok({ enabled: true, suggestions: ['What are my biggest positions?'] }),
  'GET /api/v1/admin-core/copilot/history': ok([{ id: 'h1', question: 'Any breaks?', intent: 'breaks', answer: 'x', at: '2026-08-25T10:00:00Z' }]),
  'POST /api/v1/admin-core/copilot/ask': (r: { body: { question: string } }) => reply(r.body.question),
  ...o,
});

describe('Investment Copilot', () => {
  it('Ask is disabled for questions under 3 characters; asking posts the trimmed question and shows answer, table, sources and tool calls (with denied permission)', async () => {
    const { user, api } = await mountPage(<CopilotPage />, { perms: ['dashboard.view'], routes: cBase() });
    const input = await screen.findByLabelText('Question');
    const ask = screen.getByRole('button', { name: 'Ask' });
    await user.type(input, 'ab');
    expect(ask).toBeDisabled();
    await user.type(input, 'c  ');
    await user.click(ask);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/copilot/ask'));
    expectBody(req!, { question: 'abc' });
    expect(await screen.findByText('You hold 12 positions.')).toBeInTheDocument();
    expect(screen.getByText('ABC')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'IBOR' })).toHaveAttribute('href', '/ops/ibor');
    expect(screen.getByText(/cash \(denied, needs cash.view\)/)).toBeInTheDocument();
    expect(screen.getByText(/positions \(12 rows\)/)).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('');
  });
  it('suggestions and history items ask directly; history reloads after asking', async () => {
    const { user, api } = await mountPage(<CopilotPage />, { perms: ['dashboard.view'], routes: cBase() });
    await user.click(await screen.findByRole('button', { name: 'What are my biggest positions?' }));
    await waitFor(() => expectBody(api.calls('POST /api/v1/admin-core/copilot/ask')[0]!, { question: 'What are my biggest positions?' }));
    await waitFor(() => expect(api.calls('GET /api/v1/admin-core/copilot/history').length).toBeGreaterThan(1));
    await user.click(screen.getByRole('button', { name: 'Any breaks?' }));
    await waitFor(() => expect(api.calls('POST /api/v1/admin-core/copilot/ask')).toHaveLength(2));
  });
  it('API failure shows the error and keeps the question text', async () => {
    const { user } = await mountPage(<CopilotPage />, { perms: ['dashboard.view'], routes: cBase({ 'POST /api/v1/admin-core/copilot/ask': fail(503, 'unavailable', 'The model is unavailable') }) });
    const input = await screen.findByLabelText('Question');
    await user.type(input, 'what is my cash');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('The model is unavailable')).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('what is my cash');
  });
  it('switched off in Settings shows the notice and no input; no permission shows access message', async () => {
    const a = await mountPage(<CopilotPage />, { perms: ['dashboard.view'], routes: cBase({ 'GET /api/v1/admin-core/copilot/suggestions': ok({ enabled: false, suggestions: [] }) }) });
    expect(await screen.findByText(/The Copilot is switched off in Settings/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Question')).not.toBeInTheDocument();
    a.unmount();
    await mountPage(<CopilotPage />, { perms: [], routes: cBase() });
    expect(await screen.findByText(/Ask an administrator for the dashboard.view permission/)).toBeInTheDocument();
  });
});
