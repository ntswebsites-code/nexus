'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { describeError, newIdempotencyKey, OpsError } from './api';
import { formatMoney, type DecimalLike } from './money';

// ------------------------------------------------------------------ data loading

export type Resource<T> =
  | { state: 'loading'; data?: undefined; error?: undefined }
  | { state: 'ok'; data: T; error?: undefined }
  | { state: 'error'; data?: undefined; error: unknown };

/** Loads `fn()` on mount and whenever `deps` change; `reload()` refetches. */
export function useResource<T>(fn: () => Promise<T>, deps: unknown[] = []): Resource<T> & { reload: () => void } {
  const [res, setRes] = useState<Resource<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setRes((prev) => (prev.state === 'ok' ? prev : { state: 'loading' }));
    fnRef
      .current()
      .then((data) => alive && setRes({ state: 'ok', data }))
      .catch((error: unknown) => alive && setRes({ state: 'error', error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...res, reload };
}

/** Renders loading / not-available / error states, or `children(data)`. */
export function Loaded<T>({ res, children, what }: { res: Resource<T>; children: (data: T) => ReactNode; what?: string }) {
  if (res.state === 'loading') return <div className="ops-loading">Loading{what ? ` ${what}` : ''}…</div>;
  if (res.state === 'error') return <ErrorState error={res.error} what={what} />;
  return <>{children(res.data)}</>;
}

export function ErrorState({ error, what }: { error: unknown; what?: string }) {
  if (error instanceof OpsError && error.notAvailable) {
    return (
      <div className="ops-unavailable" role="status">
        <strong>Not available yet</strong>
        <p>
          The operations API for {what ?? 'this screen'} has not been deployed to this environment yet, so there is
          nothing to show. No demo data is displayed here.
        </p>
      </div>
    );
  }
  if (error instanceof OpsError && error.status === 403) {
    return (
      <div className="ops-alert error" role="alert">
        You do not have permission to view {what ?? 'this'}. {error.message}
      </div>
    );
  }
  if (error instanceof OpsError && error.status === 404) {
    return (
      <div className="ops-alert error" role="alert">
        Not found. It may have been removed, or the link is wrong.
      </div>
    );
  }
  return (
    <div className="ops-alert error" role="alert">
      Could not load {what ?? 'this screen'}: {describeError(error)}
    </div>
  );
}

// ------------------------------------------------------------------ actions

/**
 * One user intent = one Idempotency-Key. The key survives the step-up retry and any
 * manual retry after an error, and is replaced only after a success.
 */
export function useAction() {
  const keyRef = useRef<string>(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(fn: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn(keyRef.current);
      keyRef.current = newIdempotencyKey();
      return result;
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setError(null);
    keyRef.current = newIdempotencyKey();
  }, []);

  return { run, busy, error, clear };
}

// ------------------------------------------------------------------ layout pieces

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ops-page-head">
      <div>
        {kicker && <div className="ops-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="ops-muted">{subtitle}</p>}
      </div>
      {actions && <div className="ops-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="ops-card">
      {(title || actions) && (
        <header className="ops-card-head">
          <h2>{title}</h2>
          {actions && <div className="ops-actions">{actions}</div>}
        </header>
      )}
      <div className="ops-card-body">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ops-empty">{children}</div>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'warn' | 'ok'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`ops-alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

const TONES: Record<string, string> = {
  DRAFT: 'grey',
  PENDING: 'amber',
  PENDING_APPROVAL: 'amber',
  SUBMITTED: 'amber',
  COMPLIANCE_REVIEW: 'amber',
  UNDER_REVIEW: 'amber',
  AWAITING_FUNDS: 'amber',
  AWAITING_NAV: 'amber',
  RECEIVED: 'amber',
  APPROVED: 'blue',
  ISSUED: 'blue',
  VIEWED: 'blue',
  PUBLISHED: 'green',
  ACTIVE: 'green',
  PARTIALLY_PAID: 'amber',
  PAID: 'green',
  COMPLETED: 'green',
  EXECUTED: 'green',
  COUNTERSIGNED: 'green',
  SIGNED_BY_COMPANY: 'blue',
  ACCEPTED: 'green',
  CANCELLED: 'red',
  REJECTED: 'red',
  WITHDRAWN: 'red',
  EXCEPTION: 'red',
  EXPIRED: 'grey',
  CLOSED: 'grey',
  SUPERSEDED: 'grey',
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="ops-badge grey">—</span>;
  const key = status.toUpperCase().replace(/\s+/g, '_');
  return <span className={`ops-badge ${TONES[key] ?? 'grey'}`}>{status.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function Money({ value, currency }: { value: DecimalLike; currency?: string | null }) {
  return <span className="ops-num">{formatMoney(value, currency)}</span>;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function DateText({ value, time }: { value?: string | null; time?: boolean }) {
  return <span>{time ? formatDateTime(value) : formatDate(value)}</span>;
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="ops-dl">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ modal + forms

export function Modal({
  title,
  kicker,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  kicker?: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ops-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`ops-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <header className="ops-modal-head">
          <div>
            {kicker && <div className="ops-kicker">{kicker}</div>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="ops-modal-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * A modal form bound to one intent: submits through `useAction` (so the same Idempotency-Key
 * is reused across step-up and retries) and closes on success.
 */
export function FormModal({
  title,
  kicker,
  subtitle,
  submitLabel,
  onClose,
  onSubmit,
  onDone,
  children,
  wide,
  danger,
  disabled,
}: {
  title: ReactNode;
  kicker?: string;
  subtitle?: ReactNode;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (form: FormData, idempotencyKey: string) => Promise<unknown>;
  onDone?: (result: unknown) => void;
  children?: ReactNode;
  wide?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const action = useAction();
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    let ok = false;
    const result = await action.run(async (key) => {
      const r = await onSubmit(fd, key);
      ok = true;
      return r;
    });
    if (ok) {
      onDone?.(result);
      onClose();
    }
  }
  return (
    <Modal title={title} kicker={kicker} subtitle={subtitle} onClose={onClose} wide={wide}>
      <form onSubmit={handle}>
        <div className="ops-modal-body">
          {children}
          <Alert>{action.error}</Alert>
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn" type="button" onClick={onClose} disabled={action.busy}>
            Cancel
          </button>
          <button className={`ops-btn ${danger ? 'danger' : 'primary'}`} type="submit" disabled={action.busy || disabled}>
            {action.busy ? 'Working…' : submitLabel}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function Field({
  label,
  hint,
  children,
  span,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  span?: 2;
}) {
  return (
    <label className={`ops-field${span === 2 ? ' span2' : ''}`}>
      <span className="ops-label">{label}</span>
      {children}
      {hint && <span className="ops-hint">{hint}</span>}
    </label>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="ops-grid">{children}</div>;
}

/** Inline action button with its own intent key, busy state and error line. */
export function ActionButton({
  label,
  onRun,
  onDone,
  primary,
  danger,
  disabled,
  title,
  confirm,
}: {
  label: string;
  onRun: (idempotencyKey: string) => Promise<unknown>;
  onDone?: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  confirm?: string;
}) {
  const action = useAction();
  return (
    <span className="ops-action-wrap">
      <button
        className={`ops-btn${primary ? ' primary' : ''}${danger ? ' danger' : ''}`}
        type="button"
        title={title}
        disabled={disabled || action.busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          let ok = false;
          await action.run(async (key) => {
            await onRun(key);
            ok = true;
          });
          if (ok) onDone?.();
        }}
      >
        {action.busy ? 'Working…' : label}
      </button>
      {action.error && <span className="ops-error-text">{action.error}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ form value helpers

export function str(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '').trim();
}

export function optStr(fd: FormData, name: string): string | undefined {
  const v = str(fd, name);
  return v ? v : undefined;
}

/** Decimal string as typed (commas removed); validation is the caller's. */
export function amount(fd: FormData, name: string): string {
  return str(fd, name).replace(/,/g, '');
}
