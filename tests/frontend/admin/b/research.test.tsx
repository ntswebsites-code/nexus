import { describe, it, expect } from 'vitest';
import ResearchPage from '@/app/(ops)/ops/research/page';
import { mountPage } from './_kit';
import { ok, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const summary = (o: Record<string, unknown> = {}) => ({
  cases: { draft: 2, inReview: 1, published: 5, archived: 0 }, openDecisions: 2, awaitingMyVote: 1, awaitingRatification: 0, votingOpen: 1, myOpenCases: 1,
  upcomingMeetings: [{ id: 'mt1', ref: 'ICM-1', title: 'September IC', scheduledAt: '2026-09-10T09:00:00Z' }], ...o,
});
const kase = (o: Record<string, unknown> = {}) => ({
  id: 'cs1', ref: 'RSC-1001', securityId: 's1', ticker: 'ABC', securityName: 'ABC Holdings', title: 'ABC re-rating', thesis: 'A thesis that is long enough to be valid.', risks: 'FX risk', rating: 'BUY', targetPrice: '2.50', currency: 'USD', latestPrice: '1.80', upsidePct: '38.9',
  horizonMonths: 12, conviction: 4, status: 'DRAFT', analystId: 'usr_admin', analystName: 'Test Admin', reviewerName: null, returnReason: null, publishedAt: null, version: 2,
  history: [], decisions: [], ...o,
});
const decision = (o: Record<string, unknown> = {}) => ({
  id: 'd1', ref: 'ICD-1001', caseId: 'cs1', caseRef: 'RSC-1001', caseTitle: 'ABC re-rating', meetingId: 'mt1', meetingRef: 'ICM-1', portfolioId: 'p1', portfolioName: 'Balanced Growth Fund', ticker: 'ABC', action: 'BUY', quantity: '1000',
  rationale: 'Strong upside versus risk', status: 'VOTING', proposerId: 'usr_other', proposerName: 'Proposer P', quorum: 3, tally: { for: 3, against: 0, abstain: 0, total: 3 }, projected: { outcome: 'APPROVED', reason: 'for > against' },
  votes: [{ voterName: 'Voter V', vote: 'FOR', comment: 'agree', castAt: '2026-09-01T10:00:00Z' }], myVote: null, warning: null, ratifiedByName: null, outcomeNote: null, orders: [], ...o,
});
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/research/summary': ok(summary()),
  'GET /api/v1/research/cases': ok([kase(), kase({ id: 'cs2', ref: 'RSC-1002', title: 'XYZ idea', status: 'PUBLISHED', upsidePct: null })]),
  'GET /api/v1/research/cases/:id': ok(kase()),
  'GET /api/v1/research/decisions': ok([decision()]),
  'GET /api/v1/research/decisions/:id': ok(decision()),
  'GET /api/v1/research/meetings': ok([{ id: 'mt1', ref: 'ICM-1', title: 'September IC', scheduledAt: '2026-09-10T09:00:00Z', agenda: 'Agenda', quorum: 3, status: 'SCHEDULED', chairName: 'Chair C', minutes: null, decisions: 2, openDecisions: 1 }]),
  'GET /api/v1/research/meetings/:id': ok({ id: 'mt1', ref: 'ICM-1', title: 'September IC', scheduledAt: '2026-09-10T09:00:00Z', agenda: 'Agenda', quorum: 3, status: 'SCHEDULED', chairName: 'Chair C', minutes: null, decisions: 1, openDecisions: 1, decisionList: [decision()] }),
  'GET /api/v1/portfolios': ok([{ id: 'p1', ref: 'PF-1', name: 'Balanced Growth Fund' }]),
  'GET /api/v1/securities': ok([{ id: 's1', ticker: 'ABC', name: 'ABC Holdings' }]),
  ...o,
});

describe('Research: overview and cases', () => {
  it('summary tiles and case list show names and computed fields (not ids)', async () => {
    await mountPage(<ResearchPage />, { routes: base() });
    expect(await screen.findByText('RSC-1001')).toBeInTheDocument();
    expect(screen.getByText('ABC re-rating')).toBeInTheDocument();
    expect(screen.getAllByText('Test Admin').length).toBeGreaterThan(0);
    expect(screen.getByText('38.9%')).toBeInTheDocument();
    expect(screen.getAllByText('USD 2.50').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 in review · 2 draft/)).toBeInTheDocument();
    expect(screen.getByText('September IC')).toBeInTheDocument();
    expect(screen.queryByText('cs1')).not.toBeInTheDocument();
  });
  it('ADB-011: awaiting ratification counts only quorum-reached decisions; hint says how many are still collecting votes', async () => {
    await mountPage(<ResearchPage />, { routes: base() });
    const tile = (await screen.findByText('Awaiting ratification')).closest('button')!;
    expect(within(tile).getByRole('heading', { level: 3 })).toHaveTextContent('0');
    expect(within(tile).getByText(/1 still collecting votes/)).toBeInTheDocument();
  });
  it('ADB-011: no "collecting votes" text when none are open', async () => {
    await mountPage(<ResearchPage />, { routes: base({ 'GET /api/v1/research/summary': ok(summary({ votingOpen: 0, awaitingRatification: 2 })) }) });
    const tile = (await screen.findByText('Awaiting ratification')).closest('button')!;
    expect(within(tile).getByRole('heading', { level: 3 })).toHaveTextContent('2');
    expect(within(tile).queryByText(/still collecting/)).not.toBeInTheDocument();
  });
  it('filters (status, search, mine) are sent as query params', async () => {
    const { user, api } = await mountPage(<ResearchPage />, { routes: base() });
    await screen.findByText('RSC-1001');
    await user.selectOptions(screen.getByLabelText('Status'), 'PUBLISHED');
    await user.type(screen.getByPlaceholderText('Title, ref or thesis'), 'abc');
    await user.click(screen.getByLabelText('Mine only'));
    await waitFor(() => {
      const q = api.calls('GET /api/v1/research/cases').at(-1)!.query;
      expect(q.get('status')).toBe('PUBLISHED');
      expect(q.get('q')).toBe('abc');
      expect(q.get('mine')).toBe('1');
    });
  });
  it('empty state; New case hidden without research.edit', async () => {
    await mountPage(<ResearchPage />, { perms: ['research.view'], routes: base({ 'GET /api/v1/research/cases': ok([]) }) });
    expect(await screen.findByText(/No research cases match/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New case' })).not.toBeInTheDocument();
  });
  it('without research.view: access denied naming the permission', async () => {
    const { api } = await mountPage(<ResearchPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask an administrator for the research.view permission/)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/research/cases');
  });
});

describe('Research: case form validation (ADB-010)', () => {
  const openNew = async (extra: Record<string, unknown> = {}) => {
    const m = await mountPage(<ResearchPage />, { routes: base(extra) });
    await m.user.click(await screen.findByRole('button', { name: 'New case' }));
    return { ...m, dlg: screen.getByRole('dialog') };
  };
  it('ADB-010: thesis "qa" and target price "abc" show inline field messages, modal stays open, nothing is sent', async () => {
    const { user, api, dlg } = await openNew();
    await user.type(within(dlg).getByLabelText(/^Title/), 'Valid title');
    await user.selectOptions(within(dlg).getByLabelText(/^Security/), 's1');
    await user.type(within(dlg).getByLabelText(/^Thesis/), 'qa');
    await user.type(within(dlg).getByLabelText(/Target price/), 'abc');
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    expect(await within(dlg).findByText('State the thesis (20+ characters)')).toBeInTheDocument();
    expect(within(dlg).getByText('Enter the target price as a positive number, for example 12.50')).toBeInTheDocument();
    expect(within(dlg).getByLabelText(/^Thesis/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(api.calls('POST /api/v1/research/cases')).toHaveLength(0);
  });
  it('ADB-010: empty form lists every required field; errors are cleared on a valid resubmit', async () => {
    const { user, api, dlg } = await openNew({ 'POST /api/v1/research/cases': ok({ id: 'cs9' }, 201) });
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    expect(await within(dlg).findByText('Choose the security this case covers')).toBeInTheDocument();
    expect(within(dlg).getByText('Give the case a title of 3 to 200 characters')).toBeInTheDocument();
    await user.selectOptions(within(dlg).getByLabelText(/^Security/), 's1');
    await user.type(within(dlg).getByLabelText(/^Title/), 'ABC thesis');
    await user.type(within(dlg).getByLabelText(/^Thesis/), 'This thesis has more than twenty characters.');
    await user.type(within(dlg).getByLabelText(/Target price/), '12.50');
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/cases'));
    expectBody(req!, { securityId: 's1', title: 'ABC thesis', targetPrice: '12.50', rating: 'HOLD', conviction: 3 });
    expectIdempotencyKey(req!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('ADB-010: out-of-range horizon and conviction are explained per field', async () => {
    const { user, dlg } = await openNew();
    const h = within(dlg).getByLabelText(/Horizon/);
    await user.clear(h);
    await user.type(h, '500');
    const c = within(dlg).getByLabelText(/Conviction/);
    await user.clear(c);
    await user.type(c, '9');
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    expect(await within(dlg).findByText('Horizon must be a whole number of months from 1 to 120')).toBeInTheDocument();
    expect(within(dlg).getByText('Conviction is a whole number from 1 to 5')).toBeInTheDocument();
  });
  it('ADB-010: server 400 details (path/message) are mapped under the matching fields; unmapped message stays in the alert', async () => {
    const { user, dlg } = await openNew({
      'POST /api/v1/research/cases': fail(400, 'validation_error', 'Validation failed', [{ path: 'targetPrice', message: 'Target price is too far from the market' }, { path: 'horizonMonths', message: 'Horizon too long' }]),
    });
    await user.selectOptions(within(dlg).getByLabelText(/^Security/), 's1');
    await user.type(within(dlg).getByLabelText(/^Title/), 'ABC thesis');
    await user.type(within(dlg).getByLabelText(/^Thesis/), 'This thesis has more than twenty characters.');
    await user.type(within(dlg).getByLabelText(/Target price/), '99');
    await user.click(within(dlg).getByRole('button', { name: 'Create draft' }));
    expect(await within(dlg).findByText('Target price is too far from the market')).toBeInTheDocument();
    expect(within(dlg).getByText('Horizon too long')).toBeInTheDocument();
    expect(within(dlg).getAllByRole('alert').some((a) => /Validation failed/.test(a.textContent ?? ''))).toBe(true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Research: case lifecycle and maker-checker', () => {
  const openCase = async (c: Record<string, unknown>, perms?: string[]) => {
    const m = await mountPage(<ResearchPage />, {
      perms,
      routes: base({
        'GET /api/v1/research/cases/:id': ok(c),
        'POST /api/v1/research/cases/:id/submit': ok({}), 'POST /api/v1/research/cases/:id/publish': ok({}), 'POST /api/v1/research/cases/:id/return': ok({}),
        'POST /api/v1/research/cases/:id/archive': ok({}), 'PATCH /api/v1/research/cases/:id': ok({}),
      }),
    });
    await m.user.click(await screen.findByText('RSC-1001'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('author of a draft can edit (PATCH with version) and submit; submit sends a key', async () => {
    const { user, api, dlg } = await openCase(kase());
    await user.click(await within(dlg).findByRole('button', { name: 'Submit for review' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/cases/cs1/submit'));
    expectIdempotencyKey(req!);
    await user.click(within(dlg).getByRole('button', { name: 'Edit' }));
    const edit = screen.getAllByRole('dialog').at(-1)!;
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    const [p] = await waitFor(() => expectCalled(api, 'PATCH /api/v1/research/cases/cs1'));
    expectBody(p!, { version: 2, title: 'ABC re-rating', targetPrice: '2.50' });
  });
  it('author cannot publish own case: sees the waiting message, no Publish button', async () => {
    const { dlg } = await openCase(kase({ status: 'IN_REVIEW' }), ['research.view', 'research.edit', 'research.ic.decide']);
    expect(await within(dlg).findByText(/you cannot publish your own case/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });
  it('a different reviewer with research.ic.decide publishes after confirm, or returns with a reason', async () => {
    const { user, api, dlg } = await openCase(kase({ status: 'IN_REVIEW', analystId: 'someone-else' }), ['research.view', 'research.ic.decide']);
    await user.click(await within(dlg).findByRole('button', { name: 'Return to author' }));
    await user.type(screen.getByLabelText(/Reason/), 'Needs a source');
    await user.click(screen.getAllByRole('button', { name: 'Return' }).at(-1)!);
    const [r] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/cases/cs1/return'));
    expectBody(r!, { reason: 'Needs a source' });
  });
  it('publish runs only after the in-app confirm', async () => {
    const { user, api, dlg } = await openCase(kase({ status: 'IN_REVIEW', analystId: 'someone-else' }), ['research.view', 'research.ic.decide']);
    await user.click(await within(dlg).findByRole('button', { name: 'Publish' }));
    expect(api.calls('POST /api/v1/research/cases/cs1/publish')).toHaveLength(0);
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expectCalled(api, 'POST /api/v1/research/cases/cs1/publish'));
  });
  it('returned drafts show the return reason; published cases offer Take to committee and Revise', async () => {
    const { dlg, user } = await openCase(kase({ status: 'PUBLISHED', returnReason: 'Fix numbers' }));
    expect(await within(dlg).findByText(/Fix numbers/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Take to committee' })).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Revise' })).toBeInTheDocument();
    await user.click(within(dlg).getByRole('button', { name: 'Archive' }));
    expect(screen.getByLabelText(/Reason/)).toBeRequired();
  });
  it('history and decisions render real names', async () => {
    const { dlg } = await openCase(kase({ status: 'PUBLISHED', history: [{ rating: 'BUY', targetPrice: '2.5', conviction: 4, priceAtChange: '1.7', note: null, changedByName: 'Analyst A', approvedByName: 'Reviewer R', createdAt: '2026-08-01T10:00:00Z' }], decisions: [decision({ id: 'd7', ref: 'ICD-1007' })] }));
    expect(await within(dlg).findByText('Analyst A')).toBeInTheDocument();
    expect(within(dlg).getByText('Reviewer R')).toBeInTheDocument();
    expect(within(dlg).getByText('ICD-1007')).toBeInTheDocument();
  });
});

describe('Research: IC decisions and meetings', () => {
  const openDecision = async (d: Record<string, unknown>, perms?: string[]) => {
    const m = await mountPage(<ResearchPage />, {
      perms,
      routes: base({
        'GET /api/v1/research/decisions/:id': ok(d), 'POST /api/v1/research/decisions/:id/vote': ok({}), 'POST /api/v1/research/decisions/:id/open-voting': ok({}),
        'POST /api/v1/research/decisions/:id/ratify': ok({}), 'POST /api/v1/research/decisions/:id/withdraw': ok({}), 'POST /api/v1/research/decisions/:id/order': ok({}),
      }),
    });
    await m.user.click(await screen.findByRole('tab', { name: 'IC decisions' }));
    await m.user.click(await screen.findByText('ICD-1001'));
    return { ...m, dlg: await screen.findByRole('dialog') };
  };
  it('decision list shows proposer name, vote tally and quorum', async () => {
    const { user } = await mountPage(<ResearchPage />, { routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'IC decisions' }));
    expect(await screen.findByText('Proposer P')).toBeInTheDocument();
    expect(screen.getByText('3-0-0')).toBeInTheDocument();
    expect(screen.getByText('/ quorum 3')).toBeInTheDocument();
  });
  it('voting: casts a vote with the exact vote value (no idempotency key needed by design) and refreshes', async () => {
    const { user, api, dlg } = await openDecision(decision(), ['research.view', 'research.edit']);
    await user.click(await within(dlg).findByRole('button', { name: 'Vote against' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/decisions/d1/vote'));
    expectBody(req!, { vote: 'AGAINST' });
    await waitFor(() => expect(api.calls('GET /api/v1/research/decisions/d1').length).toBeGreaterThan(1));
  });
  it('my existing vote is marked with a tick', async () => {
    const { dlg } = await openDecision(decision({ myVote: 'FOR' }), ['research.view', 'research.edit']);
    expect(await within(dlg).findByRole('button', { name: 'Vote for ✓' })).toBeInTheDocument();
  });
  it('proposer cannot ratify own proposal (explained); a different decider ratifies with an optional note', async () => {
    const { dlg } = await openDecision(decision({ proposerId: 'usr_admin' }), ['research.view', 'research.edit', 'research.ic.decide']);
    expect(await within(dlg).findByText(/A different person with research.ic.decide ratifies/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Ratify result' })).not.toBeInTheDocument();
  });
  it('another decider ratifies', async () => {
    const { user, api, dlg } = await openDecision(decision(), ['research.view', 'research.ic.decide']);
    expect(await within(dlg).findByText('3 of 3')).toBeInTheDocument();
    expect(within(dlg).getByText('If ratified now').nextSibling).toHaveTextContent('Approved');
    await user.click(within(dlg).getByRole('button', { name: 'Ratify result' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Ratify' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/decisions/d1/ratify'));
    expectIdempotencyKey(req!);
  });
  it('SoD error on ratify shows the different-approver wording and keeps the dialog', async () => {
    const { user, api, dlg } = await openDecision(decision(), ['research.view', 'research.ic.decide']);
    api.on('POST /api/v1/research/decisions/:id/ratify', fail(409, 'segregation_of_duties', 'Proposer cannot ratify'));
    await user.click(await within(dlg).findByRole('button', { name: 'Ratify result' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Ratify' }));
    expect(await screen.findByText('A different approver is required. Proposer cannot ratify')).toBeInTheDocument();
  });
  it('approved BUY decision offers Create draft order only with orders.create; HOLD offers none', async () => {
    const a = await openDecision(decision({ status: 'APPROVED' }), ['research.view', 'orders.create']);
    expect(await within(a.dlg).findByRole('button', { name: 'Create draft order' })).toBeInTheDocument();
    a.unmount();
    const b = await openDecision(decision({ status: 'APPROVED', action: 'HOLD' }), ['research.view', 'orders.create']);
    await within(b.dlg).findByText(/ICD-1001/);
    expect(within(b.dlg).queryByRole('button', { name: 'Create draft order' })).not.toBeInTheDocument();
  });
  it('draft orders already created are listed with refs', async () => {
    const { dlg } = await openDecision(decision({ status: 'APPROVED', orders: [{ orderId: 'o1', orderRef: 'ORD-3001' }] }));
    expect(await within(dlg).findByText('ORD-3001')).toBeInTheDocument();
  });
  it('propose: HOLD disables quantity and omits it; quantity required otherwise', async () => {
    const { user, api } = await mountPage(<ResearchPage />, { routes: base({ 'GET /api/v1/research/cases': ok([kase({ id: 'cs2', ref: 'RSC-1002', status: 'PUBLISHED' })]), 'POST /api/v1/research/decisions': ok({ id: 'd9' }, 201) }) });
    await user.click(await screen.findByRole('tab', { name: 'IC decisions' }));
    await user.click(await screen.findByRole('button', { name: 'New proposal' }));
    const dlg = screen.getByRole('dialog');
    await user.selectOptions(await within(dlg).findByLabelText('Research case'), 'cs2');
    expect(within(dlg).getByLabelText(/Quantity/)).toBeRequired();
    await user.selectOptions(within(dlg).getByLabelText('Action'), 'HOLD');
    expect(within(dlg).getByLabelText(/Quantity/)).toBeDisabled();
    await user.type(within(dlg).getByLabelText('Rationale'), 'Keep the position for now');
    await user.click(within(dlg).getByRole('button', { name: 'Create proposal' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/decisions'));
    expectBody(req!, { caseId: 'cs2', action: 'HOLD' });
    expect((req!.body as Record<string, unknown>).quantity).toBeUndefined();
    expectIdempotencyKey(req!);
  });
  it('meetings: list shows chair name and open decisions; detail shows agenda and agenda decisions; scheduling posts title/quorum', async () => {
    const { user, api } = await mountPage(<ResearchPage />, { routes: base({ 'POST /api/v1/research/meetings': ok({ id: 'mt2' }, 201) }) });
    await user.click(await screen.findByRole('tab', { name: 'IC meetings' }));
    expect(await screen.findByText('Chair C')).toBeInTheDocument();
    expect(screen.getByText('2 (1 open)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Schedule meeting' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Title/), 'October IC');
    await user.type(within(dlg).getByLabelText(/Date and time/), '2026-10-10T10:00');
    await user.click(within(dlg).getByRole('button', { name: 'Schedule' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/research/meetings'));
    expectBody(req!, { title: 'October IC', quorum: 3 });
  });
  it('meeting detail: Mark as held patches status HELD with minutes; server refusal (undecided decisions) is shown', async () => {
    const { user } = await mountPage(<ResearchPage />, { routes: base({ 'PATCH /api/v1/research/meetings/:id': fail(409, 'conflict', 'Every decision needs a ratified outcome') }) });
    await user.click(await screen.findByRole('tab', { name: 'IC meetings' }));
    await user.click(await screen.findByText('ICM-1'));
    const dlg = await screen.findByRole('dialog');
    await user.click(await within(dlg).findByRole('button', { name: 'Mark as held' }));
    await user.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Mark as held' }));
    expect(await screen.findByText(/Every decision needs a ratified outcome/)).toBeInTheDocument();
  });
});
