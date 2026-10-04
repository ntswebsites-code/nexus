import { describe, it, expect } from 'vitest';
import ModelGovernancePage from '@/app/(ops)/ops/model-governance/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const model = (o: Record<string, unknown> = {}) => ({ id: 'm1', ref: 'MDL-1001', name: 'Equity pricing model', purpose: 'Price equities', modelType: 'PRICING', tier: 1, ownerName: 'Owen O', status: 'APPROVED', currentVersion: '1.2', inFlightVersion: { id: 'v3', version: '1.3', status: 'IN_VALIDATION' }, nextReviewOn: '2026-12-01', reviewOverdue: true, usageCount: 14, lastUsedAt: null, ...o });
const version = (o: Record<string, unknown> = {}) => ({ id: 'v3', version: '1.3', status: 'IN_VALIDATION', changeNote: 'Recalibrated', documentation: 'DOC-12', author: 'Author A', submittedAt: null, approvedBy: null, approvedAt: null, decisionNote: null, isCurrent: false, validations: [{ id: 'va1', validator: 'Val V', outcome: 'PASS_WITH_FINDINGS', scope: 'Backtest', findings: 'Minor drift', evidenceRef: 'EV-1', performedOn: '2026-08-01' }], actions: { submit: false, validate: false, approve: false, reject: false }, ...o });
const detail = (v = version(), o: Record<string, unknown> = {}) => ({ ...model(), createdBy: 'Reg R', versionList: [v], timeline: [], ...o });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/model-governance/models': raw({ data: [model(), model({ id: 'm2', ref: 'MDL-1002', name: 'Credit scoring', status: 'DRAFT', currentVersion: null, inFlightVersion: null, reviewOverdue: false })], total: 2 }),
  'GET /api/v1/model-governance/summary': ok({ byStatus: { APPROVED: 3 }, byTier: {}, reviewsOverdue: 1, awaitingValidation: 2, awaitingApproval: 1, usesLast30Days: 40 }),
  'GET /api/v1/model-governance/models/:id': ok(detail()),
  'GET /api/v1/model-governance/reviews': raw({ data: [{ id: 'rv1', modelId: 'm1', modelRef: 'MDL-1001', modelName: 'Equity pricing model', tier: 1, status: 'SUBMITTED', dueOn: '2026-09-01', overdue: true, openedBy: 'Opener O', reviewer: 'Rev R', outcome: 'CONFIRMED', findings: 'None', approver: null, decisionNote: null, nextReviewOn: null, completedAt: null }, { id: 'rv2', modelId: 'm2', modelRef: 'MDL-1002', modelName: 'Credit scoring', tier: 2, status: 'OPEN', dueOn: '2026-10-01', overdue: false, openedBy: 'Opener O', reviewer: null, outcome: null, findings: null, approver: null, decisionNote: null, nextReviewOn: null, completedAt: null }] }),
  'GET /api/v1/model-governance/bindings': raw({ data: [{ purpose: 'NAV_VALUATION', modelId: 'm1', modelRef: 'MDL-1001', modelName: 'Equity pricing model', modelStatus: 'APPROVED', nextReviewOn: '2026-12-01', enforce: true, automaticUses30d: 9 }, { purpose: 'RISK_SCENARIO', modelId: null, modelRef: null, modelName: null, modelStatus: null, nextReviewOn: null, enforce: false, automaticUses30d: 0 }] }),
  'GET /api/v1/model-governance/usage': raw({ data: [{ id: 'u1', modelRef: 'MDL-1001', modelName: 'Equity pricing model', version: '1.2', context: 'NAV close', objectRef: 'NAV-1', note: null, usedBy: 'Use U', usedAt: '2026-08-26T10:00:00Z' }], total: 1 }),
  ...o,
});
const VIEW = ['risk.view'];

describe('Model governance inventory (ADB-023: refs stay MDL-)', () => {
  it('shows tiles, models with MDL- refs, version in flight, overdue flag and status', async () => {
    await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base() });
    expect(await screen.findByText('Equity pricing model')).toBeInTheDocument();
    expect(screen.getByText('MDL-1001')).toBeInTheDocument();
    expect(screen.getByText('MDL-1002')).toBeInTheDocument();
    expect(screen.queryByText(/PMD-/)).not.toBeInTheDocument();
    expect(screen.getByText('v1.3 In validation')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    expect(screen.getByText('Awaiting validation').parentElement).toHaveTextContent('2');
  });
  it('Register model only for authors (risk.manage); posts the full payload with a key', async () => {
    const v = await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base() });
    await screen.findByText('Equity pricing model');
    expect(screen.queryByRole('button', { name: 'Register model' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await mountPage(<ModelGovernancePage />, { perms: [...VIEW, 'risk.manage'], routes: base({ 'POST /api/v1/model-governance/models': ok({ id: 'm9' }, 201) }) });
    await user.click(await screen.findByRole('button', { name: 'Register model' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Name/), 'Scoring v2');
    await user.type(within(dlg).getByLabelText(/^Purpose/), 'Score clients');
    await user.type(within(dlg).getByLabelText(/^Owner/), 'Olga');
    await user.click(within(dlg).getByRole('button', { name: /Register|Create/ }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/models'));
    expectBody(req!, { name: 'Scoring v2', purpose: 'Score clients', ownerName: 'Olga' });
    expectIdempotencyKey(req!);
  });
  it('no permission message; empty inventory and error', async () => {
    const a = await mountPage(<ModelGovernancePage />, { perms: [], routes: base() });
    expect(await screen.findByText('You do not have permission to view model governance.')).toBeInTheDocument();
    a.unmount();
    const b = await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base({ 'GET /api/v1/model-governance/models': raw({ data: [], total: 0 }) }) });
    expect(await screen.findByText('No models registered.')).toBeInTheDocument();
    b.unmount();
    await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base({ 'GET /api/v1/model-governance/models': fail(500, 'x', 'Registry offline') }) });
    expect(await screen.findByText(/Registry offline/)).toBeInTheDocument();
  });
});

describe('Model governance: versions, three-person control', () => {
  const open = async (d: ReturnType<typeof detail>, perms: string[], routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<ModelGovernancePage />, { perms, routes: base({ 'GET /api/v1/model-governance/models/:id': ok(d), ...routes }) });
    await m.user.click((await screen.findAllByRole('button', { name: 'Open' }))[0]!);
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('detail lists versions with validations (validator and findings) and the model facts', async () => {
    const { dlg } = await open(detail(), VIEW);
    expect(await within(dlg).findByText('Version 1.3')).toBeInTheDocument();
    expect(within(dlg).getByText('Val V')).toBeInTheDocument();
    expect(within(dlg).getByText('Minor drift')).toBeInTheDocument();
    expect(within(dlg).getByText('MDL-1001 - Equity pricing model')).toBeInTheDocument();
  });
  it('server action flags drive the buttons: author submit, validator validate, approver approve/reject (and nobody sees buttons they cannot use)', async () => {
    const none = await open(detail(), VIEW);
    await within(none.dlg).findByText('Version 1.3');
    for (const n of ['Submit for validation', 'Record validation', 'Approve', 'Reject']) expect(within(none.dlg).queryByRole('button', { name: n })).not.toBeInTheDocument();
    none.unmount();
    const a = await open(detail(version({ actions: { submit: true, validate: false, approve: false, reject: false } })), VIEW, { 'POST /api/v1/model-governance/versions/:id/submit': ok({}) });
    await a.user.click(await within(a.dlg).findByRole('button', { name: 'Submit for validation' }));
    await waitFor(() => expectCalled(a.api, 'POST /api/v1/model-governance/versions/v3/submit'));
  });
  it('approve asks an in-app confirm naming model and version, then posts with an idempotency key', async () => {
    const { user, api, dlg } = await open(detail(version({ actions: { submit: false, validate: false, approve: true, reject: true } })), VIEW, { 'POST /api/v1/model-governance/versions/:id/approve': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    expect(within(screen.getAllByRole('dialog').at(-1)!).getByText('Approve Equity pricing model v1.3 for use?')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/model-governance/versions/v3/approve');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/versions/v3/approve'));
    expectIdempotencyKey(req!);
  });
  it('SoD refusal (author tries to approve) shows the different-approver wording', async () => {
    const { user, dlg } = await open(detail(version({ actions: { submit: false, validate: false, approve: true, reject: false } })), VIEW, { 'POST /api/v1/model-governance/versions/:id/approve': fail(409, 'segregation_of_duties', 'Author cannot approve') });
    await user.click(await within(dlg).findByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('A different approver is required. Author cannot approve')).toBeInTheDocument();
  });
  it('record validation posts outcome, scope and findings; reject requires a reason', async () => {
    const { user, api, dlg } = await open(detail(version({ actions: { submit: false, validate: true, approve: false, reject: true } })), VIEW, { 'POST /api/v1/model-governance/versions/:id/validations': ok({}), 'POST /api/v1/model-governance/versions/:id/reject': ok({}) });
    await user.click(await within(dlg).findByRole('button', { name: 'Record validation' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Scope tested/), 'Full backtest');
    await user.click(within(f).getByRole('button', { name: 'Record validation' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/versions/v3/validations'));
    expectBody(req!, { scope: 'Full backtest' });
    await user.click(await within(dlg).findByRole('button', { name: 'Reject' }));
    const reason = screen.getAllByRole('dialog').at(-1)!.querySelector('textarea')!;
    expect(reason).toBeRequired();
    await user.type(reason, 'Backtest fails');
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Reject' }));
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/versions/v3/reject'));
    expectBody(r!, { reason: 'Backtest fails' });
  });
  it('Log usage is only for approved models; Retire only for approvers; Draft new version only when nothing is in flight', async () => {
    const approved = await open(detail(version(), { inFlightVersion: null }), ['risk.view', 'risk.manage', 'model.approve']);
    expect(await within(approved.dlg).findByRole('button', { name: 'Log usage' })).toBeInTheDocument();
    expect(within(approved.dlg).getByRole('button', { name: 'Retire model' })).toBeInTheDocument();
    expect(within(approved.dlg).getByRole('button', { name: 'Draft new version' })).toBeInTheDocument();
    approved.unmount();
    const flight = await open(detail(), ['risk.view', 'risk.manage']);
    await within(flight.dlg).findByText('Version 1.3');
    expect(within(flight.dlg).queryByRole('button', { name: 'Draft new version' })).not.toBeInTheDocument();
    expect(within(flight.dlg).queryByRole('button', { name: 'Retire model' })).not.toBeInTheDocument();
    flight.unmount();
    const draft = await open(detail(version(), { status: 'DRAFT' }), ['risk.view', 'risk.manage']);
    await within(draft.dlg).findByText('Version 1.3');
    expect(within(draft.dlg).queryByRole('button', { name: 'Log usage' })).not.toBeInTheDocument();
  });
  it('usage warning from the API is shown after logging a use of a model with an overdue review', async () => {
    const { user, dlg } = await open(detail(version(), { inFlightVersion: null }), ['risk.view', 'risk.manage'], { 'POST /api/v1/model-governance/models/:id/usage': raw({ warning: 'The periodic review is overdue' }) });
    await user.click(await within(dlg).findByRole('button', { name: 'Log usage' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    await user.type(within(f).getByLabelText(/^Used for/), 'NAV pricing');
    await user.click(within(f).getByRole('button', { name: /Log|Record/ }));
    expect(await within(dlg).findByText(/The periodic review is overdue/)).toBeInTheDocument();
  });
});

describe('Model governance: reviews, bindings, usage', () => {
  it('reviews: overdue flag, people involved, approve/return only for reviewers with model.approve', async () => {
    const v = await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base() });
    await v.user.click(await screen.findByRole('tab', { name: 'Periodic reviews' }));
    expect(await screen.findByText('Reviewer Rev R')).toBeInTheDocument();
    expect(screen.getAllByText('Opened by Opener O').length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    v.unmount();
    const { user, api } = await mountPage(<ModelGovernancePage />, { perms: [...VIEW, 'model.approve'], routes: base({ 'POST /api/v1/model-governance/reviews/:id/approve': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Periodic reviews' }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const f = screen.getAllByRole('dialog').at(-1)!;
    const note = f.querySelector('textarea')!;
    await user.type(note, 'Reviewed');
    await user.click(within(f).getByRole('button', { name: /Approve/ }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/reviews/rv1/approve'));
    expectBody(req!, { note: 'Reviewed' });
    expect(screen.getAllByRole('button', { name: 'Record outcome' }).length).toBe(1);
  });
  it('authors can open reviews due within 30 days and send reminders', async () => {
    const { user, api } = await mountPage(<ModelGovernancePage />, { perms: [...VIEW, 'risk.manage'], routes: base({ 'POST /api/v1/model-governance/reviews/sweep': ok({}), 'POST /api/v1/model-governance/reviews/remind': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Periodic reviews' }));
    await user.click(await screen.findByRole('button', { name: 'Open reviews due within 30 days' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/reviews/sweep'));
    await user.click(screen.getByRole('button', { name: 'Send due-date reminders' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/model-governance/reviews/remind'));
  });
  it('bindings: names the calculation in words, shows bound model with status and enforcement; unbound is explicit; approvers can bind/unbind (confirm)', async () => {
    const { user, api } = await mountPage(<ModelGovernancePage />, { perms: [...VIEW, 'model.approve'], routes: base({ 'DELETE /api/v1/model-governance/bindings/:purpose': raw({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Where models are used' }));
    expect(await screen.findByText('NAV valuation runs')).toBeInTheDocument();
    expect(screen.getByText('Not bound')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bind a model' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unbind' }));
    expect(within(screen.getByRole('dialog')).getByText(/Stop logging this calculation/)).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Unbind' }));
    await waitFor(() => expectCalled(api, 'DELETE /api/v1/model-governance/bindings/NAV_VALUATION'));
  });
  it('usage log lists who used which model version, context and object', async () => {
    const { user } = await mountPage(<ModelGovernancePage />, { perms: VIEW, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Usage log' }));
    expect(await screen.findByText('NAV close')).toBeInTheDocument();
    expect(screen.getByText('Use U')).toBeInTheDocument();
  });
});
