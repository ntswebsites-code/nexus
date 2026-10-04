import { describe, it, expect } from 'vitest';
import AccountingPage from '@/app/(ops)/ops/accounting/page';
import AJournalPage from '@/app/(ops)/ops/accounting/journals/[id]/page';
import PeriodPage from '@/app/(ops)/ops/accounting/periods/[id]/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, fireEvent, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage, validationFail, without } from './_kit';

const acct = (id: string, code: string, name: string, type = 'ASSET') => ({ id, portfolioId: PF.id, code, name, type, description: null, isActive: true });
const journal = { id: 'aj-1', ref: 'JE-00001', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, entryDate: '2026-09-30', description: 'NAV release', currency: 'USD', status: 'POSTED', totalDebit: '900.00', totalCredit: '900.00', makerId: 'u1', makerName: 'Maya Maker', postedByName: 'Pat Poster', postedAt: '2026-09-30T10:00:00Z', reversalOfId: null, reversalOfRef: null, reversedById: null, reversedByRef: null, reverseReason: null };
const period = { id: 'p-1', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, periodStart: '2026-09-01', periodEnd: '2026-09-30', month: '2026-09', status: 'OPEN', unpostedJournals: 0, closingByName: null, closedByName: null, closedAt: null, reopenedByName: null, reopenedAt: null, reopenReason: null };

const base = () => ({
  'GET /api/v1/portfolios': D([PF]),
  'GET /api/v1/accounting/journals': D([journal], { total: 1, summary: { byStatus: { POSTED: 1 }, drafts: 0, pendingApproval: 0, posted: 1 } }),
  'GET /api/v1/accounting/periods': D([period]),
  'GET /api/v1/accounting/accounts': D([acct('a1', '1000', 'Cash'), acct('a2', '3000', 'Capital', 'EQUITY')]),
});
type M = ReturnType<typeof mountPage>;
const tab = async (user: M['user'], name: string) => user.click(await screen.findByRole('tab', { name }));
const pick = async (user: M['user']) => {
  await screen.findByRole('option', { name: /Growth Portfolio/ });
  await user.selectOptions(screen.getAllByRole('combobox')[0], PF.id);
};

describe('Accounting page', () => {
  it('ADA-028: no valuation.view shows a message naming valuation.view and accounting.post, loads nothing', async () => {
    const { api } = mountPage(<AccountingPage />, { perms: without('valuation.view'), routes: base() });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('valuation.view');
    expect(alert).toHaveTextContent('accounting.post');
    expect(api.calls('GET /api/v1/accounting/journals')).toHaveLength(0);
  });

  it('journals tab lists journals with the summary, status filter re-queries, and rows open the detail', async () => {
    const { api, user } = mountPage(<AccountingPage />, { routes: base() });
    expect(await screen.findByText('JE-00001')).toBeInTheDocument();
    expect(screen.getByText(/0 draft . 0 awaiting posting . 1 posted/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'POSTED');
    await waitFor(() => expect(api.calls('GET /api/v1/accounting/journals').at(-1)!.query.get('status')).toBe('POSTED'));
    await user.click(await screen.findByText('JE-00001'));
    expect(router.push).toHaveBeenCalledWith('/ops/accounting/journals/aj-1');
  });

  it('journals empty state and error state', async () => {
    mountPage(<AccountingPage />, { routes: { ...base(), 'GET /api/v1/accounting/journals': D([], { total: 0, summary: { byStatus: {}, drafts: 0, pendingApproval: 0, posted: 0 } }) } });
    expect(await screen.findByText(/No journals match/)).toBeInTheDocument();
    expect(screen.getByText('0 journals')).toBeInTheDocument();
  });
  it('journals API error is shown as a message', async () => {
    mountPage(<AccountingPage />, { routes: { ...base(), 'GET /api/v1/accounting/journals': fail(500, 'internal', 'db down') } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load journals: db down/);
  });

  it('pagination sends offset', async () => {
    const r = { ...base(), 'GET /api/v1/accounting/journals': D([journal], { total: 60, summary: { byStatus: {}, drafts: 0, pendingApproval: 0, posted: 60 } }) };
    const { api, user } = mountPage(<AccountingPage />, { routes: r });
    await screen.findByText('JE-00001');
    expect(screen.getByText('1–25 of 60')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.calls('GET /api/v1/accounting/journals').at(-1)!.query.get('offset')).toBe('25'));
  });

  it('trial balance asks for an entity, then shows balanced totals; unbalanced shows a blocking alert', async () => {
    const tb = (balanced: boolean) => ({ portfolioId: PF.id, asOf: '2026-10-01', rows: [{ accountId: 'a1', code: '1000', name: 'Cash', type: 'ASSET', isActive: true, periodDebits: '900.00', periodCredits: '0.00', debit: '900.00', credit: '0.00', balance: '900.00' }], totalDebit: '900.00', totalCredit: balanced ? '900.00' : '800.00', balanced, difference: balanced ? '0.00' : '100.00' });
    const { api, user } = mountPage(<AccountingPage />, { routes: { ...base(), 'GET /api/v1/accounting/trial-balance': D(tb(true)) } });
    await tab(user, 'Trial balance');
    expect(await screen.findByText('Choose an entity above.')).toBeInTheDocument();
    await pick(user);
    expect(await screen.findByText('Balanced')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/accounting/trial-balance')[0].query.get('portfolioId')).toBe(PF.id);
    api.on('GET /api/v1/accounting/trial-balance', D(tb(false)));
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-09-30' } });
    expect(await screen.findByText(/out by 100.00/)).toBeInTheDocument();
    expect(screen.getByText('Unbalanced')).toBeInTheDocument();
  });

  it('account ledger: choose entity, account, then see opening/closing and postings', async () => {
    const ledger = { account: { id: 'a1', code: '1000', name: 'Cash', type: 'ASSET' }, openingBalance: '0.00', closingBalance: '900.00', lines: [{ journalId: 'aj-1', ref: 'JE-00001', entryDate: '2026-09-30', description: 'NAV release line', memo: 'memo text', status: 'POSTED', debit: '900.00', credit: '0.00', balance: '900.00' }] };
    const { api, user } = mountPage(<AccountingPage />, { routes: { ...base(), 'GET /api/v1/accounting/ledger': D(ledger) } });
    await tab(user, 'Account ledger');
    await pick(user);
    await user.selectOptions(await screen.findByLabelText('Account'), 'a1');
    expect(await screen.findByText('NAV release line')).toBeInTheDocument();
    expect(screen.getByText('memo text')).toBeInTheDocument();
    expect(api.calls('GET /api/v1/accounting/ledger')[0].query.get('accountId')).toBe('a1');
  });

  it('periods tab lists months; Open a period posts entity+month with a key and opens it', async () => {
    const { api, user } = mountPage(<AccountingPage />, { routes: { ...base(), 'POST /api/v1/accounting/periods': created({ ...period, id: 'p-9', checklist: [], blockers: [], canClose: false }) } });
    await tab(user, 'Periods & close');
    expect(await screen.findByText('2026-09')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open a period' }));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(within(dlg).getByLabelText('Entity'), PF.id);
    await user.click(within(dlg).getByRole('button', { name: 'Open period' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/periods'));
    expectBody(req, { portfolioId: PF.id });
    expect((req.body as { month: string }).month).toMatch(/^\d{4}-\d{2}$/);
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/accounting/periods/p-9'));
  });

  it('chart of accounts: setup buttons only with accounting.post and an entity; adds standard chart and a new account', async () => {
    const routes = { ...base(), 'POST /api/v1/accounting/accounts/default-chart': created({}), 'POST /api/v1/accounting/accounts': created({}) };
    const { api, user } = mountPage(<AccountingPage />, { routes });
    await tab(user, 'Chart of accounts');
    expect(await screen.findByText('Choose an entity above.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add standard chart' })).not.toBeInTheDocument();
    await pick(user);
    expect(await screen.findByText('Capital')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add standard chart' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/accounts/default-chart')))[0], { portfolioId: PF.id });
    await user.click(screen.getByRole('button', { name: 'New account' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Code/), '4000');
    await user.type(within(dlg).getByLabelText('Name'), 'Fees');
    await user.selectOptions(within(dlg).getByLabelText('Type'), 'EXPENSE');
    await user.click(within(dlg).getByRole('button', { name: 'Create account' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/accounts'));
    expectBody(req, { portfolioId: PF.id, code: '4000', name: 'Fees', type: 'EXPENSE' });
    expectIdempotencyKey(req);
  });

  it('chart of accounts without accounting.post: read-only, empty state points to an accountant', async () => {
    const { user } = mountPage(<AccountingPage />, { perms: without('accounting.post'), routes: { ...base(), 'GET /api/v1/accounting/accounts': D([]) } });
    await tab(user, 'Chart of accounts');
    await pick(user);
    expect(await screen.findByText(/Ask an accountant with posting authority/)).toBeInTheDocument();
  });

  it('notification deep links ?journal= and ?period= redirect to the record', async () => {
    mountPage(<AccountingPage />, { routes: base(), search: 'period=p%201' });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/ops/accounting/periods/p%201'));
  });

  describe('new journal form', () => {
    async function open() {
      const m = mountPage(<AccountingPage />, { routes: { ...base(), 'POST /api/v1/accounting/journals': created({ ...journal, id: 'aj-9' }) } });
      await pick(m.user);
      await m.user.click(await screen.findByRole('button', { name: 'New journal' }));
      return { ...m, dlg: await screen.findByRole('dialog') };
    }
    it('Save draft needs a balanced entry and a description; sends account lines and a key; navigates to it', async () => {
      const { api, user, dlg } = await open();
      const save = within(dlg).getByRole('button', { name: 'Save draft' });
      expect(save).toBeDisabled();
      await within(dlg).findAllByRole('option', { name: /1000 Cash/ });
      const sel = within(dlg).getAllByRole('combobox').slice(1);
      await user.selectOptions(sel[0], 'a1');
      await user.selectOptions(sel[1], 'a2');
      const dec = within(dlg).getAllByRole('textbox').filter((e) => e.getAttribute('inputmode') === 'decimal');
      await user.type(dec[0], '250');
      expect(within(dlg).getByText(/Out by 250.00/)).toBeInTheDocument();
      await user.type(dec[3], '250');
      expect(within(dlg).getByText('Balanced')).toBeInTheDocument();
      await user.type(within(dlg).getByLabelText('Description'), 'Seed capital');
      await user.click(save);
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/journals'));
      expectBody(req, { portfolioId: PF.id, description: 'Seed capital', lines: [{ accountId: 'a1', debit: '250' }, { accountId: 'a2', credit: '250' }] });
      expectIdempotencyKey(req);
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/accounting/journals/aj-9'));
    });
    it('API validation error is shown in the form and the dialog stays open', async () => {
      const { api, user, dlg } = await open();
      api.on('POST /api/v1/accounting/journals', validationFail({ description: 'Description must be at least 3 characters' }));
      await within(dlg).findAllByRole('option', { name: /1000 Cash/ });
      const sel = within(dlg).getAllByRole('combobox').slice(1);
      await user.selectOptions(sel[0], 'a1');
      await user.selectOptions(sel[1], 'a2');
      const dec = within(dlg).getAllByRole('textbox').filter((e) => e.getAttribute('inputmode') === 'decimal');
      await user.type(dec[0], '5');
      await user.type(dec[3], '5');
      await user.type(within(dlg).getByLabelText('Description'), 'abc');
      await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
      expect(await within(dlg).findByRole('alert')).toHaveTextContent('Validation failed. Description must be at least 3 characters');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});

const dj = (over: Record<string, unknown> = {}, al: Record<string, unknown> = {}) => ({
  ...journal, status: 'PENDING_APPROVAL', postedByName: null, postedAt: null, periodId: 'p-1', periodStatus: 'OPEN',
  lines: [{ id: 'l1', lineNo: 1, accountId: 'a1', accountCode: '1000', accountName: 'Cash', accountType: 'ASSET', debit: '900.00', credit: '0.00', memo: null }, { id: 'l2', lineNo: 2, accountId: 'a2', accountCode: '3000', accountName: 'Capital', accountType: 'EQUITY', debit: '0.00', credit: '900.00', memo: null }],
  timeline: [], allowed: { edit: false, submit: false, discard: false, returnToMaker: false, post: true, postBlocker: null, reverse: false, ...al }, ...over,
});

describe('Accounting journal detail', () => {
  const routes = (j: unknown, extra = {}) => ({ 'GET /api/v1/accounting/journals/aj-1': D(j), 'GET /api/v1/portfolios': D([PF]), ...extra });
  it('shows account codes and names (not ids) for lines', async () => {
    mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: routes(dj()) });
    expect(await screen.findByText('Capital')).toBeInTheDocument();
    expect(screen.getByText('JE-00001')).toBeInTheDocument();
  });
  it('Post journal: confirm then POST /post with a key; reloads', async () => {
    const { api, user } = mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: routes(dj(), { 'POST /api/v1/accounting/journals/aj-1/post': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Post journal' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Post journal' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/journals/aj-1/post')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/accounting/journals/aj-1').length).toBe(2));
  });
  it('maker cannot post: disabled with blocker', async () => {
    mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: routes(dj({}, { post: false, postBlocker: 'You created this journal' })) });
    const b = await screen.findByRole('button', { name: 'Post journal' });
    expect(b).toBeDisabled();
    expect(screen.getByText(/Posting is not available to you: You created this journal/)).toBeInTheDocument();
  });
  it('Reverse a posted journal sends reason and opens the reversal', async () => {
    const { api, user } = mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: routes(dj({ status: 'POSTED', postedByName: 'Pat Poster' }, { reverse: true, post: false }), { 'POST /api/v1/accounting/journals/aj-1/reverse': D({ id: 'aj-2' }) }) });
    await user.click(await screen.findByRole('button', { name: 'Reverse' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText(/Reason/), 'Wrong period');
    await user.click(within(d).getByRole('button', { name: 'Post reversal' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/journals/aj-1/reverse')))[0], { reason: 'Wrong period' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/accounting/journals/aj-2'));
  });
  it('closed period warning for unposted journals', async () => {
    mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: routes(dj({ periodStatus: 'CLOSED' })) });
    expect(await screen.findByText(/period for this date is closed/)).toBeInTheDocument();
  });
});

const pd = (over: Record<string, unknown> = {}) => ({ ...period, checklist: [{ key: 'tb', label: 'Trial balance in balance', ok: false, blockers: ['Out by 10.00'], detail: 'Debits must equal credits' }], blockers: ['Out by 10.00'], canClose: false, trialBalance: { totalDebit: '900.00', totalCredit: '890.00', balanced: false }, ...over });

describe('Accounting period detail', () => {
  const r = (p: unknown, extra = {}) => ({ 'GET /api/v1/accounting/periods/p-1': D(p), ...extra });
  it('lists blockers, disables Close period with the count, shows the trial balance', async () => {
    mountPage(<PeriodPage />, { params: { id: 'p-1' }, routes: r(pd()) });
    expect(await screen.findByText('Out by 10.00')).toBeInTheDocument();
    expect(screen.getByText(/1 blocker listed below/)).toBeInTheDocument();
    const b = screen.getByRole('button', { name: 'Close period' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', '1 blocker to clear first');
    expect(screen.getByText('No')).toBeInTheDocument();
  });
  it('Start close and Close period post with keys', async () => {
    const { api, user } = mountPage(<PeriodPage />, { params: { id: 'p-1' }, routes: r(pd({ blockers: [], canClose: true, checklist: [] }), { 'POST /api/v1/accounting/periods/p-1/start-close': D({}), 'POST /api/v1/accounting/periods/p-1/close': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Start close' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Start close' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/periods/p-1/start-close')))[0]);
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close period' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/periods/p-1/close')))[0]);
  });
  it('closed: Reopen needs accounting.reopen and a reason', async () => {
    const closed = pd({ status: 'CLOSED', blockers: [], closedByName: 'Carl', closedAt: '2026-10-01T00:00:00Z' });
    const { api, user } = mountPage(<PeriodPage />, { params: { id: 'p-1' }, routes: r(closed, { 'POST /api/v1/accounting/periods/p-1/reopen': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Reopen' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Adjustment needed');
    await user.click(within(d).getByRole('button', { name: 'Reopen period' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/accounting/periods/p-1/reopen')))[0], { reason: 'Adjustment needed' });
  });
  it('closed without accounting.reopen: no Reopen button', async () => {
    mountPage(<PeriodPage />, { params: { id: 'p-1' }, perms: without('accounting.reopen'), routes: r(pd({ status: 'CLOSED', blockers: [] })) });
    await screen.findByText(/Closed by/);
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });
});
