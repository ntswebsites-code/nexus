'use client';

import type { ReactNode } from 'react';
import { apiBase, apiRequest, OpsError } from './api';

/** Shared helpers for the Reports, Regulatory, Data Fabric and Model Governance screens. */

/** Full JSON payload (`{ data, total, counts ... }`) of a GET. */
export const full = <T,>(path: string) => apiRequest<T>('GET', path);

/** Opens a signed, short-lived download link issued by a `.../link` endpoint. */
export async function openLink(linkPath: string) {
  const r = await apiRequest<{ data: { url: string } }>('GET', linkPath);
  window.open(r.data.url, '_blank', 'noopener');
}

/** Multipart upload (the shared client sends JSON only). */
export async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData();
  fd.set('file', file);
  for (const [k, v] of Object.entries(fields)) if (v) fd.set(k, v);
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, { method: 'POST', body: fd, credentials: 'include', cache: 'no-store' });
  } catch {
    throw new OpsError(0, 'network_error', 'The API could not be reached. Check your connection and try again.');
  }
  const json = (await res.json().catch(() => undefined)) as { data?: T; error?: { code?: string; message?: string; details?: unknown } } | undefined;
  if (!res.ok) throw new OpsError(res.status, json?.error?.code ?? 'http_error', json?.error?.message ?? `Upload failed with status ${res.status}`, json?.error?.details);
  return json?.data as T;
}

/** Saves text produced in the browser from data already fetched from the API (for example a filing CSV). */
export function saveText(filename: string, text: string, mime = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TONES: Record<string, string> = {
  PASS: 'green',
  PASS_WITH_FINDINGS: 'amber',
  FAIL: 'red',
  ERROR: 'red',
  FAILED: 'red',
  OVERDUE: 'red',
  OPEN: 'red',
  ACKNOWLEDGED: 'amber',
  RESOLVED: 'green',
  WAIVED: 'grey',
  SUPERSEDED: 'grey',
  SUCCEEDED: 'green',
  COMPLETED: 'green',
  ACTIVE: 'green',
  PAUSED: 'grey',
  DRAFT: 'grey',
  IN_REVIEW: 'amber',
  IN_VALIDATION: 'amber',
  SUBMITTED: 'blue',
  VALIDATED: 'blue',
  APPROVED: 'green',
  RETURNED: 'red',
  REJECTED: 'red',
  RETIRED: 'grey',
  HIGH: 'red',
  MEDIUM: 'amber',
  LOW: 'grey',
};

export function Tone({ value }: { value?: string | null }) {
  if (!value) return <span className="ops-badge grey">-</span>;
  const key = value.toUpperCase().replace(/\s+/g, '_');
  return <span className={`ops-badge ${TONES[key] ?? 'grey'}`}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}

export const label = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export function Tiles({ items }: { items: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green' }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
      {items.map((t) => (
        <div key={t.label} className="ops-card" style={{ padding: '12px 14px' }}>
          <div className="ops-muted" style={{ fontSize: 12 }}>
            {t.label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: t.tone === 'red' ? 'var(--ops-red, #b42318)' : t.tone === 'amber' ? 'var(--ops-amber, #b54708)' : undefined }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  return (
    <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
      <span className="ops-muted">{total === 0 ? '0 rows' : `${offset + 1}-${Math.min(offset + limit, total)} of ${total}`}</span>
      <span style={{ display: 'flex', gap: 6 }}>
        <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </button>
        <button className="ops-btn small" type="button" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          Next
        </button>
      </span>
    </div>
  );
}

/** A plain table of string/number cells (report and filing payloads). */
export function SimpleTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  if (!rows.length) return <p className="ops-muted">No rows.</p>;
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const dayOf = (iso?: string | null) => (iso ? iso.slice(0, 10) : '-');
