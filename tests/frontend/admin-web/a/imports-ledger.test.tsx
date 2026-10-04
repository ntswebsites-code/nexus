import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import ImportsPage from '@/app/(ops)/ops/imports/page';
import LedgerPage from '@/app/(ops)/ops/ledger/page';
import { ComplianceReportTab } from '@/ops/risk/ComplianceReportTab';
import { commitAllowed, type ImportBatchView } from '@/ops/imports';
import { expectCalled, expectIdempotencyKey, screen, waitFor, within } from '../../_helpers';
import { D, mountPage, without } from './_kit';

const kinds = [
  {
    kind: 'orders',
    title: 'Orders (CSV, XLSX or JSON)',
    stepUp: false,
    controlTotals: null,
    fields: [],
    columns: [{ key: 'portfolio', label: 'Portfolio', required: true, example: 'PF-1001', hint: '' }],
  },
  {
    kind: 'margin-statement',
    title: 'Margin statement',
    stepUp: false,
    controlTotals: { column: 'called_amount', required: true },
    fields: [{ key: 'facilityRef', label: 'Facility', hint: '' }],
    columns: [{ key: 'called_amount', label: 'Called amount', required: true, example: '100.00', hint: '' }],
  },
];

const batch = (over: Partial<ImportBatchView> = {}): ImportBatchView => ({
  id: 'b-1', ref: 'IMP-000001', kind: 'orders', filename: 'orders.csv', format: 'csv', status: 'PREVIEWED',
  rowCount: 3, validCount: 2, errorCount: 1, fileErrors: [], warnings: [],
  errors: [{ line: 4, field: 'quantity', message: 'must be a multiple of the board lot' }], errorsTruncated: false,
  preview: [
    { line: 2, ok: true, values: { Portfolio: 'PF-1001', Ticker: 'DLTA' }, errors: [], warnings: [] },
    { line: 4, ok: false, values: { Portfolio: 'PF-1001', Ticker: 'DLTA' }, errors: ['quantity must be a multiple of the board lot'], warnings: [] },
  ],
  control: null, duplicateOf: null, canCommit: true, result: null, createdAt: '2026-10-04T09:00:00Z', committedAt: null, ...over,
});

describe('commitAllowed', () => {
  it('needs skipInvalid when rows have errors, and a tick for a duplicate file', () => {
    expect(commitAllowed(batch(), false, false)).toBe(false);
    expect(commitAllowed(batch(), true, false)).toBe(true);
    expect(commitAllowed(batch({ errorCount: 0, duplicateOf: { ref: 'IMP-000000', committedAt: null } }), false, false)).toBe(false);
    expect(commitAllowed(batch({ errorCount: 0, duplicateOf: { ref: 'IMP-000000', committedAt: null } }), false, true)).toBe(true);
  });
  it('never allows a rejected file, a file-level failure or a committed batch', () => {
    expect(commitAllowed(batch({ status: 'REJECTED', errorCount: 0 }), true, true)).toBe(false);
    expect(commitAllowed(batch({ fileErrors: ['Control total does not match'], errorCount: 0 }), true, true)).toBe(false);
    expect(commitAllowed(batch({ status: 'COMMITTED', errorCount: 0 }), true, true)).toBe(false);
    expect(commitAllowed(batch({ validCount: 0, errorCount: 3 }), true, true)).toBe(false);
  });
});

const fileInput = async () => {
  await screen.findByRole('button', { name: 'Preview (dry run)' });
  return document.querySelector('input[type=file]') as HTMLInputElement;
};

/** jsdom keeps a required file input invalid after user.upload and its FormData cannot read the bytes, so the form is submitted directly. */
const submitPreview = () => fireEvent.submit(document.querySelector('input[type=file]')!.closest('form')!);

describe('Data imports page', () => {
  const routes = { 'GET /api/v1/imports/kinds': D(kinds), 'GET /api/v1/imports/batches': D([]) };

  it('uploads the file for a dry run, shows row errors, and commits only after skipping the invalid row', async () => {
    const { api, user } = mountPage(<ImportsPage />, {
      routes: { ...routes, 'POST /api/v1/imports/orders/preview': D(batch(), {}), 'POST /api/v1/imports/orders/b-1/commit': D(batch({ status: 'COMMITTED', errorCount: 1 })) },
    });
    const input = await fileInput();
    await user.upload(input, new File(['Portfolio,Ticker\nPF-1001,DLTA\n'], 'orders.csv', { type: 'text/csv' }));
    submitPreview();
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/imports/orders/preview'));
    expect(req.body).toBeInstanceOf(FormData);
    expect((req.body as FormData).get('kindSelect')).toBeNull();

    expect(await screen.findByText(/Dry run IMP-000001/)).toBeInTheDocument();
    const errors = screen.getByRole('table', { name: 'Row errors' });
    expect(within(errors).getByText('must be a multiple of the board lot')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been written yet/)).toBeInTheDocument();

    const commit = screen.getByRole('button', { name: 'Commit 2 rows' });
    expect(commit).toBeDisabled();
    await user.click(screen.getByLabelText(/Skip the 1 invalid row/));
    expect(commit).toBeEnabled();
    await user.click(commit);
    const [c] = await waitFor(() => expectCalled(api, 'POST /api/v1/imports/orders/b-1/commit'));
    expectIdempotencyKey(c);
    expect(c.body).toEqual({ skipInvalid: true });
    expect(await screen.findByText(/IMP-000001 committed/)).toBeInTheDocument();
  });

  it('a file-level failure (control total) cannot be committed', async () => {
    const rejected = batch({ kind: 'margin-statement', status: 'REJECTED', validCount: 0, errorCount: 0, errors: [], preview: [], fileErrors: ['Control total 90.00 does not match the file (100.00)'], canCommit: false });
    const { user } = mountPage(<ImportsPage />, { routes: { ...routes, 'POST /api/v1/imports/margin-statement/preview': D(rejected) } });
    await fileInput();
    await user.selectOptions(screen.getByLabelText('File type'), 'margin-statement');
    expect(screen.getByLabelText(/Control: row count/)).toBeRequired();
    await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'm.csv', { type: 'text/csv' }));
    await user.type(screen.getByLabelText(/Control: row count/), '1');
    await user.type(screen.getByLabelText(/Control: total of/), '90.00');
    submitPreview();
    expect(await screen.findByText(/does not match the file/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Commit/ })).toBeNull();
  });

  it('shows an explanation when the role has no import permission', async () => {
    mountPage(<ImportsPage />, { routes: { 'GET /api/v1/imports/kinds': D([]), 'GET /api/v1/imports/batches': D([]) } });
    expect(await screen.findByText(/does not include any import/)).toBeInTheDocument();
  });
});

const line = (over: Record<string, unknown> = {}) => ({
  entryId: 'a-1', entryType: 'CAPITAL_CALL', txnDate: '2026-09-01', currency: 'EUR', amount: '1000.0000', description: 'Capital call #3', status: 'PAID', lineKind: 'ENTRY',
  stamp: { rate: '1.0850000000', rateDate: '2026-09-01', source: 'FX_RATES', version: 1, reportingAmount: '1085.00' }, reportingAmount: '1085.00', clientRef: 'CL-1', clientName: 'Acme Pension', fundRef: 'FND-1', fundName: 'Growth Fund', ...over,
});
const corr = (over: Record<string, unknown> = {}) => ({
  id: 'c-1', ref: 'LCR-0001', entryId: 'a-1', kind: 'FX_RESTAMP', currency: 'EUR', reportingCurrency: 'USD', newRate: '1.0900000000', newRateDate: '2026-09-01', adjustmentAmount: null, reason: 'Wrong rate source', status: 'PENDING_APPROVAL',
  makerName: 'Maya Maker', checkerName: null, decisionNote: null, createdAt: '2026-10-01T09:00:00Z', entry: { description: 'Capital call #3', amount: '1000.0000', txnDate: '2026-09-01' }, ...over,
});
const ledgerRoutes = {
  'GET /api/v1/ledger': D([line(), line({ entryId: 'a-2', stamp: null, reportingAmount: null, description: 'Subscription request' })], { total: 2, summary: { reporting: 'USD', entries: 2, unstamped: 1, reportingTotal: '1085.00', byCurrency: [{ currency: 'EUR', total: '2000.00' }] } }),
  'GET /api/v1/ledger/corrections': D([corr()]),
};

describe('Ledger and FX stamps page', () => {
  it('shows stamped and unstamped entries and the pending correction', async () => {
    mountPage(<LedgerPage />, { perms: ['ledger.view', 'ledger.correct'], routes: ledgerRoutes });
    expect((await screen.findAllByText('Capital call #3')).length).toBeGreaterThan(0);
    expect(screen.getByText(/1\.0850000000 on/)).toBeInTheDocument();
    expect(screen.getByText('No stamp')).toBeInTheDocument();
    expect(screen.getByText('LCR-0001')).toBeInTheDocument();
  });

  it('stamping posts the reporting currency with an Idempotency-Key', async () => {
    const { api, user } = mountPage(<LedgerPage />, { perms: ['ledger.view', 'ledger.correct'], routes: { ...ledgerRoutes, 'POST /api/v1/ledger/stamp': D({ stamped: 1 }) } });
    await user.click(await screen.findByRole('button', { name: 'Stamp unstamped entries' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ledger/stamp'));
    expectIdempotencyKey(req);
    expect(req.body).toEqual({ reporting: 'USD' });
  });

  it('proposing an FX restamp sends the rate, date and reason', async () => {
    const { api, user } = mountPage(<LedgerPage />, { perms: ['ledger.view', 'ledger.correct'], routes: { ...ledgerRoutes, 'POST /api/v1/ledger/corrections': D({ ref: 'LCR-0002' }) } });
    const row = (await screen.findAllByText('Capital call #3'))[0]!.closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Propose correction' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/New rate/), '1.0900');
    await user.type(within(dlg).getByLabelText('Rate date'), '2026-09-01');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Wrong rate source');
    await user.click(within(dlg).getByRole('button', { name: 'Submit for approval' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ledger/corrections'));
    expectIdempotencyKey(req);
    expect(req.body).toMatchObject({ entryId: 'a-1', kind: 'FX_RESTAMP', newRate: '1.0900', newRateDate: '2026-09-01', reason: 'Wrong rate source', reporting: 'USD' });
  });

  it('approve is disabled with the reason when the role lacks ledger.approve, and posts when it has it', async () => {
    const view = mountPage(<LedgerPage />, { perms: ['ledger.view', 'ledger.correct'], routes: ledgerRoutes });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    view.unmount();
    const { api, user } = mountPage(<LedgerPage />, { perms: ['ledger.view', 'ledger.approve'], routes: { ...ledgerRoutes, 'POST /api/v1/ledger/corrections/c-1/approve': D({}) } });
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ledger/corrections/c-1/approve'));
    expectIdempotencyKey(req);
  });

  it('a role without ledger.view sees the access message', async () => {
    mountPage(<LedgerPage />, { perms: without('ledger.view'), routes: ledgerRoutes });
    expect(await screen.findByText(/Ask an administrator for the ledger\.view permission/)).toBeInTheDocument();
  });
});

describe('Compliance report tab', () => {
  it('lists limit lines as of the date with state and headroom, and offers print and downloads', async () => {
    mountPage(<ComplianceReportTab />, {
      routes: {
        'GET /api/v1/portfolios': D([]),
        'GET /api/v1/risk/compliance-report': D({
          asOf: '2026-10-03', generatedAt: '2026-10-04T09:00:00Z', summary: { portfolios: 1, limitsChecked: 1, breaches: 1, warnings: 0 }, problems: [],
          lines: [{ portfolioRef: 'PF-1001', portfolioName: 'Growth Portfolio', limitRef: 'LIM-0001', metric: 'SINGLE_NAME_PCT', metricLabel: 'Single name', scope: 'PORTFOLIO', breachAction: 'BLOCK', threshold: '10.0000', value: '12.5000', headroom: '-2.5000', state: 'BREACH', recordedBreach: 'OPEN' }],
        }),
      },
    });
    expect(await screen.findByText('LIM-0001')).toBeInTheDocument();
    expect(screen.getByText(/1 breach,/)).toBeInTheDocument();
    expect(screen.getByText('-2.5000')).toBeInTheDocument();
    for (const name of ['Print', 'Download CSV', 'Download XLSX']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});
