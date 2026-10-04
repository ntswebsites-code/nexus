import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LpRequestsMessagesScreen } from '@/components/lp-portal/screens/lp-requests-messages-screen';
import { toast } from 'sonner';
import { ok, fail, screen, waitFor, within, expectCalled, expectIdempotencyKey, expectNoUnmocked, router } from '../_helpers';
import { API, liveApi, renderLp, list, FUND_PE, FUND_OE } from './_lp';
import { emitRealtime } from './_rt';

vi.setConfig({ testTimeout: 30_000 });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

const REQ_2017 = {
  id: 'sr-2017', reference: 'REQ-2017', type: 'ACCOUNT_STATEMENT', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', status: 'UNDER_REVIEW',
  subject: 'Statement for Q1', description: 'Need statement', createdAt: '2026-04-01T09:00:00Z', updatedAt: '2026-04-02T09:00:00Z', priority: 'NORMAL',
  submittedBy: { id: 'u1', email: 'ann@alpha.test', name: 'Ann Alpha' }, attachments: [],
};
const REQ_1082 = {
  id: 'sr-1082', reference: 'REQ-1082', type: 'CAPITAL_ACTIVITY', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', status: 'AWAITING_INVESTOR',
  subject: 'Query on call 13', description: 'Why this amount?', createdAt: '2026-03-01T09:00:00Z', updatedAt: '2026-03-02T09:00:00Z', priority: 'HIGH',
  submittedBy: 'Bob Beta', attachments: [{ id: 'att1', name: 'invoice.pdf', size: 2048, downloadUrl: 'http://x/invoice.pdf' }],
};
const THREAD_1082 = { id: 'th-1082', subject: 'Query on call 13', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', relatedType: 'REQUEST', relatedId: 'REQ-1082', status: 'OPEN', lastMessageAt: '2026-03-02T09:00:00Z', lastMessagePreview: 'Please clarify', unreadCount: '1' };
const THREAD_GEN = { id: 'th-gen', subject: 'Welcome', fundId: FUND_PE.fundId, fundName: 'Growth Fund I', relatedType: 'GENERAL', relatedId: '', status: 'OPEN', lastMessageAt: '2026-02-02T09:00:00Z', lastMessagePreview: 'Hello there', unreadCount: '0' };
const detail = (t: typeof THREAD_1082) => ({
  ...t, participants: [{ name: 'Ann Alpha' }],
  messages: [
    { id: 'm1', authorType: 'INVESTOR', authorId: 'u1', body: 'First question', readAt: null, createdAt: '2026-03-01T10:00:00Z' },
    { id: 'm2', authorType: 'STAFF', authorId: 's1', body: 'Please clarify', readAt: null, createdAt: '2026-03-02T09:00:00Z' },
  ],
});

function routes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${API}/requests/attachments`]: ok({}),
    [`GET ${API}/requests/:ref`]: (_r: unknown, p: Record<string, string>) =>
      p.ref === 'REQ-1082' ? ok(REQ_1082) : p.ref === 'REQ-2017' ? ok(REQ_2017) : p.ref === 'REQ-3001' ? ok({ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001', subject: 'Brand new subject', status: 'SUBMITTED' }) : fail(404, 'LP_NOT_FOUND', 'Request not found'),
    [`GET ${API}/requests`]: ok(list([REQ_2017, REQ_1082])),
    [`GET ${API}/messages/:id`]: (_r: unknown, p: Record<string, string>) => ok(detail(p.id === 'th-gen' ? THREAD_GEN : THREAD_1082)),
    [`GET ${API}/messages`]: ok(list([THREAD_1082, THREAD_GEN])),
    [`POST ${API}/messages/:id/read`]: ok({ threadId: 'x', markedRead: 1 }),
    [`GET ${API}/organisation`]: ok({ id: 'c', legalName: 'Alpha', investorId: 'I', email: 'e', country: 'US', phone: '', address: '', status: 'ACTIVE', lpRole: 'MANAGER', colleagues: [] }),
    [`GET ${API}/bank-instructions/changes`]: ok({ items: [] }),
    ...over,
  } as never;
}

beforeEach(() => vi.clearAllMocks());
async function typeInto(user: ReturnType<typeof renderLp>['user'], el: HTMLElement, text: string) {
  await user.click(el);
  await user.paste(text);
}
const ready = async () => within(await screen.findByRole('table')).findByText('REQ-2017');

describe('Requests list and detail', () => {
  it('renders the real API shapes: refs, fund names, mapped statuses, submittedBy as name (actor object or string), counts', async () => {
    liveApi(routes());
    renderLp(<LpRequestsMessagesScreen />);
    await ready();
    const table = screen.getByRole('table');
    expect(within(table).getByText('REQ-1082')).toBeInTheDocument();
    expect(within(table).getByText('Ann Alpha')).toBeInTheDocument(); // object submittedBy => name, no React child crash
    expect(within(table).getByText('Bob Beta')).toBeInTheDocument();
    expect(within(table).getByText('Under Review')).toBeInTheDocument();
    expect(within(table).getByText('Awaiting Investor')).toBeInTheDocument();
    expect(within(table).getAllByText('Growth Fund I').length).toBe(2);
    expect(screen.getByRole('button', { name: /Requests \(2\)/ })).toBeInTheDocument();
    // unread count arrives as the string "1" and "0": the badge must read 1, never "10"
    expect(screen.getByRole('button', { name: /Messages \(1\)/ })).toBeInTheDocument();
    expectNoUnmocked();
  });

  it('LPC-022: selecting REQ-1082 loads GET /requests/REQ-1082 and shows REQ-1082 (never a fixed REQ-2017)', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await waitFor(() => expectCalled(api, `GET ${API}/requests/REQ-2017`));
    await user.click(within(screen.getByRole('table')).getByText('REQ-1082'));
    await waitFor(() => expectCalled(api, `GET ${API}/requests/REQ-1082`));
    const panel = screen.getByRole('heading', { name: 'Request Details' }).closest('section')!;
    await waitFor(() => expect(within(panel).getByText('REQ-1082')).toBeInTheDocument());
    expect(within(panel).queryByText('REQ-2017')).not.toBeInTheDocument();
    expect(within(panel).getByText('invoice.pdf')).toBeInTheDocument();
  });

  it('LPC-022: opening a conversation linked to REQ-1082 (relatedId is the REFERENCE) shows that request, not the first row', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    const convs = screen.getByText('Conversations').closest('div')!.parentElement!;
    await user.click(within(convs).getByText('Query on call 13'));
    await waitFor(() => expectCalled(api, `GET ${API}/requests/REQ-1082`));
    const panel = screen.getByRole('heading', { name: 'Request Details' }).closest('section')!;
    await waitFor(() => expect(within(panel).getByText('REQ-1082')).toBeInTheDocument());
  });

  it('LPC-022: selecting a request row activates its conversation (thread relatedId is the reference)', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await user.click(within(screen.getByRole('table')).getByText('REQ-1082'));
    await waitFor(() => expectCalled(api, `GET ${API}/messages/th-1082`));
  });

  it('?ref= deep link selects that request and loads its detail', async () => {
    const api = liveApi(routes());
    renderLp(<LpRequestsMessagesScreen initialRequestRef="REQ-1082" />);
    await waitFor(() => expectCalled(api, `GET ${API}/requests/REQ-1082`));
  });

  it('KPI cards filter the table (Awaiting Investor) and search narrows by text', async () => {
    liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: /Awaiting Investor/ }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText('REQ-2017')).not.toBeInTheDocument();
    expect(within(table).getByText('REQ-1082')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open Requests/ }));
    await typeInto(user, screen.getByPlaceholderText('Search requests...'), 'statement');
    expect(within(screen.getByRole('table')).queryByText('REQ-1082')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('REQ-2017')).toBeInTheDocument();
  });

  it('error state shows the API message', async () => {
    liveApi(routes({ [`GET ${API}/requests`]: fail(500, 'internal', 'Requests unavailable') }));
    renderLp(<LpRequestsMessagesScreen />);
    expect(await screen.findByText(/Requests unavailable/)).toBeInTheDocument();
  });

  it('empty state renders without crashing', async () => {
    liveApi(routes({ [`GET ${API}/requests`]: ok(list([])), [`GET ${API}/messages`]: ok(list([])) }));
    renderLp(<LpRequestsMessagesScreen />);
    expect(await screen.findByRole('button', { name: /Requests \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Request' })).toBeEnabled();
  });

  it('realtime lp_request_created refetches the list (new request appears without reload)', async () => {
    const api = liveApi(routes());
    renderLp(<LpRequestsMessagesScreen />);
    await ready();
    api.on(`GET ${API}/requests`, ok(list([{ ...REQ_2017, id: 'sr-9', reference: 'REQ-9000' }, REQ_2017, REQ_1082])));
    emitRealtime('lp_request_created');
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('REQ-9000')).toBeInTheDocument());
  });
});

describe('Create request (LPC-002)', () => {
  const fill = async (user: ReturnType<typeof renderLp>['user'], subject = 'Brand new subject', description = 'Please help') => {
    await typeInto(user, screen.getByPlaceholderText('Brief summary of your request'), subject);
    if (description) await typeInto(user, screen.getByPlaceholderText(/Provide details/), description);
  };

  it('empty subject is rejected client side with a message and no request', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(toast.error).toHaveBeenCalledWith('Subject is required.');
    expect(api.calls(`POST ${API}/requests`)).toHaveLength(0);
  });

  it('LPC-002: submits type/fund/subject/description/priority with an Idempotency-Key and opens the NEW record', async () => {
    const api = liveApi(
      routes({
        [`POST ${API}/requests`]: ok({ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001', subject: 'Brand new subject', status: 'SUBMITTED' }, 201),
      }),
    );
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await fill(user);
    api.on(`GET ${API}/requests`, ok(list([{ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001', subject: 'Brand new subject', status: 'SUBMITTED' }, REQ_2017, REQ_1082])));
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Request submitted.'));
    const [req] = expectCalled(api, `POST ${API}/requests`);
    expectIdempotencyKey(req);
    expect(req.body).toMatchObject({ type: 'ACCOUNT_STATEMENT', fundId: FUND_PE.fundId, subject: 'Brand new subject', description: 'Please help', priority: 'MEDIUM' });
    // the new record is the one opened in the detail panel
    await waitFor(() => expectCalled(api, `GET ${API}/requests/REQ-3001`));
    const panel = screen.getByRole('heading', { name: 'Request Details' }).closest('section')!;
    await waitFor(() => expect(within(panel).getByText('REQ-3001')).toBeInTheDocument());
    // form reset
    expect(screen.getByPlaceholderText('Brief summary of your request')).toHaveValue('');
  });

  it('missing description is sent as a placeholder, not an empty string the API rejects', async () => {
    const api = liveApi(routes({ [`POST ${API}/requests`]: ok({ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001' }, 201) }));
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await fill(user, 'Only subject', '');
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expectCalled(api, `POST ${API}/requests`));
    expect(api.calls(`POST ${API}/requests`)[0].body).toMatchObject({ description: 'No description provided.' });
  });

  it('attachments upload first (multipart + Idempotency-Key) and their ids are sent with the request', async () => {
    const api = liveApi(
      routes({
        [`POST ${API}/requests/attachments`]: ok({ id: 'att-9', name: 'doc.pdf', size: 4, uploadedAt: 'n' }, 201),
        [`POST ${API}/requests`]: ok({ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001' }, 201),
      }),
    );
    const { user, container } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await fill(user);
    const formInput = container.querySelector('input[type=file][multiple]') as HTMLInputElement; // the Create form's (reply box input is single)
    await user.upload(formInput, new File(['abcd'], 'doc.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('doc.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expectCalled(api, `POST ${API}/requests`));
    const [up] = expectCalled(api, `POST ${API}/requests/attachments`);
    expectIdempotencyKey(up);
    expect((up.body as FormData).get('file')).toBeInstanceOf(File);
    expect(api.calls(`POST ${API}/requests`)[0].body).toMatchObject({ attachmentIds: ['att-9'] });
  });

  it('double submit is blocked while the request is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = liveApi(routes({ [`POST ${API}/requests`]: async () => { await gate; return ok({ ...REQ_2017, id: 'sr-3001', reference: 'REQ-3001' }, 201); } }));
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await fill(user);
    const btn = screen.getByRole('button', { name: 'Submit Request' });
    await user.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await user.click(btn);
    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(api.calls(`POST ${API}/requests`)).toHaveLength(1);
  });

  it('server validation error is surfaced with the field detail, not just a generic message', async () => {
    liveApi(
      routes({
        [`POST ${API}/requests`]: {
          status: 400,
          body: { success: false, code: 'LP_VALIDATION', message: 'Check the request details', fieldErrors: { subject: 'At most 200 characters' } },
        },
      }),
    );
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    await fill(user, 'x'.repeat(5));
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const msg = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(msg).toContain('Check the request details');
    expect(msg).toContain('At most 200 characters');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('linked fund options show fund names (not ids) from the session', async () => {
    liveApi(routes());
    renderLp(<LpRequestsMessagesScreen />);
    await ready();
    const section = screen.getByRole('heading', { name: 'Create New Request' }).closest('section')!;
    await waitFor(() => expect(section).toHaveTextContent(FUND_PE.fundName));
    expect(section).not.toHaveTextContent(FUND_PE.fundId);
    expect(FUND_OE.fundName).toBeTruthy();
  });
});

describe('Reply (LPC-022)', () => {
  it('reply in the REQ-1082 conversation posts to /requests/REQ-1082/messages only, clears the box and reloads the thread', async () => {
    const api = liveApi(
      routes({
        [`POST ${API}/requests/:ref/messages`]: ok({ id: 'm3', authorType: 'INVESTOR', body: 'My answer', createdAt: 'n' }, 201),
      }),
    );
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    const convs = screen.getByText('Conversations').closest('div')!.parentElement!;
    await user.click(within(convs).getByText('Query on call 13'));
    await screen.findByText('First question');
    const box = screen.getByPlaceholderText('Type your message...');
    await typeInto(user, box, '  My answer ');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Message sent.'));
    const [post] = expectCalled(api, `POST ${API}/requests/REQ-1082/messages`);
    expect(post.body).toEqual({ body: 'My answer' });
    expect(api.calls(`POST ${API}/requests/REQ-2017/messages`)).toHaveLength(0);
    expect(box).toHaveValue('');
    expect(api.calls(`GET ${API}/messages/th-1082`).length).toBeGreaterThanOrEqual(2);
  });

  it('reply in a general thread goes to /messages/:id/replies', async () => {
    const api = liveApi(routes({ [`POST ${API}/messages/:id/replies`]: ok({ id: 'm9', authorType: 'INVESTOR', body: 'hi', createdAt: 'n' }, 201) }));
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await ready();
    const convs = screen.getByText('Conversations').closest('div')!.parentElement!;
    await user.click(within(convs).getByText('Welcome'));
    await screen.findByText('First question');
    await typeInto(user, screen.getByPlaceholderText('Type your message...'), 'hi');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expectCalled(api, `POST ${API}/messages/th-gen/replies`));
    expect(api.calls(`POST ${API}/messages/th-gen/replies`)[0].body).toEqual({ body: 'hi' });
  });

  it('blank reply sends nothing', async () => {
    const api = liveApi(routes());
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await screen.findByText('First question');
    await typeInto(user, screen.getByPlaceholderText('Type your message...'), '   ');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    expect(api.requests.filter((r) => r.method === 'POST' && /messages|replies/.test(r.path) && !/read$/.test(r.path))).toHaveLength(0);
  });

  it('failed reply toasts the API message and keeps the typed text', async () => {
    liveApi(routes({ [`POST ${API}/requests/:ref/messages`]: fail(404, 'LP_NOT_FOUND', 'Request not found') }));
    const { user } = renderLp(<LpRequestsMessagesScreen />);
    await screen.findByText('First question');
    const box = screen.getByPlaceholderText('Type your message...');
    await typeInto(user, box, 'keep me');
    await user.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Request not found'));
    expect(box).toHaveValue('keep me');
  });

  it('opening a thread marks it read and renders sender names (You / Matanho Team), not author ids', async () => {
    const api = liveApi(routes());
    renderLp(<LpRequestsMessagesScreen />);
    await screen.findByText('First question');
    expect(screen.getAllByText('You').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Matanho Team').length).toBeGreaterThan(0);
    expect(screen.queryByText('s1')).not.toBeInTheDocument();
    await waitFor(() => expectCalled(api, `POST ${API}/messages/th-1082/read`));
  });

  it('viewer cannot add participants: control is disabled and explains why', async () => {
    liveApi(routes(), { session: { lpRole: 'VIEWER' } });
    renderLp(<LpRequestsMessagesScreen />);
    await screen.findByText('First question');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add participant' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Add participant' })).toHaveAttribute('title', expect.stringMatching(/Viewers cannot/));
  });

  it('request attachment download without a URL tells the user instead of failing silently', async () => {
    liveApi(routes({ [`GET ${API}/requests/:ref`]: ok({ ...REQ_1082, attachments: [{ id: 'a', name: 'nolink.pdf', size: 1 }] }) }));
    const { user } = renderLp(<LpRequestsMessagesScreen initialRequestRef="REQ-1082" />);
    await user.click(await screen.findByRole('button', { name: 'Download nolink.pdf' }));
    expect(toast.error).toHaveBeenCalledWith('Download URL not available.');
    expect(router.push).not.toHaveBeenCalled();
  });
});
