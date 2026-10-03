'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut, userInitials } from '@matanho/portal-kit/session';
import { useSession } from './session';
import { StepUpHost } from './StepUp';

interface NavItem {
  href: string;
  label: string;
  perms: string[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Fund operations',
    items: [
      { href: '/ops', label: 'Overview', perms: [] },
      { href: '/ops/funds', label: 'Funds & commitments', perms: ['funds.view'] },
      { href: '/ops/capital-calls', label: 'Capital calls', perms: ['capital.view'] },
      { href: '/ops/distributions', label: 'Distributions', perms: ['capital.view', 'distributions.create', 'distributions.approve', 'distributions.settle'] },
      { href: '/ops/notices', label: 'LP notices', perms: ['notices.view'] },
      { href: '/ops/bank-instructions', label: 'Bank instructions', perms: ['clients.view'] },
    ],
  },
  {
    section: 'Portfolio',
    items: [
      { href: '/ops/portfolios', label: 'Portfolios', perms: ['portfolio.view'] },
      { href: '/ops/securities', label: 'Securities & prices', perms: ['portfolio.view', 'research.view', 'orders.view'] },
      { href: '/ops/ibor', label: 'IBOR & Positions', perms: ['portfolio.view'] },
      { href: '/ops/performance', label: 'Performance & Attribution', perms: ['reports.view'] },
    ],
  },
  {
    section: 'Trading',
    items: [{ href: '/ops/orders', label: 'Orders', perms: ['orders.view'] }],
  },
  {
    section: 'Valuation',
    items: [{ href: '/ops/nav', label: 'NAV & valuation', perms: ['valuation.view'] }],
  },
  {
    section: 'Accounting',
    items: [{ href: '/ops/accounting', label: 'Accounting & Close', perms: ['valuation.view'] }],
  },
  {
    section: 'Cash',
    items: [{ href: '/ops/cash', label: 'Cash & Ledgers', perms: ['cash.view'] }],
  },
  {
    section: 'Risk & compliance',
    items: [{ href: '/ops/risk', label: 'Risk & compliance', perms: ['risk.view', 'risk.manage'] }],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops/reconciliation', label: 'Reconciliations', perms: ['operations.view'] },
      { href: '/ops/corporate-actions', label: 'Corporate actions', perms: ['operations.view'] },
    ],
  },
  {
    section: 'Dealing & deals',
    items: [
      { href: '/ops/dealing', label: 'Dealing queue', perms: ['dealing.view'] },
      { href: '/ops/term-sheets', label: 'Term sheets', perms: ['term_sheets.view'] },
      { href: '/ops/investee-requests', label: 'Investee requests', perms: ['research.edit'] },
      { href: '/ops/reporting', label: 'Reporting packs', perms: ['portfolio.view', 'research.edit'] },
    ],
  },
  {
    section: 'Counterparties',
    items: [{ href: '/ops/custodian', label: 'Custodian submissions', perms: ['custodian.view'] }],
  },
];

export function OpsShell({ children }: { children: ReactNode }) {
  const { user, can } = useSession();
  const pathname = usePathname() ?? '/ops';
  const active = (href: string) => (href === '/ops' ? pathname === '/ops' : pathname === href || pathname.startsWith(href + '/'));
  const current = NAV.flatMap((s) => s.items).find((i) => active(i.href));
  const roleLabel = user.roles.filter((r) => r.portal === 'admin').map((r) => r.label).join(', ');

  return (
    <>
      <aside className="ops-sidebar">
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
                const allowed = i.perms.length === 0 || can(...i.perms);
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`${active(i.href) ? 'active' : ''}${allowed ? '' : ' disabled'}`}
                    aria-disabled={!allowed}
                    title={allowed ? undefined : 'Your role does not include this area'}
                  >
                    {i.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="ops-sidebar-foot">
          {/* Plain anchor: the legacy workspace is a different root layout. */}
          <a href="/">← Back to the investment workspace</a>
        </div>
      </aside>
      <div className="ops-main">
        <header className="ops-topbar">
          <span className="ops-crumb">Operations · {current?.label ?? 'Console'}</span>
          <div className="ops-user">
            <div className="ops-avatar">{userInitials(user.name ?? user.email)}</div>
            <div className="ops-user-copy">
              <strong>{user.name ?? user.email}</strong>
              <small>{roleLabel || 'Staff'}</small>
            </div>
            <button className="ops-btn small" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="ops-content">{children}</main>
      </div>
      <StepUpHost />
    </>
  );
}
