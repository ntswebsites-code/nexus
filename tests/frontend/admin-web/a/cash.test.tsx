import { describe, it, expect } from 'vitest';
import CashPage from '@/app/(ops)/ops/cash/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage, without } from './_kit';

const ledger = { id: 'led-1', ref: 'LED-001', name: 'Bank account', portfolioId: PF.id, portfolioName: PF.name, currency: 'USD', kind: 'BANK', minBuffer: '1000.00', tolerance: '0.01', status: 'ACTIVE' };
const balance = { ledgerId: 'led-1', ref: 'LED-001', name: 'Bank account', portfolioId: PF.id, portfolioName: PF.name, currency: 'USD', status: 'ACTIVE', posted: '250000.00', reserved: '40000.00', minBuffer: '1000.00', expectedNet: '5000.00', available: '209000.00', withdrawable: '209000.00' };
const balances = { asOf: '2026-10-01', calculation: 'posted - reserved - buffer', note: 'Derived from posted journals.', ledgers: [balance], totals: [] };
const journal = { id: 'j-1', ref: 'CJ-00001', portfolioId: PF.id, portfolioName: PF.name, entryDate: '2026-09-30', description: 'Opening', purpose: 'OPENING_BALANCE', sourceRef: 'DEP-1', evidenceRef: null, currency: 'USD', status: 'POSTED', totalDebit: '250000.00', totalCredit: '250000.00', makerId: 'u1', makerName: 'Maya Maker', postedByName: 'Carl Checker', postedAt: '2026-09-30T10:00:00Z', rejectReason: null, expectationId: null, reservationId: null, reversalOfId: null, reversalOfRef: null, reversedById: null, reversedByRef: null, reverseReason: null };
const reservation = { id: 'res-1', ref: 'RSV-001', portfolioName: PF.name, ledgerRef: 'LED-001', ledgerName: 'Bank account', source: 'ORDER-784', purpose: 'ORDER_SETTLEMENT', currency: 'USD', amount: '40000.00', consumed: '0.00', remaining: '40000.00', requiredDate: '2026-10-02', expiresOn: null, lapsed: false, status: 'ACTIVE', createdByName: 'Maya Maker', releaseReason: null };
const expectation = { id: 'exp-1', ref: 'EXP-001', portfolioName: PF.name, ledgerRef: 'LED-001', ledgerName: 'Bank account', direction: 'IN', kind: 'DIVIDEND', source: 'CMCL', currency: 'USD', amount: '5000.00', signedAmount: '5000.00', expectedDate: '2026-10-05', status: 'EXPECTED', journalId: null, note: null };
const imp = { id: 'imp-1', ref: 'IMP-001', ledgerName: 'Bank account', filename: 'sep.csv', format: 'CSV', currency: 'USD', statementFrom: '2026-09-01', statementTo: '2026-09-30', openingBalance: '100.00', closingBalance: '250.00', lineCount: 3, unmatchedLines: 1, variance: '0.00', status: 'COMMITTED', makerName: 'Maya Maker', checkerName: 'Carl Checker' };
const close = { id: 'cl-1', portfolioId: PF.id, portfolioName: PF.name, periodEnd: '2026-09-30', status: 'PREPARED', preparedByName: 'Maya Maker', approvedByName: null, closedByName: null, closedAt: null, reopenReason: null };

const base = () => ({
  'GET /api/v1/portfolios': D([PF]),
  'GET /api/v1/cash/balances': D(balances),
  'GET /api/v1/cash/ledgers': D([ledger]),
  'GET /api/v1/cash/journals': D([journal], { total: 1, summary: { byStatus: { POSTED: 1 }, drafts: 0, pendingApproval: 0, posted: 1 } }),
  'GET /api/v1/cash/reservations': D([reservation], { total: 1, summary: { active: 1, remaining: '40000.00' } }),
  'GET /api/v1/cash/expectations': D([expectation], { total: 1, summary: { open: 1, expectedNet: '5000.00', due: 0 } }),
  'GET /api/v1/cash/statement-imports': D([imp]),
  'GET /api/v1/cash/period-closes': D([close]),
});

type M = ReturnType<typeof mountPage>;
const openTab = async (user: M['user'], name: string) => user.click(await screen.findByRole('tab', { name }));
const pickPortfolio = async (user: M['user']) => {
  await screen.findByText(`${PF.name} (${PF.ref})`, { selector: 'option' });
  await user.selectOptions(screen.getAllByRole('combobox')[0], PF.id);
};
const decimals = (el: HTMLElement) => within(el).getAllByRole('textbox').filter((e) => e.getAttribute('inputmode') === 'decimal');

describe('Cash and ledgers page', () => {
  it('shows a permission message and loads no cash data without cash.view', async () => {
    const { api } = mountPage(<CashPage />, { perms: without('cash.view'), routes: base() });
    expect(await screen.findByText(/does not include cash/i)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/cash/balances');
  });

  it('balances tab renders derived cash by state with real field names and re-queries by portfolio', async () => {
    const { api, user } = mountPage(<CashPage />, { routes: base() });
    expect(await screen.findByText('Bank account')).toBeInTheDocument();
    expect(screen.getByText('250,000.00')).toBeInTheDocument();
    expect(screen.getByText('209,000.00')).toBeInTheDocument();
    expect(screen.getByText(/posted - reserved - buffer/)).toBeInTheDocument();
    await pickPortfolio(user);
    await waitFor(() => expect(api.calls('GET /api/v1/cash/balances').at(-1)!.query.get('portfolioId')).toBe(PF.id));
  });

  it('balances tab empty state; "Add standard ledgers" only with a portfolio picked and posts that portfolio', async () => {
    const r = { ...base(), 'GET /api/v1/cash/balances': D({ ...balances, ledgers: [] }), 'POST /api/v1/cash/ledgers/default-set': created({ created: 5 }) };
    const { api, user } = mountPage(<CashPage />, { routes: r });
    expect(await screen.findByText(/No bank ledgers yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add standard ledgers' })).not.toBeInTheDocument();
    await pickPortfolio(user);
    await user.click(await screen.findByRole('button', { name: 'Add standard ledgers' }));
    await user.click(screen.getByRole('button', { name: 'Add ledgers' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/ledgers/default-set'));
    expectBody(req, { portfolioId: PF.id });
  });

  it('Explain opens the balance breakdown from /balances/explain', async () => {
    const explain = { ref: 'LED-001', name: 'Bank account', currency: 'USD', formula: 'posted minus holds', posted: '250000.00', reserved: '40000.00', minBuffer: '1000.00', available: '209000.00', journalLines: [{ journalId: 'j-1', ref: 'CJ-00001', entryDate: '2026-09-30', status: 'POSTED', description: 'Opening line', signed: '250000.00' }], reservations: [] };
    const { api, user } = mountPage(<CashPage />, { routes: { ...base(), 'GET /api/v1/cash/balances/explain': D(explain) } });
    await user.click(await screen.findByRole('button', { name: 'Explain' }));
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText('Opening line')).toBeInTheDocument();
    expect(within(dlg).getByText('No live reservations.')).toBeInTheDocument();
    expect(expectCalled(api, 'GET /api/v1/cash/balances/explain')[0].query.get('ledgerId')).toBe('led-1');
  });

  it('shows an error state (not a crash) when balances fail', async () => {
    mountPage(<CashPage />, { routes: { ...base(), 'GET /api/v1/cash/balances': fail(500, 'internal', 'boom') } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load balances/);
  });

  describe('ADA-015 cash tabs render without crashing when the API returns { data: [...] }', () => {
    it('Cash ledger tab lists journals with maker and checker as two different people (ADA-017)', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Cash ledger');
      expect(await screen.findByText('CJ-00001')).toBeInTheDocument();
      expect(screen.getByText('Maya Maker / Carl Checker')).toBeInTheDocument();
      expect(screen.getByText(/0 draft . 0 awaiting approval . 1 posted/)).toBeInTheDocument();
    });
    it('Reservations tab', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Reservations');
      expect(await screen.findByText('RSV-001')).toBeInTheDocument();
      expect(screen.getByText(/1 live . 40,000.00 held/)).toBeInTheDocument();
    });
    it('Reservations tab empty state', async () => {
      const r = { ...base(), 'GET /api/v1/cash/reservations': D([], { total: 0, summary: { active: 0, remaining: '0.00' } }) };
      const { user } = mountPage(<CashPage />, { routes: r });
      await openTab(user, 'Reservations');
      expect(await screen.findByText('No reservations.')).toBeInTheDocument();
    });
    it('Expected cash tab', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Expected cash');
      expect(await screen.findByText('EXP-001')).toBeInTheDocument();
      expect(screen.getByText(/1 open . expected net 5,000.00 . 0 due/)).toBeInTheDocument();
      expect(screen.getByText(/\+5,000.00/)).toBeInTheDocument();
    });
    it('Statement imports tab', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Statement imports');
      expect(await screen.findByText('IMP-001')).toBeInTheDocument();
      expect(screen.getByText('1 unmatched')).toBeInTheDocument();
    });
    it('Period close tab and its empty state', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Period close');
      expect(await screen.findByText('Maya Maker / —')).toBeInTheDocument();
    });
    it('Period close empty state', async () => {
      const { user } = mountPage(<CashPage />, { routes: { ...base(), 'GET /api/v1/cash/period-closes': D([]) } });
      await openTab(user, 'Period close');
      expect(await screen.findByText('No closes yet.')).toBeInTheDocument();
    });
    it('New reservation form ledger picker lists ledgers (reads data.data of the raw payload)', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Reservations');
      await pickPortfolio(user);
      await user.click(await screen.findByRole('button', { name: 'New reservation' }));
      expect(await screen.findByRole('option', { name: /LED-001 Bank account \(USD\)/ })).toBeInTheDocument();
    });
  });

  it('row click navigates to the journal, import and close detail pages', async () => {
    const { user } = mountPage(<CashPage />, { routes: base() });
    await openTab(user, 'Cash ledger');
    await user.click(await screen.findByText('CJ-00001'));
    expect(router.push).toHaveBeenCalledWith('/ops/cash/journals/j-1');
    await openTab(user, 'Statement imports');
    await user.click(await screen.findByText('IMP-001'));
    expect(router.push).toHaveBeenCalledWith('/ops/cash/imports/imp-1');
    await openTab(user, 'Period close');
    await user.click(await screen.findByText('Maya Maker / —'));
    expect(router.push).toHaveBeenCalledWith('/ops/cash/closes/cl-1');
  });

  it('notification deep links redirect to the detail page', async () => {
    mountPage(<CashPage />, { routes: base(), search: 'journal=j%2F9' });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/ops/cash/journals/j%2F9'));
  });
  it('?import= and ?close= deep links redirect too', async () => {
    mountPage(<CashPage />, { routes: base(), search: 'import=i1' });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/ops/cash/imports/i1'));
  });

  it('?tab=reservations opens the reservations tab (order ticket -> cash hold link)', async () => {
    mountPage(<CashPage />, { routes: base(), search: 'tab=reservations' });
    expect(await screen.findByText('RSV-001')).toBeInTheDocument();
  });

  describe('reservations flow', () => {
    it('New reservation: disabled without a portfolio, sends the body with an Idempotency-Key and reloads the list', async () => {
      const { api, user } = mountPage(<CashPage />, { routes: { ...base(), 'POST /api/v1/cash/reservations': created(reservation) } });
      await openTab(user, 'Reservations');
      expect(await screen.findByRole('button', { name: 'New reservation' })).toBeDisabled();
      await pickPortfolio(user);
      await user.click(screen.getByRole('button', { name: 'New reservation' }));
      const dlg = await screen.findByRole('dialog');
      expect(within(dlg).getByLabelText(/Source event/)).toBeRequired();
      await user.selectOptions(await within(dlg).findByLabelText('Bank ledger'), 'led-1');
      await user.type(within(dlg).getByLabelText(/Source event/), 'ORDER-784');
      await user.type(within(dlg).getByLabelText('Amount'), '12,500.50');
      await user.click(within(dlg).getByRole('button', { name: 'Reserve cash' }));
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/reservations'));
      expectBody(req, { ledgerId: 'led-1', source: 'ORDER-784', purpose: 'BUY_SETTLEMENT', amount: '12500.50', expiresOn: null, orderId: null });
      expectIdempotencyKey(req);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.calls('GET /api/v1/cash/reservations').length).toBeGreaterThan(1);
    });

    it('insufficient cash error shows in the dialog, keeps it open, and the retry reuses the same key', async () => {
      let n = 0;
      const routes = { ...base(), 'POST /api/v1/cash/reservations': () => (++n === 1 ? fail(409, 'insufficient_cash', 'Available cash is 100.00 only') : created(reservation)) };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Reservations');
      await pickPortfolio(user);
      await user.click(await screen.findByRole('button', { name: 'New reservation' }));
      const dlg = await screen.findByRole('dialog');
      await user.selectOptions(await within(dlg).findByLabelText('Bank ledger'), 'led-1');
      await user.type(within(dlg).getByLabelText(/Source event/), 'ORDER-9');
      await user.type(within(dlg).getByLabelText('Amount'), '9999999');
      await user.click(within(dlg).getByRole('button', { name: 'Reserve cash' }));
      expect(await within(dlg).findByRole('alert')).toHaveTextContent('Available cash is 100.00 only');
      await user.click(within(dlg).getByRole('button', { name: 'Reserve cash' }));
      await waitFor(() => expect(api.calls('POST /api/v1/cash/reservations')).toHaveLength(2));
      const [a, b] = api.calls('POST /api/v1/cash/reservations');
      expect(b.idempotencyKey).toBe(a.idempotencyKey);
    });

    it('Release needs a reason of 5+ chars and posts it; Consume defaults to the remaining amount', async () => {
      const routes = { ...base(), 'POST /api/v1/cash/reservations/res-1/release': D({}), 'POST /api/v1/cash/reservations/res-1/consume': D({}) };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Reservations');
      await user.click(await screen.findByRole('button', { name: 'Release' }));
      const dlg = await screen.findByRole('dialog');
      expect(within(dlg).getByLabelText('Reason')).toHaveAttribute('minlength', '5');
      await user.type(within(dlg).getByLabelText('Reason'), 'Order cancelled');
      await user.click(within(dlg).getByRole('button', { name: 'Release' }));
      const [rel] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/reservations/res-1/release'));
      expectBody(rel, { reason: 'Order cancelled' });
      expectIdempotencyKey(rel);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(await screen.findByRole('button', { name: 'Consume' }));
      const d2 = await screen.findByRole('dialog');
      expect(within(d2).getByLabelText('Amount')).toHaveValue('40000.00');
      await user.click(within(d2).getByRole('button', { name: 'Consume' }));
      const [con] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/reservations/res-1/consume'));
      expectBody(con, { amount: '40000.00' });
    });

    it('permission gating: hold/approve actions are not offered without the permissions', async () => {
      const { user } = mountPage(<CashPage />, { perms: ['cash.view'], routes: base() });
      await openTab(user, 'Reservations');
      await screen.findByText('RSV-001');
      for (const n of ['New reservation', 'Release', 'Consume', 'Sweep expired']) expect(screen.queryByRole('button', { name: n })).not.toBeInTheDocument();
    });

    it('Sweep expired posts and reloads (approver only)', async () => {
      const { api, user } = mountPage(<CashPage />, { routes: { ...base(), 'POST /api/v1/cash/reservations/expire-sweep': D({ expired: 0 }) } });
      await openTab(user, 'Reservations');
      await user.click(await screen.findByRole('button', { name: 'Sweep expired' }));
      await waitFor(() => expectCalled(api, 'POST /api/v1/cash/reservations/expire-sweep'));
    });
  });

  describe('expected cash flow', () => {
    it('adds an expected movement with the real body, then cancels one with a reason', async () => {
      const routes = { ...base(), 'POST /api/v1/cash/expectations': created(expectation), 'POST /api/v1/cash/expectations/exp-1/cancel': D({}) };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Expected cash');
      await pickPortfolio(user);
      await user.click(await screen.findByRole('button', { name: 'Add expected movement' }));
      const dlg = await screen.findByRole('dialog');
      await user.selectOptions(await within(dlg).findByLabelText('Bank ledger'), 'led-1');
      await user.selectOptions(within(dlg).getByLabelText('Direction'), 'OUT');
      await user.type(within(dlg).getByLabelText('Amount'), '2,000');
      await user.click(within(dlg).getByRole('button', { name: 'Add' }));
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/expectations'));
      expectBody(req, { ledgerId: 'led-1', direction: 'OUT', kind: 'OTHER', amount: '2000', source: null });
      expectIdempotencyKey(req);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(await screen.findByRole('button', { name: 'Cancel' }));
      const d2 = await screen.findByRole('dialog');
      await user.type(within(d2).getByLabelText('Reason'), 'Trade cancelled');
      await user.click(within(d2).getByRole('button', { name: 'Cancel expectation' }));
      expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/cash/expectations/exp-1/cancel')))[0], { reason: 'Trade cancelled' });
    });
    it('"Add expected movement" is disabled until a portfolio is chosen', async () => {
      const { user } = mountPage(<CashPage />, { routes: base() });
      await openTab(user, 'Expected cash');
      expect(await screen.findByRole('button', { name: 'Add expected movement' })).toBeDisabled();
    });
  });

  describe('statement import flow', () => {
    it('stage stays disabled until ledger and file are chosen; a JSON file posts format JSON then opens the import', async () => {
      const routes = { ...base(), 'POST /api/v1/cash/statement-imports': created({ ...imp, id: 'imp-9', lines: [] }) };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Statement imports');
      await user.click(await screen.findByRole('button', { name: 'Upload external statement' }));
      const dlg = await screen.findByRole('dialog');
      const stage = within(dlg).getByRole('button', { name: 'Stage statement' });
      expect(stage).toBeDisabled();
      await user.selectOptions(await within(dlg).findByRole('combobox'), 'led-1').catch(() => undefined);
      expect(stage).toBeDisabled();
      const content = JSON.stringify({ openingBalance: '1', closingBalance: '2', lines: [] });
      await user.upload(within(dlg).getByLabelText('Statement file'), new File([content], 'jan.json', { type: 'application/json' }));
      await waitFor(() => expect(stage).toBeEnabled());
      await user.click(stage);
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-imports'));
      expectBody(req, { ledgerId: 'led-1', filename: 'jan.json', format: 'JSON', content });
      expectIdempotencyKey(req);
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/cash/imports/imp-9'));
    });
    it('a CSV upload sends typed balances without commas and shows the API error in the dialog', async () => {
      const routes = { ...base(), 'POST /api/v1/cash/statement-imports': fail(422, 'statement_not_footing', 'Statement does not foot') };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Statement imports');
      await user.click(await screen.findByRole('button', { name: 'Upload external statement' }));
      const dlg = await screen.findByRole('dialog');
      await user.selectOptions(within(dlg).getByRole('combobox'), 'led-1');
      await user.upload(within(dlg).getByLabelText('Statement file'), new File(['date,amount\n2026-01-01,5'], 'a.csv', { type: 'text/csv' }));
      await user.type(within(dlg).getByLabelText(/Opening balance/), '1,000.00');
      await user.type(within(dlg).getByLabelText(/Closing balance/), '1,005.00');
      await user.click(within(dlg).getByRole('button', { name: 'Stage statement' }));
      expect(await within(dlg).findByRole('alert')).toHaveTextContent('Statement does not foot');
      expectBody(api.calls('POST /api/v1/cash/statement-imports')[0], { format: 'CSV', openingBalance: '1000.00', closingBalance: '1005.00' });
    });
    it('upload action is hidden without cash.import', async () => {
      const { user } = mountPage(<CashPage />, { perms: ['cash.view'], routes: base() });
      await openTab(user, 'Statement imports');
      await screen.findByText('IMP-001');
      expect(screen.queryByRole('button', { name: 'Upload external statement' })).not.toBeInTheDocument();
    });
  });

  describe('period close flow', () => {
    it('prepares a close for a portfolio and date, then opens it', async () => {
      const routes = { ...base(), 'POST /api/v1/cash/period-closes': created({ ...close, id: 'cl-9', checklist: [], blockers: [], canClose: false }) };
      const { api, user } = mountPage(<CashPage />, { routes });
      await openTab(user, 'Period close');
      await user.click(await screen.findByRole('button', { name: 'Prepare a close' }));
      const dlg = await screen.findByRole('dialog');
      await within(dlg).findByRole('option', { name: /Growth Portfolio/ });
      await user.selectOptions(within(dlg).getByLabelText('Portfolio'), PF.id);
      await user.click(within(dlg).getByRole('button', { name: 'Prepare close' }));
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/period-closes'));
      expectBody(req, { portfolioId: PF.id });
      expect((req.body as { periodEnd: string }).periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expectIdempotencyKey(req);
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/cash/closes/cl-9'));
    });
    it('hides Prepare without cash.close', async () => {
      const { user } = mountPage(<CashPage />, { perms: without('cash.close'), routes: base() });
      await openTab(user, 'Period close');
      await screen.findByText('Maya Maker / —');
      expect(screen.queryByRole('button', { name: 'Prepare a close' })).not.toBeInTheDocument();
    });
  });

  describe('controlled journal form', () => {
    async function openForm(extra = {}) {
      const m = mountPage(<CashPage />, { routes: { ...base(), 'POST /api/v1/cash/journals': created({ ...journal, id: 'j-9' }), ...extra } });
      await openTab(m.user, 'Cash ledger');
      await pickPortfolio(m.user);
      await m.user.click(await screen.findByRole('button', { name: 'New controlled journal' }));
      return { ...m, dlg: await screen.findByRole('dialog') };
    }
    it('Save draft is disabled until debits equal credits and a description exists; shows how far out it is', async () => {
      const { user, dlg } = await openForm();
      const save = within(dlg).getByRole('button', { name: 'Save draft' });
      expect(save).toBeDisabled();
      const dec = decimals(dlg);
      await user.type(dec[0], '100');
      expect(within(dlg).getByText('Out by 100.00')).toBeInTheDocument();
      await user.type(dec[3], '100');
      expect(within(dlg).getByText('Balanced')).toBeInTheDocument();
      expect(save).toBeDisabled(); // description still empty
      await user.type(within(dlg).getByLabelText('Description'), 'Fee fix');
      expect(save).toBeEnabled();
    });
    it('posts the draft with both lines and the idempotency key, then navigates to it', async () => {
      const { api, user, dlg } = await openForm();
      await screen.findAllByRole('option', { name: /LED-001/ });
      const lineSelects = within(dlg).getAllByRole('combobox').slice(2);
      await user.selectOptions(lineSelects[0], 'led-1');
      await user.selectOptions(lineSelects[1], 'led-1');
      const dec = decimals(dlg);
      await user.type(dec[0], '1,500.25');
      await user.type(dec[3], '1500.25');
      await user.type(within(dlg).getByLabelText('Description'), 'Fee correction');
      await user.click(within(dlg).getByRole('button', { name: 'Save draft' }));
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/journals'));
      expectBody(req, { portfolioId: PF.id, description: 'Fee correction', purpose: 'MANUAL_CORRECTION', lines: [{ ledgerId: 'led-1', debit: '1500.25' }, { ledgerId: 'led-1', credit: '1500.25' }] });
      expectIdempotencyKey(req);
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops/cash/journals/j-9'));
    });
    it('warns when the portfolio has no ledgers', async () => {
      await openForm({ 'GET /api/v1/cash/ledgers': D([]) });
      expect(await screen.findByText(/no active cash ledgers/)).toBeInTheDocument();
    });
  });
});
