import { describe, it, expect } from 'vitest';
import TermSheetsPage from '@/app/(ops)/ops/term-sheets/page';
import TermSheetPage from '@/app/(ops)/ops/term-sheets/[id]/page';
import InvesteePage from '@/app/(ops)/ops/investee-requests/page';
import { expectBody, expectCalled, expectIdempotencyKey, router, screen, waitFor, within } from '../../_helpers';
import { D, created, mountPage, without } from './_kit';

const ireq = (over: Record<string, unknown> = {}) => ({
  id: 'ir-1', companyId: 'CO-1', companyName: 'Zim Agro Ltd', companyRef: 'CO-1', title: 'Irrigation pumps', description: 'x', status: 'SUBMITTED', priority: 'High',
  sourcingCategory: 'Equipment', currency: 'USD', estimatedAmount: 250000, needBy: '2026-12-01', createdByName: 'Tendai Moyo', note: '', hoursPending: 3, slaBreached: false, poRef: null, ...over,
});
const DECIDE = 'POST /api/v1/ops/investee-requests/CO-1/ir-1/decide';
const reqRoutes = (rows: unknown[], extra = {}) => ({ 'GET /api/v1/ops/investee-requests': D(rows), 'GET /api/v1/ops/investee-requests/consents': D([]), ...extra });

describe('Investee requests: review, RFQ and SLA (BR-230, FR-CMP-035)', () => {
  it('flags a request that has waited past the 48 hour SLA', async () => {
    mountPage(<InvesteePage />, { routes: reqRoutes([ireq({ slaBreached: true, hoursPending: 53 }), ireq({ id: 'ir-2', title: 'Fresh request' })]) });
    expect(await screen.findByText('Waiting 53h, past the 48 hour SLA')).toBeInTheDocument();
    expect(screen.getAllByText(/past the 48 hour SLA/)).toHaveLength(1);
  });

  it('Return asks for a reason and posts RETURNED with the note', async () => {
    const { api, user } = mountPage(<InvesteePage />, { routes: reqRoutes([ireq()], { [DECIDE]: D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Return' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Attach three quotes');
    await user.click(within(d).getByRole('button', { name: 'Return' }));
    const [r] = await waitFor(() => expectCalled(api, DECIDE));
    expectBody(r, { status: 'RETURNED', note: 'Attach three quotes' });
    expectIdempotencyKey(r);
  });

  it('an approved request can be sent to RFQ, then converted to a purchase order with its reference', async () => {
    const first = mountPage(<InvesteePage />, { routes: reqRoutes([ireq({ status: 'APPROVED' })], { [DECIDE]: D({}) }) });
    await first.user.click(await screen.findByRole('button', { name: 'Send RFQ' }));
    await first.user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send RFQ' }));
    expectBody((await waitFor(() => expectCalled(first.api, DECIDE)))[0], { status: 'RFQ_SENT' });
    first.unmount();

    const { api, user } = mountPage(<InvesteePage />, { routes: reqRoutes([ireq({ status: 'RFQ_SENT' })], { [DECIDE]: D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Convert to PO' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Purchase order reference'), 'PO-7781');
    await user.click(within(d).getByRole('button', { name: 'Convert' }));
    expectBody((await waitFor(() => expectCalled(api, DECIDE)))[0], { status: 'CONVERTED_TO_PO', poRef: 'PO-7781' });
  });

  it('a converted request offers Mark fulfilled and shows its PO', async () => {
    mountPage(<InvesteePage />, { routes: reqRoutes([ireq({ status: 'CONVERTED_TO_PO', poRef: 'PO-7781' })]) });
    expect(await screen.findByText('PO PO-7781')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark fulfilled' })).toBeInTheDocument();
  });

  it('review buttons are hidden without research.edit', async () => {
    mountPage(<InvesteePage />, { perms: without('research.edit'), routes: reqRoutes([ireq()]) });
    await screen.findByText('Irrigation pumps');
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
  });

  it('the tranche panel shows committed, reserved, available and approved figures, and the committed amount is set with a key', async () => {
    const ledger = { currency: 'USD', configured: true, source: 'tranche', committed: 1000000, reserved: 420000, available: 580000, approvedThisQuarter: 250000, totalApproved: 320000 };
    const { api, user } = mountPage(<InvesteePage />, {
      perms: without('portfolio.view'),
      routes: reqRoutes([], { 'GET /api/v1/ops/investee-requests/tranche/CO-1': D(ledger), 'PUT /api/v1/ops/investee-requests/tranche/CO-1': D({ ...ledger, committed: 1200000 }) }),
    });
    expect(await screen.findByText(/Select a company to see its committed/)).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText('Company id'));
    await user.paste('CO-1');
    expect(await screen.findByText('USD 1,000,000')).toBeInTheDocument();
    expect(screen.getByText('USD 420,000')).toBeInTheDocument();
    expect(screen.getByText('USD 580,000')).toBeInTheDocument();
    expect(screen.getByText('USD 250,000')).toBeInTheDocument();
    expect(screen.getByText('USD 320,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set committed amount' }));
    const d = await screen.findByRole('dialog');
    const input = within(d).getByLabelText(/Total committed/);
    await user.clear(input);
    await user.type(input, '1,200,000');
    await user.click(within(d).getByRole('button', { name: 'Save' }));
    const [r] = await waitFor(() => expectCalled(api, 'PUT /api/v1/ops/investee-requests/tranche/CO-1'));
    expectBody(r, { totalCommittedAmount: 1200000 });
    expectIdempotencyKey(r);
  });

  it('warns that over-draw is not checked when no tranche is on record', async () => {
    const ledger = { currency: 'USD', configured: false, source: 'term_sheets', committed: 0, reserved: 0, available: 0, approvedThisQuarter: 0, totalApproved: 0 };
    const { user } = mountPage(<InvesteePage />, { perms: without('portfolio.view'), routes: reqRoutes([], { 'GET /api/v1/ops/investee-requests/tranche/CO-1': D(ledger) }) });
    await user.click(await screen.findByPlaceholderText('Company id'));
    await user.paste('CO-1');
    expect(await screen.findByText(/over-draw is not checked for this company/)).toBeInTheDocument();
  });
});

const sheet = (over: Record<string, unknown> = {}) => ({
  id: 'ts-1', ref: 'TS-001', companyId: 'CO-1', companyName: 'Zim Agro Ltd', title: 'Series A term sheet', versionNo: 1, status: 'SIGNED_BY_COMPANY', investmentAmount: '2000000.00', valuation: '10000000.00',
  equityPercentage: '16.67', currency: 'USD', keyTerms: ['1x liquidation preference'], conditions: 'Satisfactory DD', timeline: '90 days', createdById: 'u-maker', createdByName: 'Maya Maker',
  approvedById: null, approvedByName: null, issuedById: 'u-issuer', issuedAt: null, viewedAt: null, signedAt: null, parentId: null, amendmentReason: null, closeReason: null, ...over,
});

describe('Term sheet extras (GAP-020)', () => {
  const r = (t: unknown, extra = {}) => ({ 'GET /api/v1/ops/term-sheets/ts-1': D(t), ...extra });

  it('a company-signed sheet can be rejected for the fund with a reason', async () => {
    const { api, user } = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet(), { 'POST /api/v1/ops/term-sheets/ts-1/reject': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Reject for the fund' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Valuation not agreed');
    await user.click(within(d).getByRole('button', { name: 'Reject' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/term-sheets/ts-1/reject'));
    expectBody(req, { reason: 'Valuation not agreed' });
    expectIdempotencyKey(req);
  });

  it('a countersigned sheet can be voided; an executed sheet offers no void', async () => {
    const first = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ status: 'COUNTERSIGNED' }), { 'POST /api/v1/ops/term-sheets/ts-1/void': D({}) }) });
    await first.user.click(await screen.findByRole('button', { name: 'Void' }));
    const d = await screen.findByRole('dialog');
    await first.user.type(within(d).getByLabelText('Reason'), 'Terms replaced');
    await first.user.click(within(d).getByRole('button', { name: 'Void' }));
    expectBody((await waitFor(() => expectCalled(first.api, 'POST /api/v1/ops/term-sheets/ts-1/void')))[0], { reason: 'Terms replaced' });
    first.unmount();
    mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ status: 'EXECUTED' })) });
    await screen.findByText('Series A term sheet');
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Amend' })).not.toBeInTheDocument();
  });

  it('Amend creates the next version and opens it', async () => {
    const { api, user } = mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, routes: r(sheet({ status: 'ISSUED' }), { 'POST /api/v1/ops/term-sheets/ts-1/amend': created({ id: 'ts-2' }) }) });
    await user.click(await screen.findByRole('button', { name: 'Amend' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Reason'), 'Change the equity split');
    await user.click(within(d).getByRole('button', { name: 'Create amendment' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/ops/term-sheets/ts-1/amend')))[0], { reason: 'Change the equity split' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/term-sheets/ts-2'));
  });

  it('a superseded sheet shows why and lists the version chain', async () => {
    mountPage(<TermSheetPage />, {
      params: { id: 'ts-1' },
      routes: r(sheet({ status: 'SUPERSEDED', closeReason: 'Equity split changed' }), {
        'GET /api/v1/ops/term-sheets/ts-1/history': D([
          { id: 'ts-1', ref: 'TS-001', versionNo: 1, status: 'SUPERSEDED', createdAt: '2026-10-01T00:00:00Z' },
          { id: 'ts-2', ref: 'TS-002', versionNo: 2, status: 'DRAFT', amendmentReason: 'Equity split changed', createdAt: '2026-10-02T00:00:00Z' },
        ]),
      }),
    });
    expect(await screen.findByText('Superseded: Equity split changed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'v2 TS-002' })).toHaveAttribute('href', '/ops-native/term-sheets/ts-2');
  });

  it('without term_sheets.approve there is no reject or void', async () => {
    mountPage(<TermSheetPage />, { params: { id: 'ts-1' }, perms: without('term_sheets.approve'), routes: r(sheet()) });
    await screen.findByText('Series A term sheet');
    expect(screen.queryByRole('button', { name: 'Reject for the fund' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  const tpl = (over: Record<string, unknown> = {}) => ({ id: 'tp-1', name: 'Seed equity round', description: 'Seed preferred', status: 'ACTIVE', ...over });
  const listRoutes = (templates: unknown[], extra = {}) => ({
    'GET /api/v1/ops/term-sheets': D([]),
    'GET /api/v1/ops/term-sheets/templates': D(templates),
    'GET /api/v1/ops/lookups/companies': D([{ id: 'CO-1', name: 'Zim Agro Ltd' }]),
    ...extra,
  });

  it('the template library lists templates and archives one with a key', async () => {
    const { api, user } = mountPage(<TermSheetsPage />, { routes: listRoutes([tpl()], { 'PATCH /api/v1/ops/term-sheets/templates/tp-1': D({}) }) });
    expect(await screen.findByText('Seed equity round')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const [req] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/ops/term-sheets/templates/tp-1'));
    expectBody(req, { status: 'ARCHIVED' });
    expectIdempotencyKey(req);
  });

  it('a new template is posted with its key terms split by line', async () => {
    const { api, user } = mountPage(<TermSheetsPage />, { routes: listRoutes([], { 'POST /api/v1/ops/term-sheets/templates': created({ id: 'tp-9' }) }) });
    await user.click(await screen.findByRole('button', { name: 'New template' }));
    const d = await screen.findByRole('dialog');
    await user.type(within(d).getByLabelText('Name'), 'Convertible');
    await user.type(within(d).getByLabelText(/Key terms/), 'Discount 20%{enter}Cap TBD');
    await user.click(within(d).getByRole('button', { name: 'Save template' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/ops/term-sheets/templates'));
    expectBody(req, { name: 'Convertible', keyTerms: ['Discount 20%', 'Cap TBD'] });
    expectIdempotencyKey(req);
  });

  it('New template is hidden without term_sheets.create', async () => {
    mountPage(<TermSheetsPage />, { perms: without('term_sheets.create'), routes: listRoutes([tpl()]) });
    await screen.findByText('Seed equity round');
    expect(screen.queryByRole('button', { name: 'New template' })).not.toBeInTheDocument();
  });
});
