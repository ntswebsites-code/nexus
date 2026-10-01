'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSessionUser, userInitials } from '@matanho/portal-kit/session';
import { IP8_PAGE_TO_PATH, pathToIp8Page } from '@/lib/nav';
import { startInvesteePortalV8Runtime } from '@/components/investee-portal-v8-mock/matanho-investee-portal-runtime';
import { INVESTEE_PORTAL_V8_SHELL_HTML } from '@/components/investee-portal-v8-mock/shell';
import { createInvesteeApi, loadPlatformFlags, setStepUpHandler } from '@/lib/investee/api';
import { createInvesteeHost, type ActionDetail, type InvesteeHost } from '@/lib/investee/host';
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

async function loadLiveActions(): Promise<{ liveActions: string[]; note?: string }> {
  try {
    const flags = await Promise.race([
      loadPlatformFlags(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), FLAGS_TIMEOUT_MS)),
    ]);
    return { liveActions: Array.isArray(flags?.investee?.liveActions) ? flags.investee.liveActions : [] };
  } catch {
    return { liveActions: [], note: 'live settings could not be loaded' };
  }
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
  const [stepUp, setStepUp] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    let busy = false;
    const listeners: Array<[string, EventListener]> = [];

    window.__CLIENT_DESIGN_SIGN_OUT__ = () => void signOut();
    setStepUpHandler(
      (err) => new Promise<boolean>((resolve) => setStepUp({ reason: err.message, resolve })),
    );

    void loadLiveActions().then(({ liveActions, note }) => {
      if (cancelled) return;
      const host = createInvesteeHost(createInvesteeApi(liveActions), () => window.MatanhoInvesteeUI);
      hostRef.current = host;
      setFlagsNote(note);
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
          if (result.error) ui()?.notify?.('Request failed', result.error, 'error');
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
    // The runtime is started once; later route changes go through setPage below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.setPage(pathToIp8Page(pathname));
  }, [pathname]);

  useEffect(() => {
    const root = rootRef.current;
    if (!user || !root || livePages === null) return;
    const name = user.name ?? user.email;
    const detail = {
      name,
      email: user.email,
      role: user.roles[0]?.label ?? 'Portfolio company user',
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
  }, [user, livePages]);

  const page = pathToIp8Page(pathname);
  const showRibbon = livePages !== null && !livePages.includes(page);

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#f3f6fb' }}>
      <div ref={rootRef} className="investee-portal-v8-root" data-theme="light" data-live-pages={livePages?.join(' ') ?? ''} style={{ height: '100%' }} />
      {showRibbon && <DemoRibbon note={flagsNote} />}
      {stepUp && (
        <StepUpDialog
          reason={stepUp.reason}
          onDone={(ok) => {
            stepUp.resolve(ok);
            setStepUp(null);
          }}
        />
      )}
    </div>
  );
}
