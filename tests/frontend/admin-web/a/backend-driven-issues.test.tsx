import { describe, it, expect } from 'vitest';
import AccountingPage from '@/app/(ops)/ops/accounting/page';
import AJournalPage from '@/app/(ops)/ops/accounting/journals/[id]/page';
import CallsPage from '@/app/(ops)/ops/capital-calls/page';
import NoticesPage from '@/app/(ops)/ops/notices/page';
import { screen, within } from '../../_helpers';
import { D, PF, mountPage } from './_kit';

/**
 * ADA-016, ADA-018 and ADA-023 were fixed in the API (full chart on first auto posting, month period opened on
 * post, call ref in notice titles). The browser half is that the screens show exactly what the API now sends.
 */
describe('ADA-016 full chart after the first automatic posting', () => {
  it('the journal form offers every account of the entity, not just the four the first posting created', async () => {
    const codes = [['1000', 'Cash'], ['1100', 'Investments'], ['2000', 'Payables'], ['3000', 'Capital'], ['4000', 'Fees'], ['4300', 'Realised gains and losses'], ['5000', 'Expenses'], ['6000', 'Accruals']];
    const accounts = codes.map(([code, name], i) => ({ id: `a${i}`, portfolioId: PF.id, code, name, type: 'ASSET', description: null, isActive: true }));
    const { user } = mountPage(<AccountingPage />, { routes: { 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/accounting/journals': D([], { total: 0, summary: { byStatus: {}, drafts: 0, pendingApproval: 0, posted: 0 } }), 'GET /api/v1/accounting/accounts': D(accounts) } });
    await screen.findByRole('option', { name: /Growth Portfolio/ });
    await user.selectOptions(screen.getAllByRole('combobox')[0], PF.id);
    await user.click(await screen.findByRole('button', { name: 'New journal' }));
    const dlg = await screen.findByRole('dialog');
    await within(dlg).findAllByRole('option', { name: /4300 Realised gains and losses/ });
    const firstLine = within(dlg).getAllByRole('combobox')[1];
    expect(within(firstLine).getAllByRole('option').length).toBe(1 + codes.length);
  });
});

describe('ADA-018 posting opens the month period', () => {
  it('a posted journal whose month period was opened automatically shows no closed-period warning, and the Periods tab lists the month', async () => {
    const journal = { id: 'aj-1', ref: 'JE-00001', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, entryDate: '2026-09-30', description: 'NAV', currency: 'USD', status: 'PENDING_APPROVAL', totalDebit: '1.00', totalCredit: '1.00', makerId: 'u1', makerName: 'M', postedByName: null, postedAt: null, reversalOfId: null, reversalOfRef: null, reversedById: null, reversedByRef: null, reverseReason: null, periodId: 'p-1', periodStatus: 'OPEN', lines: [], timeline: [], allowed: { edit: false, submit: false, discard: false, returnToMaker: false, post: true, postBlocker: null, reverse: false } };
    mountPage(<AJournalPage />, { params: { id: 'aj-1' }, routes: { 'GET /api/v1/accounting/journals/aj-1': D(journal), 'GET /api/v1/portfolios': D([PF]) } });
    await screen.findByText('JE-00001');
    expect(screen.queryByText(/period for this date is closed/)).not.toBeInTheDocument();
  });
  it('Periods tab shows the automatically opened month', async () => {
    const period = { id: 'p-1', portfolioId: PF.id, portfolioRef: PF.ref, portfolioName: PF.name, periodStart: '2026-09-01', periodEnd: '2026-09-30', month: '2026-09', status: 'OPEN', unpostedJournals: 1, closingByName: null, closedByName: null, closedAt: null, reopenedByName: null, reopenedAt: null, reopenReason: null };
    const { user } = mountPage(<AccountingPage />, { routes: { 'GET /api/v1/portfolios': D([PF]), 'GET /api/v1/accounting/journals': D([], { total: 0, summary: { byStatus: {}, drafts: 0, pendingApproval: 0, posted: 0 } }), 'GET /api/v1/accounting/periods': D([period]) } });
    await user.click(await screen.findByRole('tab', { name: 'Periods & close' }));
    expect(await screen.findByText('2026-09')).toBeInTheDocument();
  });
});

describe('ADA-023 one reference style for a call across screens', () => {
  it('the capital call list and the LP notice title use the same CC-nnnnn ref the API sends', async () => {
    const calls = mountPage(<CallsPage />, { routes: { 'GET /api/v1/ops/capital-calls': D([{ id: 'cc-1', ref: 'CC-00014', callNo: 14, fundId: 'f-1', fundName: 'Fund', dueDate: '2026-10-15', totalAmount: '1.00', currency: 'USD', status: 'ISSUED' }]), 'GET /api/v1/ops/funds': D([]) } });
    expect(await screen.findByText('CC-00014')).toBeInTheDocument();
    calls.unmount();
    mountPage(<NoticesPage />, { routes: { 'GET /api/v1/ops/notices': D([{ id: 'n1', ref: 'NT-1', title: 'CC-00014 capital call issued', body: 'b', category: 'CAPITAL_CALL', targetType: 'ALL', requiresAcknowledgement: true, status: 'PUBLISHED' }]), 'GET /api/v1/ops/funds': D([]) } });
    expect(await screen.findByText('CC-00014 capital call issued')).toBeInTheDocument();
  });
});
