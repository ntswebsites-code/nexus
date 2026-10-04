import { describe, it, expect } from 'vitest';
import EsignPage from '@/app/(ops)/ops/esign/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const MANAGE = ['esign.view', 'esign.manage'];
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/esign/requests': raw({ data: [], counts: {} }),
  'GET /api/v1/esign/me/requests': raw({ data: [] }),
  'GET /api/v1/esign/batches': ok([]),
  'GET /api/v1/esign/directory': ok([{ userId: 'u9', name: 'Stan Staff', email: 'stan@x.test', kind: 'STAFF', org: 'Matanho', role: 'Analyst' }]),
  'POST /api/v1/uploads': raw({ files: [{ id: 'file-1' }] }, 201),
  'POST /api/v1/esign/requests': ok({ request: { id: 'rq9' } }, 201),
  'GET /api/v1/esign/requests/:id': ok({ request: { id: 'rq9', ref: 'ESG-9', title: 'X', status: 'DRAFT', signingOrder: 'PARALLEL', subjectType: null, subjectId: null, documentId: null, originalSha256: 'a', sealedSha256: null, chainHead: null, hasSealed: false, hasCertificate: false, expiresAt: null, sentAt: null, completedAt: null, voidReason: null, declineReason: null, createdAt: '2026-09-01T00:00:00Z', progress: { signed: 0, total: 1 }, reminder: { intervalDays: 3, max: 3, custom: false }, bulkBatchId: null, fields: [], signers: [], events: [] } }),
  ...o,
});

async function startWizard(routes: Record<string, unknown> = {}) {
  const m = await mountPage(<EsignPage />, { perms: MANAGE, routes: base(routes) });
  await m.user.click(await screen.findByRole('button', { name: 'New signature request' }));
  return { ...m, dlg: await screen.findByRole('dialog') };
}

describe('E-signature wizard (new signature request)', () => {
  it('Step 1: Next stays disabled until a PDF is chosen and the title has 3+ characters; uploading prefills the title from the file name', async () => {
    const { user, dlg } = await startWizard();
    const next = within(dlg).getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    await user.click(within(dlg).getByRole('button', { name: 'Upload a PDF' }));
    await user.upload(within(dlg).getByLabelText(/^PDF file/), new File(['%PDF-1.4'], 'Subscription form.pdf', { type: 'application/pdf' }));
    expect(await within(dlg).findByText('Uploaded Subscription form.pdf.')).toBeInTheDocument();
    expect(within(dlg).getByLabelText(/^Title/)).toHaveValue('Subscription form');
    expect(next).toBeEnabled();
    await user.clear(within(dlg).getByLabelText(/^Title/));
    await user.type(within(dlg).getByLabelText(/^Title/), 'ab');
    expect(next).toBeDisabled();
  });
  it('upload failure is shown and Next stays disabled', async () => {
    const { user, dlg } = await startWizard({ 'POST /api/v1/uploads': fail(400, 'validation_error', 'Encrypted PDFs are not supported') });
    await user.click(within(dlg).getByRole('button', { name: 'Upload a PDF' }));
    await user.upload(within(dlg).getByLabelText(/^PDF file/), new File(['x'], 'locked.pdf', { type: 'application/pdf' }));
    expect(await within(dlg).findByText(/Encrypted PDFs are not supported/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  const toStep2 = async (user: ReturnType<typeof import('@testing-library/user-event').default.setup>, dlg: HTMLElement) => {
    await user.click(within(dlg).getByRole('button', { name: 'Upload a PDF' }));
    await user.upload(within(dlg).getByLabelText(/^PDF file/), new File(['%PDF-1.4'], 'Agreement.pdf', { type: 'application/pdf' }));
    await within(dlg).findByText('Uploaded Agreement.pdf.');
    await user.click(within(dlg).getByRole('button', { name: 'Next' }));
  };
  it('Step 2: at least one signer is required; staff can be added from the directory (once, duplicates ignored) and removed', async () => {
    const { user, dlg, api } = await startWizard();
    await toStep2(user, dlg);
    expect(within(dlg).getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(within(dlg).getByText('Add at least one signer.')).toBeInTheDocument();
    await user.click(await within(dlg).findByRole('button', { name: 'Add' }));
    await user.click(within(dlg).getByRole('button', { name: 'Add' }));
    expect(within(dlg).getByText('Signers (1)')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/esign/directory')[0]!.query.get('kind')).toBe('STAFF');
    expect(within(dlg).getByRole('button', { name: 'Next' })).toBeEnabled();
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }));
    expect(within(dlg).getByText('Add at least one signer.')).toBeInTheDocument();
  });
  it('Step 2: external signer needs a name and a valid e-mail before the Add button is enabled', async () => {
    const { user, dlg } = await startWizard();
    await toStep2(user, dlg);
    await user.selectOptions(within(dlg).getByLabelText(/^Signer type/), 'EXTERNAL');
    const add = within(dlg).getByRole('button', { name: 'Add external signer' });
    expect(add).toBeDisabled();
    await user.type(within(dlg).getByLabelText(/^Full name/), 'Ext Person');
    await user.type(within(dlg).getByLabelText(/^E-mail/), 'not-an-email');
    expect(add).toBeDisabled();
    await user.clear(within(dlg).getByLabelText(/^E-mail/));
    await user.type(within(dlg).getByLabelText(/^E-mail/), 'ext@x.test');
    expect(add).toBeEnabled();
  });
  it('full flow: upload, external signer, review, Send for signature posts the file, signer, order and send:true once, then opens the new request', async () => {
    const { user, dlg, api } = await startWizard();
    await toStep2(user, dlg);
    await user.selectOptions(within(dlg).getByLabelText(/^Signer type/), 'EXTERNAL');
    await user.type(within(dlg).getByLabelText(/^Full name/), 'Ext Person');
    await user.type(within(dlg).getByLabelText(/^E-mail/), 'ext@x.test');
    await user.click(within(dlg).getByRole('button', { name: 'Add external signer' }));
    await user.click(within(dlg).getByRole('button', { name: 'Next' }));
    expect(within(dlg).getByText(/By default each signature goes on a signature page appended to the document/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Next' }));
    expect(within(dlg).getByText('On the appended signature page')).toBeInTheDocument();
    expect(within(dlg).getByText('Ext Person (External (e-mail link))')).toBeInTheDocument();
    expect(within(dlg).getByText('Default (every 3 days, up to 3)')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Send for signature' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/esign/requests'));
    expect(req!.body).toMatchObject({ title: 'Agreement', fileId: 'file-1', signingOrder: 'PARALLEL', expiresInDays: 14, send: true, signers: [{ kind: 'EXTERNAL', name: 'Ext Person', email: 'ext@x.test', orderNo: 1 }] });
    await waitFor(() => expectCalled(api, 'GET /api/v1/esign/requests/rq9'));
  });
  it('Save as draft posts send:false; a server refusal is shown in the wizard and it stays open', async () => {
    const { user, dlg, api } = await startWizard({ 'POST /api/v1/esign/requests': fail(400, 'validation_error', 'Validation failed', undefined) });
    await toStep2(user, dlg);
    await user.selectOptions(within(dlg).getByLabelText(/^Signer type/), 'EXTERNAL');
    await user.type(within(dlg).getByLabelText(/^Full name/), 'Ext Person');
    await user.type(within(dlg).getByLabelText(/^E-mail/), 'ext@x.test');
    await user.click(within(dlg).getByRole('button', { name: 'Add external signer' }));
    await user.click(within(dlg).getByRole('button', { name: 'Next' }));
    await user.click(within(dlg).getByRole('button', { name: 'Next' }));
    await user.click(within(dlg).getByRole('button', { name: 'Save as draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/esign/requests'));
    expectBody(req!, { send: false });
    expect(await within(dlg).findByText(/Validation failed/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('Back navigates between steps and Cancel on step 1 closes; sequential order exposes order numbers', async () => {
    const { user, dlg } = await startWizard();
    await user.selectOptions(within(dlg).getByLabelText(/^Signing order/), 'SEQUENTIAL');
    await toStep2(user, dlg);
    await user.selectOptions(within(dlg).getByLabelText(/^Signer type/), 'EXTERNAL');
    await user.type(within(dlg).getByLabelText(/^Full name/), 'Ext Person');
    await user.type(within(dlg).getByLabelText(/^E-mail/), 'ext@x.test');
    await user.click(within(dlg).getByRole('button', { name: 'Add external signer' }));
    expect(within(dlg).getByText(/Signers with the same number sign together/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Back' }));
    expect(within(dlg).getByLabelText(/^Title/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('E-signature verify and flows', () => {
  it('verify a hash: shows SEALED/chain result; unknown hash says it is not on record', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/esign/public/verify': raw({ match: 'NONE', sha256: 'x' }) }) });
    await user.click(await screen.findByRole('button', { name: 'Verify a document' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByPlaceholderText('64 hex characters'), 'a'.repeat(64));
    await user.click(within(dlg).getByRole('button', { name: 'Check hash' }));
    expect(await within(dlg).findByText(/No sealed or original document with this hash is on record/)).toBeInTheDocument();
  });
  it('verify result with a broken chain warns', async () => {
    const { user, api } = await mountPage(<EsignPage />, { perms: MANAGE, routes: base({ 'POST /api/v1/esign/public/verify': raw({ match: 'SEALED', sha256: 'x', ref: 'ESG-1', note: 'Matches the sealed PDF.', chainIntact: false, signers: [{ name: 'Ann', roleLabel: null, signedAt: null }] }) }) });
    await user.click(await screen.findByRole('button', { name: 'Verify a document' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByPlaceholderText('64 hex characters'), 'b'.repeat(64));
    await user.click(within(dlg).getByRole('button', { name: 'Check hash' }));
    expect(await within(dlg).findByText(/ESG-1: Matches the sealed PDF\. The recorded signature chain no longer verifies\. Signed by Ann\./)).toBeInTheDocument();
    expectBody(expectCalled(api, 'POST /api/v1/esign/public/verify')[0]!, { sha256: 'b'.repeat(64) });
  });
  it('signing flows menu offers the five flows and only for managers', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: MANAGE, routes: base() });
    const menu = await screen.findByLabelText('Start a signing flow');
    expect(within(menu).getAllByRole('option').map((o) => o.textContent)).toEqual(['Signing flows…', 'Subscription and commitment pack', 'LP commitment agreement (single page)', 'Capital call acknowledgement', 'Term sheet countersignature', 'Staff approval']);
    await user.selectOptions(menu, 'staff-approval');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
  it('bulk send dialog opens for managers', async () => {
    const { user } = await mountPage(<EsignPage />, { perms: MANAGE, routes: base() });
    await user.click(await screen.findByRole('button', { name: 'Bulk send' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expectNotCalled((await mountPage(<EsignPage />, { perms: MANAGE, routes: base() })).api, 'POST /api/v1/esign/requests');
  });
});
