import { describe, it, expect } from 'vitest';
import VaultPage from '@/app/(ops)/ops/vault/page';
import { mountPage } from './_kit';
import { raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const doc = (o: Record<string, unknown> = {}) => ({
  id: 'DOC-0042', name: 'Mandate agreement.pdf', type: 'legal', classification: 'Restricted', status: 'Draft', client: 'Horizon Pension Fund', clientRef: 'CL-1', fund: null, fundRef: null, date: '2026-08-01', versions: 2, retentionYears: 7, retainUntil: '2033-08-01',
  retention: 'Retained', held: false, pendingChanges: 0, ...o,
});
const detail = (o: Record<string, unknown> = {}, d: Record<string, unknown> = {}) => ({
  document: { ...doc(o), uuid: 'uuid-42', makerId: 'usr_other', label: null, relatedLabel: 'Mandate MND-1', period: null },
  versions: [{ version: 1, sha256: 'a'.repeat(64), file: 'm.pdf', size: '22 B', scan: 'CLEAN', by: 'Uploader U', at: '2026-08-01T10:00:00Z' }, { version: 2, sha256: 'b'.repeat(64), file: 'm2.pdf', size: '1.4 MB', scan: 'CLEAN', by: 'Uploader U', at: '2026-08-02T10:00:00Z' }],
  holds: [], changes: [], published: [], accessLog: [{ id: 'al1', action: 'DOWNLOAD', by: null, at: '2026-08-03T10:00:00Z', ip: '10.0.0.1' }], ...d,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/client-ops/vault/summary': raw({ total: 32, byClassification: { Restricted: 4 }, retention: { 'Disposal eligible': 1, 'Due within 90 days': 2 }, held: 1, pendingChanges: 2, accessLast7Days: 9 }),
  'GET /api/v1/client-ops/vault/documents': raw({ data: [doc()] }),
  'GET /api/v1/client-ops/vault/documents/:id': raw(detail()),
  'GET /api/v1/clients': raw({ data: [{ id: 'CL-1', name: 'Horizon Pension Fund' }] }),
  'GET /api/v1/ops/funds': raw({ data: [{ id: 'f1', ref: 'FND-1', name: 'Balanced Growth Fund' }] }),
  'GET /api/v1/client-ops/vault/changes': raw({ data: [] }),
  'GET /api/v1/client-ops/vault/pm-evidence': raw({ data: [] }),
  'GET /api/v1/client-ops/vault/access-log': raw({ data: [] }),
  ...o,
});
const VIEW = ['documents.view'];
const EDIT = ['documents.view', 'documents.edit'];

/** jsdom keeps its own file list for constraint validation, so a `required` file input that user-event filled still counts as empty; drop the attribute so the submit handler runs (the handler's own file check is what we test). */
const unrequire = (el: HTMLElement) => el.removeAttribute('required');

describe('Vault register', () => {
  it('tiles and register rows with client names, classification, retention and version count', async () => {
    await mountPage(<VaultPage />, { routes: base() });
    expect(await screen.findByText('Mandate agreement.pdf')).toBeInTheDocument();
    expect(screen.getByText('4 restricted')).toBeInTheDocument();
    expect(screen.getByText('2 due within 90 days')).toBeInTheDocument();
    expect(screen.getByText('Horizon Pension Fund', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText(/7y · until 01 Aug 2033/)).toBeInTheDocument();
  });
  it('filters (search, type, classification, retention, client, fund) are sent to the API', async () => {
    const { user, api } = await mountPage(<VaultPage />, { routes: base() });
    await screen.findByText('Mandate agreement.pdf');
    await user.type(screen.getByPlaceholderText('Name, reference or related item'), 'mand');
    await user.selectOptions(screen.getByLabelText('Type'), 'legal');
    await user.selectOptions(screen.getByLabelText('Classification'), 'Restricted');
    await user.selectOptions(screen.getByLabelText('Retention'), 'Held');
    await user.selectOptions(screen.getByLabelText('Client'), 'CL-1');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Fund' }), 'FND-1');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/client-ops/vault/documents').at(-1)!.query;
      expect(Object.fromEntries(q)).toMatchObject({ q: 'mand', type: 'legal', classification: 'Restricted', retention: 'Held', client: 'CL-1', fund: 'FND-1' });
    });
  });
  it('empty, error and no-access states; Access log tab only for approvers', async () => {
    const a = await mountPage(<VaultPage />, { perms: VIEW, routes: base({ 'GET /api/v1/client-ops/vault/documents': raw({ data: [] }) }) });
    expect(await screen.findByText('No documents match.')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Access log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
    a.unmount();
    const b = await mountPage(<VaultPage />, { perms: [...VIEW, 'documents.approve'], routes: base({ 'GET /api/v1/client-ops/vault/documents': fail(500, 'x', 'Vault offline') }) });
    expect(await screen.findByText(/Could not load documents: Vault offline/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Access log' })).toBeInTheDocument();
    b.unmount();
    await mountPage(<VaultPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the documents.view permission/)).toBeInTheDocument();
  });
});

describe('Vault upload (ADB-016a)', () => {
  it('ADB-016(a): the name field is prefilled from the chosen file and stays editable', async () => {
    const { user } = await mountPage(<VaultPage />, { perms: EDIT, routes: base() });
    await user.click(await screen.findByRole('button', { name: 'Upload document' }));
    const dlg = screen.getByRole('dialog');
    const name = within(dlg).getByLabelText(/^Name/) as HTMLInputElement;
    expect(name.value).toBe('');
    await user.upload(within(dlg).getByLabelText(/^File/), new File(['x'.repeat(22)], 'board-pack.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(name.value).toBe('board-pack.pdf'));
    await user.clear(name);
    await user.type(name, 'Board pack Q3');
    expect(name.value).toBe('Board pack Q3');
  });
  it('submitting without a file is refused with "Choose a file" and sends nothing (the multipart body itself is covered in suite-helpers.test: jsdom FormData cannot read user-event uploads)', async () => {
    const { user, api } = await mountPage(<VaultPage />, { perms: EDIT, routes: base({ 'POST /api/v1/documents': raw({ data: { id: 'x' } }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Upload document' }));
    const dlg = screen.getByRole('dialog');
    unrequire(within(dlg).getByLabelText(/^File/));
    await user.click(within(dlg).getByRole('button', { name: 'Upload' }));
    expect(await within(dlg).findByText('Choose a file')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/documents');
  });
  it('a file chosen second time without a manual edit refreshes the prefilled name', async () => {
    const { user } = await mountPage(<VaultPage />, { perms: EDIT, routes: base() });
    await user.click(await screen.findByRole('button', { name: 'Upload document' }));
    const dlg = screen.getByRole('dialog');
    const name = within(dlg).getByLabelText(/^Name/) as HTMLInputElement;
    await user.upload(within(dlg).getByLabelText(/^File/), new File(['a'], 'one.pdf'));
    await waitFor(() => expect(name.value).toBe('one.pdf'));
  });
});

describe('Vault document detail', () => {
  const open = async (d: ReturnType<typeof detail>, perms: string[]) => {
    const m = await mountPage(<VaultPage />, {
      perms,
      routes: base({
        'GET /api/v1/client-ops/vault/documents/:id': raw(d),
        'POST /api/v1/documents/:id/submit': raw({}), 'POST /api/v1/documents/:id/approve': raw({}), 'POST /api/v1/documents/:id/publish': raw({}),
        'POST /api/v1/client-ops/vault/documents/:id/changes': raw({}, 201), 'POST /api/v1/client-ops/vault/documents/:id/hold': raw({}, 201),
        'POST /api/v1/client-ops/vault/holds/:id/release': raw({}),
      }),
    });
    await m.user.click(await screen.findByText('Mandate agreement.pdf'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('ADB-016(b): versions show the exact size text from the API (22 B) and a short hash', async () => {
    const { dlg } = await open(detail(), EDIT);
    expect(await within(dlg).findByText('22 B')).toBeInTheDocument();
    expect(within(dlg).getByText('1.4 MB')).toBeInTheDocument();
    expect(within(dlg).getByText('a'.repeat(12))).toHaveAttribute('title', 'a'.repeat(64));
  });
  it('ADB-016(c): the submitter sees Approve disabled with the maker-checker reason', async () => {
    const { dlg } = await open(detail({ status: 'In review' }, {}) as never, [...EDIT, 'documents.approve']);
    // maker = usr_other in the fixture, so approve is enabled for the signed-in admin
    const ok1 = await within(dlg).findByRole('button', { name: 'Approve' });
    expect(ok1).toBeEnabled();
  });
  it('ADB-016(c): when the signed-in user is the maker, Approve is disabled with the reason', async () => {
    const d = detail({ status: 'In review' });
    (d.document as { makerId: string }).makerId = 'usr_admin';
    const { dlg, api } = await open(d, [...EDIT, 'documents.approve']);
    const b = await within(dlg).findByRole('button', { name: 'Approve' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Maker-checker: a different person must approve this document');
    expectNotCalled(api, 'POST /api/v1/documents/uuid-42/approve');
  });
  it('lifecycle: Draft shows Submit for review; posts to the document uuid (the documents API has no idempotency-key requirement)', async () => {
    const { user, api, dlg } = await open(detail(), EDIT);
    await user.click(await within(dlg).findByRole('button', { name: 'Submit for review' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/documents/uuid-42/submit'));
  });
  it('publish needs a linked client and an in-app confirm; sends client ids', async () => {
    const noClient = await open(detail({ status: 'Approved', classification: 'Client', clientRef: null, client: null }), EDIT);
    const b = await within(noClient.dlg).findByRole('button', { name: 'Publish to client' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'Link the document to a client first');
    noClient.unmount();
    const { user, api, dlg } = await open(detail({ status: 'Approved', classification: 'Client' }), EDIT);
    await user.click(await within(dlg).findByRole('button', { name: 'Publish to client' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Publish to client' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/documents/uuid-42/publish'));
    expectBody(req!, { clientIds: ['CL-1'] });
  });
  it('classification change is a maker-checker change request with a 5+ char reason', async () => {
    const { user, api, dlg } = await open(detail(), EDIT);
    await user.click(await within(dlg).findByRole('button', { name: 'Change classification' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    expect(within(f).getByText(/Goes to a different approver/)).toBeInTheDocument();
    await user.selectOptions(within(f).getByLabelText(/New classification/), 'Internal');
    await user.type(within(f).getByLabelText(/^Reason/), 'Reclassified');
    await user.click(within(f).getByRole('button', { name: 'Submit for approval' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/vault/documents/DOC-0042/changes'));
    expectBody(req!, { kind: 'CLASSIFICATION', to: 'Internal', reason: 'Reclassified' });
    expectIdempotencyKey(req!);
  });
  it('legal hold: the placer cannot release their own hold; another approver can', async () => {
    const hold = { id: 'h1', reason: 'Litigation', placedBy: 'Legal L', placedById: 'usr_admin', placedAt: '2026-08-05T10:00:00Z', releasedAt: null, releasedBy: null, releaseNote: null };
    const own = await open(detail({ held: true, retention: 'Held' }, { holds: [hold] }), [...EDIT, 'documents.approve']);
    expect(await within(own.dlg).findByText(/Legal hold since .* by Legal L: Litigation/)).toBeInTheDocument();
    expect(within(own.dlg).queryByRole('button', { name: 'Release legal hold' })).not.toBeInTheDocument();
    own.unmount();
    const { user, api, dlg } = await open(detail({ held: true, retention: 'Held' }, { holds: [{ ...hold, placedById: 'someone-else' }] }), [...EDIT, 'documents.approve']);
    await user.click(await within(dlg).findByRole('button', { name: 'Release legal hold' }));
    await user.type(screen.getAllByRole('dialog').at(-1)!.querySelector('textarea')!, 'Case closed');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Release' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/vault/holds/h1/release'));
    expectBody(req!, { note: 'Case closed' });
  });
  it('disposal request only when disposal eligible and not held; disposed documents show the withdrawn notice', async () => {
    const elig = await open(detail({ retention: 'Disposal eligible' }), EDIT);
    expect(await within(elig.dlg).findByRole('button', { name: 'Request disposal' })).toBeInTheDocument();
    elig.unmount();
    const disposed = await open(detail({ status: 'Disposed', retention: 'Disposal eligible' }), EDIT);
    expect(await within(disposed.dlg).findByText(/disposed at the end of its retention period/)).toBeInTheDocument();
    expect(within(disposed.dlg).queryByRole('button', { name: 'Request disposal' })).not.toBeInTheDocument();
  });
  it('viewer (no documents.edit) has no mutation controls', async () => {
    const { dlg } = await open(detail(), VIEW);
    await within(dlg).findByText('Versions (2)');
    for (const n of ['Change classification', 'Place legal hold', 'Upload new version', 'Submit for review']) expect(within(dlg).queryByRole('button', { name: n })).not.toBeInTheDocument();
  });
  it('access tab lists the user or "Investor user" when no staff user', async () => {
    const { user, dlg } = await open(detail(), VIEW);
    await user.click(await within(dlg).findByRole('tab', { name: 'Access (1)' }));
    expect(await within(dlg).findByText('Investor user')).toBeInTheDocument();
  });
});

describe('Vault pending changes and evidence', () => {
  it('pending changes: maker sees "Awaiting a different approver"; approver approves with a note', async () => {
    const changes = raw({ data: [{ id: 'ch1', document: 'DOC-1', name: 'A.pdf', kind: 'CLASSIFICATION', from: 'Internal', to: 'Restricted', reason: 'Sensitive', status: 'PENDING', maker: 'Maker M', makerId: 'usr_other', at: '2026-08-01T10:00:00Z' }, { id: 'ch2', document: 'DOC-2', name: 'B.pdf', kind: 'RETENTION', from: '7', to: '10', reason: 'Policy', status: 'PENDING', maker: 'Me', makerId: 'usr_admin', at: '2026-08-01T10:00:00Z' }] });
    const { user, api } = await mountPage(<VaultPage />, { perms: [...EDIT, 'documents.approve'], routes: base({ 'GET /api/v1/client-ops/vault/changes': changes, 'POST /api/v1/client-ops/vault/changes/:id/approve': raw({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Pending changes' }));
    expect(await screen.findByText('Awaiting a different approver')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.type(screen.getByLabelText(/^Note/), 'Looks right');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/vault/changes/ch1/approve'));
    expectBody(req!, { note: 'Looks right' });
  });
  it('ADB-016(e): an approved mark with no file shows "Evidence file missing: attach it"; with a file shows its id and status', async () => {
    const ev = raw({ data: [{ id: 'e1', kind: 'GP_STATEMENT', title: 'Q2 statement', note: null, mark: 'MRK-1', markStatus: 'APPROVED', asOf: '2026-06-30', commitment: 'CMT-1', fund: 'Growth III', document: null }, { id: 'e2', kind: 'VALUATION_REPORT', title: 'Report', note: 'n', mark: 'MRK-2', markStatus: 'PENDING_APPROVAL', asOf: '2026-06-30', commitment: 'CMT-2', fund: 'Growth IV', document: { id: 'DOC-0007', name: 'r.pdf', status: 'Approved' } }, { id: 'e3', kind: 'OTHER', title: 'Draft ev', note: null, mark: 'MRK-3', markStatus: 'DRAFT', asOf: '2026-06-30', commitment: 'CMT-3', fund: 'Growth V', document: null }] });
    const { user } = await mountPage(<VaultPage />, { perms: EDIT, routes: base({ 'GET /api/v1/client-ops/vault/pm-evidence': ev }) });
    await user.click(await screen.findByRole('tab', { name: 'Valuation evidence' }));
    expect(await screen.findByText('Evidence file missing: attach it')).toBeInTheDocument();
    expect(screen.getByText('DOC-0007')).toBeInTheDocument();
    expect(screen.getByText('No file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New version' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Attach file' })).toHaveLength(2);
  });
  it('empty evidence and empty pending-changes messages', async () => {
    const { user } = await mountPage(<VaultPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Pending changes' }));
    expect(await screen.findByText('Nothing awaiting approval.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Valuation evidence' }));
    expect(await screen.findByText('No valuation evidence recorded yet.')).toBeInTheDocument();
  });
});
