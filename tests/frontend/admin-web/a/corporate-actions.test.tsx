import { describe, it, expect } from 'vitest';
import CaPage from '@/app/(ops)/ops/corporate-actions/page';
import CaDetailPage from '@/app/(ops)/ops/corporate-actions/[id]/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, router, screen, waitFor, within } from '../../_helpers';
import { D, SEC, created, mountPage, without } from './_kit';

const ev = (over: Record<string, unknown> = {}) => ({
  id: 'ca-1', ref: 'CA-00001', securityId: 'sec-1', ticker: 'CMCL.VX', securityName: 'Cim Holdings', type: 'CASH_DIVIDEND', status: 'CONFIRMED', currency: 'USD', exDate: '2026-09-01', recordDate: '2026-09-02', payDate: '2026-09-20', electionDeadline: null,
  rate: '0.05', ratioNew: null, ratioOld: null, withholdingPct: '10', targetSecurityId: null, targetTicker: null, defaultOption: null, description: 'Interim dividend', elective: false, options: [], electionOpen: false, entitlementsAt: '2026-09-03T00:00:00Z', entitlementCount: 1, electedCount: 0,
  netCash: '450.00', makerId: 'u-maker', makerName: 'Maya Maker', confirmedBy: 'u2', confirmedByName: 'Carl Confirmer', confirmedAt: '2026-09-03T00:00:00Z', processedBy: null, processedByName: null, processedAt: null, cancelReason: null, cancelledAt: null, cashInLieu: false, cilPrice: null,
  reversedBy: null, reversedByName: null, reversedAt: null, reverseReason: null, processing: null, createdAt: '2026-08-30T00:00:00Z', updatedAt: null, ...over,
});
const list = (rows: unknown[]) => D(rows, { total: rows.length, summary: { byStatus: {}, upcoming: 2, awaitingConfirmation: 1, awaitingProcessing: 1, processed: 4 } });
const lroutes = (rows: unknown[] = [ev()], extra = {}) => ({ 'GET /api/v1/securities': D([SEC]), 'GET /api/v1/corporate-actions/upcoming': D(rows, { from: '2026-10-01', to: '2026-12-30' }), 'GET /api/v1/corporate-actions/events': list(rows), ...extra });

describe('Corporate actions list', () => {
  it('shows upcoming events with security, type and status; summary tiles; rows open the action', async () => {
    const { user } = mountPage(<CaPage />, { routes: lroutes() });
    expect(await screen.findByText('CA-00001')).toBeInTheDocument();
    expect(screen.getByText('CMCL.VX')).toBeInTheDocument();
    expect(screen.getByText('Cash dividend')).toBeInTheDocument();
    await user.click(screen.getByText('CA-00001'));
    expect(router.push).toHaveBeenCalledWith('/ops-native/corporate-actions/ca-1');
  });
  it('ADA-031: a CONFIRMED cash dividend whose record date has passed is listed (so entitlements and Process can be exercised)', async () => {
    mountPage(<CaPage />, { routes: lroutes([ev({ recordDate: '2026-09-02', status: 'CONFIRMED' })]) });
    expect(await screen.findByText('CA-00001')).toBeInTheDocument();
    expect(screen.queryByText(/Demo event/)).not.toBeInTheDocument();
  });
  it('status tiles switch to All events with the status filter sent to the API; empty states', async () => {
    const { api, user } = mountPage(<CaPage />, { routes: lroutes() });
    await screen.findByText('CA-00001');
    await user.click(screen.getByText('Awaiting processing', { selector: 'p' }));
    await waitFor(() => expect(api.calls('GET /api/v1/corporate-actions/events').at(-1)!.query.get('status')).toBe('CONFIRMED'));
    expect(await screen.findByText('All events')).toBeInTheDocument();
  });
  it('empty upcoming state', async () => {
    mountPage(<CaPage />, { routes: lroutes([]) });
    expect(await screen.findByText(/Nothing is due in the next 90 days/)).toBeInTheDocument();
  });
  it('New corporate action: cash dividend posts rate and withholding; scrip shows election fields; keys are sent', async () => {
    const { api, user } = mountPage(<CaPage />, { routes: lroutes([], { 'POST /api/v1/corporate-actions/events': created({ id: 'ca-9' }) }) });
    await user.click(await screen.findByRole('button', { name: 'New corporate action' }));
    const d = await screen.findByRole('dialog');
    await within(d).findByRole('option', { name: /DLTA/ });
    await user.selectOptions(within(d).getByLabelText('Security'), 'sec-1');
    const setDate = (el: HTMLElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setDate(within(d).getByLabelText('Ex-date'), '2026-11-01');
    setDate(within(d).getByLabelText(/Record date/), '2026-11-02');
    setDate(within(d).getByLabelText('Pay date'), '2026-11-20');
    await user.type(within(d).getByLabelText('Cash per share'), '0.05');
    expect(within(d).queryByLabelText(/Election deadline/)).not.toBeInTheDocument();
    await user.click(within(d).getByRole('button', { name: 'Create' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events'));
    expectBody(req, { securityId: 'sec-1', type: 'CASH_DIVIDEND', exDate: '2026-11-01', recordDate: '2026-11-02', payDate: '2026-11-20', rate: '0.05', withholdingPct: '0' });
    expectIdempotencyKey(req);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/ops-native/corporate-actions/ca-9'));
  });
  it('choosing scrip dividend reveals the election deadline and default option', async () => {
    const { user } = mountPage(<CaPage />, { routes: lroutes([]) });
    await user.click(await screen.findByRole('button', { name: 'New corporate action' }));
    const d = await screen.findByRole('dialog');
    await user.selectOptions(within(d).getByLabelText('Type'), 'SCRIP_DIVIDEND');
    expect(within(d).getByLabelText(/Election deadline/)).toBeInTheDocument();
    expect(within(d).getByLabelText('If a holder does not elect')).toHaveValue('CASH');
    await user.selectOptions(within(d).getByLabelText('Type'), 'MERGER');
    expect(within(d).getByLabelText('Acquirer security')).toBeInTheDocument();
  });
  it('New corporate action is hidden without operations.view', async () => {
    mountPage(<CaPage />, { perms: without('operations.view'), routes: lroutes() });
    await screen.findByText('CA-00001');
    expect(screen.queryByRole('button', { name: 'New corporate action' })).not.toBeInTheDocument();
  });
});

const ent = (over: Record<string, unknown> = {}) => ({ id: 'en-1', portfolioId: 'pf-1', portfolioRef: 'PF-1001', portfolioName: 'Growth Portfolio', quantity: '10000', option: null, elected: false, electedByName: null, electedAt: null, grossAmount: '500.00', taxAmount: '50.00', cashAmount: '450.00', cashInLieu: '0', sharesDelta: '0', targetShares: '0', fraction: '0', status: 'PENDING', defaulted: false, note: null, ...over });
const allowed = (over: Record<string, unknown> = {}) => ({ edit: false, confirm: false, calculate: true, calculateBlocker: null, elect: false, process: false, processBlocker: null, cancel: false, reverse: false, reverseBlocker: null, ...over });
const detail = (over: Record<string, unknown> = {}, al: Record<string, unknown> = {}) => ({
  ...ev(), entitlements: [ent()], totals: { quantity: '10000', gross: '500.00', tax: '50.00', netCash: '450.00', cashInLieu: '0', sharesDelta: '0', targetShares: '0' }, timeline: [{ at: '2026-09-03T00:00:00Z', action: 'corp_action.confirmed', actor: 'Carl Confirmer', reason: null }], allowed: allowed(al), ...over,
});
const dr = (d: unknown, extra = {}) => ({ 'GET /api/v1/corporate-actions/events/ca-1': D(d), 'GET /api/v1/corporate-actions/events/ca-1/clients': D([{ clientId: 'c1', clientRef: 'CL-1', clientName: 'Rutendo Trust', portfolios: ['PF-1001'], quantity: '10000', cash: '450.00', cashInLieu: '0', sharesDelta: '0', targetShares: '0', elected: 0, entitlements: 1 }]), ...extra });

describe('Corporate action detail', () => {
  it('shows entitlements by portfolio name and client roll-up with names (no ids)', async () => {
    mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail()) });
    expect((await screen.findAllByText('Growth Portfolio')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Rutendo Trust')).toBeInTheDocument();
    expect(screen.getByText('Interim dividend')).toBeInTheDocument();
    expect(screen.getAllByText('Carl Confirmer', { exact: false }).length).toBeGreaterThan(0);
  });
  it('confirmed + process: maker is blocked with a reason; an independent processor sees Process enabled and a confirmation that states net cash', async () => {
    const blocked = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({}, { process: false, processBlocker: 'A different user must process this action' })) });
    const b = await screen.findByRole('button', { name: 'Process' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'A different user must process this action');
    expect(screen.getByText('A different user must process this action.')).toBeInTheDocument();
    blocked.unmount();
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({}, { process: true }), { 'POST /api/v1/corporate-actions/events/ca-1/process': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Process' }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('net cash of 450.00 USD');
    expectNotCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/process');
    await user.click(within(dlg).getByRole('button', { name: 'Process' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/process')))[0]);
    await waitFor(() => expect(api.calls('GET /api/v1/corporate-actions/events/ca-1').length).toBe(2));
  });
  it('FR-OPS-015: the stage badge shows the lifecycle stage; Instruct custodian confirms first then posts with a key', async () => {
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ stage: 'PROJECTED', stageLabel: 'Entitlement projected' }, { instruct: true }), { 'POST /api/v1/corporate-actions/events/ca-1/instruct': D({}) }) });
    expect(await screen.findByText('Entitlement projected')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Instruct custodian' }));
    const dlg = await screen.findByRole('dialog');
    expectNotCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/instruct');
    await user.click(within(dlg).getByRole('button', { name: 'Instruct custodian' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/instruct')))[0]);
  });
  it('FR-OPS-015: a processed action offers Mark reconciled, which posts with a key', async () => {
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ status: 'PROCESSED', stage: 'PROCESSED', stageLabel: 'Processed' }, { reconcile: true }), { 'POST /api/v1/corporate-actions/events/ca-1/reconcile': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Mark reconciled' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Mark reconciled' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/reconcile')))[0]);
  });
  it('Calculate entitlements: disabled with the blocker before the record date; posts with a key otherwise', async () => {
    const early = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ entitlementsAt: null, entitlements: [], entitlementCount: 0 }, { calculate: false, calculateBlocker: 'The record date has not passed' })) });
    const b = await screen.findByRole('button', { name: 'Calculate entitlements' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', 'The record date has not passed');
    early.unmount();
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail(), { 'POST /api/v1/corporate-actions/events/ca-1/entitlements/calculate': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Recalculate entitlements' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/entitlements/calculate')))[0]);
  });
  it('announced: Confirm asks first; Edit terms sends only changed fields and refuses an unchanged form', async () => {
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ status: 'ANNOUNCED' }, { edit: true, confirm: true, cancel: true }), { 'POST /api/v1/corporate-actions/events/ca-1/confirm': D({}), 'PATCH /api/v1/corporate-actions/events/ca-1': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Edit terms' }));
    let d = await screen.findByRole('dialog');
    await user.click(within(d).getByRole('button', { name: 'Save terms' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Nothing was changed.');
    expectNotCalled(api, 'PATCH /api/v1/corporate-actions/events/ca-1');
    await user.clear(within(d).getByLabelText('Cash per share'));
    await user.type(within(d).getByLabelText('Cash per share'), '0.07');
    await user.click(within(d).getByRole('button', { name: 'Save terms' }));
    expectBody((await waitFor(() => expectCalled(api, 'PATCH /api/v1/corporate-actions/events/ca-1')))[0], { rate: '0.07' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    d = await screen.findByRole('dialog');
    expect(d).toHaveTextContent('terms can no longer be edited');
    await user.click(within(d).getByRole('button', { name: 'Confirm' }));
    expectIdempotencyKey((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/confirm')))[0]);
  });
  it('Cancel action needs a reason of 5+ characters', async () => {
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ status: 'ANNOUNCED' }, { cancel: true }), { 'POST /api/v1/corporate-actions/events/ca-1/cancel': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Cancel action' }));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByLabelText(/Reason/)).toHaveAttribute('minlength', '5');
    await user.type(within(d).getByLabelText(/Reason/), 'Announced in error');
    await user.click(within(d).getByRole('button', { name: 'Cancel action' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/cancel')))[0], { reason: 'Announced in error' });
  });
  it('elective event: Record election PUTs the chosen option for that portfolio', async () => {
    const d = detail({ type: 'SCRIP_DIVIDEND', status: 'CONFIRMED', elective: true, options: ['CASH', 'SCRIP'], defaultOption: 'CASH', electionDeadline: '2026-09-15' }, { elect: true });
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(d, { 'PUT /api/v1/corporate-actions/events/ca-1/elections': D({}) }) });
    await user.click(await screen.findByRole('button', { name: 'Record election' }));
    const dlg = await screen.findByRole('dialog');
    await user.selectOptions(within(dlg).getByLabelText('Option'), 'SCRIP');
    await user.click(within(dlg).getByRole('button', { name: 'Record election' }));
    expectBody((await waitFor(() => expectCalled(api, 'PUT /api/v1/corporate-actions/events/ca-1/elections')))[0], { portfolioId: 'pf-1', option: 'SCRIP' });
  });
  it('processed: shows who processed and how many portfolios were updated, and Reverse needs a reason', async () => {
    const d = detail({ status: 'PROCESSED', processedByName: 'Pat Processor', processedAt: '2026-09-20T10:00:00Z', processing: { applied: 1, effectiveDate: '2026-09-20' } }, { reverse: true });
    const { api, user } = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(d, { 'POST /api/v1/corporate-actions/events/ca-1/reverse': D({}) }) });
    expect(await screen.findByText(/Processed by Pat Processor/)).toBeInTheDocument();
    expect(screen.getByText(/1 portfolio updated/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reverse by adjustment' }));
    const dlg = await screen.findByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Reason/), 'Wrong rate applied');
    await user.click(within(dlg).getByRole('button', { name: 'Reverse by adjustment' }));
    expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/corporate-actions/events/ca-1/reverse')))[0], { reason: 'Wrong rate applied' });
  });
  it('cancelled and reversed states are explained', async () => {
    const c = mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ status: 'CANCELLED', cancelReason: 'Announced in error', cancelledAt: '2026-09-04T00:00:00Z' })) });
    expect(await screen.findByText(/Cancelled on .*Announced in error/)).toBeInTheDocument();
    c.unmount();
    mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: dr(detail({ status: 'REVERSED', reversedByName: 'Rita', reversedAt: '2026-09-25T00:00:00Z', reverseReason: 'Wrong rate' })) });
    expect(await screen.findByText(/Reversed by Rita/)).toBeInTheDocument();
  });
  it('a failed detail load is an error, 404 is "Not found"', async () => {
    mountPage(<CaDetailPage />, { params: { id: 'ca-1' }, routes: { 'GET /api/v1/corporate-actions/events/ca-1': fail(404, 'not_found', 'x') } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found');
  });
});
