'use client';

import { api, apiRequest, v1 } from '../api';
import { useResource } from '../ui';
import type { PortfolioSummary } from '../types';
import type { CounterpartyOption, StaffUser } from './types';

export const recon = (path: string) => v1(`/recon${path}`);

/** `{ data, ... }` responses where the console needs more than `data` (breaks, allowed, events). */
export const reconFull = <T,>(method: string, path: string, body?: unknown, idempotencyKey?: string) =>
  apiRequest<T>(method, recon(path), body, idempotencyKey ? { idempotencyKey } : undefined);

export function useStaffUsers() {
  return useResource<StaffUser[]>(() => api.get<StaffUser[]>(recon('/users')), []);
}

export function useCounterparties() {
  return useResource<CounterpartyOption[]>(() => api.get<CounterpartyOption[]>(recon('/counterparties')), []);
}

export function usePortfolioOptions() {
  return useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
}

const TONE: Record<string, string> = {
  LOW: 'grey',
  MEDIUM: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
  NEW: 'red',
  ASSIGNED: 'amber',
  INVESTIGATING: 'blue',
  PENDING_CHECKER: 'amber',
  MATCHED: 'green',
  CLOSED: 'grey',
  CLEAN: 'green',
  BREAKS: 'red',
  SOURCE_MISSING: 'amber',
};

export function Tone({ value }: { value: string }) {
  const key = value.toUpperCase().replace(/\s+/g, '_');
  const strong = key === 'CRITICAL' ? { fontWeight: 800, outline: '1px solid currentColor' } : undefined;
  return (
    <span className={`ops-badge ${TONE[key] ?? 'grey'}`} style={strong}>
      {value.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
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

export function ageText(days: number, hours: number): string {
  if (days >= 1) return `${days}d`;
  return `${hours}h`;
}

/** Render a stored internal / external value object as short "key: value" pairs. */
export function ValueBox({ value, empty }: { value: Record<string, unknown> | null; empty: string }) {
  if (!value) return <div className="ops-muted">{empty}</div>;
  const rows = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl className="ops-dl">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</dt>
          <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
