'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { api, v1 } from '../api';
import { DefinitionList, Loaded, StatusBadge, formatDateTime, useResource } from '../ui';

/**
 * Shared right-hand drawer for previews that should not leave the current page (SRD 5A.0.4). Any screen can render
 * `<Drawer>` with its own content, or `<RecordDrawer kind id>` to preview a record from the global registry.
 */
export function Drawer({ title, kicker, onClose, children, footer }: { title: ReactNode; kicker?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ops-drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
        <header className="ops-modal-head">
          <div>
            {kicker && <div className="ops-kicker">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          <button className="ops-modal-close" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="ops-drawer-body">{children}</div>
        {footer && <footer className="ops-modal-foot">{footer}</footer>}
      </aside>
    </div>
  );
}

export interface RecordView {
  kind: string;
  kindLabel: string;
  id: string;
  ref: string | null;
  title: string;
  status: string | null;
  route: string;
  fields: { label: string; value: string }[];
}

export interface RecordResponse {
  record: RecordView;
  history: { id: string; at: string; action: string; role: string | null; reason: string | null }[] | null;
}

export const loadRecord = (kind: string, id: string) => api.get<RecordResponse>(v1(`/shell/record/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`)) as unknown as Promise<RecordResponse>;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
export const fieldValue = (v: string) => (ISO.test(v) ? formatDateTime(v) : v);

/** Field list plus audit history for one record; shared by the drawer and the full record page. */
export function RecordBody({ data, full }: { data: RecordResponse; full?: boolean }) {
  const { record, history } = data;
  const fields = full ? record.fields : record.fields.slice(0, 14);
  return (
    <>
      <DefinitionList items={[['Type', record.kindLabel], ...(record.ref ? ([['Reference', record.ref]] as [string, ReactNode][]) : []), ...(record.status ? ([['Status', <StatusBadge key="s" status={record.status} />]] as [string, ReactNode][]) : []), ...fields.map((f) => [f.label, fieldValue(f.value)] as [string, ReactNode])]} />
      {!full && record.fields.length > fields.length && <p className="ops-muted">{record.fields.length - fields.length} more fields on the full record.</p>}
      {history && (
        <>
          <h4>Recent activity</h4>
          {history.length === 0 ? (
            <p className="ops-muted">No audit events on this record.</p>
          ) : (
            <ul className="ops-plain-list">
              {history.map((h) => (
                <li key={h.id}>
                  <strong>{h.action}</strong> <span className="ops-muted">{formatDateTime(h.at)}{h.role ? ` · ${h.role}` : ''}</span>
                  {h.reason && <div className="ops-muted">“{h.reason}”</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

export function RecordDrawer({ kind, id, onClose }: { kind: string; id: string; onClose: () => void }) {
  const res = useResource(() => loadRecord(kind, id), [kind, id]);
  return (
    <Drawer
      title={res.state === 'ok' ? res.data.record.title : 'Record'}
      kicker={res.state === 'ok' ? res.data.record.kindLabel : undefined}
      onClose={onClose}
      footer={
        <>
          <Link className="ops-btn" href={`/ops/record/${kind}/${id}`} onClick={onClose}>
            Open full record
          </Link>
          {res.state === 'ok' && (
            <Link className="ops-btn primary" href={res.data.record.route} onClick={onClose}>
              Open in module
            </Link>
          )}
        </>
      }
    >
      <Loaded res={res} what="the record">
        {(d) => <RecordBody data={d} />}
      </Loaded>
    </Drawer>
  );
}
