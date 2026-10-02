'use client';

import { api, v1 } from '../api';
import { useResource } from '../ui';
import type { PortfolioSummary } from '../types';
import type { StaffUser } from './types';

export const risk = (path: string) => v1(`/risk${path}`);

export function useStaffUsers() {
  return useResource<StaffUser[]>(() => api.get<StaffUser[]>(risk('/users')), []);
}

export function usePortfolioOptions() {
  return useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
}

const TONE: Record<string, string> = {
  // limits
  DRAFT: 'grey',
  PENDING_APPROVAL: 'amber',
  ACTIVE: 'green',
  RETIRED: 'grey',
  // breaches
  OPEN: 'red',
  ACKNOWLEDGED: 'amber',
  RESOLVED: 'green',
  // cases
  INVESTIGATING: 'blue',
  CLOSED: 'grey',
  // severity
  LOW: 'grey',
  MEDIUM: 'amber',
  HIGH: 'red',
  CRITICAL: 'red',
  // scenario
  ESCALATE: 'red',
  REVIEW: 'amber',
  WITHIN: 'green',
  BREACH: 'red',
  WARNING: 'amber',
  OK: 'green',
};

/** Coloured pill for any risk status word. */
export function Tone({ value }: { value: string }) {
  const key = value.toUpperCase().replace(/\s+/g, '_');
  return <span className={`ops-badge ${TONE[key] ?? 'grey'}`}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export function UserSelect({
  name,
  users,
  defaultValue,
  required,
  blank,
}: {
  name: string;
  users: StaffUser[];
  defaultValue?: string | null;
  required?: boolean;
  blank?: string;
}) {
  return (
    <select className="ops-input" name={name} required={required} defaultValue={defaultValue ?? ''}>
      {blank !== undefined && <option value="">{blank}</option>}
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

/** Small tab strip built from the console's button styles. */
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
