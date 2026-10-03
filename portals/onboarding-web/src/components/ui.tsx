'use client';

import type { ReactNode } from 'react';
import type { Field } from '@/lib/fields';

export function Shell({ children, pill }: { children: ReactNode; pill?: string }) {
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden />
          matanho
        </a>
        <div className="top-meta">
          <span className="secure-pill">
            <i className="secure-dot" />
            Encrypted submission workflow
          </span>
          {pill ? <span className="secure-pill">{pill}</span> : null}
        </div>
      </header>
      {children}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
  error,
  onFile,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onFile?: boolean;
}) {
  const id = `f-${field.key}`;
  const common = {
    id,
    value,
    required: field.required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : undefined,
    placeholder: field.placeholder,
  };
  return (
    <label className={`field${field.wide ? ' wide' : ''}${error ? ' has-error' : ''}`} htmlFor={id}>
      <span>
        {field.label}
        {field.required ? <b aria-hidden> *</b> : null}
        {field.hint ? <em> {field.hint}</em> : null}
      </span>
      {field.type === 'select' ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea {...common} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type={field.type ?? 'text'} min={field.type === 'number' ? 0 : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {onFile ? <small className="muted">On file. Leave blank to keep it.</small> : null}
      {error ? (
        <small id={`${id}-err`} className="err">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export const fmtSize = (n: number | null | undefined) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
