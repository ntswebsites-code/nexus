'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, apiRequest, describeError, qs, v1 } from '@/ops/api';
import { Badge, downloadCsv, jsonText, type AuditDetail, type AuditFacets, type AuditList, type AuditRow } from '@/ops/admin-core';
import { useCan } from '@/ops/session';
import { Alert, Card, DefinitionList, Empty, Field, formatDateTime, Loaded, Modal, PageHeader, useResource } from '@/ops/ui';

const PAGE = 50;
interface Filters {
  q: string;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  portal: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { q: '', actor: '', action: '', objectType: '', objectId: '', portal: '', from: '', to: '' };

function params(f: Filters, extra: Record<string, string | undefined> = {}) {
  return qs({
    q: f.q,
    actor: f.actor,
    action: f.action,
    objectType: f.objectType,
    objectId: f.objectId,
    portal: f.portal,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : undefined,
    to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : undefined,
    ...extra,
  });
}

interface Verify {
  checked: number;
  brokenAt: string | null;
}

export default function AuditPage() {
  const can = useCan('audit.view');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ busy: boolean; result?: Verify; error?: string; at?: string }>({ busy: false });
  const [exportError, setExportError] = useState('');
  const facets = useResource<AuditFacets>(() => api.get<AuditFacets>(v1('/admin-core/audit/facets')), []);

  const load = useCallback(async (f: Filters, before?: string) => {
    setState((s) => (before ? s : 'loading'));
    try {
      const r = await apiRequest<AuditList>('GET', v1(`/admin/audit-events${params(f, { limit: String(PAGE), before })}`));
      setRows((prev) => (before ? [...prev, ...r.data] : r.data));
      setNext(r.nextBefore);
      setState('ok');
    } catch (e) {
      setError(describeError(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (can) void load(filters);
  }, [can, filters, load]);

  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="Audit Trail" />
        <Alert>Your role does not include the audit trail. Ask an administrator for the audit.view permission.</Alert>
      </>
    );
  }

  const runVerify = async () => {
    setVerify({ busy: true });
    try {
      const result = await api.get<Verify>(v1('/admin/audit-events/verify'));
      setVerify({ busy: false, result, at: new Date().toISOString() });
    } catch (e) {
      setVerify({ busy: false, error: describeError(e) });
    }
  };

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const f = facets.state === 'ok' ? facets.data : null;

  return (
    <>
      <PageHeader
        kicker="Administration"
        title="Audit Trail"
        subtitle="Append-only, hash-chained record of every controlled change. Search, drill into an entity, verify the chain and export evidence."
        actions={
          <>
            <button className="ops-btn" type="button" disabled={verify.busy} onClick={runVerify}>
              {verify.busy ? 'Verifying…' : 'Verify chain'}
            </button>{' '}
            <button
              className="ops-btn primary"
              type="button"
              onClick={() => downloadCsv(`/api/v1/admin/audit-events.csv${params(filters)}`, 'audit-evidence.csv').then(() => setExportError('')).catch((e: Error) => setExportError(e.message))}
            >
              Export CSV
            </button>
          </>
        }
      />
      {verify.result &&
        (verify.result.brokenAt ? (
          <Alert>Chain broken at event {verify.result.brokenAt} after {verify.result.checked} intact events. Escalate to the security owner.</Alert>
        ) : (
          <Alert kind="ok">Chain intact: {verify.result.checked.toLocaleString()} events recomputed, no break found ({formatDateTime(verify.at)}).</Alert>
        ))}
      <Alert>{verify.error}</Alert>
      <Alert>{exportError}</Alert>
      {f && (
        <p className="ops-muted">
          {f.stats.total.toLocaleString()} events · {f.stats.last24h.toLocaleString()} in the last 24 hours · first {formatDateTime(f.stats.firstAt)} · latest {formatDateTime(f.stats.lastAt)}
          {f.stats.headHash && <> · head <code>{f.stats.headHash.slice(0, 16)}…</code></>}
        </p>
      )}
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilters(draft);
          }}
        >
          <div className="ops-filters">
            <Field label="Search">
              <input className="ops-input" value={draft.q} onChange={set('q')} placeholder="Action, object, reason" />
            </Field>
            <Field label="User">
              <input className="ops-input" value={draft.actor} onChange={set('actor')} placeholder="Name or email" />
            </Field>
            <Field label="Action">
              <select className="ops-input" value={draft.action} onChange={set('action')}>
                <option value="">All actions</option>
                {f?.actions.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.value} ({a.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Object type">
              <select className="ops-input" value={draft.objectType} onChange={set('objectType')}>
                <option value="">All types</option>
                {f?.objectTypes.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.value} ({a.count})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Object id">
              <input className="ops-input" value={draft.objectId} onChange={set('objectId')} />
            </Field>
            <Field label="Portal">
              <select className="ops-input" value={draft.portal} onChange={set('portal')}>
                <option value="">All</option>
                {f?.portals.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From">
              <input className="ops-input" type="date" value={draft.from} onChange={set('from')} />
            </Field>
            <Field label="To">
              <input className="ops-input" type="date" value={draft.to} onChange={set('to')} />
            </Field>
            <button className="ops-btn primary" type="submit">
              Search
            </button>
            <button
              className="ops-btn"
              type="button"
              onClick={() => {
                setDraft(EMPTY);
                setFilters(EMPTY);
              }}
            >
              Clear
            </button>
          </div>
        </form>
        {state === 'loading' && <div className="ops-loading">Loading audit events…</div>}
        {state === 'error' && <Alert>{error}</Alert>}
        {state === 'ok' &&
          (rows.length === 0 ? (
            <Empty>No audit events match.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>When</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Object</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <button className="ops-btn small" type="button" onClick={() => setOpenId(r.id)}>
                            #{r.id}
                          </button>
                        </td>
                        <td>{formatDateTime(r.at)}</td>
                        <td>
                          {r.user}
                          {r.role && <div className="ops-muted">{r.role}</div>}
                        </td>
                        <td>{r.action}</td>
                        <td>
                          <button
                            className="ops-btn small"
                            type="button"
                            title="Show every event on this object"
                            onClick={() => {
                              const nf = { ...EMPTY, objectType: r.objectType, objectId: r.objectId };
                              setDraft(nf);
                              setFilters(nf);
                            }}
                          >
                            {r.objectType} {r.objectId.length > 14 ? `${r.objectId.slice(0, 8)}…` : r.objectId}
                          </button>
                        </td>
                        <td className="ops-muted" style={{ maxWidth: 320 }}>
                          {r.previous && <div>{r.previous}</div>}
                          {r.next && <div>→ {r.next}</div>}
                          {r.reason && <div>“{r.reason}”</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {next && (
                <div style={{ marginTop: 12 }}>
                  <button className="ops-btn" type="button" onClick={() => load(filters, next)}>
                    Load older events
                  </button>
                </div>
              )}
            </>
          ))}
      </Card>
      {openId && <EventModal id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
    </>
  );
}

function EventModal({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const res = useResource<AuditDetail>(() => api.get<AuditDetail>(v1(`/admin-core/audit/events/${id}`)), [id]);
  return (
    <Modal wide title={`Audit event #${id}`} kicker="Evidence" onClose={onClose}>
      <div className="ops-modal-body">
        <Loaded res={res} what="the event">
          {(e) => (
            <>
              <DefinitionList
                items={[
                  ['When', formatDateTime(e.at)],
                  ['User', `${e.actor}${e.role ? `, ${e.role}` : ''}`],
                  ['Portal', e.portal],
                  ['Action', e.action],
                  ['Object', `${e.objectType} ${e.objectId}`],
                  ['Events on this object', e.eventsOnObject],
                  ['IP', e.ip],
                  ['Request', e.requestId],
                  ['Reason', e.reason],
                ]}
              />
              <h4>Before</h4>
              <pre className="ops-pre">{jsonText(e.before) || 'Nothing recorded'}</pre>
              <h4>After</h4>
              <pre className="ops-pre">{jsonText(e.after) || 'Nothing recorded'}</pre>
              <h4>Chain</h4>
              <p>
                Links to previous event: {e.linkedToPrevious ? <Badge tone="green">yes</Badge> : <Badge tone="red">no</Badge>} · Links to next event:{' '}
                {e.linkedToNext === null ? <Badge tone="grey">latest</Badge> : e.linkedToNext ? <Badge tone="green">yes</Badge> : <Badge tone="red">no</Badge>}
              </p>
              <p className="ops-muted" style={{ wordBreak: 'break-all' }}>
                prev <code>{e.prevHash}</code>
                <br />
                hash <code>{e.hash}</code>
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="ops-btn" type="button" disabled={!e.previousId} onClick={() => e.previousId && onOpen(e.previousId)}>
                  Previous event
                </button>
                <button className="ops-btn" type="button" disabled={!e.nextId} onClick={() => e.nextId && onOpen(e.nextId)}>
                  Next event
                </button>
              </div>
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}
