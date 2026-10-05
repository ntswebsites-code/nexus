import { describe, it, expect } from 'vitest';
import JournalPage from '@/app/(ops)/ops/cash/journals/[id]/page';
import ImportPage from '@/app/(ops)/ops/cash/imports/[id]/page';
import ClosePage from '@/app/(ops)/ops/cash/closes/[id]/page';
import { setStepUpHandler } from '@/ops/api';
import { expectBody, expectCalled, expectIdempotencyKey, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, mountPage, without } from './_kit';

const allowed = { edit: false, submit: false, discard: false, returnToMaker: false, reject: false, post: true, postBlocker: null as string | null, reverse: false };
const line = (n: number, debit: string, credit: string) => ({ id: `l${n}`, lineNo: n, ledgerId: 'led-1', ledgerRef: 'LED-001', ledgerName: 'Bank account', ledgerKind: 'BANK', debit, credit, memo: n === 1 ? 'Cash in' : null });
const jr = (over: Record<string, unknown> = {}, al: Partial<typeof allowed> = {}) => ({
  id: 'j-1', ref: 'CJ-00007', portfolioId: PF.id, portfolioName: PF.name, entryDate: '2026-09-30', description: 'Fee refund', purpose: 'MANUAL_CORRECTION', sourceRef: 'DEP-9', evidenceRef: null, currency: 'USD', status: 'PENDING_APPROVAL',
  totalDebit: '500.00', totalCredit: '500.00', makerId: 'u1', makerName: 'Maya Maker', postedByName: null, postedAt: null, rejectReason: null, expectationId: null, reservationId: null, reversalOfId: null, reversalOfRef: null, reversedById: null, reversedByRef: null, reverseReason: null,
  periodClosed: false, lines: [line(1, '500.00', '0.00'), line(2, '0.00', '500.00')], timeline: [{ at: '2026-09-30T09:00:00Z', action: 'SUBMITTED', actor: 'Maya Maker', reason: null }], allowed: { ...allowed, ...al }, ...over,
});
const jroutes = (j: unknown) => ({ 'GET /api/v1/cash/journals/j-1': D(j), 'GET /api/v1/portfolios': D([PF]) });

describe('Cash journal detail', () => {
  it('renders lines (blank zero side), control block with maker and checker names and the history', async () => {
    mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: jroutes(jr()) });
    expect(await screen.findByText('CJ-00007')).toBeInTheDocument();
    expect(screen.getByText('Maya Maker', { selector: 'dd, td, div, span' })).toBeInTheDocument();
    expect(screen.getByText('Cash in')).toBeInTheDocument();
    expect(screen.getByText(/Submitted/i)).toBeInTheDocument();
  });

  it('Approve and post: confirm dialog, then POST /post with an Idempotency-Key, then reloads', async () => {
    const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(jr()), 'POST /api/v1/cash/journals/j-1/post': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent(/cannot be edited/);
    await user.click(within(dlg).getByRole('button', { name: 'Approve and post' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/post'));
    expectIdempotencyKey(req);
    await waitFor(() => expect(api.calls('GET /api/v1/cash/journals/j-1').length).toBe(2));
  });

  it('SoD: when the maker views their own journal, Post is disabled and the blocker is explained', async () => {
    mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: jroutes(jr({}, { post: false, postBlocker: 'You created this journal' })) });
    const btn = await screen.findByRole('button', { name: 'Approve and post' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'You created this journal');
    expect(screen.getByText(/Posting is not available to you: You created this journal/)).toBeInTheDocument();
  });

  it('segregation_of_duties error from the API is shown with the "different approver" wording', async () => {
    const { user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(jr()), 'POST /api/v1/cash/journals/j-1/post': fail(403, 'segregation_of_duties', 'Maker cannot post own journal') } });
    await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve and post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A different approver is required. Maker cannot post own journal');
  });

  it('step-up: the post is retried once after the authenticator code with the SAME Idempotency-Key', async () => {
    let n = 0;
    const routes = { ...jroutes(jr()), 'POST /api/v1/cash/journals/j-1/post': () => (++n === 1 ? fail(401, 'step_up_required', 'Code needed') : D({})) };
    setStepUpHandler(async () => true);
    try {
      const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes });
      await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve and post' }));
      await waitFor(() => expect(api.calls('POST /api/v1/cash/journals/j-1/post')).toHaveLength(2));
      const [a, b] = api.calls('POST /api/v1/cash/journals/j-1/post');
      expect(a.idempotencyKey).toBeTruthy();
      expect(b.idempotencyKey).toBe(a.idempotencyKey);
    } finally {
      setStepUpHandler(null);
    }
  });

  it('a cancelled step-up shows "Nothing was changed" and does not retry', async () => {
    setStepUpHandler(async () => false);
    try {
      const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(jr()), 'POST /api/v1/cash/journals/j-1/post': fail(401, 'step_up_required', 'Code needed') } });
      await user.click(await screen.findByRole('button', { name: 'Approve and post' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve and post' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed');
      expect(api.calls('POST /api/v1/cash/journals/j-1/post')).toHaveLength(1);
    } finally {
      setStepUpHandler(null);
    }
  });

  it('draft: Submit for approval is offered; Edit/Return/Reject/Discard follow the allowed flags', async () => {
    const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(jr({ status: 'DRAFT' }, { submit: true, edit: true, discard: true, post: false })), 'POST /api/v1/cash/journals/j-1/submit': D({}), 'POST /api/v1/cash/journals/j-1/discard': D({}) } });
    expect(await screen.findByRole('button', { name: 'Edit draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and post' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit for approval' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit for approval' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/submit')))[0]);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText(/Reason/)).toBeRequired();
    await user.type(within(d).getByLabelText(/Reason/), 'Duplicate entry');
    await user.click(within(d).getByRole('button', { name: 'Discard' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/discard')))[0], { reason: 'Duplicate entry' });
  });

  it('Reject sends the reason; Return sends the reason', async () => {
    const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(jr({}, { reject: true, returnToMaker: true })), 'POST /api/v1/cash/journals/j-1/reject': D({}), 'POST /api/v1/cash/journals/j-1/return': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    let d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Wrong ledger');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/reject')))[0], { reason: 'Wrong ledger' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Return to creator' }));
    d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Needs evidence');
    await user.click(within(d).getByRole('button', { name: 'Return' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/return')))[0], { reason: 'Needs evidence' });
  });

  it('posted journal: Reverse needs a reason and navigates to the reversal journal; shows final-by-reversal banner', async () => {
    const posted = jr({ status: 'POSTED', postedByName: 'Carl Checker', postedAt: '2026-09-30T10:00:00Z' }, { reverse: true, post: false });
    const { api, user } = mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { ...jroutes(posted), 'POST /api/v1/cash/journals/j-1/reverse': D({ id: 'j-2' }) } });
    expect(await screen.findByText(/Posted by Carl Checker/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Posted in error');
    await user.click(within(d).getByRole('button', { name: 'Post reversal' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals/j-1/reverse')))[0], { reason: 'Posted in error' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/cash/journals/j-2'));
  });

  it('closed-period warning, rejected reason and reversal links render', async () => {
    mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: jroutes(jr({ status: 'REJECTED', rejectReason: 'Wrong ledger', periodClosed: true, reversalOfId: 'j-0', reversalOfRef: 'CJ-00001' })) });
    expect(await screen.findByText(/Rejected: Wrong ledger/)).toBeInTheDocument();
    expect(screen.getByText(/Cash for this date is closed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CJ-00001' })).toHaveAttribute('href', '/ops-native/cash/journals/j-0');
  });

  it('not found and server errors show a state, not a crash', async () => {
    mountPage(<JournalPage />, { params: { id: 'j-1' }, routes: { 'GET /api/v1/cash/journals/j-1': fail(404, 'not_found', 'nope'), 'GET /api/v1/portfolios': D([]) } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Not found/);
  });
});

const imp = (over: Record<string, unknown> = {}, al = {}) => ({
  id: 'imp-1', ref: 'IMP-001', ledgerName: 'Bank account', portfolioName: PF.name, currency: 'USD', filename: 'sep.csv', format: 'CSV', statementFrom: '2026-09-01', statementTo: '2026-09-30', openingBalance: '100.00', closingBalance: '250.00', lineCount: 2, unmatchedLines: 1, variance: '0.00', status: 'STAGED', makerName: 'Maya Maker', checkerName: null, rejectReason: null,
  lines: [{ id: 'sl-1', lineNo: 1, valueDate: '2026-09-02', amount: '150.00', reference: 'REF1', description: 'Deposit', status: 'UNMATCHED', matchedJournalId: null, note: null }],
  timeline: [], allowed: { commit: true, commitBlocker: null, reject: true, ...al }, ...over,
});

describe('Statement import detail', () => {
  it('staged: Commit evidence posts with a key; blocker disables it with the reason', async () => {
    const { api, user } = mountPage(<ImportPage />, { params: { id: 'imp-1' }, routes: { 'GET /api/v1/cash/statement-imports/imp-1': D(imp()), 'POST /api/v1/cash/statement-imports/imp-1/commit': D({}) } });
    expect(await screen.findByText('Deposit')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Commit evidence' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Commit evidence' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-imports/imp-1/commit')))[0]);
  });
  it('maker cannot commit: button disabled and blocker text shown', async () => {
    mountPage(<ImportPage />, { params: { id: 'imp-1' }, routes: { 'GET /api/v1/cash/statement-imports/imp-1': D(imp({}, { commit: false, commitBlocker: 'You uploaded this statement' })) } });
    expect(await screen.findByRole('button', { name: 'Commit evidence' })).toBeDisabled();
    expect(screen.getByText(/Commit is not available to you: You uploaded this statement/)).toBeInTheDocument();
  });
  it('Reject requires a reason and sends it', async () => {
    const { api, user } = mountPage(<ImportPage />, { params: { id: 'imp-1' }, routes: { 'GET /api/v1/cash/statement-imports/imp-1': D(imp()), 'POST /api/v1/cash/statement-imports/imp-1/reject': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Wrong account');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-imports/imp-1/reject')))[0], { reason: 'Wrong account' });
  });
  it('committed: unmatched lines can be matched by journal reference or written off with an explanation', async () => {
    const committed = imp({ status: 'COMMITTED', checkerName: 'Carl Checker' }, { reject: false });
    const routes = { 'GET /api/v1/cash/statement-imports/imp-1': D(committed), 'POST /api/v1/cash/statement-lines/sl-1/match': D({}), 'POST /api/v1/cash/statement-lines/sl-1/ignore': D({}) };
    const { api, user } = mountPage(<ImportPage />, { params: { id: 'imp-1' }, routes });
    expect(await screen.findByText(/1 line not matched/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Match' }));
    let d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Journal reference'), 'CJ-00012');
    await user.click(within(d).getByRole('button', { name: 'Match' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-lines/sl-1/match')))[0], { journalId: 'CJ-00012' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Write off' }));
    d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Explanation'), 'Bank charge');
    await user.click(within(d).getByRole('button', { name: 'Write off' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-lines/sl-1/ignore')))[0], { note: 'Bank charge' });
  });
  it('match/write-off buttons follow permissions', async () => {
    mountPage(<ImportPage />, { params: { id: 'imp-1' }, perms: ['cash.view'], routes: { 'GET /api/v1/cash/statement-imports/imp-1': D(imp({ status: 'COMMITTED' })) } });
    await screen.findByText('Deposit');
    expect(screen.queryByRole('button', { name: 'Match' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write off' })).not.toBeInTheDocument();
  });
});

const close = (over: Record<string, unknown> = {}) => ({
  id: 'cl-1', portfolioId: PF.id, portfolioName: PF.name, periodEnd: '2026-09-30', status: 'PREPARED', preparedByName: 'Maya Maker', approvedByName: null, closedByName: null, closedAt: null, reopenReason: null, canClose: false, blockers: ['Suspense is not clear'],
  checklist: [{ key: 'suspense', label: 'Suspense clear', ok: false, blockers: ['2 open suspense items'], detail: 'Suspense must be nil' }, { key: 'coverage', label: 'Statement coverage', ok: true, blockers: [], detail: 'Covered' }], ...over,
});

describe('Cash period close detail', () => {
  it('lists every blocker in the pre-check and disables Close period with the reason', async () => {
    mountPage(<ClosePage />, { params: { id: 'cl-1' }, routes: { 'GET /api/v1/cash/period-closes/cl-1': D(close()) } });
    expect(await screen.findByText('2 open suspense items')).toBeInTheDocument();
    expect(screen.getByText('Close blocked: 1 blocker.')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Close period' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Clear every blocker first');
  });
  it('checker approval then close: both send keys and reload', async () => {
    const routes = { 'GET /api/v1/cash/period-closes/cl-1': D(close({ canClose: true, blockers: [] })), 'POST /api/v1/cash/period-closes/cl-1/approve': D({}), 'POST /api/v1/cash/period-closes/cl-1/close': D({}) };
    const { api, user } = mountPage(<ClosePage />, { params: { id: 'cl-1' }, routes });
    expect(await screen.findByText('Every control passes. The period can be closed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Approve as checker' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve as checker' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/period-closes/cl-1/approve')))[0]);
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close period' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/period-closes/cl-1/close')))[0]);
  });
  it('closed period offers Reopen with a mandatory reason', async () => {
    const { api, user } = mountPage(<ClosePage />, { params: { id: 'cl-1' }, routes: { 'GET /api/v1/cash/period-closes/cl-1': D(close({ status: 'CLOSED', closedByName: 'Carl Checker', closedAt: '2026-10-01T08:00:00Z', blockers: [] })), 'POST /api/v1/cash/period-closes/cl-1/reopen': D({}) } });
    expect(await screen.findByText(/Closed by Carl Checker/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Late statement');
    await user.click(within(d).getByRole('button', { name: 'Reopen' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/period-closes/cl-1/reopen')))[0], { reason: 'Late statement' });
  });
  it('without cash.close the close/reopen controls are absent', async () => {
    mountPage(<ClosePage />, { params: { id: 'cl-1' }, perms: without('cash.close'), routes: { 'GET /api/v1/cash/period-closes/cl-1': D(close()) } });
    await screen.findByText('2 open suspense items');
    expect(screen.queryByRole('button', { name: 'Close period' })).not.toBeInTheDocument();
  });
});
