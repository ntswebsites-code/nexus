'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSessionUser, userInitials } from '@matanho/portal-kit/session';
import { IP8_PAGE_TO_PATH, pathToIp8Page } from '@/lib/nav';
import { startInvesteePortalV8Runtime } from '@/components/investee-portal-v8-mock/matanho-investee-portal-runtime';
import { INVESTEE_PORTAL_V8_SHELL_HTML } from '@/components/investee-portal-v8-mock/shell';
import { createInvesteeApi, loadHealth, loadPlatformFlags, setStepUpHandler } from '@/lib/investee/api';
import { createInvesteeHost, type ActionDetail, type InvesteeHost } from '@/lib/investee/host';
import type { InvesteeLivePayload } from '@/lib/investee/types';
import { DemoRibbon } from '@/components/DemoRibbon';
import { StepUpDialog } from '@/components/StepUpDialog';
import '@/components/investee-portal-v8-mock/investee-portal-v8.css';
import '@/components/investee-portal-v8-mock/investee-portal-v8-overrides.css';

type RuntimeApi = { setPage: (page: string) => void; destroy: () => void };

declare global {
  interface Window {
    __CLIENT_DESIGN_SESSION_USER__?: { name: string; email: string; role: string; initials: string };
    __CLIENT_DESIGN_SIGN_OUT__?: () => void;
  }
}

const FLAGS_TIMEOUT_MS = 6000;

/**
 * INO-016: a failed or slow settings call is retried, and when it still fails the portal shows an error with a
 * Retry button. It never falls back to the sample company, because that looks like the user's real data.
 */
async function loadLiveActions(): Promise<{ liveActions: string[] } | { failed: true }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const flags = await Promise.race([
        loadPlatformFlags(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), FLAGS_TIMEOUT_MS)),
      ]);
      return { liveActions: Array.isArray(flags?.investee?.liveActions) ? flags.investee.liveActions : [] };
    } catch {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  return { failed: true };
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'U'
  );
}

/**
 * Hosts the Investee portal runtime. Pages whose loaders are in the platform allowlist
 * (`investee.liveActions`) render live data from `/api/v1/investee-portal`; every other page keeps
 * the runtime's demo data and shows the "Demo data" ribbon. Allowlisted actions are taken over from
 * the runtime's demo handlers and persisted through the API.
 */
export function InvesteePortal() {
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<RuntimeApi | null>(null);
  const hostRef = useRef<InvesteeHost | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const user = useSessionUser();
  const [livePages, setLivePages] = useState<string[] | null>(null);
  const [flagsNote, setFlagsNote] = useState<string | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [noCompany, setNoCompany] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [stepUp, setStepUp] = useState<{ reason: string; mode: 'verify' | 'enroll'; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    let busy = false;
    const listeners: Array<[string, EventListener]> = [];

    window.__CLIENT_DESIGN_SIGN_OUT__ = () => void signOut();
    setStepUpHandler(
      (err) =>
        new Promise<boolean>((resolve) =>
          setStepUp({ reason: err.message, mode: err.code === 'mfa_enrolment_required' ? 'enroll' : 'verify', resolve }),
        ),
    );

    setLoadFailed(false);
    void loadLiveActions().then((result) => {
      if (cancelled) return;
      if ('failed' in result) {
        setLoadFailed(true);
        return;
      }
      const { liveActions } = result;
      const host = createInvesteeHost(createInvesteeApi(liveActions), () => window.MatanhoInvesteeUI, {
        enrolMfa: () =>
          new Promise<boolean>((resolve) => setStepUp({ reason: '', mode: 'enroll', resolve })),
        onLoaded: (payload) => {
          if (cancelled) return;
          setNoCompany(payload.noCompany);
          applyChrome(el, payload);
          setProfileVersion((v) => v + 1);
        },
      });
      hostRef.current = host;
      setFlagsNote(undefined);
      setLivePages(host.livePages);

      apiRef.current = startInvesteePortalV8Runtime(el, {
        shellHtml: INVESTEE_PORTAL_V8_SHELL_HTML,
        initialPage: pathToIp8Page(pathnameRef.current),
        liveOnly: host.livePages.length > 0,
        livePages: host.livePages,
        onNavigate: (page: string) => {
          const path = IP8_PAGE_TO_PATH[page] || '/';
          if (pathnameRef.current !== path) router.push(path);
        },
      });
      void host.reload();

      const onBeforeAction = (event: Event) => {
        const detail = ((event as CustomEvent).detail || {}) as ActionDetail;
        if (!host.intercepts(detail)) return;
        event.preventDefault();
        if (busy) return;
        busy = true;
        const ui = () => window.MatanhoInvesteeUI;
        void host.handle(detail).then((result) => {
          busy = false;
          if (result.error) {
            // Validation problems are shown on the open form as well as in the toast.
            ui()?.inlineError?.(result.error);
            ui()?.notify?.('Request failed', result.error, 'error');
          }
          else if (result.message) ui()?.notify?.(result.message, result.detail ?? '', 'success');
        });
      };
      const onReload = () => {
        void host.reload();
      };
      listeners.push(['matanho:before-action', onBeforeAction], ['investee:reload-request', onReload]);
      for (const [name, fn] of listeners) window.addEventListener(name, fn);
    });

    return () => {
      cancelled = true;
      for (const [name, fn] of listeners) window.removeEventListener(name, fn);
      setStepUpHandler(null);
      apiRef.current?.destroy();
      apiRef.current = null;
      hostRef.current = null;
      delete window.__CLIENT_DESIGN_SIGN_OUT__;
    };
    // The runtime is started once per attempt; later route changes go through setPage below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    apiRef.current?.setPage(pathToIp8Page(pathname));
  }, [pathname]);

  useEffect(() => {
    const root = rootRef.current;
    if (!user || !root || livePages === null) return;
    const name = user.name ?? user.email;
    const profile = hostRef.current?.getPayload()?.profile;
    const detail = {
      name,
      email: user.email,
      role: profile?.title || (profile?.accessProfile ?? '').replace(/_/g, ' ') || 'Company user',
      initials: userInitials(name),
    };
    window.__CLIENT_DESIGN_SESSION_USER__ = detail;
    window.dispatchEvent(new CustomEvent('client-design-session-user', { detail }));
    // The runtime updates the name; the role line and avatar initials it leaves as the demo persona.
    const avatar = root.querySelector('.topbar .profile-avatar');
    const role = root.querySelector('.topbar .profile-copy span');
    if (avatar) avatar.textContent = detail.initials;
    if (role) role.textContent = detail.role;
    // Re-render the current page so the dashboard greeting picks up the name.
    apiRef.current?.setPage(pathToIp8Page(pathnameRef.current));
    return () => {
      delete window.__CLIENT_DESIGN_SESSION_USER__;
    };
  }, [user, livePages, profileVersion]);

  const page = pathToIp8Page(pathname);
  const showRibbon = livePages !== null && !loadFailed && !noCompany && !livePages.includes(page);

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#f3f6fb' }}>
      <div
        ref={rootRef}
        className="investee-portal-v8-root"
        data-theme="light"
        data-live-pages={livePages?.join(' ') ?? ''}
        style={{ height: '100%', display: loadFailed || noCompany ? 'none' : undefined }}
      />
      {loadFailed && (
        <StatusPanel
          title="The portal could not load your data"
          text="Your company data could not be loaded, so nothing is shown rather than sample figures. Check your connection and try again."
          action={{ label: 'Retry', onClick: () => setAttempt((n) => n + 1) }}
        />
      )}
      {noCompany && (
        <StatusPanel
          title="This account is not linked to a portfolio company"
          text="You are signed in as a different kind of user, so there is no company workspace to show. Sign out and use your company account, or ask your workspace administrator to invite you."
          action={{ label: 'Sign out', onClick: () => void signOut() }}
        />
      )}
      {showRibbon && <DemoRibbon note={flagsNote} />}
      {livePages !== null && !loadFailed && !noCompany && (
        <a
          href="/workspace"
          style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 50, background: '#4f46e5', color: '#fff', padding: '9px 14px', borderRadius: 999, fontSize: 13, textDecoration: 'none', boxShadow: '0 6px 18px rgba(79,70,229,.35)' }}
        >
          Workspace tools
        </a>
      )}
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

/** Centered notice used instead of the portal shell (load failure, account with no company). */
function StatusPanel({ title, text, action }: { title: string; text: string; action: { label: string; onClick: () => void } }) {
  return (
    <div role="alert" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 16, background: '#f3f6fb', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <div style={{ maxWidth: 460, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, boxShadow: '0 10px 30px rgba(15,23,42,.08)' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 19 }}>{title}</h1>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#4b5563' }}>{text}</p>
        <button onClick={action.onClick} style={{ border: 0, borderRadius: 9, padding: '9px 16px', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
          {action.label}
        </button>
      </div>
    </div>
  );
}

/** INO-005/006: sidebar company card, fund, period selector and footer come from the live records. */
function applyChrome(root: HTMLElement, payload: InvesteeLivePayload) {
  const companyName = payload.profile?.company?.name ?? payload.company?.name ?? '';
  const fundName = payload.profile?.company?.fundName ?? payload.company?.fund?.name ?? '';
  const card = root.querySelector('.company-card');
  if (card && companyName) {
    const strong = card.querySelector('.company-copy strong');
    const span = card.querySelector('.company-copy span');
    const avatar = card.querySelector('.company-avatar');
    if (strong) strong.textContent = companyName;
    if (span) span.textContent = fundName || 'Matanho portfolio company';
    if (avatar) avatar.textContent = initials(companyName);
  }
  // The shell's period selector is a fixed demo list and drives nothing; periods live in the Reporting Centre.
  const period = root.querySelector<HTMLElement>('#periodSelect');
  if (period) period.style.display = 'none';
  void loadHealth().then((ok) => {
    const health = root.querySelector('.system-health');
    const label = health?.querySelector('span:last-child');
    const dot = health?.querySelector<HTMLElement>('.health-dot');
    if (label) label.textContent = ok ? 'Connected to Matanho' : 'Service unavailable';
    if (dot) dot.style.background = ok ? '' : '#dc2626';
  });
}
