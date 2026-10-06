'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { signOut, useSessionUser } from '@matanho/portal-kit/session';
import { createInvesteeApi, InvesteeApiError, setStepUpHandler, type InvesteeApi } from '@/lib/investee/api';
import { PORTAL_NAV, cleanPath, nativePageFor } from '@/lib/native-pages';
import { StepUpDialog } from '@/components/StepUpDialog';
import { Notice, money } from './ui';

export type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;

interface NativeCtx {
  api: InvesteeApi;
  run: Run;
  /** Signed-in user id, for requester-only actions (the server enforces them too). */
  meId: string | null;
}

const Ctx = createContext<NativeCtx | null>(null);

export function useNative(): NativeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNative must be used inside NativeShell');
  return ctx;
}

/** One line for the notice bar; the tranche refusal also states what is still available (BR-229). */
export function describeError(e: unknown): string {
  if (!(e instanceof InvesteeApiError)) return 'Something went wrong';
  if (e.code === 'tranche_exceeded' && e.details && typeof e.details === 'object') {
    const d = e.details as { available?: number; requested?: number };
    if (typeof d.available === 'number' && typeof d.requested === 'number') {
      return `${e.message} Available: ${money('', d.available).trim()}; requested: ${money('', d.requested).trim()}.`;
    }
  }
  return e.describe();
}

/**
 * Chrome for the native investee screens: sidebar with every portal page (runtime pages are plain links, so the
 * router mounts the runtime for them), notice bar, step-up prompt, and the API bound to the live allowlist.
 */
export function NativeShell({ liveActions, pathname, children }: { liveActions: readonly string[]; pathname: string; children: ReactNode }) {
  const api = useMemo(() => createInvesteeApi(liveActions), [liveActions]);
  const user = useSessionUser();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [company, setCompany] = useState<{ name: string; fund: string } | null>(null);
  const [stepUp, setStepUp] = useState<{ reason: string; mode: 'verify' | 'enroll'; resolve: (ok: boolean) => void } | null>(null);
  const here = cleanPath(pathname);

  useEffect(() => {
    setStepUpHandler((err) => new Promise<boolean>((resolve) => setStepUp({ reason: err.message, mode: err.code === 'mfa_enrolment_required' ? 'enroll' : 'verify', resolve })));
    return () => setStepUpHandler(null);
  }, []);

  useEffect(() => {
    if (!api.isLive('profile')) return;
    api
      .getProfile()
      .then((p) => {
        const co = (p as { company?: { name?: string; fundName?: string } }).company;
        if (co?.name) setCompany({ name: co.name, fund: co.fundName ?? '' });
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => setMsg(null), [here]);

  const run = useCallback<Run>(async (label, fn) => {
    try {
      const out = await fn();
      if (label) setMsg({ kind: 'ok', text: label });
      return out;
    } catch (e) {
      setMsg({ kind: 'err', text: describeError(e) });
      return undefined;
    }
  }, []);

  const ctx = useMemo(() => ({ api, run, meId: user?.id ?? null }), [api, run, user?.id]);
  const title = nativePageFor(here)?.title ?? '';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100dvh', background: '#f3f6fb', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <aside style={{ flex: '0 0 220px', background: '#fff', borderRight: '1px solid #e5e7eb', padding: '16px 12px' }}>
        <div style={{ marginBottom: 16 }}>
          <strong style={{ display: 'block', fontSize: 14 }}>{company?.name ?? 'Investee portal'}</strong>
          <span style={{ fontSize: 12, color: '#6b7280' }}>{company?.fund || 'Matanho portfolio company'}</span>
        </div>
        <nav aria-label="Portal pages">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {PORTAL_NAV.map((item) => {
              const current = item.path === here;
              return (
                <li key={item.path}>
                  <Link
                    href={item.path}
                    aria-current={current ? 'page' : undefined}
                    style={{ display: 'block', padding: '7px 10px', borderRadius: 8, fontSize: 13, textDecoration: 'none', color: current ? '#fff' : '#111827', background: current ? '#4f46e5' : 'transparent' }}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <a href="/workspace" style={{ display: 'block', padding: '7px 10px', fontSize: 13, color: '#4f46e5' }}>Workspace tools</a>
            </li>
          </ul>
        </nav>
        <button type="button" onClick={() => void signOut()} style={{ marginTop: 16, border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>
          Sign out
        </button>
      </aside>
      <main style={{ flex: '1 1 600px', minWidth: 0, padding: '20px 20px 60px', maxWidth: 1200 }}>
        <h1 style={{ margin: '0 0 14px', fontSize: 22 }}>{title}</h1>
        {msg && <Notice kind={msg.kind} text={msg.text} />}
        <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
      </main>
      {stepUp && (
        <StepUpDialog
          reason={stepUp.reason}
          mode={stepUp.mode}
          onDone={(ok) => {
            stepUp.resolve(ok);
            setStepUp(null);
          }}
        />
      )}
    </div>
  );
}
