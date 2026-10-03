'use client';

import type { ReactNode } from 'react';
import { apiRequest, qs } from './api';

// Shared helpers for the Clients & Accounts, Investor Services, Onboarding & KYC and Document Vault screens
// (API: /api/v1/client-ops/*, plus the existing /clients, /cash-accounts, /kyc and /documents endpoints).

export const co = (path: string) => `/api/v1/client-ops${path}`;
export const coGet = <T,>(path: string, params?: Record<string, string | undefined | null>) => apiRequest<T>('GET', co(path) + (params ? qs(params) : ''));
export const coPost = <T,>(path: string, body: unknown = {}, key?: string) => apiRequest<T>('POST', co(path), body, key ? { idempotencyKey: key } : undefined);
export const coPut = <T,>(path: string, body: unknown = {}) => apiRequest<T>('PUT', co(path), body);
export const rawGet = <T,>(path: string) => apiRequest<T>('GET', path);
export const rawPost = <T,>(path: string, body: unknown = {}, key?: string) => apiRequest<T>('POST', path, body, key ? { idempotencyKey: key } : undefined);

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

const TONES: [RegExp, string][] = [
  [/breach|reject|fail|high|declin|overdue|held|restricted|disposal/i, 'red'],
  [/risk|pending|review|refer|waiting|propos|due|medium|shell|client action|enhanced|unassigned/i, 'amber'],
  [/ok|track|current|active|pass|approved|low|closed|clear|retained|complete|published|on track/i, 'green'],
];

export function Tone({ value }: { value?: string | null }) {
  if (!value) return <span className="ops-badge grey">-</span>;
  const tone = TONES.find(([re]) => re.test(value))?.[1] ?? 'grey';
  return <span className={`ops-badge ${tone}`}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function Tile({ label, value, hint, warn }: { label: string; value: ReactNode; hint?: string; warn?: boolean }) {
  return (
    <div className="ops-tile" style={warn ? { borderColor: 'var(--ops-amber)' } : undefined}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`ops-btn${value === t.key ? ' primary' : ''}`} type="button" onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function NoAccess({ kicker, title, perm }: { kicker: string; title: string; perm: string }) {
  return (
    <header className="ops-page-head">
      <div>
        <div className="ops-kicker">{kicker}</div>
        <h1>{title}</h1>
        <div className="ops-alert error">Your role does not include this area. Ask an administrator for the {perm} permission.</div>
      </div>
    </header>
  );
}

export function StaffSelect({ staff, name, value, allowNone = true }: { staff: StaffUser[]; name: string; value?: string | null; allowNone?: boolean }) {
  return (
    <select className="ops-input" name={name} defaultValue={value ?? ''}>
      {allowNone && <option value="">Unassigned</option>}
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export const asList = <T,>(x: { data: T[] } | T[]): T[] => (Array.isArray(x) ? x : x.data);
export const hrs = (h: number) => (h >= 48 ? `${Math.round(h / 24)}d` : `${h}h`);
