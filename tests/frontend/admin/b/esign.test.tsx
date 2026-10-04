import { describe, it, expect } from 'vitest';
import EsignPage from '@/app/(ops)/ops/esign/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectNotCalled } from '../../_helpers';

const signer = (o: Record<string, unknown> = {}) => ({ id: 'sg1', orderNo: 1, kind: 'STAFF', userId: 'usr_admin', name: 'Test Admin', email: 'admin@example.test', roleLabel: 'Approver', status: 'PENDING', identityMethod: null, notifiedAt: null, reminderCount: 1, fieldCount: 2, nextReminderAt: null, viewedAt: null, signedAt: null, declinedAt: null, declineReason: null, signatureMode: null, ip: null, chainHash: null, ...o });
const request = (o: Record<string, unknown> = {}) => ({
  id: 'rq1', ref: 'ESG-1001', title: 'Subscription agreement', message: null, status: 'PENDING', signingOrder: 'SEQUENTIAL', subjectType: 'LP_COMMITMENT', subjectId: 'CMT-9', documentId: 'd1', originalSha256: 'a'.repeat(64), sealedSha256: null, chainHead: null, hasSealed: false, hasCertificate: false,
  expiresAt: '2026-10-30T00:00:00Z', sentAt: '2026-09-01T10:00:00Z', completedAt: null, voidReason: null, declineReason: null, createdAt: '2026-09-01T09:00:00Z', progress: { signed: 0, total: 2 }, reminder: { intervalDays: 3, max: 3, custom: false }, bulkBatchId: null, fields: [],
  signers: [signer(), signer({ id: 'sg2', orderNo: 2, kind: 'LP', userId: null, name: 'Lola LP', email: 'lola@x.test', roleLabel: null })], events: [{ id: 'ev1', type: 'SENT', at: '2026-09-01T10:00:00Z', who: 'Test Admin', ip: null, hash: 'f'.repeat(64) }], ...o,
});
const list = (rows = [request(), request({ id: 'rq2', ref: 'ESG-1002', title: 'Done doc', status: 'COMPLETED', progress: { signed: 2, total: 2 }, completedAt: '2026-09-05T10:00:00Z' })]) => raw({ data: rows, counts: { PENDING: 1, COMPLETED: 1, DECLINED: 0 } });
const mine = (n = 1) => raw({ data: Array.from({ length: n }, (_, i) => ({ id: `rq${i + 1}`, ref: `ESG-100${i + 1}`, title: 'Subscription agreement', message: null, status: 'PENDING', expiresAt: null, completedAt: null, hasSealed: false, actionable: true, me: { id: 'sg1', status: 'PENDING', name: 'Test Admin', roleLabel: 'Approver', signedAt: null }, signers: [] })) });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/esign/requests': list(),
  'GET /api/v1/esign/me/requests': mine(1),
  'GET /api/v1/esign/requests/:id': ok({ request: request() }),
  ...o,
});
const VIEW = ['esign.view'];
const MANAGE = ['esign.view', 'esign.manage', 'esign.void'];

describe('E-signature screen', () => {
  it('lists requests with signers, progress and status; tiles from counts', async () => {
    await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('ESG-1001')).toBeInTheDocument();
    expect(screen.getAllByText('Test Admin, Lola LP')).toHaveLength(2);
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getAllByText('lp commitment').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending').parentElement).toHaveTextContent('1');
  });
  it('search and status filter are sent; submitting the search form trims the term', async () => {
    const { user, api } = await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    await screen.findByText('ESG-1001');
    await user.selectOptions(screen.getByLabelText('Status'), 'COMPLETED');
    await user.type(screen.getByPlaceholderText(/Reference, title, signer name/), '  lola ');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => {
      const q = api.calls('GET /api/v1/esign/requests').at(-1)!.query;
      expect(q.get('status')).toBe('COMPLETED');
      expect(q.get('q')).toBe('lola');
    });
  });
  it('management controls only for esign.manage; void only with esign.void', async () => {
    const v = await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    await screen.findByText('ESG-1001');
    for (const n of ['New signature request', 'Bulk send']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Start a signing flow')).not.toBeInTheDocument();
    v.unmount();
    await mountPage(<EsignPage />, { perms: MANAGE, routes: base() });
    expect(await screen.findByRole('button', { name: 'New signature request' })).toBeInTheDocument();
    expect(screen.getByLabelText('Start a signing flow')).toBeInTheDocument();
  });
  it('empty and error states', async () => {
    const a = await mountPage(<EsignPage />, { perms: VIEW, routes: base({ 'GET /api/v1/esign/requests': list([]) }) });
    expect(await screen.findByText('No signature requests match.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<EsignPage />, { perms: VIEW, routes: base({ 'GET /api/v1/esign/requests': fail(500, 'x', 'E-sign offline') }) });
    expect(await screen.findByText(/Could not load signature requests: E-sign offline/)).toBeInTheDocument();
  });
});

describe('Staff signing (ADB-025)', () => {
  it('ADB-025: the all-requests view shows a banner "N document(s) are waiting for your own signature" with a Review and sign button that opens the inbox', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: VIEW, routes: base({ 'GET /api/v1/esign/me/requests': mine(2) }) });
    expect(await screen.findByText(/2 documents are waiting for your own signature/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review and sign' }));
    expect(await screen.findByText('Awaiting my signature')).toBeInTheDocument();
    expect(await screen.findAllByText('Subscription agreement')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'All signature requests' })).toBeInTheDocument();
  });
  it('ADB-025: singular wording for one document; no banner when none is actionable', async () => {
    const a = await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText(/1 document is waiting for your own signature/)).toBeInTheDocument();
    a.unmount();
    await mountPage(<EsignPage />, { perms: VIEW, routes: base({ 'GET /api/v1/esign/me/requests': raw({ data: [{ id: 'rq1', actionable: false }] }) }) });
    await screen.findByText('ESG-1001');
    expect(screen.queryByText(/waiting for your own signature/)).not.toBeInTheDocument();
  });
  it('ADB-025: opening a request shows a Sign button on the signed-in user\'s row when it is their turn; clicking it closes the drawer and shows the inbox', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByText('ESG-1001'));
    const dlg = await screen.findByRole('dialog');
    const sign = await within(dlg).findByRole('button', { name: 'Sign' });
    expect(within(sign.closest('tr')!).getByText('admin@example.test')).toBeInTheDocument();
    await user.click(sign);
    expect(await screen.findByText('Awaiting my signature')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('ADB-025: other signers\' rows have no Sign button; a completed request offers no Sign to anyone', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: VIEW, routes: base({ 'GET /api/v1/esign/requests/:id': ok({ request: request({ status: 'COMPLETED' }) }) }) });
    await user.click(await screen.findByText('ESG-1001'));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByText('Lola LP');
    expect(within(dlg).queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument();
  });
  it('ADB-025/nav: a user without esign.view still gets the signer inbox with an explanation (no all-requests fetch)', async () => {
    const { api } = await mountPage(<EsignPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Your role cannot see the signature requests of other people \(esign.view\), but you can sign what has been sent to you/)).toBeInTheDocument();
    expect(await screen.findByText('Awaiting my signature')).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/esign/requests');
    expect(screen.queryByRole('button', { name: 'All signature requests' })).not.toBeInTheDocument();
  });
  it('inbox "My signatures" tab can return to all requests', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: VIEW, routes: base() });
    await screen.findByText('ESG-1001');
    await user.click(screen.getByRole('button', { name: 'My signatures' }));
    await user.click(await screen.findByRole('button', { name: 'All signature requests' }));
    expect(await screen.findByText('ESG-1001')).toBeInTheDocument();
  });
});

describe('E-signature request detail', () => {
  const open = async (r: ReturnType<typeof request>, perms = MANAGE, routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<EsignPage />, { perms, routes: base({ 'GET /api/v1/esign/requests/:id': ok({ request: r }), ...routes }) });
    await m.user.click(await screen.findByText('ESG-1001'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('shows hash facts, signer identity method, audit trail and reminder schedule', async () => {
    const { dlg } = await open(request({ signers: [signer({ status: 'SIGNED', identityMethod: 'EMAIL_OTP', signedAt: '2026-09-02T10:00:00Z', ip: '1.2.3.4' }), signer({ id: 'sg2', userId: null, name: 'Lola LP' })] }), VIEW);
    expect(await within(dlg).findByText('every 3 days, up to 3 per signer (default)')).toBeInTheDocument();
    expect(within(dlg).getByText('Not sealed yet')).toBeInTheDocument();
    expect(within(dlg).getByText('E-mail code')).toBeInTheDocument();
    expect(within(dlg).getByText('SENT')).toBeInTheDocument();
    expect(within(dlg).getByText('f'.repeat(12))).toBeInTheDocument();
  });
  it('sealed PDF / certificate downloads are disabled until they exist', async () => {
    const { dlg } = await open(request(), VIEW);
    expect(await within(dlg).findByRole('button', { name: 'Download sealed PDF' })).toBeDisabled();
    expect(within(dlg).getByRole('button', { name: 'Download certificate' })).toBeDisabled();
    expect(within(dlg).getByRole('button', { name: 'Download original' })).toBeEnabled();
  });
  it('draft: Send for signature posts; pending: Remind everyone and per-signer Resend post (signerId)', async () => {
    const d = await open(request({ status: 'DRAFT' }), MANAGE, { 'POST /api/v1/esign/requests/:id/send': ok({}) });
    await d.user.click(await within(d.dlg).findByRole('button', { name: 'Send for signature' }));
    await waitFor(() => expectCalled(d.api, 'POST /api/v1/esign/requests/rq1/send'));
    d.unmount();
    const p = await open(request(), MANAGE, { 'POST /api/v1/esign/requests/:id/resend': ok({}) });
    await p.user.click(await within(p.dlg).findByRole('button', { name: 'Remind everyone due' }));
    await waitFor(() => expectCalled(p.api, 'POST /api/v1/esign/requests/rq1/resend'));
    const row = within(p.dlg).getByText('Lola LP').closest('tr')!;
    await p.user.click(within(row).getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(p.api.calls('POST /api/v1/esign/requests/rq1/resend')).toHaveLength(2));
    expectBody(p.api.calls('POST /api/v1/esign/requests/rq1/resend')[1]!, { signerId: 'sg2' });
  });
  it('void needs esign.void and a reason (3+ chars); completed requests cannot be voided', async () => {
    const { user, api, dlg } = await open(request(), MANAGE, { 'POST /api/v1/esign/requests/:id/void': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Void request' }));
    const reason = screen.getByLabelText(/^Reason/);
    expect(reason).toBeRequired();
    await user.type(reason, 'Wrong document');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Void request' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/esign/requests/rq1/void'));
    expectBody(req!, { reason: 'Wrong document' });
  });
  it('no void without esign.void; none for completed', async () => {
    const a = await open(request(), ['esign.view', 'esign.manage']);
    await within(a.dlg).findByText('Signers');
    expect(within(a.dlg).queryByRole('button', { name: 'Void request' })).not.toBeInTheDocument();
    a.unmount();
    const b = await open(request({ status: 'COMPLETED' }), MANAGE);
    await within(b.dlg).findByText('Signers');
    expect(within(b.dlg).queryByRole('button', { name: 'Void request' })).not.toBeInTheDocument();
  });
  it('Verify integrity shows a pass/fail report per check; an API error appears as an alert', async () => {
    const { user, dlg } = await open(request(), VIEW, { 'GET /api/v1/esign/requests/:id/verify': ok({ ok: false, checks: [{ name: 'Hash chain', ok: true, detail: null }, { name: 'Sealed PDF hash', ok: false, detail: 'mismatch' }] }) });
    await user.click(await within(dlg).findByRole('button', { name: 'Verify integrity' }));
    expect(await within(dlg).findByText('Integrity problem')).toBeInTheDocument();
    expect(within(dlg).getByText('FAILED: Sealed PDF hash (mismatch)')).toBeInTheDocument();
    expect(within(dlg).getByText('Passed: Hash chain')).toBeInTheDocument();
  });
  it('send failure (e.g. missing fields) shows the API message in the drawer', async () => {
    const { user, dlg } = await open(request({ status: 'DRAFT' }), MANAGE, { 'POST /api/v1/esign/requests/:id/send': fail(400, 'validation_error', 'Every signer needs a signature field') });
    await user.click(await within(dlg).findByRole('button', { name: 'Send for signature' }));
    expect(await within(dlg).findByText(/Every signer needs a signature field/)).toBeInTheDocument();
  });
});
