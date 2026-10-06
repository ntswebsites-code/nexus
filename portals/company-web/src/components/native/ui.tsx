'use client';

import type { CSSProperties, ReactNode } from 'react';

export const card: CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 };
export const th: CSSProperties = { textAlign: 'left', fontSize: 12, color: '#6b7280', padding: '6px 8px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' };
export const td: CSSProperties = { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
export const input: CSSProperties = { border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 9px', fontSize: 13, minWidth: 0 };
export const btn: CSSProperties = { border: 0, borderRadius: 8, padding: '7px 12px', fontSize: 13, background: '#4f46e5', color: '#fff', cursor: 'pointer' };
export const ghost: CSSProperties = { ...btn, background: '#fff', color: '#111827', border: '1px solid #d1d5db' };
export const row: CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 };
export const muted: CSSProperties = { fontSize: 12, color: '#6b7280' };

export const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
export const money = (currency: string, v: number) => `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section style={card} aria-label={title}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** `rows` is null while loading, so an empty list is never shown as "Nothing recorded yet" before the data arrives. */
export function Table({ head, rows, empty = 'Nothing recorded yet.' }: { head: string[]; rows: ReactNode[][] | null; empty?: string }) {
  if (rows === null) return <p role="status" style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Loading...</p>;
  if (!rows.length) return <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{head.map((h, i) => <th key={`${h}-${i}`} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONES = {
  neutral: { background: '#f3f4f6', color: '#374151' },
  info: { background: '#eef2ff', color: '#3730a3' },
  good: { background: '#ecfdf5', color: '#065f46' },
  warn: { background: '#fffbeb', color: '#92400e' },
  bad: { background: '#fef2f2', color: '#991b1b' },
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span style={{ ...TONES[tone], fontSize: 12, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', display: 'inline-block' }}>{children}</span>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', minWidth: 150, flex: '1 1 150px', background: tone ? TONES[tone].background : '#fff' }}>
      <div style={muted}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: tone ? TONES[tone].color : '#111827' }}>{value}</div>
      {hint && <div style={{ ...muted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function Notice({ kind, text }: { kind: 'ok' | 'err'; text: string }) {
  return (
    <p role={kind === 'err' ? 'alert' : 'status'} style={{ ...card, padding: 10, fontSize: 13, color: kind === 'ok' ? '#065f46' : '#991b1b', background: kind === 'ok' ? '#ecfdf5' : '#fef2f2' }}>
      {text}
    </p>
  );
}
