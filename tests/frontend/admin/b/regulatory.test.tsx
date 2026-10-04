import { describe, it, expect, vi } from 'vitest';
import RegulatoryPage from '@/app/(ops)/ops/regulatory/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const row = (o: Record<string, unknown> = {}) => ({ id: 'fl1', ref: 'REG-00002', templateKey: 'CMA_Q', template: 'Quarterly return', regulator: 'SECZ', formCode: 'Q-1', periodStart: '2026-04-01', periodEnd: '2026-06-30', dueDate: '2026-07-30', daysToDue: -40, status: 'DRAFT', effectiveStatus: 'OVERDUE', populated: false, evidenceCount: 0, maker: null, submittedBy: null, submissionRef: null, ...o });
const calendar = (rows = [row()]) => raw({ data: rows, counts: { open: 3, overdue: 1, dueIn14Days: 2, inReview: 1, awaitingSubmission: 0, submitted: 5 } });
const payload = { template: 'CMA_Q', period: { start: '2026-04-01', end: '2026-06-30' }, figures: [{ label: 'Total assets', value: '1,000,000.00' }], tables: [{ name: 'Holdings', columns: ['Ticker', 'Qty'], rows: [['ABC', 100]] }], notes: ['Prepared from live data'] };
const detail = (o: Record<string, unknown> = {}, a: Record<string, unknown> = {}) => ({
  ...row(), notes: null, returnReason: null, payload: null, payloadSha256: null, evidence: [], timeline: [{ at: '2026-07-01T10:00:00Z', action: 'regulatory.filing_created', actor: 'Rita R', reason: null }], submissions: [],
  actions: { populate: true, attachEvidence: true, submitForReview: true, approve: false, return: false, submit: false, waive: false, ...a }, ...o,
});
const evidence = (n = 1) => Array.from({ length: n }, (_, i) => ({ id: `ev${i + 1}`, name: `statement-${i + 1}.pdf`, description: 'Bank statement', sha256: 'h', uploadedBy: 'Rita R', createdAt: '2026-07-02T10:00:00Z' }));
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/regulatory/calendar': calendar(),
  'GET /api/v1/regulatory/templates': ok([{ key: 'CMA_Q', regulator: 'SECZ', formCode: 'Q-1', name: 'Quarterly return', description: 'Quarterly SECZ filing', frequency: 'QUARTERLY', dueAfterDays: 30 }]),
  'GET /api/v1/regulatory/filings/:id': ok(detail()),
  ...o,
});
const VIEW = ['reports.view'];
const PREP = ['reports.view', 'reports.create'];

describe('Regulatory calendar', () => {
  it('tiles, filing rows with form, period, lateness and effective status; evidence count', async () => {
    await mountPage(<RegulatoryPage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('REG-00002')).toBeInTheDocument();
    expect(screen.getByText('SECZ Q-1')).toBeInTheDocument();
    expect(screen.getByText('40 days late')).toBeInTheDocument();
    expect(screen.getByText('not prepared')).toBeInTheDocument();
    expect(screen.getByText('2026-04-01 to 2026-06-30')).toBeInTheDocument();
    expect(screen.getByText('Due in 14 days').parentElement).toHaveTextContent('2');
  });
  it('viewer has no New filing / Open calendar filings; preparer does and creating posts the template with a key', async () => {
    const v = await mountPage(<RegulatoryPage />, { perms: VIEW, routes: base() });
    await screen.findByText('REG-00002');
    expect(screen.queryByRole('button', { name: 'New filing' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await mountPage(<RegulatoryPage />, { perms: PREP, routes: base({ 'POST /api/v1/regulatory/filings': ok({ id: 'fl9' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'New filing' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Create and populate' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings'));
    expect(req!.body).toEqual({ templateKey: 'CMA_Q' });
    expectIdempotencyKey(req!);
    await waitFor(() => expectCalled(api, 'GET /api/v1/regulatory/filings/fl9'));
  });
  it('templates tab lists regulator, frequency and due offset', async () => {
    const { user } = await mountPage(<RegulatoryPage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    expect(await screen.findByText('Quarterly SECZ filing')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });
  it('empty calendar and API error states; no permission', async () => {
    const a = await mountPage(<RegulatoryPage />, { perms: VIEW, routes: base({ 'GET /api/v1/regulatory/calendar': calendar([]) }) });
    expect(await screen.findByText(/No filings yet/)).toBeInTheDocument();
    a.unmount();
    const b = await mountPage(<RegulatoryPage />, { perms: VIEW, routes: base({ 'GET /api/v1/regulatory/calendar': fail(500, 'x', 'Calendar offline') }) });
    expect(await screen.findByText(/Calendar offline/)).toBeInTheDocument();
    b.unmount();
    await mountPage(<RegulatoryPage />, { perms: [], routes: base() });
    expect(await screen.findByText('You do not have permission to view regulatory reporting.')).toBeInTheDocument();
  });
});

describe('Regulatory filing (ADB-018)', () => {
  const open = async (d: ReturnType<typeof detail>, routes: Record<string, unknown> = {}, perms = PREP) => {
    const m = await mountPage(<RegulatoryPage />, { perms, routes: base({ 'GET /api/v1/regulatory/filings/:id': ok(d), ...routes }) });
    await m.user.click(await screen.findByRole('button', { name: 'Open' }));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('ADB-018: DRAFT with no figures and no evidence: "Send for review" is disabled with the missing prerequisites named, and the hint text says so', async () => {
    const { dlg } = await open(detail());
    const b = await within(dlg).findByRole('button', { name: 'Send for review' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'First populate the figures and attach at least one piece of evidence');
    expect(within(dlg).getByText('First populate the figures and attach at least one piece of evidence.')).toBeInTheDocument();
  });
  it('ADB-018: figures present but no evidence names only the evidence; with both it is enabled and shows no hint', async () => {
    const a = await open(detail({ payload }));
    expect(await within(a.dlg).findByText('First attach at least one piece of evidence.')).toBeInTheDocument();
    a.unmount();
    const b = await open(detail({ payload, evidence: evidence() }));
    const btn = await within(b.dlg).findByRole('button', { name: 'Send for review' });
    expect(btn).toBeEnabled();
    expect(within(b.dlg).queryByText(/^First /)).not.toBeInTheDocument();
  });
  it('ADB-018: a red error from an earlier failed click disappears once the prerequisite state changes (evidence removed -> button re-keyed)', async () => {
    let evidenceCount = 1;
    const { user, dlg, api } = await open(detail({ payload, evidence: evidence() }), {
      'GET /api/v1/regulatory/filings/:id': () => ok(detail({ payload, evidence: evidence(evidenceCount) })),
      'POST /api/v1/regulatory/filings/:id/submit-review': fail(409, 'conflict', 'Evidence is stale, refresh first'),
      'DELETE /api/v1/regulatory/filings/:id/evidence/:eid': () => {
        evidenceCount = 0;
        return ok({});
      },
    });
    await user.click(await within(dlg).findByRole('button', { name: 'Send for review' }));
    expect(await within(dlg).findByText(/Evidence is stale, refresh first/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Remove' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/regulatory/filings/fl1/evidence/ev1'));
    await waitFor(() => expect(within(dlg).queryByText(/Evidence is stale/)).not.toBeInTheDocument());
    expect(within(dlg).getByRole('button', { name: 'Send for review' })).toBeDisabled();
  });
  it('rebuild from live data asks for an in-app confirm, posts populate with a key and reloads', async () => {
    const { user, dlg, api } = await open(detail(), { 'POST /api/v1/regulatory/filings/:id/populate': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Rebuild from live data' }));
    expect(within(screen.getAllByRole('dialog').at(-1)!).getByText(/You become the preparer/)).toBeInTheDocument();
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Rebuild from live data' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings/fl1/populate'));
    expectIdempotencyKey(req!);
    await waitFor(() => expect(api.calls('GET /api/v1/regulatory/filings/fl1').length).toBeGreaterThan(1));
  });
  it('figures, tables and notes render; Download CSV fetches the export and saves it', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};
    const { user, dlg, api } = await open(detail({ payload, evidence: evidence() }), { 'GET /api/v1/regulatory/filings/:id/export': ok({ filename: 'REG-00002.csv', csv: 'a,b\n1,2' }) });
    expect(await within(dlg).findByText('Total assets')).toBeInTheDocument();
    expect(within(dlg).getByText('1,000,000.00')).toBeInTheDocument();
    expect(within(dlg).getByText('Prepared from live data')).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expectCalled(api, 'GET /api/v1/regulatory/filings/fl1/export'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  });
  it('evidence upload without a file says "Choose a file first"; with a file posts multipart to /evidence', async () => {
    const { user, dlg, api } = await open(detail({ payload }), { 'POST /api/v1/regulatory/filings/:id/evidence': raw({ data: { id: 'ev9' } }, 201) });
    await user.click(await within(dlg).findByRole('button', { name: 'Attach evidence' }));
    expect(await within(dlg).findByText('Choose a file first')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/regulatory/filings/fl1/evidence');
    const input = dlg.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File(['pdf'], 'bank.pdf'));
    await user.click(within(dlg).getByRole('button', { name: 'Attach evidence' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings/fl1/evidence'));
    expect((req!.body as FormData).get('file')).toBeInstanceOf(File);
  });
  it('maker-checker: action buttons follow the server-provided action flags (approve/return/submit/waive)', async () => {
    const none = await open(detail({ status: 'IN_REVIEW', payload, evidence: evidence() }, { populate: false, attachEvidence: false, submitForReview: false }));
    await within(none.dlg).findByText('Figures');
    for (const n of ['Approve', 'Return', 'Record submission', 'Waive', 'Send for review']) expect(within(none.dlg).queryByRole('button', { name: n })).not.toBeInTheDocument();
    none.unmount();
    const { user, dlg, api } = await open(detail({ status: 'IN_REVIEW', payload, evidence: evidence() }, { approve: true, return: true, submit: true, waive: true, populate: false, attachEvidence: false, submitForReview: false }), { 'POST /api/v1/regulatory/filings/:id/approve': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings/fl1/approve'));
  });
  it('SoD refusal on approve is shown as a different-approver message', async () => {
    const { user, dlg } = await open(detail({ status: 'IN_REVIEW', payload, evidence: evidence() }, { approve: true, populate: false, attachEvidence: false, submitForReview: false }), { 'POST /api/v1/regulatory/filings/:id/approve': fail(409, 'segregation_of_duties', 'You prepared this filing') });
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    expect(await within(dlg).findByText('A different approver is required. You prepared this filing')).toBeInTheDocument();
  });
  it('return requires a 5+ char reason and posts it; record submission posts the regulator reference with a key', async () => {
    const { user, dlg, api } = await open(detail({ status: 'APPROVED', payload, evidence: evidence() }, { return: true, submit: true, populate: false, attachEvidence: false, submitForReview: false }), { 'POST /api/v1/regulatory/filings/:id/return': ok({}), 'POST /api/v1/regulatory/filings/:id/submit': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Return' }));
    const reason = screen.getByLabelText(/^Reason/);
    expect(reason).toHaveAttribute('minlength', '5');
    await user.type(reason, 'Totals do not tie');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Return to preparer' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings/fl1/return'));
    expectBody(r!, { reason: 'Totals do not tie' });
    await user.click(await within(dlg).findByRole('button', { name: 'Record submission' }));
    await user.type(screen.getByLabelText(/Regulator reference/), 'SECZ-2026-77');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Record as submitted' }));
    const [s] = await waitFor(() => expectCalled(api, 'POST /api/v1/regulatory/filings/fl1/submit'));
    expectBody(s!, { submissionRef: 'SECZ-2026-77' });
    expectIdempotencyKey(s!);
  });
  it('shows return reason, history with humanised actions, electronic submissions and payload hash prefix', async () => {
    const { dlg } = await open(detail({ returnReason: 'Fix totals', status: 'DRAFT', payloadSha256: 'abcdef0123456789zzzz', payload, evidence: evidence(), submissions: [{ id: 's1', regulator: 'SECZ', formCode: 'Q-1', status: 'ACCEPTED', receiptRef: 'RCPT-1', receivedAt: '2026-07-03T10:00:00Z', payloadSha256: 'x', submittedBy: 'Sub S' }] }));
    expect(await within(dlg).findByText(/Returned: Fix totals/)).toBeInTheDocument();
    expect(within(dlg).getByText('abcdef0123456789')).toBeInTheDocument();
    expect(within(dlg).getByText(/Filing created by Rita R/)).toBeInTheDocument();
    expect(within(dlg).getByText(/receipt RCPT-1 \(sent by Sub S\)/)).toBeInTheDocument();
  });
});
