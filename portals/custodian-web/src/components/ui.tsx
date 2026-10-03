'use client';

import { useEffect, type ReactNode } from 'react';

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="cx-card">
      {(title || actions) && (
        <header className="cx-card-head">
          <h2>{title}</h2>
          <div className="cx-actions">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="cx-pagehead">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="cx-actions">{actions}</div>
    </div>
  );
}

const TONES: Record<string, string> = {
  Received: 'info',
  Draft: 'muted',
  Approved: 'ok',
  Accepted: 'ok',
  Matched: 'ok',
  Exception: 'bad',
  Queried: 'warn',
  Rejected: 'bad',
  Cancelled: 'muted',
  Superseded: 'muted',
  Imported: 'ok',
  Failed: 'bad',
  active: 'ok',
  inactive: 'muted',
};

export function Badge({ value }: { value: string }) {
  return <span className={`cx-badge ${TONES[value] ?? 'muted'}`}>{value}</span>;
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'ok' | 'error' | 'warn'; children: ReactNode }) {
  return (
    <div className={`cx-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="cx-empty">{children}</p>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="cx-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Stat({ label, value, tone, href }: { label: string; value: ReactNode; tone?: string; href?: string }) {
  const body = (
    <>
      <span className="cx-stat-label">{label}</span>
      <strong className={tone ?? ''}>{value}</strong>
    </>
  );
  return href ? (
    <a className="cx-stat" href={href}>
      {body}
    </a>
  ) : (
    <div className="cx-stat">{body}</div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="cx-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`cx-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="cx-btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div className="cx-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Loading({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <Notice kind="error">{error}</Notice>;
  return loading ? <p className="cx-empty">Loading...</p> : null;
}

export function ControlRow({ label, declared, received, ok }: { label: string; declared: string; received: string; ok: boolean }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{declared}</td>
      <td className="num">{received}</td>
      <td>
        <span className={`cx-badge ${ok ? 'ok' : 'bad'}`}>{ok ? 'Agrees' : 'Differs'}</span>
      </td>
    </tr>
  );
}
