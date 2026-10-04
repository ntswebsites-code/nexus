import { describe, it, expect } from 'vitest';
import OnboardingPage from '@/app/(ops)/ops/onboarding/page';
import { mountPage } from './_kit';
import { raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const row = (o: Record<string, unknown> = {}) => ({ id: 'cs1', ref: 'KYC-1001', applicationRef: 'APP-1', name: 'Jane Applicant', type: 'Individual', country: 'ZW', stage: 'Screening', risk: 'Low', owner: 'Rev R', ownerId: 'st1', slaDueAt: '2026-09-10T10:00:00Z', sla: 'On track', checks: { done: 0, total: 8, failed: 0, referred: 0 }, riskAssessment: null, ...o });
const queue = (rows = [row()]) => raw({ data: rows, total: rows.length, summary: { byStage: { ClientAction: 2 }, byRisk: { High: 1 }, bySla: { Breached: 3, 'At risk': 1 }, awaitingRiskApproval: 2 } });
const workup = (o: Record<string, unknown> = {}) => ({
  case: { id: 'cs1', ref: 'KYC-1001', name: 'Jane Applicant', stage: 'ComplianceReview', risk: 'Low', version: 3, blockers: [], email: 'jane@example.test' },
  app: { country: 'ZW', pep: 'No', sourceOfFunds: 'Salary', expectedInvestment: 50000, owners: 1 },
  checks: [{ kind: 'SANCTIONS', outcome: null, provider: null, notes: null, by: null, at: null, history: 0 }, { kind: 'ID_VERIFICATION', outcome: 'PASS', provider: 'Manual', notes: 'ok', by: 'Rev R', at: '2026-09-01T10:00:00Z', history: 2 }],
  riskPreview: { score: 0, rating: 'Low', factors: [], provisional: true, checksRun: 0, checksTotal: 8 },
  assessments: [{ id: 'ra1', score: 20, rating: 'Medium', factors: [], rationale: 'Overridden', status: 'PROPOSED', maker: 'Maker M', makerId: 'usr_other', checker: null, decisionNote: null, at: '2026-09-01T10:00:00Z' }],
  gates: { blockers: ['Risk rating not approved'], riskApproved: false, checksComplete: false, openReferrals: [] }, timeline: [{ at: '2026-09-01T10:00:00Z', title: 'Application submitted', detail: null }], ...o,
});
const factors = raw({ factors: [{ key: 'pep', label: 'Politically exposed person', points: 40, defaultPoints: 40, enabled: true, params: null, updatedBy: null }, { key: 'amount', label: 'Large investment', points: 10, defaultPoints: 10, enabled: false, params: { threshold: 100000 }, updatedBy: 'Admin A' }], thresholds: { medium: 30, high: 60 } });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/client-ops/onboarding/queue': queue(),
  'GET /api/v1/client-ops/onboarding/cases/:id/workup': raw(workup()),
  'GET /api/v1/client-ops/onboarding/cases/:id/triage': raw({ data: [] }),
  'GET /api/v1/client-ops/staff': raw({ data: [{ id: 'st1', name: 'Rev R', email: 'r@x.test', roles: [] }] }),
  'GET /api/v1/client-ops/onboarding/risk-factors': factors,
  ...o,
});
const VIEW = ['onboarding.view'];

describe('Onboarding queue', () => {
  it('tiles from the summary; rows show applicant name, ref, stage, check progress, SLA (no uuids)', async () => {
    await mountPage(<OnboardingPage />, { routes: base() });
    expect(await screen.findByText('Jane Applicant')).toBeInTheDocument();
    expect(screen.getByText('KYC-1001 · Individual · ZW')).toBeInTheDocument();
    expect(screen.getByText('0/8')).toBeInTheDocument();
    expect(screen.getByText('1 at risk')).toBeInTheDocument();
    expect(screen.queryByText('cs1')).not.toBeInTheDocument();
  });
  it('default queue asks for open cases; picking a stage drops the open flag and sends stage; filters are sent', async () => {
    const { user, api } = await mountPage(<OnboardingPage />, { routes: base() });
    await screen.findByText('Jane Applicant');
    expect(api.calls('GET /api/v1/client-ops/onboarding/queue')[0]!.query.get('open')).toBe('true');
    await user.selectOptions(screen.getByLabelText('Stage'), 'Approved');
    await user.selectOptions(screen.getByLabelText('SLA'), 'Breached');
    await waitFor(() => {
      const q = api.calls('GET /api/v1/client-ops/onboarding/queue').at(-1)!.query;
      expect(q.get('stage')).toBe('Approved');
      expect(q.get('sla')).toBe('Breached');
      expect(q.get('open')).toBeNull();
    });
  });
  it('empty queue message; without onboarding.view: no access', async () => {
    const a = await mountPage(<OnboardingPage />, { routes: base({ 'GET /api/v1/client-ops/onboarding/queue': queue([]) }) });
    expect(await screen.findByText('No cases match.')).toBeInTheDocument();
    a.unmount();
    await mountPage(<OnboardingPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the onboarding.view permission/)).toBeInTheDocument();
  });
  it('queue API failure shows an error state', async () => {
    await mountPage(<OnboardingPage />, { routes: base({ 'GET /api/v1/client-ops/onboarding/queue': fail(500, 'x', 'Queue down') }) });
    expect(await screen.findByText(/Could not load the onboarding queue: Queue down/)).toBeInTheDocument();
  });
});

describe('Onboarding case review', () => {
  const open = async (w: Record<string, unknown>, perms: string[], user?: Record<string, unknown>) => {
    const m = await mountPage(<OnboardingPage />, {
      perms, user,
      routes: base({
        'GET /api/v1/client-ops/onboarding/cases/:id/workup': raw(w),
        'POST /api/v1/client-ops/onboarding/cases/:id/checks': raw({}), 'POST /api/v1/client-ops/onboarding/cases/:id/risk': raw({}),
        'POST /api/v1/client-ops/onboarding/risk/:id/approve': raw({}), 'POST /api/v1/client-ops/onboarding/risk/:id/reject': raw({}),
        'POST /api/v1/kyc/cases/:id/decision': raw({}), 'POST /api/v1/kyc/cases/:id/activate': raw({}), 'POST /api/v1/kyc/cases/:id/advance': raw({}),
      }),
    });
    await m.user.click(await screen.findByText('Jane Applicant'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('INO-025: zero checks run shows a "Provisional" warning above the risk rating (not a clean Low)', async () => {
    const { dlg } = await open(workup(), VIEW);
    expect(await within(dlg).findByText(/Provisional: 0 of 8 provider checks have been recorded/)).toBeInTheDocument();
    expect(within(dlg).getByText(/not a clearance/)).toBeInTheDocument();
  });
  it('INO-025: no warning once checks are complete', async () => {
    const { dlg } = await open(workup({ riskPreview: { score: 10, rating: 'Low', factors: [], provisional: false, checksRun: 8, checksTotal: 8 } }), VIEW);
    await within(dlg).findByText(/Computed now/);
    expect(within(dlg).queryByText(/Provisional/)).not.toBeInTheDocument();
  });
  it('open gates, check outcomes with names, history count, not-done label', async () => {
    const { dlg } = await open(workup(), VIEW);
    expect(await within(dlg).findByText(/Open gates: Risk rating not approved/)).toBeInTheDocument();
    expect(within(dlg).getByText('Not done')).toBeInTheDocument();
    expect(within(dlg).getByText('2 entries')).toBeInTheDocument();
    expect(within(dlg).getByText('Application submitted')).toBeInTheDocument();
  });
  it('viewer cannot record checks or propose ratings (no manage controls)', async () => {
    const { dlg } = await open(workup(), VIEW);
    await within(dlg).findByText(/Computed now/);
    expect(within(dlg).queryByRole('button', { name: 'Record check' })).not.toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Propose risk rating' })).not.toBeInTheDocument();
  });
  it('analyst records a check: kind/outcome/provider/notes posted with an idempotency key', async () => {
    const { user, api, dlg } = await open(workup(), [...VIEW, 'onboarding.manage']);
    await user.click(await within(dlg).findByRole('button', { name: 'Record check' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.selectOptions(within(f).getByLabelText('Outcome'), 'REFER');
    await user.type(within(f).getByLabelText(/^Notes/), 'Name match');
    await user.click(within(f).getByRole('button', { name: 'Record' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/onboarding/cases/cs1/checks'));
    expectBody(req!, { kind: 'SANCTIONS', outcome: 'REFER', notes: 'Name match' });
    expectIdempotencyKey(req!);
  });
  it('maker cannot approve their own risk assessment (sees "Awaiting a different approver"); another approver approves with a required note', async () => {
    const own = await open(workup({ assessments: [{ ...workup().assessments[0], makerId: 'usr_admin' }] }), [...VIEW, 'onboarding.approve']);
    expect(await within(own.dlg).findByText('Awaiting a different approver')).toBeInTheDocument();
    expect(within(own.dlg).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    own.unmount();
    const { user, api, dlg } = await open(workup(), [...VIEW, 'onboarding.approve']);
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    const note = screen.getByLabelText(/^Note/);
    expect(note).toBeRequired();
    await user.type(note, 'Agree');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/onboarding/risk/ra1/approve'));
    expectBody(req!, { note: 'Agree' });
  });
  it('record decision only for compliance role; sends decision, reason and case version', async () => {
    const roles = [{ portal: 'admin', key: 'compliance', label: 'Compliance' }];
    const none = await open(workup(), [...VIEW, 'onboarding.manage']);
    await within(none.dlg).findByText(/Computed now/);
    expect(within(none.dlg).queryByRole('button', { name: 'Record decision' })).not.toBeInTheDocument();
    none.unmount();
    const { user, api, dlg } = await open(workup(), [...VIEW, 'onboarding.manage'], { roles });
    await user.click(await within(dlg).findByRole('button', { name: 'Record decision' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/Basis for the decision/), 'All checks clear');
    await user.click(within(f).getByRole('button', { name: 'Record decision' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/kyc/cases/cs1/decision'));
    expectBody(req!, { decision: 'approve', reason: 'All checks clear', version: 3 });
    expectIdempotencyKey(req!);
  });
  it('approved case offers Activate client', async () => {
    const { user, api, dlg } = await open(workup({ case: { ...workup().case, stage: 'Approved' } }), [...VIEW, 'onboarding.manage']);
    await user.click(await within(dlg).findByRole('button', { name: 'Activate client' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/kyc/cases/cs1/activate'));
  });
  it('closed cases (Active/Rejected) offer no mutation controls', async () => {
    const { dlg } = await open(workup({ case: { ...workup().case, stage: 'Active' } }), [...VIEW, 'onboarding.manage']);
    await within(dlg).findByText(/Computed now/);
    expect(within(dlg).queryByRole('button', { name: 'Record check' })).not.toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Move stage' })).not.toBeInTheDocument();
  });
  it('AI triage panel: empty state; run triage for managers; advisory label', async () => {
    const { user, api, dlg } = await open(workup(), [...VIEW, 'onboarding.manage']);
    expect(await within(dlg).findByText('No triage has been run for this case.')).toBeInTheDocument();
    expect(within(dlg).getByText('advisory only')).toBeInTheDocument();
    api.on('POST /api/v1/client-ops/onboarding/cases/:id/triage', raw({}));
    await user.click(within(dlg).getByRole('button', { name: 'Run triage' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/client-ops/onboarding/cases/cs1/triage'));
  });
});

describe('Onboarding risk scoring configuration (ADB-012)', () => {
  it('approver sees Edit on each factor; the edit form requires a reason and PUTs points/enabled/threshold', async () => {
    const { user, api } = await mountPage(<OnboardingPage />, { perms: [...VIEW, 'onboarding.approve'], routes: base({ 'PUT /api/v1/client-ops/onboarding/risk-factors/:key': raw({}) }) });
    const edits = await screen.findAllByRole('button', { name: 'Edit' });
    expect(edits.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Threshold 100,000')).toBeInTheDocument();
    await user.click(edits.at(-1)!);
    const f = screen.getAllByRole('dialog').at(-1)!;
    expect(within(f).getByLabelText(/^Reason/)).toBeRequired();
    await user.type(within(f).getByLabelText(/^Reason/), 'Align with policy');
    await user.click(within(f).getByRole('button', { name: 'Save' }));
    const [req] = await waitFor(() => expectCalled(api, 'PUT /api/v1/client-ops/onboarding/risk-factors/amount'));
    expectBody(req!, { points: 10, enabled: false, reason: 'Align with policy', params: { threshold: 100000 } });
  });
  it('ADB-012: for a user without onboarding.approve the risk scoring table still shows Edit, disabled, with the permission named', async () => {
    const { api } = await mountPage(<OnboardingPage />, { perms: VIEW, routes: base() });
    const edits = await screen.findAllByRole('button', { name: 'Edit' });
    expect(edits.length).toBe(2);
    for (const b of edits) {
      expect(b).toBeDisabled();
      expect(b).toHaveAttribute('title', 'Needs the onboarding.approve permission');
    }
    expect(screen.getByText(/Needs onboarding\.approve/)).toBeInTheDocument();
    expectNotCalled(api, 'PUT /api/v1/client-ops/onboarding/risk-factors/pep');
  });
});
