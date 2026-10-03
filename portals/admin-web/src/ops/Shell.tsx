'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, v1 } from './api';
import { useSession } from './session';
import { StepUpHost } from './StepUp';
import { NAV } from './shell/nav';
import { Breadcrumbs } from './shell/Breadcrumbs';
import { CommandPalette } from './shell/CommandPalette';
import { NotificationBell } from './shell/NotificationBell';
import { UserMenu, type RoleFocus } from './shell/UserMenu';
import { IntegrationsBanner } from './IntegrationsBanner';

export function OpsShell({ children }: { children: ReactNode }) {
  const { user, can } = useSession();
  const pathname = usePathname() ?? '/ops';
  const active = (href: string) => (href === '/ops' ? pathname === '/ops' : pathname === href || pathname.startsWith(href + '/'));
  const [focus, setFocus] = useState<RoleFocus | null>(null);
  useEffect(() => {
    api.get<RoleFocus>(v1('/shell/me/role-focus')).then(setFocus).catch(() => setFocus(null));
  }, [user.id]);
  const focusPerms = focus?.permissions ?? null;
  // Mobile: the sidebar is an off-canvas drawer opened from the top bar (ISS-ADB-026).
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [pathname]);

  return (
    <>
      {navOpen && <div className="ops-nav-scrim" role="presentation" onClick={() => setNavOpen(false)} />}
      <aside className={`ops-sidebar${navOpen ? ' open' : ''}`} id="ops-sidebar">
        <div className="ops-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/matanho-logo.png" alt="Matanho" />
        </div>
        <div className="ops-chip">
          OPERATIONS CONSOLE
          <small>Live data · maker/checker controls</small>
        </div>
        <nav className="ops-nav" aria-label="Operations">
          {NAV.map((s) => (
            <div key={s.section}>
              <div className="ops-nav-section">{s.section}</div>
              {s.items.map((i) => {
                const allowed = (i.perms.length === 0 || can(...i.perms)) && (!focusPerms || i.perms.length === 0 || i.perms.some((p) => focusPerms.includes(p)));
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`${active(i.href) ? 'active' : ''}${allowed ? '' : ' disabled'}`}
                    aria-disabled={!allowed}
                    title={allowed ? undefined : focusPerms && can(...i.perms) ? 'Outside the role you are viewing as' : 'Your role does not include this area'}
                  >
                    {i.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="ops-main">
        <header className="ops-topbar">
          <button
            className="ops-nav-toggle"
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={navOpen}
            aria-controls="ops-sidebar"
            onClick={() => setNavOpen((o) => !o)}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <Breadcrumbs />
          <div className="ops-topbar-tools">
            <button className="ops-search-btn" type="button" onClick={() => window.dispatchEvent(new Event('ops:open-palette'))} aria-label="Search and commands (Ctrl+K)">
              <span>Search pages and records</span>
              <kbd>Ctrl K</kbd>
            </button>
            <NotificationBell />
            <UserMenu focus={focus} onFocus={setFocus} />
          </div>
        </header>
        <main className="ops-content">
          <IntegrationsBanner />
          {children}
        </main>
      </div>
      <CommandPalette focusPerms={focusPerms} />
      <StepUpHost />
    </>
  );
}
