import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApi, ok, fail, raw, expectCalled, expectNotCalled, expectNoUnmocked } from '../_helpers';
import { ALL_LIVE_FLAGS, API, list, useNodeBlob } from './_lp';

type ApiClientMod = typeof import('@/lib/api/api-client');
type StepUpMod = typeof import('@/lib/api/step-up');

async function fresh() {
  vi.resetModules();
  const client = (await import('@/lib/api/api-client')) as ApiClientMod;
  const stepUp = (await import('@/lib/api/step-up')) as StepUpMod;
  return { ...client, ...stepUp };
}

describe('api-client: request shape', () => {
  it('GET is credentialed, no-store, JSON Accept, base URL + /api/v1', async () => {
    const api = mockApi({ [`GET ${API}/session`]: ok({ a: 1 }) });
    const { apiClient } = await fresh();
    const res = await apiClient.get<{ data: { a: number } }>('/lp-portal/session');
    expect(res.data.a).toBe(1);
    const [req] = expectCalled(api, `GET ${API}/session`);
    expect(req.headers.accept).toBe('application/json');
    const init = api.fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(init.cache).toBe('no-store');
  });

  it('POST sends JSON with content-type; FormData is sent without forcing a JSON content-type', async () => {
    const api = mockApi({ [`POST ${API}/x`]: ok({}) });
    const { apiClient } = await fresh();
    await apiClient.post('/lp-portal/x', { a: 1 });
    const fd = new FormData();
    fd.append('file', new Blob(['hi']), 'a.txt');
    await apiClient.post('/lp-portal/x', fd);
    const [json, form] = api.requests;
    expect(json.headers['content-type']).toContain('application/json');
    expect(json.body).toEqual({ a: 1 });
    expect(form.headers['content-type'] ?? '').not.toContain('application/json');
    expect(form.body).toBeInstanceOf(FormData);
  });

  it('blob responseType returns a Blob and uses a wildcard Accept', async () => {
    const api = mockApi({ [`GET ${API}/d`]: ok({ pdf: true }) });
    useNodeBlob();
    const { apiClient } = await fresh();
    const blob = await apiClient.get<Blob>('/lp-portal/d', { responseType: 'blob' });
    expect(blob).toBeInstanceOf(Blob);
    expect(api.requests[0].headers.accept).toBe('*/*');
  });

  it('empty 204 body resolves undefined', async () => {
    mockApi({ [`DELETE ${API}/x`]: { status: 204 } });
    const { apiClient } = await fresh();
    await expect(apiClient.delete('/lp-portal/x')).resolves.toBeUndefined();
  });
});

describe('api-client: error envelopes', () => {
  it('Nexus envelope {error:{code,message,details[]}} => LpApiError with field-level messages', async () => {
    mockApi({
      [`POST ${API}/requests`]: fail(400, 'validation_error', 'Validation failed', [
        { path: 'subject', message: 'Subject is required' },
        { path: 'description', message: 'Description is too short' },
      ]),
    });
    const { apiClient, isLpApiError } = await fresh();
    const err = await apiClient.post('/lp-portal/requests', {}).catch((e) => e);
    expect(isLpApiError(err)).toBe(true);
    expect(err.status).toBe(400);
    expect(err.code).toBe('validation_error');
    expect(err.fieldErrors).toEqual({ subject: 'Subject is required', description: 'Description is too short' });
    expect(err.response.fieldErrors?.subject).toBe('Subject is required');
  });

  it('LP envelope {success:false, code, message, fieldErrors} keeps fieldErrors and code', async () => {
    mockApi({
      [`POST ${API}/capital-calls/c1/payment-confirmations`]: {
        status: 400,
        body: { success: false, code: 'LP_VALIDATION', message: 'Amount exceeds the outstanding balance', fieldErrors: { amountClaimed: 'Amount exceeds the outstanding balance' } },
      },
    });
    const { apiClient } = await fresh();
    const err = await apiClient.post('/lp-portal/capital-calls/c1/payment-confirmations', new FormData()).catch((e) => e);
    expect(err.code).toBe('LP_VALIDATION');
    expect(err.fieldErrors).toEqual({ amountClaimed: 'Amount exceeds the outstanding balance' });
    expect(err.message).toBe('Amount exceeds the outstanding balance');
  });

  it('5xx appends the request id reference and is retryable; no stack is exposed', async () => {
    mockApi({ [`GET ${API}/dashboard`]: { status: 500, headers: { 'X-Request-Id': 'req-77' }, body: { error: { code: 'internal', message: 'Boom' } } } });
    const { apiClient } = await fresh();
    const err = await apiClient.get('/lp-portal/dashboard').catch((e) => e);
    expect(err.message).toBe('Boom (reference req-77)');
    expect(err.retryable).toBe(true);
    expect(err.requestId).toBe('req-77');
    expect(JSON.stringify(err.response)).not.toContain('stack');
  });

  it('non-JSON error body falls back to a generic status message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })));
    const { apiClient } = await fresh();
    const err = await apiClient.get('/lp-portal/dashboard').catch((e) => e);
    expect(err.message).toMatch(/502/);
    expect(err.code).toBe('LP_INTERNAL');
  });

  it('network failure => LP_NETWORK_ERROR (retryable), never swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { apiClient } = await fresh();
    const err = await apiClient.get('/lp-portal/dashboard').catch((e) => e);
    expect(err.code).toBe('LP_NETWORK_ERROR');
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
  });

  it('abort is re-thrown as AbortError, not converted into a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); }));
    const { apiClient } = await fresh();
    const err = await apiClient.get('/lp-portal/dashboard').catch((e) => e);
    expect(err.name).toBe('AbortError');
  });

  it('200 with unreadable body => LP_INVALID_RESPONSE; 200 with success:false => error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    let c = await fresh();
    expect((await c.apiClient.get('/x').catch((e) => e)).code).toBe('LP_INVALID_RESPONSE');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'LP_X', message: 'nope' }), { status: 200 })));
    c = await fresh();
    expect((await c.apiClient.get('/x').catch((e) => e)).code).toBe('LP_X');
  });
});

describe('api-client: session expiry and step-up', () => {
  it('loginRedirectHref encodes pathname and search for the sign-in return URL', async () => {
    const { loginRedirectHref } = await import('@/lib/api/api-client');
    expect(loginRedirectHref('/lp-portal/documents', '?x=1')).toBe(`/login?next=${encodeURIComponent('/lp-portal/documents?x=1')}`);
  });

  it('401 LP_UNAUTHORIZED redirects to login once', async () => {
    mockApi({ [`GET ${API}/session`]: { status: 401, body: { success: false, code: 'LP_UNAUTHORIZED', message: 'Sign in' } } });
    const { apiClient, setRedirectHandler } = await fresh();
    const hrefs: string[] = [];
    setRedirectHandler((href) => hrefs.push(href));
    await apiClient.get('/lp-portal/session').catch(() => undefined);
    await apiClient.get('/lp-portal/session').catch(() => undefined);
    expect(hrefs).toHaveLength(1);
    setRedirectHandler(null);
  });

  it('authRedirect:false suppresses the redirect; a 401 with another code does not redirect', async () => {
    mockApi({
      [`GET ${API}/a`]: { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } },
      [`GET ${API}/b`]: { status: 401, body: { error: { code: 'wrong_password', message: 'x' } } },
    });
    const { apiClient, setRedirectHandler } = await fresh();
    const hrefs: string[] = [];
    setRedirectHandler((href) => hrefs.push(href));
    await apiClient.get('/lp-portal/a', { authRedirect: false }).catch(() => undefined);
    await apiClient.get('/lp-portal/b').catch(() => undefined);
    expect(hrefs).toHaveLength(0);
    setRedirectHandler(null);
  });

  it('LP_STEP_UP_REQUIRED opens the dialog, then retries the SAME request with the SAME Idempotency-Key', async () => {
    let n = 0;
    const api = mockApi({
      [`POST ${API}/capital-calls/c1/acknowledge`]: () => (++n === 1 ? fail(403, 'LP_STEP_UP_REQUIRED', 'Confirm with your code') : ok({ acknowledgedAt: 'now' })),
    });
    const { registerStepUpHandler, apiClient } = await fresh();
    const handler = vi.fn(async () => true);
    registerStepUpHandler(handler);
    const res = await apiClient.post<{ data: { acknowledgedAt: string } }>('/lp-portal/capital-calls/c1/acknowledge', {}, { headers: { 'Idempotency-Key': 'k-1' } });
    expect(res.data.acknowledgedAt).toBe('now');
    expect(handler).toHaveBeenCalledWith({ mode: 'verify', message: 'Confirm with your code' });
    const reqs = expectCalled(api, `POST ${API}/capital-calls/c1/acknowledge`, 2);
    expect(reqs.map((r) => r.idempotencyKey)).toEqual(['k-1', 'k-1']);
  });

  it('LP_MFA_REQUIRED opens enrolment mode; cancelling rejects with the original error and does not retry', async () => {
    const api = mockApi({ [`POST ${API}/x`]: fail(403, 'LP_MFA_REQUIRED', 'Set up MFA') });
    const { registerStepUpHandler, apiClient } = await fresh();
    const handler = vi.fn(async () => false);
    registerStepUpHandler(handler);
    const err = await apiClient.post('/lp-portal/x', {}).catch((e) => e);
    expect(handler).toHaveBeenCalledWith({ mode: 'enroll', message: 'Set up MFA' });
    expect(err.code).toBe('LP_MFA_REQUIRED');
    expectCalled(api, `POST ${API}/x`, 1);
  });

  it('step-up retries once only (a second step-up answer is an error, not a loop); stepUp:false skips the dialog', async () => {
    const api = mockApi({ [`POST ${API}/x`]: fail(403, 'LP_STEP_UP_REQUIRED', 'again') });
    const { registerStepUpHandler, apiClient } = await fresh();
    const handler = vi.fn(async () => true);
    registerStepUpHandler(handler);
    const err = await apiClient.post('/lp-portal/x', {}).catch((e) => e);
    expect(err.code).toBe('LP_STEP_UP_REQUIRED');
    expectCalled(api, `POST ${API}/x`, 2);
    expect(handler).toHaveBeenCalledTimes(1);
    handler.mockClear();
    await apiClient.post('/lp-portal/x', {}, { stepUp: false }).catch(() => undefined);
    expect(handler).not.toHaveBeenCalled();
  });

  it('step-up bridge: false without a handler; concurrent requests share one dialog; unregister works', async () => {
    const { requestStepUp, registerStepUpHandler } = await fresh();
    await expect(requestStepUp({ mode: 'verify' })).resolves.toBe(false);
    let resolve!: (v: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const off = registerStepUpHandler(handler);
    const a = requestStepUp({ mode: 'verify' });
    const b = requestStepUp({ mode: 'verify' });
    expect(handler).toHaveBeenCalledTimes(1);
    resolve(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    off();
    await expect(requestStepUp({ mode: 'verify' })).resolves.toBe(false);
  });
});

describe('lpPortalApi proxy: domain routing, count coercion, normalisation', () => {
  beforeEach(() => vi.resetModules());

  it('routes a live domain to the API and coerces count-like string keys but NOT money strings', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [`GET ${API}/session`]: ok({ unreadCounts: { requests: '1', messages: '0', notices: '1', notifications: '0' }, funds: [{ commitmentAmount: '5000000.00' }] }),
      [`GET ${API}/documents`]: ok(list([{ id: 'd', fileSizeBytes: 10 }], { page: '1', pageSize: '20', total: '1', totalPages: '1' })),
      [`GET ${API}/messages`]: ok(list([{ id: 't', unreadCount: '1' }])),
    });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    const s = await lpPortalApi.getSession();
    // session unreadCounts are coerced in LpPortalProvider (see lp-shell tests), not here
    expect(s.data.funds[0].commitmentAmount).toBe('5000000.00');
    const docs = await lpPortalApi.getDocuments();
    expect(docs.data).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    const msgs = await lpPortalApi.getMessages();
    expect(msgs.data.items[0].unreadCount).toBe(1);
  });

  it('a domain that is not live is served from the mock store: no network call to its endpoint', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': raw({ lp: { ...ALL_LIVE_FLAGS.lp, notices: false } }) });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    const res = await lpPortalApi.getNotices({ pageSize: 5 });
    expect(Array.isArray(res.data.items)).toBe(true);
    expectNotCalled(api, `GET ${API}/notices`);
    expectNoUnmocked();
  });

  it('a live call that fails rejects with the API error and is never answered from mock data', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [`GET ${API}/notices`]: fail(500, 'internal', 'Down'),
    });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    await expect(lpPortalApi.getNotices()).rejects.toMatchObject({ status: 500 });
  });

  it('every flagged-off flag load failure => all demo, status error', async () => {
    mockApi({ 'GET /api/v1/platform/flags': fail(503, 'down', 'down') });
    const flags = await import('@/lib/lp-portal/flags');
    const state = await flags.loadLpFlags();
    expect(state.status).toBe('error');
    expect(Object.values(state.lp).every((v) => v === false)).toBe(true);
    expect(state.error).toMatch(/503/);
  });

  it('flags response without lp block is an error; only literal true makes a domain live', async () => {
    mockApi({ 'GET /api/v1/platform/flags': raw({}) });
    let flags = await import('@/lib/lp-portal/flags');
    expect((await flags.loadLpFlags()).status).toBe('error');
    vi.resetModules();
    mockApi({ 'GET /api/v1/platform/flags': raw({ lp: { capital: 'true', notices: true, session: 1 } }) });
    flags = await import('@/lib/lp-portal/flags');
    const s = await flags.loadLpFlags();
    expect(s.lp.notices).toBe(true);
    expect(s.lp.capital).toBe(false);
    expect(s.lp.session).toBe(false);
    expect(flags.isLpDomainLive('notices')).toBe(true);
  });

  it('reloadLpFlags refetches', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': fail(503, 'down', 'down') });
    const flags = await import('@/lib/lp-portal/flags');
    await flags.loadLpFlags();
    api.on('GET /api/v1/platform/flags', raw(ALL_LIVE_FLAGS));
    const next = await flags.reloadLpFlags();
    expect(next.status).toBe('ready');
    expectCalled(api, 'GET /api/v1/platform/flags', 2);
  });

  it('LPC-QA: bank-instruction changes returned as {items:[]} are normalised to an array (organisation screen crashed on .map)', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [`GET ${API}/bank-instructions/changes`]: ok({ items: [{ id: 'b1', status: 'PENDING' }] }),
    });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    const res = await lpPortalApi.getBankInstructionChanges();
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(1);
  });

  it('bank-instruction changes: bare array and missing payload both give arrays', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [`GET ${API}/bank-instructions/changes`]: ok([{ id: 'b1' }]),
    });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    expect((await lpPortalApi.getBankInstructionChanges()).data).toHaveLength(1);
    mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [`GET ${API}/bank-instructions/changes`]: ok({}) });
    vi.resetModules();
    const again = await import('@/lib/api/lp-portal-api');
    expect((await again.lpPortalApi.getBankInstructionChanges()).data).toEqual([]);
  });

  it('request builders: query strings drop empty values; Idempotency-Key on money/mutations; reply has none', async () => {
    const api = mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [`GET ${API}/capital-calls`]: ok(list([])),
      [`POST ${API}/capital-calls/c1/acknowledge`]: ok({ acknowledgedAt: 'x' }),
      [`POST ${API}/requests`]: ok({}, 201),
      [`POST ${API}/requests/REQ-1082/messages`]: ok({}, 201),
      [`GET ${API}/statements/:p/download`]: ok({}),
    });
    const { lpPortalApi } = await import('@/lib/api/lp-portal-api');
    await lpPortalApi.getCapitalCalls({ fundId: '', status: undefined, pageSize: 50 });
    expect(api.requests.find((r) => r.path.endsWith('/capital-calls'))!.url).toMatch(/capital-calls\?pageSize=50$/);
    await lpPortalApi.acknowledgeCapitalCall('c1');
    await lpPortalApi.createRequest({ type: 'GENERAL', subject: 's', description: 'd' });
    await lpPortalApi.replyToRequest('REQ-1082', { body: 'hi' });
    await lpPortalApi.downloadStatement('2026 Q2/x');
    expect(api.calls(`POST ${API}/capital-calls/c1/acknowledge`)[0].idempotencyKey).toBeTruthy();
    expect(api.calls(`POST ${API}/requests`)[0].idempotencyKey).toBeTruthy();
    expect(api.calls(`POST ${API}/requests/REQ-1082/messages`)[0].body).toEqual({ body: 'hi' });
    expect(api.requests.at(-1)!.path).toBe(`${API}/statements/2026%20Q2%2Fx/download`);
  });
});
