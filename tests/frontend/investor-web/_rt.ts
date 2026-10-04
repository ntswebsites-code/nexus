/**
 * Controllable stand-in for lib/lp-portal/realtime so a screen test can fire server events.
 * Usage in a test file:
 *   vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);
 *   import { emitRealtime } from './_rt';
 */
type Handler = (payload: unknown) => void;
const subs = new Map<string, Set<Handler>>();

export const rtMock = {
  subscribeLpRealtime: (event: string, handler: Handler) => {
    const set = subs.get(event) ?? new Set<Handler>();
    set.add(handler);
    subs.set(event, set);
    return () => set.delete(handler);
  },
  isLpRealtimeConnected: () => false,
  joinLpPortalOrg: () => undefined,
  joinLpRequestRoom: () => undefined,
  leaveLpRequestRoom: () => undefined,
  joinLpThreadRoom: () => undefined,
  leaveLpThreadRoom: () => undefined,
};

export function emitRealtime(event: string, payload: unknown = {}) {
  subs.get(event)?.forEach((h) => h(payload));
}
export const realtimeSubscribers = (event: string) => subs.get(event)?.size ?? 0;
