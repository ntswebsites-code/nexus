import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockApi, ok, raw, fail } from '../_helpers';
import { ALL_LIVE_FLAGS, API } from './_lp';

class FakeES {
  static CLOSED = 2;
  static instances: FakeES[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<(e: unknown) => void>>();
  closed = false;
  constructor(public url: string, public init?: { withCredentials?: boolean }) {
    FakeES.instances.push(this);
  }
  addEventListener(name: string, fn: (e: unknown) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(name: string, data: string, lastEventId = '') {
    (this.listeners.get(name) ?? []).forEach((fn) => fn({ data, lastEventId }));
  }
}

const RT = `GET ${API}/realtime`;
type Mod = typeof import('@/lib/lp-portal/realtime');

async function load(withES: boolean): Promise<Mod> {
  vi.resetModules();
  FakeES.instances = [];
  if (withES) vi.stubGlobal('EventSource', FakeES);
  else vi.stubGlobal('EventSource', undefined);
  return import('@/lib/lp-portal/realtime');
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('realtime: polling fallback (no EventSource)', () => {
  it('polls /realtime, forwards cursor, dedupes change ids, honours pollingIntervalMs (min 5s)', async () => {
    let n = 0;
    const api = mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [RT]: () =>
        ok(
          ++n === 1
            ? { enabled: true, cursor: 'c1', pollingIntervalMs: 1000, changes: [{ id: 'a', event: 'lp_notice_updated', at: 'x', payload: { type: 'N' } }] }
            : { enabled: true, cursor: 'c2', changes: [{ id: 'a', event: 'lp_notice_updated', at: 'x' }, { id: 'b', event: 'lp_notice_updated', at: 'x' }] },
        ),
    });
    const rt = await load(false);
    const got: unknown[] = [];
    const off = rt.subscribeLpRealtime('lp_notice_updated', (p) => got.push(p));
    await flush();
    expect(got).toEqual([{ type: 'N' }]);
    expect(api.calls(RT)[0].query.get('since')).toBeNull();
    await vi.advanceTimersByTimeAsync(4_000); // interval clamped to >= 5s
    expect(api.calls(RT)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api.calls(RT)).toHaveLength(2);
    expect(api.calls(RT)[1].query.get('since')).toBe('c1');
    expect(got).toEqual([{ type: 'N' }, {}]); // 'a' deduped, 'b' delivered with empty payload
    off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls(RT)).toHaveLength(2); // stopped when the last subscriber left
  });

  it('enabled:false (demo data) keeps the poller idle', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: false }) });
    const rt = await load(false);
    rt.subscribeLpRealtime('lp_counts', () => undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.calls(RT)).toHaveLength(1);
  });

  it('transient API error: keeps polling at the normal interval, no throw', async () => {
    let n = 0;
    const api = mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [RT]: () => (++n === 1 ? fail(500, 'internal', 'x') : ok({ enabled: true, cursor: 'c', changes: [] })),
    });
    const rt = await load(false);
    rt.subscribeLpRealtime('lp_counts', () => undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(api.calls(RT).length).toBeGreaterThanOrEqual(2);
  });

  it('a throwing handler does not stop other subscribers', async () => {
    mockApi({
      'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS),
      [RT]: ok({ enabled: true, changes: [{ id: 'z', event: 'lp_counts', at: 'x', payload: { a: 1 } }] }),
    });
    const rt = await load(false);
    const ok2 = vi.fn();
    rt.subscribeLpRealtime('lp_counts', () => {
      throw new Error('screen bug');
    });
    rt.subscribeLpRealtime('lp_counts', ok2);
    await flush();
    expect(ok2).toHaveBeenCalledWith({ a: 1 });
  });

  it('hidden tab: no requests until the tab is visible again', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: true, changes: [] }) });
    const rt = await load(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    rt.subscribeLpRealtime('lp_counts', () => undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(api.calls(RT)).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(16_000); // the pending timer fires and now polls
    expect(api.calls(RT).length).toBeGreaterThanOrEqual(1);
  });
});

describe('realtime: SSE stream', () => {
  it('opens a credentialed stream at /lp-portal/realtime/stream; while open the poller pauses', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: true, cursor: 'c', changes: [] }) });
    const rt = await load(true);
    rt.subscribeLpRealtime('lp_notification', () => undefined);
    await flush();
    const es = FakeES.instances[0];
    expect(es.url).toMatch(/\/api\/v1\/lp-portal\/realtime\/stream$/);
    expect(es.init?.withCredentials).toBe(true);
    es.onopen?.();
    expect(rt.isLpRealtimeConnected()).toBe(true);
    const before = api.calls(RT).length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.calls(RT)).toHaveLength(before);
  });

  it('delivers named events with parsed payload, dedupes by lastEventId, tolerates malformed JSON', async () => {
    mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: false }) });
    const rt = await load(true);
    const got: unknown[] = [];
    rt.subscribeLpRealtime('lp_request_updated', (p) => got.push(p));
    await flush();
    const es = FakeES.instances[0];
    es.emit('lp_request_updated', '{"ref":"REQ-1"}', 'evt-1@1');
    es.emit('lp_request_updated', '{"ref":"REQ-1"}', 'evt-1@2'); // same id, replayed after reconnect
    es.emit('lp_request_updated', '{not json', 'evt-2@1');
    expect(got).toEqual([{ ref: 'REQ-1' }, {}]);
  });

  it('browser gave up (CLOSED, e.g. 401) => connected=false and polling takes over', async () => {
    const api = mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: true, cursor: 'c', pollingIntervalMs: 5000, changes: [] }) });
    const rt = await load(true);
    rt.subscribeLpRealtime('lp_notification', () => undefined);
    await flush();
    const es = FakeES.instances[0];
    es.onopen?.();
    const before = api.calls(RT).length;
    es.readyState = FakeES.CLOSED;
    es.onerror?.();
    expect(rt.isLpRealtimeConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(api.calls(RT).length).toBeGreaterThan(before);
  });

  it('last unsubscribe closes the stream', async () => {
    mockApi({ 'GET /api/v1/platform/flags': raw(ALL_LIVE_FLAGS), [RT]: ok({ enabled: true, changes: [] }) });
    const rt = await load(true);
    const off = rt.subscribeLpRealtime('lp_counts', () => undefined);
    await flush();
    off();
    expect(FakeES.instances[0].closed).toBe(true);
    expect(rt.isLpRealtimeConnected()).toBe(false);
  });
});
