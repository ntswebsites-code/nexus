'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@matanho/portal-kit/session';
import { api, describeError, qs, v1 } from '../api';
import { useSession } from '../session';
import { NAV } from './nav';

interface Hit {
  kind: string;
  kindLabel: string;
  id: string;
  ref: string | null;
  title: string;
  status: string | null;
  href: string;
}

interface Entry {
  key: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/**
 * Command palette (Ctrl/Cmd+K or "/"): jumps to any console page the role can open, runs shell actions, and searches
 * records across every module through `GET /api/v1/shell/search` (the API filters kinds by the caller's permissions).
 * `focusPerms` is the role-focus lens: when set, only pages that role could open are listed.
 */
export function CommandPalette({ focusPerms }: { focusPerms: string[] | null }) {
  const router = useRouter();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('ops:open-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ops:open-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setHits([]);
      setError('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<{ hits: Hit[] }>(v1(`/shell/search${qs({ q: term, limit: '20' })}`))
        .then((r) => {
          setHits(r.hits);
          setError('');
        })
        .catch((e) => setError(describeError(e)))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const entries = useMemo<Entry[]>(() => {
    const term = q.trim().toLowerCase();
    const pages: Entry[] = NAV.flatMap((s) =>
      s.items
        .filter((i) => (i.perms.length === 0 || can(...i.perms)) && (!focusPerms || i.perms.length === 0 || i.perms.some((p) => focusPerms.includes(p))))
        .map((i) => ({ key: `page:${i.href}`, group: 'Pages', label: i.label, hint: s.section, run: () => go(i.href) })),
    );
    const actions: Entry[] = [
      { key: 'act:profile', group: 'Actions', label: 'Open my profile and security', hint: 'MFA, password, sessions', run: () => go('/ops/profile') },
      { key: 'act:notifications', group: 'Actions', label: 'Open notifications', run: () => go('/ops/notifications') },
      { key: 'act:signout', group: 'Actions', label: 'Sign out', run: () => void signOut() },
    ];
    const match = (e: Entry) => !term || `${e.label} ${e.hint ?? ''}`.toLowerCase().includes(term);
    const recs: Entry[] = hits.map((h) => ({ key: `rec:${h.kind}:${h.id}`, group: 'Records', label: `${h.ref ? `${h.ref} · ` : ''}${h.title}`, hint: `${h.kindLabel}${h.status ? ` · ${h.status}` : ''}`, run: () => go(h.href) }));
    return [...recs, ...pages.filter(match).slice(0, 12), ...actions.filter(match)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, focusPerms, can]);

  if (!open) return null;

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      entries[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <div className="ops-modal-backdrop ops-palette-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="ops-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="ops-palette-input"
          placeholder="Search pages, records (order, portfolio, client, fund, journal, filing...) or type a command"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKey}
          aria-label="Search"
        />
        <div className="ops-palette-list" role="listbox">
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? <div className="ops-palette-group">{e.group}</div> : null;
            lastGroup = e.group;
            return (
              <div key={e.key}>
                {header}
                <button type="button" role="option" aria-selected={i === active} className={`ops-palette-item${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={e.run}>
                  <span>{e.label}</span>
                  {e.hint && <small>{e.hint}</small>}
                </button>
              </div>
            );
          })}
          {searching && <div className="ops-palette-note">Searching records…</div>}
          {error && <div className="ops-palette-note ops-error-text">{error}</div>}
          {!searching && !error && entries.length === 0 && <div className="ops-palette-note">No match. Records need at least two characters.</div>}
        </div>
        <footer className="ops-palette-foot">↑↓ to move · Enter to open · Esc to close</footer>
      </div>
    </div>
  );
}
