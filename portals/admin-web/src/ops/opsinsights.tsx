'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, apiRequest, qs, v1 } from './api';
import { moneyFmt } from './operations';
import { Alert, Card, DateText, Empty, Loaded, useAction, useResource } from './ui';

/** Operations Control extras: calendar, workload charts and task comments (GAP-010 operations part). */

export interface CalendarEvent {
  date: string;
  kind: 'TASK' | 'CORPORATE_ACTION' | 'CASH' | 'SETTLEMENT' | 'NAV' | 'CLOSE';
  title: string;
  detail: string | null;
  status: string | null;
  link: string;
  amount?: string;
  currency?: string;
}
export interface Calendar {
  from: string;
  to: string;
  events: CalendarEvent[];
  byDay: Record<string, number>;
  total: number;
}
export interface Workload {
  asOf: string;
  openTasks: number;
  overdue: number;
  byOwner: { ownerId: string | null; owner: string; open: number; dueToday: number; overdue: number; blocked: number; breaks: number }[];
  byArea: { area: string; open: number; blocked: number; overdue: number }[];
  dueByDay: { date: string; label: string; tasks: number }[];
  cashByDay: { date: string; label: string; count: number; in: string; out: string; mixedCurrency: boolean; currency: string | null }[];
}
export interface TaskComment {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<CalendarEvent['kind'], string> = { TASK: 'Task', CORPORATE_ACTION: 'Corporate action', CASH: 'Cash', SETTLEMENT: 'Settlement', NAV: 'NAV', CLOSE: 'Close' };
const KIND_TONE: Record<CalendarEvent['kind'], string> = { TASK: 'blue', CORPORATE_ACTION: 'amber', CASH: 'green', SETTLEMENT: 'red', NAV: 'grey', CLOSE: 'grey' };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Horizontal bars with a label and a value; `max` defaults to the largest value. */
export function Bars({ rows, tone = '#3a6fd8', unit = '' }: { rows: { label: string; value: number; note?: string }[]; tone?: string; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) 1fr auto', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span title={r.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div style={{ background: 'rgba(120,130,150,.2)', borderRadius: 3, height: 10 }} role="img" aria-label={`${r.label}: ${r.value}${unit}`}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: 10, borderRadius: 3, background: tone }} />
          </div>
          <span>{r.value}{unit}{r.note ? <span className="ops-muted"> {r.note}</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

export function CalendarCard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [kinds, setKinds] = useState<Record<string, boolean>>({});
  const first = `${month}-01`;
  const last = iso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)));
  const res = useResource<Calendar>(() => api.get<Calendar>(v1(`/operations/calendar${qs({ from: first, to: last })}`)), [month]);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const today = iso(new Date());
  return (
    <Card
      title={`Calendar · ${new Date(`${first}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="ops-btn small" type="button" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <button className="ops-btn small" type="button" onClick={() => setMonth(new Date().toISOString().slice(0, 7))}>Today</button>
          <button className="ops-btn small" type="button" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
      }
    >
      <Loaded res={res} what="the calendar">
        {(c) => {
          const shown = c.events.filter((e) => !kinds[e.kind]);
          const days: string[] = [];
          for (let d = new Date(`${first}T00:00:00Z`); iso(d) <= last; d = new Date(d.getTime() + 86_400_000)) days.push(iso(d));
          const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
          const byDay = new Map<string, CalendarEvent[]>();
          for (const e of shown) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
          return (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
                {(Object.keys(KIND_LABEL) as CalendarEvent['kind'][]).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={!kinds[k]} onChange={() => setKinds((s) => ({ ...s, [k]: !s[k] }))} /> <span className={`ops-badge ${KIND_TONE[k]}`}>{KIND_LABEL[k]}</span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, fontSize: 11 }}>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <strong key={d} style={{ textAlign: 'center' }}>{d}</strong>
                ))}
                {Array.from({ length: lead }).map((_, i) => (
                  <div key={`b${i}`} />
                ))}
                {days.map((d) => {
                  const ev = byDay.get(d) ?? [];
                  return (
                    <div key={d} style={{ minHeight: 56, border: d === today ? '1px solid #3a6fd8' : '1px solid rgba(120,130,150,.25)', borderRadius: 4, padding: 3, overflow: 'hidden' }}>
                      <div style={{ fontWeight: 700 }}>{Number(d.slice(8))}</div>
                      {ev.slice(0, 3).map((e, i) => (
                        <Link key={i} href={e.link} title={`${KIND_LABEL[e.kind]}: ${e.title}`} style={{ display: 'block', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'inherit' }}>
                          <span className={`ops-badge ${KIND_TONE[e.kind]}`} style={{ padding: '0 4px' }}>{KIND_LABEL[e.kind][0]}</span> {e.title}
                        </Link>
                      ))}
                      {ev.length > 3 && <span className="ops-muted">+{ev.length - 3} more</span>}
                    </div>
                  );
                })}
              </div>
              <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Agenda</h3>
              {shown.length === 0 ? (
                <Empty>Nothing scheduled in this month.</Empty>
              ) : (
                <div className="ops-table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
                  <table className="ops-table">
                    <thead><tr><th>Date</th><th>Type</th><th>Item</th><th className="r">Amount</th></tr></thead>
                    <tbody>
                      {shown.map((e, i) => (
                        <tr key={i}>
                          <td><DateText value={e.date} /></td>
                          <td><span className={`ops-badge ${KIND_TONE[e.kind]}`}>{KIND_LABEL[e.kind]}</span></td>
                          <td><Link href={e.link}>{e.title}</Link>{e.detail && <span className="ops-sub">{e.detail}{e.status ? ` · ${e.status.toLowerCase()}` : ''}</span>}</td>
                          <td className="r">{e.amount ? moneyFmt(e.amount, e.currency) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
    </Card>
  );
}

export function WorkloadCard() {
  const res = useResource<Workload>(() => api.get<Workload>(v1('/operations/workload')), []);
  return (
    <Card title="Workload" actions={<button className="ops-btn small" type="button" onClick={res.reload}>Refresh</button>}>
      <Loaded res={res} what="workload">
        {(w) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, alignItems: 'start' }}>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Open tasks by owner <span className="ops-muted">({w.openTasks} open, {w.overdue} overdue)</span></h3>
              {w.byOwner.length === 0 ? <Empty>No open tasks.</Empty> : <Bars rows={w.byOwner.map((o) => ({ label: o.owner, value: o.open, note: `${o.overdue} overdue · ${o.blocked} blocked · ${o.breaks} breaks` }))} />}
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Open tasks by area</h3>
              {w.byArea.length === 0 ? <Empty>No open tasks.</Empty> : <Bars tone="#0a9474" rows={w.byArea.map((a) => ({ label: a.area.replace(/_/g, ' ').toLowerCase(), value: a.open, note: `${a.blocked} blocked` }))} />}
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Tasks due, next 7 days <span className="ops-muted">(overdue counted today)</span></h3>
              <Bars tone="#d58b1d" rows={w.dueByDay.map((d) => ({ label: d.label, value: d.tasks }))} />
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: '0 0 8px' }}>Cash deadlines, next 7 days <span className="ops-muted">(expected receipts and payments)</span></h3>
              <Bars
                tone="#7a54c9"
                rows={w.cashByDay.map((c) => ({ label: c.label, value: c.count, note: c.count ? (c.mixedCurrency ? 'mixed currencies' : `in ${moneyFmt(c.in, c.currency ?? undefined)} · out ${moneyFmt(c.out, c.currency ?? undefined)}`) : '' }))}
              />
            </div>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

export function TaskComments({ taskId, canWork }: { taskId: string; canWork: boolean }) {
  const res = useResource<TaskComment[]>(() => api.get<TaskComment[]>(v1(`/operations/tasks/${taskId}/comments`)), [taskId]);
  const action = useAction();
  const [text, setText] = useState('');
  // Rendered inside a modal form, so this is not a nested <form>: Enter posts the comment instead of submitting the modal.
  async function add() {
    const body = text.trim();
    if (!body) return;
    const ok = await action.run((key) => apiRequest('POST', v1(`/operations/tasks/${taskId}/comments`), { body }, { idempotencyKey: key }));
    if (ok) {
      setText('');
      res.reload();
    }
  }
  return (
    <>
      <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Comments</h3>
      <Loaded res={res} what="comments">
        {(rows) =>
          rows.length === 0 ? (
            <p className="ops-muted" style={{ margin: 0 }}>No comments yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {rows.map((c) => (
                <li key={c.id} style={{ marginBottom: 4 }}>
                  {c.body}
                  <span className="ops-sub">{c.authorName ?? 'Unknown'} · <DateText value={c.createdAt} time /></span>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {canWork && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="ops-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="Add a comment"
            maxLength={1000}
            aria-label="Comment"
          />
          <button className="ops-btn" type="button" disabled={action.busy || !text.trim()} onClick={() => void add()}>Post</button>
        </div>
      )}
      <Alert>{action.error}</Alert>
    </>
  );
}
