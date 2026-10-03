'use client';

import type { ReactNode } from 'react';
import { api, v1 } from './api';
import { formatDecimal } from './money';
import type { PortfolioSummary, SecurityRow } from './types';
import { Field, FormModal, str, useResource } from './ui';

/** Shared bits for the Research & IC, Private Markets, Portfolio Construction and Financing screens. */

export function Tile({ label, value, hint, onClick, active }: { label: string; value: ReactNode; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderColor: active ? 'var(--ops-blue)' : undefined }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}

const TONE: Record<string, string> = {
  DRAFT: 'grey',
  IN_REVIEW: 'amber',
  PENDING_APPROVAL: 'amber',
  PROPOSED: 'amber',
  VOTING: 'blue',
  SCHEDULED: 'blue',
  NOTICED: 'amber',
  ISSUED: 'amber',
  ACKNOWLEDGED: 'blue',
  DISPUTED: 'red',
  PUBLISHED: 'green',
  APPROVED: 'green',
  ACTIVE: 'green',
  PAID: 'green',
  HELD: 'green',
  MET: 'green',
  OK: 'green',
  Pass: 'green',
  Review: 'amber',
  WARNING: 'amber',
  Fail: 'red',
  DEFICIT: 'red',
  REJECTED: 'red',
  WITHDRAWN: 'red',
  CANCELLED: 'red',
  WAIVED: 'grey',
  SUSPENDED: 'amber',
  CLOSED: 'grey',
  ARCHIVED: 'grey',
  RETIRED: 'grey',
  DISCARDED: 'grey',
  ORDERS_CREATED: 'green',
  RELEASED: 'grey',
  NO_DRAWINGS: 'grey',
  BUY: 'green',
  ACCUMULATE: 'green',
  HOLD: 'grey',
  REDUCE: 'amber',
  SELL: 'red',
};

export function Tag({ value, tone }: { value?: string | null; tone?: string }) {
  if (!value) return <span className="ops-badge grey">—</span>;
  return <span className={`ops-badge ${tone ?? TONE[value] ?? 'grey'}`}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export const m2 = (v: string | null | undefined) => formatDecimal(v, 2);
export const m4 = (v: string | null | undefined) => formatDecimal(v, 4);
export const pctText = (v: string | null | undefined, dp = 2) => (v === null || v === undefined ? '—' : `${formatDecimal(v, dp)}%`);
export const ratioText = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${formatDecimal(v, 2)}x`);
export const today = () => new Date().toISOString().slice(0, 10);
export const label = (s?: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : '—');

export function usePortfolios() {
  const r = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  return r.state === 'ok' ? r.data : [];
}
export function useSecurities() {
  const r = useResource<SecurityRow[]>(() => api.get<SecurityRow[]>(v1('/securities')), []);
  return r.state === 'ok' ? r.data : [];
}

export function PortfolioSelect({ name, value, onChange, list, all }: { name?: string; value?: string; onChange?: (v: string) => void; list: PortfolioSummary[]; all?: string }) {
  return (
    <select className="ops-input" name={name} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} required={!all}>
      {all !== undefined ? <option value="">{all}</option> : <option value="">Choose a portfolio</option>}
      {list.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.ref})
        </option>
      ))}
    </select>
  );
}

export function SecuritySelect({ name, list }: { name: string; list: SecurityRow[] }) {
  return (
    <select className="ops-input" name={name} required>
      <option value="">Choose a security</option>
      {list.map((s) => (
        <option key={s.id} value={s.id}>
          {s.ticker} · {s.name}
        </option>
      ))}
    </select>
  );
}

/** A modal that asks for a reason (5+ characters) and sends `{ reason }`. */
export function ReasonModal({ title, submitLabel, hint, onClose, onSubmit, onDone, danger }: { title: string; submitLabel: string; hint?: string; onClose: () => void; onSubmit: (reason: string, key: string) => Promise<unknown>; onDone?: () => void; danger?: boolean }) {
  return (
    <FormModal title={title} submitLabel={submitLabel} danger={danger} onClose={onClose} onSubmit={(fd, key) => onSubmit(str(fd, 'reason'), key)} onDone={onDone}>
      <Field label="Reason" hint={hint ?? 'Recorded in the audit trail'}>
        <textarea className="ops-input" name="reason" rows={3} minLength={5} maxLength={500} required />
      </Field>
    </FormModal>
  );
}

export function DataTable({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <div className="ops-muted" style={{ padding: 12 }}>{empty}</div>}
    </div>
  );
}

export function AccessDenied({ kicker, title, perm }: { kicker: string; title: string; perm: string }) {
  return (
    <>
      <header className="ops-page-head">
        <div>
          <div className="ops-kicker">{kicker}</div>
          <h1>{title}</h1>
        </div>
      </header>
      <div className="ops-alert error" role="alert">
        Your role does not include this page. Ask an administrator for the {perm} permission.
      </div>
    </>
  );
}
