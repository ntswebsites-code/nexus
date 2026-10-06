import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tracker } from '@/components/Tracker';
import { ResumePage, ResumePanel } from '@/components/ResumePanel';
import { expectBody, expectCalled, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { resetNavigateHandler, setNavigateHandler } from '@/lib/api';
import { application, evidenceRow, meta, P, pdf, renderApp, seedSession, SESSION_KEY, storedSession, stubLocation, userAnyFile } from './_support';

beforeEach(() => {
  localStorage.clear();
  resetNavigateHandler();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const steps = (stage: 'received' | 'review' | 'decision') => [
  { key: 'received', label: 'Received', done: stage !== 'received', current: stage === 'received' },
  { key: 'review', label: 'Under review', done: stage === 'decision', current: stage === 'review' },
  { key: 'decision', label: 'Decision', done: false, current: stage === 'decision' },
];
const status = (over: Record<string, unknown> = {}) => ({
  ref: 'ONB-100231',
  submitted: true,
  submittedAt: '2026-10-03T09:15:00.000Z',
  stage: { key: 'review', label: 'Under review' },
  steps: steps('review'),
  updates: [
    { at: '2026-10-03T09:15:00.000Z', title: 'Online application submitted', detail: 'Investor portal submission captured with 9 evidence files.' },
    { at: '2026-10-03T11:00:00.000Z', title: 'Returned to compliance review', detail: null },
  ],
  requested: null,
  ...over,
});
const requested = (over: Record<string, unknown> = {}) =>
  status({
    stage: { key: 'action', label: 'Information needed' },
    updates: [{ at: '2026-10-03T09:15:00.000Z', title: 'Online application submitted', detail: null }, { at: '2026-10-04T08:00:00.000Z', title: 'Evidence requested from applicant', detail: 'Please upload a recent bank statement' }],
    requested: { slots: [{ key: 'doc3', label: 'Source of funds', received: false }], message: 'Please upload a recent bank statement', dueAt: '2026-10-11T08:00:00.000Z' },
    ...over,
  });

function backend(st: unknown, extra: Record<string, never> = {}) {
  const state = { status: st, evidence: [evidenceRow('doc3', false), evidenceRow('doc1', true)] };
  const api = mockApi({
    [`GET ${P}/onboarding/meta`]: raw(meta),
    [`GET ${P}/applications/:id/status`]: () => ({ status: 200, body: { status: state.status } }),
    [`GET ${P}/applications/:id`]: () => ({ status: 200, body: { application: application({ status: 'Submitted', ref: 'ONB-100231', evidence: state.evidence }) } }),
    [`POST ${P}/applications/:id/reply`]: { status: 201, body: { ok: true, duplicate: false } },
    ...extra,
  });
  return { api, state };
}
async function openTracker(st: unknown = status(), extra: Record<string, never> = {}) {
  seedSession();
  const b = backend(st, extra);
  const view = renderApp(<Tracker />);
  return { ...b, ...view };
}

describe('onboarding tracker: status', () => {
  it('without a saved session it asks for a private link by email', async () => {
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta) });
    renderApp(<Tracker />);
    expect(await screen.findByRole('heading', { name: 'Check your application' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
  });

  it('shows the reference, the applicant-safe stage, the three steps with the current one marked, and updates newest first', async () => {
    const { api } = await openTracker();
    expect(await screen.findByText('Application ONB-100231')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Under review' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Progress' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual(['✓Received', 'Under review', 'Decision']);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveClass('done');
    const updates = screen.getByRole('heading', { name: 'Updates' }).closest('section')!;
    const titles = within(updates).getAllByRole('listitem').map((li) => li.querySelector('strong')!.textContent);
    expect(titles).toEqual(['Returned to compliance review', 'Online application submitted']);
    expect(within(updates).getByText('Investor portal submission captured with 9 evidence files.')).toBeInTheDocument();
    expect(screen.getByText(/Submitted .*2026.*Compliance makes the final decision/)).toBeInTheDocument();
    const [req] = expectCalled(api, `GET ${P}/applications/:id/status`);
    expect(req.headers['x-draft-token']).toBe('tok-123');
    expect(screen.queryByText('Action needed')).toBeNull();
  });

  it('an application that is still a draft links back to the wizard', async () => {
    await openTracker({ ref: null, submitted: false, stage: { key: 'draft', label: 'Draft' }, steps: [], updates: [], requested: null });
    expect(await screen.findByRole('heading', { name: 'Your application is still a draft' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue application' })).toHaveAttribute('href', '/');
  });

  it('no updates yet shows a friendly empty state', async () => {
    await openTracker(status({ updates: [] }));
    expect(await screen.findByText('No updates yet.')).toBeInTheDocument();
  });

  it('an expired link (404) falls back to the request-a-link form; other errors say it is retrying', async () => {
    seedSession();
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta), [`GET ${P}/applications/:id/status`]: fail(404, 'not_found', 'Application not found or link expired'), [`GET ${P}/applications/:id`]: fail(404, 'not_found', 'x') });
    const a = renderApp(<Tracker />);
    expect(await screen.findByRole('heading', { name: 'Check your application' })).toBeInTheDocument();
    a.unmount();
    mockApi({ [`GET ${P}/onboarding/meta`]: raw(meta), [`GET ${P}/applications/:id/status`]: fail(500, 'internal_error', 'x'), [`GET ${P}/applications/:id`]: fail(500, 'internal_error', 'x') });
    renderApp(<Tracker />);
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your status. Retrying...');
  });

  it('refreshes by itself every 30 seconds and shows a changed stage', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { api, state } = await openTracker();
    await screen.findByRole('heading', { name: 'Under review' });
    state.status = status({ stage: { key: 'decision', label: 'Approved' }, steps: steps('decision') });
    vi.advanceTimersByTime(30_000);
    expect(await screen.findByRole('heading', { name: 'Approved' })).toBeInTheDocument();
    expect(api.calls(`GET ${P}/applications/:id/status`).length).toBeGreaterThanOrEqual(2);
  });
});

describe('onboarding tracker: more-information request', () => {
  it('shows the request message, due date and a card per requested document; no card for documents already held', async () => {
    await openTracker(requested());
    expect(await screen.findByRole('heading', { name: 'We need a little more information' })).toBeInTheDocument();
    expect(screen.getByText('Please upload a recent bank statement', { selector: 'blockquote' })).toBeInTheDocument();
    expect(screen.getByText(/Please respond by .*2026/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Information needed' })).toBeInTheDocument();
    expect(screen.getByText('Source of funds')).toBeInTheDocument();
    expect(screen.queryByText('Identity / legal existence')).toBeNull();
    expect(screen.getAllByText('Please upload a recent bank statement').length).toBeGreaterThanOrEqual(2);
  });

  it('uploading a requested document posts it with the token, then reloads the tracker', async () => {
    const { api, state } = await openTracker(requested());
    await screen.findByText('Source of funds');
    api.on(`POST ${P}/applications/:id/evidence`, () => {
      state.evidence = [evidenceRow('doc3', true, { name: 'statement.pdf' }), evidenceRow('doc1', true)];
      state.status = requested({ requested: { slots: [], message: 'Please upload a recent bank statement', dueAt: null } });
      return { status: 201, body: { slot: 'doc3', name: 'statement.pdf', size: 2048, scanStatus: 'clean' } };
    });
    const before = api.calls(`GET ${P}/applications/:id/status`).length;
    await userAnyFile().upload(screen.getByLabelText('Upload Source of funds'), pdf('statement.pdf'));
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/applications/:id/evidence`));
    expect((req.body as FormData).get('slot')).toBe('doc3');
    expect(req.headers['x-draft-token']).toBe('tok-123');
    expect(await screen.findByText('All requested documents have been received. Compliance has been notified.')).toBeInTheDocument();
    expect(api.calls(`GET ${P}/applications/:id/status`).length).toBeGreaterThan(before);
  });

  it('a malware rejection on a requested document is shown on its card', async () => {
    const { api } = await openTracker(requested());
    await screen.findByText('Source of funds');
    api.on(`POST ${P}/applications/:id/evidence`, fail(422, 'malware_detected', 'The file was rejected by the malware scan'));
    await userAnyFile().upload(screen.getByLabelText('Upload Source of funds'), pdf('bad.pdf'));
    const card = screen.getByText('Source of funds').closest('.doc') as HTMLElement;
    expect(await within(card).findByRole('alert')).toHaveTextContent('The file was rejected by the malware scan');
  });

  it('reply: the button is disabled while empty; the trimmed message is posted, the box clears, a confirmation shows and the tracker reloads', async () => {
    const { api, user } = await openTracker(requested());
    const send = await screen.findByRole('button', { name: 'Send reply' });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(/Reply to Compliance/), '  Statement uploaded, see attached.  ');
    expect(send).toBeEnabled();
    const before = api.calls(`GET ${P}/applications/:id/status`).length;
    await user.click(send);
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/applications/:id/reply`));
    expectBody(req, { message: 'Statement uploaded, see attached.' });
    expect(req.headers['x-draft-token']).toBe('tok-123');
    expect(await screen.findByRole('status')).toHaveTextContent('Your reply has been sent to our Compliance team.');
    expect(screen.getByLabelText(/Reply to Compliance/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    await waitFor(() => expect(api.calls(`GET ${P}/applications/:id/status`).length).toBeGreaterThan(before));
  });

  it('reply failures keep the text and show the API message (no open request)', async () => {
    const { api, user } = await openTracker(requested());
    api.on(`POST ${P}/applications/:id/reply`, fail(409, 'no_open_request', 'There is no open request to reply to'));
    await user.type(await screen.findByLabelText(/Reply to Compliance/), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('There is no open request to reply to')).toBeInTheDocument();
    expect(screen.getByLabelText(/Reply to Compliance/)).toHaveValue('Hello');
  });

  it('double click on Send reply sends once while the first request is pending', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { api, user } = await openTracker(requested());
    api.on(`POST ${P}/applications/:id/reply`, async () => (await gate, { status: 201, body: { ok: true, duplicate: false } }));
    await user.type(await screen.findByLabelText(/Reply to Compliance/), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));
    const busy = await screen.findByRole('button', { name: 'Sending...' });
    expect(busy).toBeDisabled();
    await user.click(busy);
    release();
    await screen.findByText('Your reply has been sent to our Compliance team.');
    expect(api.calls(`POST ${P}/applications/:id/reply`)).toHaveLength(1);
  });

  it('applicant text from the API is escaped (message and update details)', async () => {
    await openTracker(requested({ requested: { slots: [], message: '<b onmouseover=alert(1)>click</b>', dueAt: null } }));
    expect(await screen.findByText('<b onmouseover=alert(1)>click</b>', { selector: 'blockquote' })).toBeInTheDocument();
    expect(document.querySelector('blockquote b')).toBeNull();
  });
});

describe('onboarding: resume by email and by link', () => {
  it('request a link: the email is validated, the request is sent and the same neutral confirmation is shown', async () => {
    const api = mockApi({ [`POST ${P}/onboarding/resume-link`]: { status: 202, body: { ok: true } } });
    const { user } = renderApp(<ResumePanel />);
    const btn = screen.getByRole('button', { name: 'Email me a link' });
    await user.type(screen.getByLabelText(/Email used on the application/), 'nope');
    expect(btn).toBeDisabled();
    await user.clear(screen.getByLabelText(/Email used on the application/));
    await user.type(screen.getByLabelText(/Email used on the application/), 'cfo@acme.test');
    await user.click(btn);
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/onboarding/resume-link`));
    expectBody(req, { email: 'cfo@acme.test' });
    expect(await screen.findByRole('status')).toHaveTextContent('If an open application exists for cfo@acme.test, a one-time link is on its way. It is valid for 24 hours.');
    expect(screen.getByRole('link', { name: 'Start a new application' })).toHaveAttribute('href', '/');
  });

  it('a rate-limited request shows the server message', async () => {
    mockApi({ [`POST ${P}/onboarding/resume-link`]: fail(429, 'rate_limited', 'Too many resume requests, try again later') });
    const { user } = renderApp(<ResumePanel />);
    await user.type(screen.getByLabelText(/Email used/), 'cfo@acme.test');
    await user.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many resume requests, try again later');
  });

  it('/resume without a link shows the email form', async () => {
    stubLocation('');
    renderApp(<ResumePage />);
    expect(await screen.findByText('Enter the email you applied with and we will send a private link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
  });

  it('/resume?link=: nothing is exchanged until the explicit click (mail scanners cannot burn the link); the click stores the session and goes to the wizard', async () => {
    stubLocation('?link=one-time-token');
    const go = vi.fn();
    setNavigateHandler(go);
    const api = mockApi({ [`POST ${P}/onboarding/resume`]: raw({ id: 'app-3', token: 'tok-3' }) });
    const { user } = renderApp(<ResumePage />);
    const btn = await screen.findByRole('button', { name: 'Continue my application' });
    expectNotCalled(api, `POST ${P}/onboarding/resume`);
    await user.click(btn);
    const [req] = await waitFor(() => expectCalled(api, `POST ${P}/onboarding/resume`));
    expectBody(req, { link: 'one-time-token' });
    await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
    expect(storedSession()).toEqual({ id: 'app-3', token: 'tok-3' });
  });

  it('a used or expired link shows the message, keeps nothing stored and offers a new link', async () => {
    stubLocation('?link=used-token');
    mockApi({ [`POST ${P}/onboarding/resume`]: fail(404, 'not_found', 'This link has expired or was already used. Request a new one.') });
    const { user } = renderApp(<ResumePage />);
    await user.click(await screen.findByRole('button', { name: 'Continue my application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired or was already used. Request a new one.');
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(screen.getByText('Need a new link?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue my application' })).toBeEnabled();
  });
});
