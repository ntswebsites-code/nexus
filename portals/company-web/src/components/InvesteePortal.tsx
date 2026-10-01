'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSessionUser, userInitials } from '@matanho/portal-kit/session';
import { IP8_PAGE_TO_PATH, pathToIp8Page } from '@/lib/nav';
import { startInvesteePortalV8Runtime } from '@/components/investee-portal-v8-mock/matanho-investee-portal-runtime';
import { INVESTEE_PORTAL_V8_SHELL_HTML } from '@/components/investee-portal-v8-mock/shell';
import '@/components/investee-portal-v8-mock/investee-portal-v8.css';
import '@/components/investee-portal-v8-mock/investee-portal-v8-overrides.css';

type RuntimeApi = { setPage: (page: string) => void; destroy: () => void };

declare global {
  interface Window {
    __CLIENT_DESIGN_SESSION_USER__?: { name: string; email: string; role: string; initials: string };
    __CLIENT_DESIGN_SIGN_OUT__?: () => void;
  }
}

/**
 * Hosts the Investee portal runtime. The pages run on the demo data built into the runtime
 * (liveOnly: false); the signed-in user only supplies the name shown in the profile and the
 * Sign out action.
 */
export function InvesteePortal() {
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<RuntimeApi | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const user = useSessionUser();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    window.__CLIENT_DESIGN_SIGN_OUT__ = () => void signOut();
    apiRef.current = startInvesteePortalV8Runtime(el, {
      shellHtml: INVESTEE_PORTAL_V8_SHELL_HTML,
      initialPage: pathToIp8Page(pathnameRef.current),
      liveOnly: false,
      onNavigate: (page: string) => {
        const path = IP8_PAGE_TO_PATH[page] || '/';
        if (pathnameRef.current !== path) router.push(path);
      },
    });

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
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
    if (!user || !root) return;
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
  }, [user]);

  return (
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#f3f6fb' }}>
      <div ref={rootRef} className="investee-portal-v8-root" data-theme="light" style={{ height: '100%' }} />
    </div>
  );
}
