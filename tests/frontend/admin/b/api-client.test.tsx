import { describe, it, expect, vi } from 'vitest';
import { api, apiRequest, apiUpload, apiDownload, describeError, OpsError, ops, v1, qs, newIdempotencyKey, setStepUpHandler } from '@/ops/api';
import { mockApi, ok, fail, raw, expectCalled, expectIdempotencyKey, expectBody } from '../../_helpers';

describe('ops api client: requests', () => {
  it('unwraps {data} and sends JSON, credentials and Idempotency-Key', async () => {
    const m = mockApi({ 'POST /api/v1/ops/funds': ok({ id: 'f1' }, 201) });
    const out = await api.post<{ id: string }>(ops('/funds'), { name: 'X' }, { idempotencyKey: 'k-1' });
    expect(out).toEqual({ id: 'f1' });
    const [req] = expectCalled(m, 'POST /api/v1/ops/funds');
    expectBody(req!, { name: 'X' });
    expect(req!.idempotencyKey).toBe('k-1');
    expect(req!.headers['content-type']).toBe('application/json');
    expect(m.fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });
  it('GET has no body/content-type; bare payloads are returned as-is', async () => {
    const m = mockApi({ 'GET /api/v1/x': raw([1, 2]) });
    expect(await api.get('/api/v1/x')).toEqual([1, 2]);
    expect(m.requests[0]!.headers['content-type']).toBeUndefined();
  });
  it('qs drops empty values; v1/ops prefix paths; idempotency keys are unique', () => {
    expect(qs({ a: '1', b: '', c: undefined, d: null })).toBe('?a=1');
    expect(qs({})).toBe('');
    expect(v1('/ibor')).toBe('/api/v1/ibor');
    expect(ops('/funds')).toBe('/api/v1/ops/funds');
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
  it('FormData is sent without a JSON content type; upload keeps the key', async () => {
    const m = mockApi({ 'POST /api/v1/up': ok({}) });
    const fd = new FormData();
    fd.set('file', new File(['a'], 'a.txt'));
    await apiUpload('POST', '/api/v1/up', fd, { idempotencyKey: 'u1' });
    expect(m.requests[0]!.headers['content-type']).toBeUndefined();
    expect(m.requests[0]!.idempotencyKey).toBe('u1');
    await apiRequest('POST', '/api/v1/up', fd);
    expect(m.requests[1]!.body).toBeInstanceOf(FormData);
  });
});

describe('ops api client: errors', () => {
  it('network failure becomes a friendly OpsError(0)', async () => {
    mockApi({});
    await expect(api.get('/api/v1/none')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
  it('maps the {error:{code,message,details}} envelope', async () => {
    mockApi({ 'GET /api/v1/a': fail(403, 'forbidden', 'Nope', { x: 1 }) });
    const e = await api.get('/api/v1/a').catch((x) => x as OpsError);
    expect(e).toBeInstanceOf(OpsError);
    expect(e).toMatchObject({ status: 403, code: 'forbidden', message: 'Nope', details: { x: 1 } });
  });
  it('ADA-010/ADB-014: field-level reasons are appended to "Validation failed" (not generic)', async () => {
    mockApi({
      'POST /api/v1/a': {
        status: 400,
        body: { error: { code: 'validation_error', message: 'Validation failed', fieldErrors: { rationale: 'Rationale must be at least 5 characters', reason: 'Reason is required' } } },
      },
    });
    const e = (await api.post('/api/v1/a', {}).catch((x) => x)) as OpsError;
    expect(e.message).toBe('Validation failed. Rationale must be at least 5 characters. Reason is required');
  });
  it('limits to 3 reasons and does not repeat reasons already in the message', async () => {
    mockApi({
      'POST /api/v1/a': {
        status: 400,
        body: { error: { code: 'x', message: 'Validation failed', fieldErrors: { a: 'A bad', b: 'B bad', c: 'C bad', d: 'D bad', e: 'E bad' } } },
      },
      'POST /api/v1/b': {
        status: 400,
        body: { error: { code: 'x', message: 'Validation failed. A bad', fieldErrors: { a: 'A bad' } } },
      },
    });
    expect(((await api.post('/api/v1/a', {}).catch((x) => x)) as OpsError).message).toBe('Validation failed. A bad. B bad. C bad (and 2 more)');
    expect(((await api.post('/api/v1/b', {}).catch((x) => x)) as OpsError).message).toBe('Validation failed. A bad');
  });
  it('non-JSON error body falls back to the status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(api.get('/api/v1/a')).rejects.toMatchObject({ status: 502, code: 'http_error', message: 'Request failed with status 502' });
  });
  it('describeError wording per code', () => {
    const e = (status: number, code: string, msg = 'm') => new OpsError(status, code, msg);
    expect(describeError(e(409, 'segregation_of_duties', 'You made it'))).toBe('A different approver is required. You made it');
    expect(describeError(e(403, 'forbidden', 'Needs x'))).toBe('You do not have permission for this action. Needs x');
    expect(describeError(e(409, 'conflict', 'Stale.'))).toContain('Reload the page');
    expect(describeError(e(409, 'version_conflict', 'Changed'))).toBe('Changed');
    expect(describeError(e(501, 'whatever'))).toMatch(/not available yet/);
    expect(describeError(e(404, 'not_implemented'))).toMatch(/not available yet/);
    expect(describeError(e(401, 'step_up_cancelled', 'Confirmation cancelled. Nothing was changed.'))).toMatch(/cancelled/);
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('x')).toBe('Something went wrong.');
    expect(new OpsError(501, 'x', 'm').notAvailable).toBe(true);
  });
});

describe('ops api client: step-up', () => {
  it('retries once with the SAME Idempotency-Key after confirmation', async () => {
    let n = 0;
    const m = mockApi({
      'POST /api/v1/pay': () => (++n === 1 ? fail(401, 'step_up_required', 'Confirm') : ok({ done: true })),
    });
    setStepUpHandler(async () => true);
    const out = await api.post('/api/v1/pay', { a: 1 }, { idempotencyKey: 'same-key' });
    setStepUpHandler(null);
    expect(out).toEqual({ done: true });
    const reqs = expectCalled(m, 'POST /api/v1/pay', 2);
    expect(reqs.map((r) => r.idempotencyKey)).toEqual(['same-key', 'same-key']);
    expectIdempotencyKey(reqs[1]!);
  });
  it('cancelled step-up throws step_up_cancelled and does not retry', async () => {
    const m = mockApi({ 'POST /api/v1/pay': fail(401, 'step_up_required') });
    setStepUpHandler(async () => false);
    await expect(api.post('/api/v1/pay', {})).rejects.toMatchObject({ code: 'step_up_cancelled' });
    setStepUpHandler(null);
    expectCalled(m, 'POST /api/v1/pay', 1);
  });
  it('a second step_up_required on the retry does not loop', async () => {
    const m = mockApi({ 'POST /api/v1/pay': fail(401, 'step_up_required') });
    setStepUpHandler(async () => true);
    await expect(api.post('/api/v1/pay', {})).rejects.toMatchObject({ code: 'step_up_required' });
    setStepUpHandler(null);
    expectCalled(m, 'POST /api/v1/pay', 2);
  });
  it('without a registered handler the 401 is surfaced', async () => {
    mockApi({ 'POST /api/v1/pay': fail(401, 'step_up_required') });
    setStepUpHandler(null);
    await expect(api.post('/api/v1/pay', {})).rejects.toMatchObject({ status: 401 });
  });
});

describe('apiDownload', () => {
  it('saves the blob through an anchor and revokes the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abc', { status: 200 })));
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = create;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await apiDownload('/api/v1/f', 'report.pdf');
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });
  it('shows the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'No such file' } }), { status: 404 })));
    await expect(apiDownload('/api/v1/f', 'x')).rejects.toMatchObject({ code: 'download_failed', message: 'No such file' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(apiDownload('/api/v1/f', 'x')).rejects.toMatchObject({ message: 'Download failed with status 500' });
  });
});
