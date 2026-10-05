'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signOut, userInitials } from '@matanho/portal-kit/session';
import { api, describeError, v1 } from '../api';
import { useSession } from '../session';

export interface RoleFocus {
  role: string | null;
  permissions: string[] | null;
  roles: { key: string; label: string }[];
}

/**
 * Avatar menu: profile link, role switcher and sign out. The role switcher sets the "focus" lens (saved per user): the
 * navigation and command palette show what that role would see. It never changes what the API allows.
 */
export function UserMenu({ focus, onFocus }: { focus: RoleFocus | null; onFocus: (f: RoleFocus) => void }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const roles = user.roles.filter((r) => r.portal === 'admin');
  const roleLabel = roles.map((r) => r.label).join(', ');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function choose(role: string | null) {
    setBusy(true);
    setError('');
    try {
      const r = await api.put<{ role: string | null; permissions: string[] | null }>(v1('/shell/me/role-focus'), { role });
      onFocus({ role: r.role, permissions: r.permissions, roles: roles.map((x) => ({ key: x.key, label: x.label })) });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-pop-wrap" ref={box}>
      <button className="ops-user ops-user-btn" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <div className="ops-avatar">{userInitials(user.name ?? user.email)}</div>
        <div className="ops-user-copy">
          <strong>{user.name ?? user.email}</strong>
          <small>{focus?.role ? `Viewing as ${roles.find((r) => r.key === focus.role)?.label ?? focus.role}` : roleLabel || 'Staff'}</small>
        </div>
      </button>
      {open && (
        <div className="ops-pop ops-user-pop" role="menu">
          <div className="ops-pop-head">
            <div>
              <strong>{user.name ?? user.email}</strong>
              <div className="ops-muted">{user.email}</div>
            </div>
          </div>
          {roles.length > 1 && (
            <div className="ops-pop-section">
              <div className="ops-label">Role focus</div>
              <select className="ops-input" value={focus?.role ?? ''} disabled={busy} onChange={(e) => void choose(e.target.value || null)} aria-label="Role focus">
                <option value="">All my roles</option>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <div className="ops-hint">Changes what the menu shows, not what you are allowed to do.</div>
            </div>
          )}
          {error && <div className="ops-pop-note ops-error-text">{error}</div>}
          <div className="ops-pop-links">
            <Link href="/ops-native/profile" onClick={() => setOpen(false)} role="menuitem">
              Profile, MFA and password
            </Link>
            <Link href="/ops-native/notifications" onClick={() => setOpen(false)} role="menuitem">
              Notifications and preferences
            </Link>
          </div>
          <div className="ops-pop-foot">
            <button className="ops-btn small" type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
