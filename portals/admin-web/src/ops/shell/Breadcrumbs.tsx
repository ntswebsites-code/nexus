'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from './nav';

const SPECIAL: Record<string, string> = {
  '/ops/profile': 'My profile',
  '/ops/notifications': 'Notifications',
  '/ops/security': 'Security controls',
};

/** Breadcrumb trail with a deep link for every level: Operations > Section > Page > Record. */
export function Breadcrumbs() {
  const pathname = usePathname() ?? '/ops';
  const crumbs: { label: string; href?: string }[] = [{ label: 'Operations', href: '/ops' }];

  const record = pathname.match(/^\/ops\/record\/([^/]+)\/([^/]+)/);
  if (record) {
    crumbs.push({ label: 'Records' }, { label: decodeURIComponent(record[1]!).replace(/-/g, ' ') }, { label: decodeURIComponent(record[2]!).slice(0, 8) });
  } else {
    let found = false;
    for (const s of NAV) {
      const item = s.items.find((i) => i.href !== '/ops' && (pathname === i.href || pathname.startsWith(i.href + '/')));
      if (!item) continue;
      found = true;
      crumbs.push({ label: s.section });
      crumbs.push({ label: item.label, href: pathname === item.href ? undefined : item.href });
      const rest = pathname.slice(item.href.length).split('/').filter(Boolean);
      rest.forEach((seg, i) => crumbs.push({ label: decodeURIComponent(seg), href: i === rest.length - 1 ? undefined : `${item.href}/${rest.slice(0, i + 1).join('/')}` }));
      break;
    }
    if (!found) {
      const special = SPECIAL[pathname];
      crumbs.push({ label: special ?? (pathname === '/ops' ? 'Overview' : 'Console') });
    }
  }

  return (
    <nav className="ops-crumb" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`}>
          {i > 0 && <span className="ops-crumb-sep"> / </span>}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
