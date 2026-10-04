import { describe, it, expect } from 'vitest';
import CashPage from '@/app/(ops)/ops/cash/page';
import ReconPage from '@/app/(ops)/ops/reconciliation/page';
import { expectBody, expectCalled, expectIdempotencyKey, fail, raw, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage } from './_kit';

// ---------------------------------------------------------------- Package S2: reconciliation and cash depth

const brk = (over: Record<string, unknown> = {}) => ({
  id: 'br-1', ref: 'REC-00010', runId: 'run-1', runRef: 'RUN-1', asOfDate: '2026-09-30', family: 'TRADES', familyLabel: 'Trades', itemKey: 'TRD:CP-1:X1', kind: 'MISSING_INTERNAL', label: 'Custodian trade X1 not in the internal book',
  internalValue: null, externalValue: { ticker: 'DLTA', side: 'BUY', quantity: '100', price: '1.25' }, difference: null, differencePct: null, currency: 'USD', cause: null, severity: 'CRITICAL', status: 'NEW',
  ownerUserId: null, ownerName: null, counterparty: { id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered' }, portfolio: { id: PF.id, ref: PF.ref, name: PF.name }, resolutionNote: null, evidenceRef: null,
  makerId: null, makerName: null, checkerId: null, checkerName: null, resolvedAt: null, closedAt: null, ageHours: 3, ageDays: 0, overdue: false, version: 2, createdAt: '2026-09-30T00:00:00Z', ...over,
});
const allowed = (over: Record<string, unknown> = {}) => ({ assign: true, investigate: true, resolve: true, approve: false, reject: false, approveBlockedReason: null, reopen: false, query: true, escalate: true, attachEvidence: true, acceptCandidate: true, ...over });
const overview = { asOfDate: '2026-09-30', families: [], openBySeverity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 }, openTotal: 1, overdue: 0 };
const batch = (over: Record<string, unknown> = {}) => ({ id: 'imp-1', ref: 'FEED-00007', source: 'CONNECTOR', connector: 'file-drop', feed: 'POSITIONS', counterparty: { id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered' }, accountRef: 'ACC-9', asOfDate: '2026-09-29', filename: 'connector-file-drop-ACC-9-2026-09-29.csv', format: 'CSV', recordCount: 12, sha256: 'ab'.repeat(32), status: 'RECEIVED', note: null, createdByName: 'Maya Maker', createdAt: '2026-09-30T08:00:00Z', ...over });

const reconBase = (extra = {}) => ({
  'GET /api/v1/recon/overview': D(overview), 'GET /api/v1/recon/sources': D([]),
  'GET /api/v1/recon/breaks': D([brk()], { total: 1, summary: { open: 1, overdue: 0, byStatus: {}, openBySeverity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 }, openByFamily: {} } }),
  'GET /api/v1/recon/counterparties': D([{ id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered', accounts: ['ACC-9'] }]),
  'GET /api/v1/recon/users': D([]), 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/recon/runs': D([]), 'GET /api/v1/recon/account-map': D([]),
  'GET /api/v1/recon/feeds': D([]), 'GET /api/v1/recon/tolerances': D([]), 'GET /api/v1/recon/counterpart-imports': D([batch(), batch({ id: 'imp-2', ref: 'FEED-00006', source: 'MANUAL', connector: null, filename: 'positions.csv', status: 'SUPERSEDED' })]), ...extra,
});
const tab = async (user: ReturnType<typeof mountPage>['user'], name: string) => user.click(await screen.findByRole('tab', { name }));

describe('Reconciliation: accept candidate match (FR-REC-006)', () => {
  async function openBreak(extra: Record<string, unknown> = {}, a = allowed()) {
    const m = mountPage(<ReconPage />, {
      routes: reconBase({ 'GET /api/v1/recon/breaks/br-1': D(brk(), { allowed: a, events: [] }), 'GET /api/v1/recon/breaks/br-1/extras': D({ evidence: [], actions: [] }), ...extra }),
    });
    await tab(m.user, 'Breaks');
    await m.user.click(await screen.findByRole('button', { name: 'REC-00010' }));
    return { ...m, dlg: await screen.findByRole('dialog') };
  }
  const candidates = D([{ id: 'br-2', ref: 'REC-00011', kind: 'MISSING_EXTERNAL', label: 'Internal fill on ORD-5 not confirmed', severity: 'HIGH', status: 'NEW', score: 100, reasons: ['Same security', 'Same side', 'Same quantity', 'Price within 1%'] }]);

  it('is offered only when the server allows it', async () => {
    const { dlg } = await openBreak({}, allowed({ acceptCandidate: false }));
    await within(dlg).findByRole('button', { name: 'Escalate' });
    expect(within(dlg).queryByRole('button', { name: 'Accept candidate match' })).not.toBeInTheDocument();
  });

  it('lists ranked candidates, needs one picked, and posts the pick with cause, rationale and the break version', async () => {
    const { api, user, dlg } = await openBreak({ 'GET /api/v1/recon/breaks/br-1/candidates': candidates, 'POST /api/v1/recon/breaks/br-1/accept-candidate': D({ ref: 'REC-00010', status: 'PENDING_CHECKER' }) });
    await user.click(await within(dlg).findByRole('button', { name: 'Accept candidate match' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(await within(d).findByText(/REC-00011/)).toBeInTheDocument();
    expect(within(d).getByText(/Same security, Same side, Same quantity/)).toBeInTheDocument();
    const send = within(d).getByRole('button', { name: 'Send to checker' });
    expect(send).toBeDisabled();
    await user.click(within(d).getByRole('radio'));
    await user.selectOptions(within(d).getByLabelText('Cause'), 'BOOKING_ERROR');
    await user.type(within(d).getByLabelText(/Rationale/), 'Same trade booked under another reference');
    await user.click(send);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/recon/breaks/br-1/accept-candidate'));
    expectBody(req!, { candidateBreakId: 'br-2', cause: 'BOOKING_ERROR', rationale: 'Same trade booked under another reference', version: 2 });
  });

  it('says so when nothing on the other side looks like the same trade', async () => {
    const { user, dlg } = await openBreak({ 'GET /api/v1/recon/breaks/br-1/candidates': D([]) });
    await user.click(await within(dlg).findByRole('button', { name: 'Accept candidate match' }));
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(await within(d).findByText(/nothing to accept/)).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Send to checker' })).toBeDisabled();
  });
});

describe('Reconciliation: import batches (FR-REC-017)', () => {
  it('lists manual and connector batches with channel, record count and hash, marking the superseded one', async () => {
    const { user } = mountPage(<ReconPage />, { routes: reconBase() });
    await tab(user, 'Sources and tolerances');
    expect(await screen.findByText('FEED-00007')).toBeInTheDocument();
    expect(screen.getByText('Connector (file-drop)')).toBeInTheDocument();
    expect(screen.getByText('Manual upload')).toBeInTheDocument();
    expect(screen.getByText('superseded')).toBeInTheDocument();
    expect(screen.getAllByText('12')).toHaveLength(2);
  });

  it('pulls positions from the connector with an idempotency key and reports the batch', async () => {
    const { api, user } = mountPage(<ReconPage />, { routes: reconBase({ 'POST /api/v1/recon/connector-imports': raw({ data: {}, batchRef: 'FEED-00008', rows: 4, connector: 'file-drop' }, 201) }) });
    await tab(user, 'Sources and tolerances');
    await screen.findByText('FEED-00007');
    const pullBtn = screen.getByRole('button', { name: 'Pull positions from the connector' });
    const form = pullBtn.closest('form')!;
    await user.selectOptions(within(form).getByLabelText('Counterparty'), 'cp-1');
    await user.selectOptions(within(form).getByLabelText('Account'), 'ACC-9');
    await user.click(pullBtn);
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/recon/connector-imports'));
    expectBody(req!, { counterpartyId: 'cp-1', accountRef: 'ACC-9' });
    expectIdempotencyKey(req!);
    expect(await screen.findByText(/Batch FEED-00008: 4 rows pulled through the file-drop connector/)).toBeInTheDocument();
  });

  it('a connector that is not configured shows the API message, not a crash', async () => {
    const { user } = mountPage(<ReconPage />, { routes: reconBase({ 'POST /api/v1/recon/connector-imports': fail(503, 'integration_not_configured', 'Custodian feed is not configured') }) });
    await tab(user, 'Sources and tolerances');
    await screen.findByText('FEED-00007');
    const pullBtn = screen.getByRole('button', { name: 'Pull positions from the connector' });
    const form = pullBtn.closest('form')!;
    await user.selectOptions(within(form).getByLabelText('Counterparty'), 'cp-1');
    await user.selectOptions(within(form).getByLabelText('Account'), 'ACC-9');
    await user.click(pullBtn);
    expect(await screen.findByText(/Custodian feed is not configured/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- cash

const ledger = { id: 'led-1', ref: 'LED-001', name: 'Bank account', portfolioId: PF.id, portfolioName: PF.name, currency: 'USD', kind: 'BANK', minBuffer: '1000.00', tolerance: '0.01', status: 'ACTIVE' };
const bal = (over: Record<string, unknown>) => ({ ledgerId: 'led-1', ref: 'LED-001', name: 'Bank account', portfolioId: PF.id, portfolioName: PF.name, currency: 'USD', status: 'ACTIVE', posted: '100.00', reserved: '0.00', minBuffer: '0.00', expectedNet: '0.00', available: '100.00', withdrawable: '100.00', ...over });
const balances = (rows: unknown[]) => ({ asOf: '2026-10-01', calculation: 'AVAIL-v1', note: 'Derived.', ledgers: rows, totals: [] });
const context = { clients: [{ id: 'cl-1', ref: 'CL-1', name: 'Acme Trust' }, { id: 'cl-2', ref: 'CL-2', name: 'Beta Fund' }], portfolios: [], cashAccounts: [{ id: 'ca-1', ref: 'CCA-2001', clientId: 'cl-1', masked: '****1234', currency: 'USD', provider: 'CBZ', portfolioIds: [PF.id] }], currencies: ['USD', 'ZWG'] };
const cashBase = (extra = {}) => ({
  'GET /api/v1/portfolios': D([{ ...PF, clientId: 'cl-1' }, { ...PF, id: 'pf-2', ref: 'PF-1002', name: 'Beta Portfolio', clientId: 'cl-2' }]),
  'GET /api/v1/cash/context': D(context),
  'GET /api/v1/cash/balances': D(balances([bal({ ledgerId: 'l-a', ref: 'LED-A', name: 'Alpha ledger', posted: '300.00', available: '300.00' }), bal({ ledgerId: 'l-b', ref: 'LED-B', name: 'Bravo ledger', posted: '100.00', available: '100.00' }), bal({ ledgerId: 'l-c', ref: 'LED-C', name: 'Charlie ledger', posted: '200.00', available: '200.00' })])),
  'GET /api/v1/cash/ledgers': D([ledger]),
  'GET /api/v1/cash/journals': D([], { total: 0, summary: { byStatus: {}, drafts: 0, pendingApproval: 0, posted: 0 } }),
  'GET /api/v1/cash/reservations': D([], { total: 0, summary: { active: 0, remaining: '0.00' } }),
  'GET /api/v1/cash/expectations': D([], { total: 0, summary: { open: 0, expectedNet: '0.00', due: 0 } }),
  'GET /api/v1/cash/statement-imports': D([]),
  'GET /api/v1/cash/period-closes': D([]),
  ...extra,
});
const ledgerOrder = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent!.slice(0, 6));

describe('Cash: context bar (FR-CASH-009)', () => {
  it('client, cash account and currency are sent to /cash/balances with the as-of date', async () => {
    const { api, user } = mountPage(<CashPage />, { routes: cashBase() });
    await screen.findByText('Alpha ledger');
    await user.selectOptions(await screen.findByLabelText('Client'), 'cl-1');
    await waitFor(() => expect(api.calls('GET /api/v1/cash/balances').at(-1)!.query.get('clientId')).toBe('cl-1'));
    await user.selectOptions(screen.getByLabelText('Cash account'), 'ca-1');
    await user.selectOptions(screen.getByLabelText('Currency'), 'ZWG');
    await user.clear(screen.getByLabelText(/^As of/));
    await user.type(screen.getByLabelText(/^As of/), '2026-09-15');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/cash/balances').at(-1)!.query;
      expect([q.get('clientId'), q.get('cashAccountId'), q.get('currency'), q.get('asOf')]).toEqual(['cl-1', 'ca-1', 'ZWG', '2026-09-15']);
    });
  });

  it('choosing a client narrows the portfolio list to that client', async () => {
    const { user } = mountPage(<CashPage />, { routes: cashBase() });
    await screen.findByText('Alpha ledger');
    const pf = screen.getByLabelText('Portfolio');
    expect(within(pf).getAllByRole('option')).toHaveLength(3);
    await user.selectOptions(screen.getByLabelText('Client'), 'cl-2');
    await waitFor(() => expect(within(screen.getByLabelText('Portfolio')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All portfolios', 'Beta Portfolio (PF-1002)']));
  });
});

describe('Cash: explain with holds, pending withdrawals and policy lines (FR-CASH-010)', () => {
  it('lists each group and states that the lines tie to the figure', async () => {
    const explain = {
      ref: 'LED-001', name: 'Bank account', currency: 'USD', formula: 'available = max(0, posted - reserved - minimum buffer)', posted: '1000.00', reserved: '300.00', minBuffer: '100.00', available: '600.00',
      journalLines: [{ journalId: 'j-1', ref: 'CJ-1', entryDate: '2026-09-30', status: 'POSTED', description: 'Deposit', signed: '1000.00' }], reservations: [],
      holds: [{ id: 'h1', ref: 'RSV-1', source: 'ORDER-9', purpose: 'BUY_SETTLEMENT', remaining: '200.00', requiredDate: '2026-10-02', expiresOn: null }],
      pendingWithdrawals: { reserved: [{ id: 'w1', ref: 'RSV-2', source: 'WD-4', remaining: '100.00' }], awaitingApproval: [{ journalId: 'j-9', ref: 'CJ-9', description: 'Client withdrawal', amount: '50.00' }] },
      policyLines: [{ key: 'MIN_BUFFER', label: 'Minimum cash buffer', amount: '100.00' }],
      contributions: [{ kind: 'JOURNAL', ref: 'CJ-1', label: 'Deposit', effect: '1000.00' }, { kind: 'HOLD', ref: 'RSV-1', label: 'hold', effect: '-200.00' }, { kind: 'PENDING_WITHDRAWAL', ref: 'RSV-2', label: 'wd', effect: '-100.00' }, { kind: 'POLICY', ref: 'MIN_BUFFER', label: 'buffer', effect: '-100.00' }],
      contributionSum: '600.00', rawAvailable: '600.00', ties: true,
    };
    const { user } = mountPage(<CashPage />, { routes: cashBase({ 'GET /api/v1/cash/balances/explain': D(explain) }) });
    await user.click((await screen.findAllByRole('button', { name: 'Explain' }))[0]!);
    const dlg = await screen.findByRole('dialog');
    expect(await within(dlg).findByText(/RSV-1 . ORDER-9 . Buy settlement: .200.00/)).toBeInTheDocument();
    expect(within(dlg).getByText(/RSV-2 . WD-4: .100.00 reserved/)).toBeInTheDocument();
    expect(within(dlg).getByText(/CJ-9 . Client withdrawal: 50.00 awaiting approval/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Minimum cash buffer: .100.00/)).toBeInTheDocument();
    expect(within(dlg).getByRole('status')).toHaveTextContent(/4 lines sum to 600.00/);
    expect(within(dlg).getByRole('status')).not.toHaveTextContent(/do NOT tie/);
  });
});

describe('Cash: tabs, sort and search (FR-CASH-019)', () => {
  it('tabs are an ARIA tab pattern: selected tab, roving tab stop, panel, and arrow keys move between tabs', async () => {
    const { user } = mountPage(<CashPage />, { routes: cashBase() });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    expect(tabs[0]).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);
    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Cash ledger' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: 'Cash ledger' })).toHaveFocus();
    await user.keyboard('{End}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Period close' })).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Balances' })).toHaveAttribute('aria-selected', 'true'));
  });

  it('clicking a column header sorts ascending, then descending, then back to the server order, with aria-sort', async () => {
    const { user } = mountPage(<CashPage />, { routes: cashBase() });
    await screen.findByText('Alpha ledger');
    expect(ledgerOrder()).toEqual(['Alpha ', 'Bravo ', 'Charli']);
    const posted = screen.getByRole('columnheader', { name: /Posted/ });
    await user.click(within(posted).getByRole('button'));
    expect(ledgerOrder()).toEqual(['Bravo ', 'Charli', 'Alpha ']);
    expect(posted).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(posted).getByRole('button'));
    expect(ledgerOrder()).toEqual(['Alpha ', 'Charli', 'Bravo ']);
    expect(posted).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(posted).getByRole('button'));
    expect(ledgerOrder()).toEqual(['Alpha ', 'Bravo ', 'Charli']);
    expect(posted).toHaveAttribute('aria-sort', 'none');
  });

  it('search filters the rows and shows "No records" when nothing matches', async () => {
    const { user } = mountPage(<CashPage />, { routes: cashBase() });
    await screen.findByText('Alpha ledger');
    await user.type(screen.getByRole('searchbox', { name: 'Search ledgers' }), 'bravo');
    expect(ledgerOrder()).toEqual(['Bravo ']);
    await user.clear(screen.getByRole('searchbox', { name: 'Search ledgers' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search ledgers' }), 'zzz');
    expect(await screen.findByText(/No records match "zzz"/)).toBeInTheDocument();
  });

  it('the statement upload accepts CAMT.053 and MT940 and sends the format derived from the file', async () => {
    const { api, user } = mountPage(<CashPage />, { routes: cashBase({ 'POST /api/v1/cash/statement-imports': created({ id: 'imp-9' }) }) });
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getByLabelText('Portfolio'), PF.id);
    await user.click(await screen.findByRole('tab', { name: 'Statement imports' }));
    await user.click(await screen.findByRole('button', { name: 'Upload external statement' }));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findByRole('option', { name: /LED-001/ });
    await user.selectOptions(within(dlg).getAllByRole('combobox')[0]!, 'led-1');
    const file = new File(['<Document/>'], 'stmt.xml', { type: 'text/xml' });
    await user.upload(dlg.querySelector('input[type="file"]') as HTMLInputElement, file);
    await user.click(within(dlg).getByRole('button', { name: 'Stage statement' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/cash/statement-imports'));
    expectBody(req!, { ledgerId: 'led-1', filename: 'stmt.xml', format: 'CAMT053' });
  });
});
