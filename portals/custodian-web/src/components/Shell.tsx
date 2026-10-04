'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from '@matanho/portal-kit/session';
import { custodian, platform, useLoad, type Me } from '@/lib/api';
import { Loading } from './ui';

const MeContext = createContext<Me | null>(null);

/** The signed-in counterparty user, role and permissions (GET /custodian/me). */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside the portal shell');
  return me;
}

export const can = (me: Me, permission: string) => me.permissions.includes(permission);

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/executions', label: 'Executions' },
  { href: '/executions/upload', label: 'Bulk upload' },
  { href: '/day-end', label: 'Day-end' },
  { href: '/statements', label: 'Statements and holdings' },
  { href: '/history', label: 'History' },
  { href: '/users', label: 'Users and roles' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/security', label: 'Security' },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const me = useLoad(() => custodian.get<Me>('/me'));
  const unread = useLoad(() => platform.get<{ unread: number }>('/notifications?pageSize=1'), [path]);

  if (!me.data) {
    return (
      <div className="cx-content">
        <Loading loading={me.loading} error={me.error} />
        {me.error && (
          <p>
            <button type="button" className="cx-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        )}
      </div>
    );
  }
  const active = (href: string) => (href === '/' ? path === '/' : path === href || (path.startsWith(`${href}/`) && !NAV.some((n) => n.href !== href && n.href.startsWith(href) && path.startsWith(n.href))));
  return (
    <MeContext.Provider value={me.data}>
      <div className="cx-shell">
        <aside className="cx-side">
          <img src="/assets/matanho-logo.png" alt="Matanho" />
          <div className="cx-org">CUSTODIAN PORTAL</div>
          <nav className="cx-nav" aria-label="Main">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={active(n.href) ? 'on' : ''}>
                {n.label}
                {n.href === '/notifications' && (unread.data?.unread ?? 0) > 0 && <span className="cx-pill">{unread.data!.unread}</span>}
              </a>
            ))}
          </nav>
        </aside>
        <div className="cx-main">
          <div className="cx-top">
            <span className="who">
              {me.data.user.name ?? me.data.user.email} · {me.data.counterparty.name} · {me.data.role}
            </span>
            <button type="button" className="cx-btn sm" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <main className="cx-content">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
