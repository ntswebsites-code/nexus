'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createApiClient } from '@matanho/shared';

const client = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100' });
const BASE = '/api/v1/custodian';

export { ApiError };

/** One Idempotency-Key per user intent: reused when the same request is retried, replaced after it succeeds. */
export function useIdempotencyKey() {
  const ref = useRef<string>(crypto.randomUUID());
  return { current: () => ref.current, renew: () => void (ref.current = crypto.randomUUID()) };
}

const headers = (key?: string) => (key ? { 'Idempotency-Key': key } : undefined);

/** A 401 means the session expired or was replaced: send the user to sign in instead of leaving a stale shell on screen. */
async function guarded<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw e;
  }
}

export const custodian = {
  get: <T,>(path: string) => guarded(() => client.get<T>(`${BASE}${path}`)),
  post: <T,>(path: string, body: unknown, key?: string) => guarded(() => client.post<T>(`${BASE}${path}`, body, headers(key ?? crypto.randomUUID()))),
  patch: <T,>(path: string, body: unknown, key?: string) => guarded(() => client.patch<T>(`${BASE}${path}`, body, headers(key ?? crypto.randomUUID()))),
};

export const platform = {
  get: <T,>(path: string) => guarded(() => client.get<T>(`/api/v1${path}`)),
  post: <T,>(path: string, body: unknown = {}) => guarded(() => client.post<T>(`/api/v1${path}`, body)),
};

export const auth = client;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Loads data on mount and whenever `deps` change; `reload` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { data, error, loading, reload };
}

export interface Me {
  user: { id: string; name: string | null; email: string };
  role: 'submitter' | 'approver';
  permissions: string[];
  counterparty: { id: string; ref: string; name: string; type: string; accounts: string[] };
}

export interface Execution {
  id: string;
  ref: string;
  tradeRef: string;
  executionAt: string;
  accountRef: string;
  ticker: string;
  isin: string | null;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  settlementDate: string | null;
  broker: string | null;
  note: string | null;
  status: string;
  amendable: boolean;
  amendCount: number;
  submittedAt: string;
}

export interface DayEnd {
  id: string;
  ref: string;
  accountRef: string;
  statementDate: string;
  currency: string;
  closingCash: string;
  holdingsMv: string;
  tradeCount: number;
  tradeQuantity: string | null;
  tradeNotional: string | null;
  file: { name: string; size: number; sha256: string } | null;
  sha256: string | null;
  note: string | null;
  status: string;
  supersedesId: string | null;
  supersedeReason: string | null;
  submittedById: string;
  approvedAt: string | null;
  submittedAt: string;
  review?: { decision: string; note: string | null; at: string } | null;
}

export interface Controls {
  executionsReceived: number;
  tradeCount: number;
  matches: boolean;
  quantity?: { declared: string; received: string; matches: boolean };
  notional?: { declared: string; received: string; matches: boolean };
}

export interface StatusEvent {
  id: string;
  executionId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  by: string;
  at: string;
  ref?: string | null;
  tradeRef?: string | null;
}

export interface Notice {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Reads one query parameter after mount (avoids useSearchParams, which forces a Suspense boundary at build). */
export function useInitialParam(name: string): [string | null, boolean] {
  const [value, setValue] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name));
    setReady(true);
  }, [name]);
  return [value, ready];
}

const tz = 'Africa/Harare';
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-GB', { timeZone: iso.length === 10 ? 'UTC' : tz, dateStyle: 'medium' });
export const fmtNum = (v: string | number, dp = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const todayIso = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

/** Downloads text as a file from the browser (client-side templates). */
export function downloadText(filename: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
