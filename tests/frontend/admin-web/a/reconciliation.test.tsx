import { describe, it, expect } from 'vitest';
import ReconPage from '@/app/(ops)/ops/reconciliation/page';
import { expectBody, expectCalled, expectIdempotencyKey, expectNotCalled, fail, screen, waitFor, within } from '../../_helpers';
import { D, PF, created, mountPage, without } from './_kit';
import { raw } from '../../_helpers';

const brk = (over: Record<string, unknown> = {}) => ({
  id: 'br-1', ref: 'REC-00003', runId: 'run-1', runRef: 'RUN-1', asOfDate: '2026-09-30', family: 'TRADES', familyLabel: 'Trades', itemKey: 'T-1', kind: 'MISMATCH', label: 'Trade TR-77 price differs',
  internalValue: { price: '1.25', quantity: '1000' }, externalValue: { price: '1.30', quantity: '1000' }, difference: '0.05', differencePct: '4.00', currency: 'USD', cause: null, severity: 'HIGH', status: 'NEW',
  ownerUserId: null, ownerName: null, counterparty: { id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered' }, portfolio: { id: PF.id, ref: PF.ref, name: PF.name }, resolutionNote: null, evidenceRef: null,
  makerId: null, makerName: null, checkerId: null, checkerName: null, resolvedAt: null, closedAt: null, ageHours: 30, ageDays: 1, overdue: false, version: 4, createdAt: '2026-09-30T00:00:00Z', ...over,
});
const allowed = (over: Record<string, unknown> = {}) => ({ assign: true, investigate: true, resolve: true, approve: false, reject: false, approveBlockedReason: null, reopen: false, query: true, escalate: true, attachEvidence: true, ...over });
const overview = { asOfDate: '2026-09-30', families: [{ family: 'TRADES', label: 'Trades', runs: 1, matched: 8, breaks: 2, matchRate: 80, openBreaks: 2, signedOff: false, sourceMissing: false }, { family: 'CASH', label: 'Cash', runs: 0, matched: 0, breaks: 0, matchRate: null, openBreaks: 0, signedOff: false, sourceMissing: true }], openBySeverity: { CRITICAL: 0, HIGH: 2, MEDIUM: 0, LOW: 0 }, openTotal: 2, overdue: 1 };
const source = { counterpartyId: 'cp-1', ref: 'CP-1', name: 'Standard Chartered', type: 'Custodian', status: 'ACTIVE', lastDayEnd: { ref: 'DAY-1', statementDate: '2026-09-30', receivedAt: null }, executionsToday: 3, missingSource: true, unmappedAccounts: ['X1'], accounts: [{ accountRef: 'ACC-9', portfolio: { id: PF.id, ref: PF.ref, name: PF.name }, mapped: true, dayEndReceived: false, dayEnd: null, executions: 0 }] };

const base = (extra = {}) => ({
  'GET /api/v1/recon/overview': D(overview), 'GET /api/v1/recon/sources': D([source]),
  'GET /api/v1/recon/breaks': D([brk()], { total: 1, summary: { open: 1, overdue: 0, byStatus: {}, openBySeverity: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0 }, openByFamily: {} } }),
  'GET /api/v1/recon/counterparties': D([{ id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered', accounts: ['ACC-9'] }]),
  'GET /api/v1/recon/users': D([{ id: 'u-9', name: 'Olive Owner', email: 'o@x' }]), 'GET /api/v1/portfolios': D([PF]),
  'GET /api/v1/recon/runs': D([]), 'GET /api/v1/recon/account-map': D([]), ...extra,
});
const tab = async (user: ReturnType<typeof mountPage>['user'], name: string) => user.click(await screen.findByRole('tab', { name }));

describe('Reconciliation page', () => {
  it('without operations.view shows the refusal and calls nothing', async () => {
    const { api } = mountPage(<ReconPage />, { perms: without('operations.view'), routes: base() });
    expect(await screen.findByText(/does not include operations/)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/recon/overview');
  });

  it('overview: match rate per family, "no run" and source-missing wording, overdue count; family tile jumps to the filtered Breaks tab', async () => {
    const { api, user } = mountPage(<ReconPage />, { routes: base() });
    expect(await screen.findByText('80.0%')).toBeInTheDocument();
    expect(screen.getByText('No run for this date')).toBeInTheDocument();
    expect(screen.getByText(/open · source missing/)).toBeInTheDocument();
    await user.click(screen.getByText('Trades', { selector: 'h3' }).closest('button')!);
    await waitFor(() => expect(api.calls('GET /api/v1/recon/breaks').at(-1)!.query.get('family')).toBe('TRADES'));
    expect(await screen.findByText('REC-00003')).toBeInTheDocument();
  });

  it('overview: source health marks missing day-ends and unmapped accounts', async () => {
    mountPage(<ReconPage />, { routes: base() });
    expect(await screen.findByText('Standard Chartered')).toBeInTheDocument();
    expect(screen.getByText(/ACC-9 ✗/)).toBeInTheDocument();
    expect(screen.getByText('1 unmapped')).toBeInTheDocument();
  });

  it('overview API failure is an error message', async () => {
    mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/overview': fail(500, 'internal', 'boom') }) });
    expect(await screen.findByText(/Could not load reconciliation overview: boom/)).toBeInTheDocument();
  });

  it('ADA-027: day-end counts are reconciled in their own family ("Day-end trade count") not mixed into Trades', async () => {
    mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/overview': D({ ...overview, families: [...overview.families, { family: 'DAYEND_COUNT', label: 'Day-end trade count', runs: 1, matched: 1, breaks: 1, matchRate: 50, openBreaks: 1, signedOff: false, sourceMissing: false }] }) }) });
    expect(await screen.findByText('Day-end trade count')).toBeInTheDocument();
  });

  describe('breaks queue and detail', () => {
    async function openBreak(extra: Record<string, unknown> = {}, detail = { data: brk(), allowed: allowed(), events: [{ id: 'e1', action: 'detected', fromStatus: null, toStatus: 'NEW', actorName: null, note: null, at: '2026-09-30T08:00:00Z' }] }) {
      const m = mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/breaks/br-1': D(detail.data, { allowed: detail.allowed, events: detail.events }), 'GET /api/v1/recon/breaks/br-1/extras': D({ evidence: [], actions: [] }), ...extra }) });
      await tab(m.user, 'Breaks');
      await m.user.click(await screen.findByRole('button', { name: 'REC-00003' }));
      return { ...m, dlg: await screen.findByRole('dialog') };
    }
    it('queue filters (family, severity, status, search) are sent as query params', async () => {
      const { api, user } = mountPage(<ReconPage />, { routes: base() });
      await tab(user, 'Breaks');
      await screen.findByText('REC-00003');
      expect(api.calls('GET /api/v1/recon/breaks')[0].query.get('status')).toBe('open');
      await user.selectOptions(screen.getByLabelText('Family'), 'CASH');
      await user.selectOptions(screen.getByLabelText('Severity'), 'CRITICAL');
      await user.type(screen.getByLabelText('Search'), 'TR-77');
      await waitFor(() => {
        const q = api.calls('GET /api/v1/recon/breaks').at(-1)!.query;
        expect([q.get('family'), q.get('severity'), q.get('q')]).toEqual(['CASH', 'CRITICAL', 'TR-77']);
      });
    });
    it('empty queue points to Run matching', async () => {
      const { user } = mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/breaks': D([], { total: 0, summary: { open: 0, overdue: 0, byStatus: {}, openBySeverity: {}, openByFamily: {} } }) }) });
      await tab(user, 'Breaks');
      expect(await screen.findByText(/No breaks match these filters/)).toBeInTheDocument();
    });
    it('detail shows internal vs external values, difference, counterparty and portfolio names, timeline wording', async () => {
      const { dlg } = await openBreak();
      expect(await within(dlg).findByText('Trade TR-77 price differs')).toBeInTheDocument();
      expect(within(dlg).getByText(/0.05 USD \(4.00%\)/)).toBeInTheDocument();
      expect(within(dlg).getByText('Standard Chartered (CP-1)')).toBeInTheDocument();
      expect(within(dlg).getByText('Growth Portfolio (PF-1001)')).toBeInTheDocument();
      expect(within(dlg).getByText('Detected by matching run')).toBeInTheDocument();
    });
    it('only the actions the server allows are enabled; Approve is disabled and the blocked reason is shown (maker-checker)', async () => {
      const { dlg } = await openBreak({}, { data: brk({ status: 'PENDING_CHECKER', makerName: 'Test Admin' }), allowed: allowed({ approve: false, approveBlockedReason: 'You resolved this break, so a different checker must approve it' }), events: [] });
      expect(await within(dlg).findByText(/You resolved this break/)).toBeInTheDocument();
      expect(within(dlg).getByRole('button', { name: 'Approve' })).toBeDisabled();
      expect(within(dlg).getByRole('button', { name: 'Assign' })).toBeEnabled();
    });
    it('Resolve needs cause, rationale (10+) and sends the break version', async () => {
      const { api, user, dlg } = await openBreak({ 'POST /api/v1/recon/breaks/br-1/resolve': D({}) });
      await user.click(await within(dlg).findByRole('button', { name: 'Resolve' }));
      const d = (await screen.findAllByRole('dialog')).at(-1)!;
      expect(within(d).getByLabelText(/Rationale/)).toHaveAttribute('minlength', '10');
      await user.selectOptions(within(d).getByLabelText('Cause'), 'TIMING');
      await user.type(within(d).getByLabelText(/Rationale/), 'Custodian booked next day');
      await user.type(within(d).getByLabelText(/Evidence reference/), 'EML-12');
      await user.click(within(d).getByRole('button', { name: 'Send to checker' }));
      expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/recon/breaks/br-1/resolve')))[0], { cause: 'TIMING', rationale: 'Custodian booked next day', evidenceRef: 'EML-12', version: 4 });
    });
    it('Assign posts the owner; Return to maker posts the reason', async () => {
      const { api, user, dlg } = await openBreak({ 'POST /api/v1/recon/breaks/br-1/assign': D({}) });
      await user.click(await within(dlg).findByRole('button', { name: 'Assign' }));
      const d = (await screen.findAllByRole('dialog')).at(-1)!;
      await within(d).findByRole('option', { name: 'Olive Owner' });
      await user.selectOptions(within(d).getByLabelText('Owner'), 'u-9');
      await user.click(within(d).getByRole('button', { name: 'Assign' }));
      expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/recon/breaks/br-1/assign')))[0], { ownerUserId: 'u-9', version: 4 });
    });
    it('checker approval posts with the version; a stale-version conflict is reported', async () => {
      const { user, dlg } = await openBreak({ 'POST /api/v1/recon/breaks/br-1/approve': fail(409, 'version_conflict', 'Break changed since you opened it') }, { data: brk({ status: 'PENDING_CHECKER' }), allowed: allowed({ approve: true }), events: [] });
      await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
      const d = (await screen.findAllByRole('dialog')).at(-1)!;
      await user.click(within(d).getByRole('button', { name: 'Approve and close' }));
      expect(await within(d).findByRole('alert')).toHaveTextContent('Break changed since you opened it');
    });
    it('notification link ?break=<id> opens the break on the Breaks tab', async () => {
      mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/breaks/br-1': D(brk(), { allowed: allowed(), events: [] }), 'GET /api/v1/recon/breaks/br-1/extras': D({ evidence: [], actions: [] }) }), search: 'break=br-1' });
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      expect(await screen.findByText(/REC-00003 . Trades/)).toBeInTheDocument();
    });
  });

  describe('run matching and mapping', () => {
    it('Run matching posts family/date and optional tolerance overrides with a key, then shows the result', async () => {
      const run = { id: 'run-1', ref: 'RUN-9', family: 'TRADES', familyLabel: 'Trades', asOfDate: '2026-09-30', counterparty: null, portfolio: null, status: 'BREAKS', matchedCount: 8, breakCount: 2, openBreaks: 2, matchRate: 80, params: null, summary: { missingSources: [{ counterpartyRef: 'CP-1', accountRef: 'ACC-9', reason: 'x' }] }, runCount: 1, runByName: 'Test Admin', updatedAt: '2026-10-01T00:00:00Z' };
      const { api, user } = mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/tolerances/effective': D({ family: 'TRADES', asOfDate: '2026-09-30', tolerances: { price: '0.01', cash: '0.01', holdingsPct: '0.1', positionQty: '0', settleDays: 2, caCash: '0.01' }, sources: { price: 'default' } }), 'POST /api/v1/recon/runs': raw({ data: run, breaks: [], rerun: false }, 201) }) });
      await tab(user, 'Run matching');
      await screen.findAllByText(/Price \(±\)/);
      await user.type(screen.getByLabelText(/Price \(±\): override/), '0.02');
      await user.click(screen.getByRole('button', { name: 'Run matching' }));
      const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/recon/runs'));
      expectBody(req, { family: 'TRADES', counterpartyId: null, portfolioId: null, tolerances: { price: '0.02' } });
      expectIdempotencyKey(req);
      expect(await screen.findByText(/RUN-9 \(new run\): 8 matched, 2 breaks, match rate 80.0%/)).toBeInTheDocument();
      expect(screen.getByText(/Source gap: CP-1\/ACC-9/)).toBeInTheDocument();
    });
    it('without recon.manage the run form is replaced by an explanation', async () => {
      const { user } = mountPage(<ReconPage />, { perms: without('recon.manage'), routes: base() });
      await tab(user, 'Run matching');
      expect(await screen.findByText(/can view reconciliations but not run matching/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Run matching' })).not.toBeInTheDocument();
    });
    it('ADA-014: removing an account mapping uses the in-app confirm dialog (not window.confirm) and only then deletes', async () => {
      const map = { id: 'm-1', counterparty: { id: 'cp-1', ref: 'CP-1', name: 'Standard Chartered' }, accountRef: 'ACC-9', portfolio: { id: PF.id, ref: PF.ref, name: PF.name } };
      const { api, user } = mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/account-map': D([map]), 'DELETE /api/v1/recon/account-map/m-1': D({}) }) });
      await tab(user, 'Run matching');
      await user.click(await screen.findByRole('button', { name: 'Remove' }));
      const d = await screen.findByRole('dialog');
      expect(d).toHaveTextContent('Stop reconciling ACC-9?');
      expectNotCalled(api, 'DELETE /api/v1/recon/account-map/m-1');
      await user.click(within(d).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expectCalled(api, 'DELETE /api/v1/recon/account-map/m-1'));
    });
    it('cancelling the confirm dialog does not delete', async () => {
      const map = { id: 'm-1', counterparty: { id: 'cp-1', ref: 'CP-1', name: 'SC' }, accountRef: 'ACC-9', portfolio: { id: PF.id, ref: PF.ref, name: PF.name } };
      const { api, user } = mountPage(<ReconPage />, { routes: base({ 'GET /api/v1/recon/account-map': D([map]), 'DELETE /api/v1/recon/account-map/m-1': D({}) }) });
      await tab(user, 'Run matching');
      await user.click(await screen.findByRole('button', { name: 'Remove' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expectNotCalled(api, 'DELETE /api/v1/recon/account-map/m-1');
    });
  });

  describe('sources and tolerances', () => {
    const sroutes = (tols: unknown[] = []) => base({ 'GET /api/v1/recon/feeds': D([]), 'GET /api/v1/recon/tolerances': D(tols) });
    it('empty receipts and tolerance states explain the effect', async () => {
      const { user } = mountPage(<ReconPage />, { routes: sroutes() });
      await tab(user, 'Sources and tolerances');
      expect(await screen.findByText(/No custodian files received yet/)).toBeInTheDocument();
      expect(screen.getByText(/built-in defaults apply/)).toBeInTheDocument();
    });
    it('ADA-014: withdrawing a future tolerance uses the in-app confirm dialog', async () => {
      const tol = { id: 't-1', family: 'TRADES', familyLabel: 'Trades', scope: 'GLOBAL', counterparty: null, effectiveFrom: '2999-01-01', status: 'FUTURE', price: '0.05', cash: null, holdingsPct: null, positionQty: null, settleDays: null, caCash: null, note: null, createdByName: 'Test Admin' };
      const { api, user } = mountPage(<ReconPage />, { routes: { ...sroutes([tol]), 'DELETE /api/v1/recon/tolerances/t-1': D({}) } });
      await tab(user, 'Sources and tolerances');
      await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
      const d = await screen.findByRole('dialog');
      expectNotCalled(api, 'DELETE /api/v1/recon/tolerances/t-1');
      await user.click(within(d).getByRole('button', { name: 'Withdraw' }));
      await waitFor(() => expectCalled(api, 'DELETE /api/v1/recon/tolerances/t-1'));
    });
    it('without recon.manage / recon.signoff the upload and tolerance forms are replaced by notices', async () => {
      const { user } = mountPage(<ReconPage />, { perms: without('recon.manage', 'recon.signoff'), routes: sroutes() });
      await tab(user, 'Sources and tolerances');
      expect(await screen.findAllByText(/Uploading source files needs recon.manage/)).toHaveLength(2);
      expect(screen.getByText(/Changing tolerances needs recon.signoff/)).toBeInTheDocument();
    });
  });

  describe('daily sign-off', () => {
    const readiness = (over: Record<string, unknown> = {}) => ({ family: 'TRADES', asOfDate: '2026-09-30', runs: [{ id: 'r', ref: 'RUN-1', status: 'BREAKS', runByName: 'Maya' }], openMaterial: [], openOther: 0, missingSources: [], signedOff: null, ready: true, reasons: [], canSign: true, independent: true, ...over });
    const sg = (r: unknown, extra = {}) => base({ 'GET /api/v1/recon/signoffs/readiness': D(r), 'GET /api/v1/recon/signoffs': D([]), ...extra });
    it('ready: shows the green state, signs with the note and posts family/date', async () => {
      const { api, user } = mountPage(<ReconPage />, { routes: sg(readiness(), { 'POST /api/v1/recon/signoffs': created({}) }) });
      await tab(user, 'Daily sign-off');
      expect(await screen.findByText(/Ready to sign/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Sign off trades for/ }));
      const d = await screen.findByRole('dialog');
      await user.type(within(d).getByLabelText(/Note/), 'All good');
      await user.click(within(d).getByRole('button', { name: 'Sign off' }));
      expectBody((await waitFor(() => expectCalled(api, 'POST /api/v1/recon/signoffs')))[0], { family: 'TRADES', counterpartyId: null, note: 'All good' });
    });
    it('blocked: lists the reasons and the sign-off button is disabled; a non-independent user is told why', async () => {
      mountPage(<ReconPage />, { routes: sg(readiness({ ready: false, canSign: false, independent: false, reasons: ['2 High breaks are open'] })) });
      const { user } = { user: (await import('@testing-library/user-event')).default.setup() };
      await user.click(await screen.findByRole('tab', { name: 'Daily sign-off' }));
      expect(await screen.findByText('Not ready: 2 High breaks are open.')).toBeInTheDocument();
      expect(screen.getByText(/different person must sign it off/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Sign off trades for/ })).toBeDisabled();
    });
    it('already signed off shows who and the button is disabled; empty history state', async () => {
      const { user } = mountPage(<ReconPage />, { routes: sg(readiness({ signedOff: { id: 's', signedByName: 'Carl Checker', signedAt: '2026-10-01T10:00:00Z' } })) });
      await tab(user, 'Daily sign-off');
      expect(await screen.findByText(/Signed off by Carl Checker/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Sign off trades for/ })).toBeDisabled();
      expect(await screen.findByText('No days have been signed off yet.')).toBeInTheDocument();
    });
    it('no recon.signoff permission: disabled with the reason as tooltip', async () => {
      const { user } = mountPage(<ReconPage />, { perms: without('recon.signoff'), routes: sg(readiness()) });
      await tab(user, 'Daily sign-off');
      const b = await screen.findByRole('button', { name: /^Sign off trades for/ });
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Your role does not include recon.signoff');
    });
  });
});
