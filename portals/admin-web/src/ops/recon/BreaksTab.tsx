'use client';

import { useState } from 'react';
import { apiDownload, qs } from '../api';
import { formatDecimal } from '../money';
import { Alert, Card, Empty, Loaded, useResource } from '../ui';
import { ageText, reconFull, Tone, useCounterparties } from './common';
import { FAMILIES, SEVERITIES, STATUSES, type BreaksPage } from './types';

export interface BreakFilter {
  family?: string;
  severity?: string;
}

export function BreaksTab({ initial, onOpen, stamp }: { initial: BreakFilter; onOpen: (id: string) => void; stamp: number }) {
  const [family, setFamily] = useState(initial.family ?? '');
  const [severity, setSeverity] = useState(initial.severity ?? '');
  const [status, setStatus] = useState('open');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [ageDays, setAgeDays] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const cps = useCounterparties();
  const res = useResource<BreaksPage>(
    () => reconFull<BreaksPage>('GET', `/breaks${qs({ family, severity, status, counterpartyId, ageDays, mine: mine ? '1' : undefined, q: q.trim(), limit: '200' })}`),
    [family, severity, status, counterpartyId, ageDays, mine, q, stamp],
  );

  return (
    <Card
      title="Break queue"
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="ops-input" placeholder="Search ref or item" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" style={{ maxWidth: 170 }} />
          <select className="ops-input" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Family" style={{ maxWidth: 170 }}>
            <option value="">All families</option>
            {FAMILIES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select className="ops-input" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity" style={{ maxWidth: 140 }}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ maxWidth: 170 }}>
            <option value="open">Open</option>
            <option value="">All statuses</option>
            <option value="resolved">Matched or closed</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.toLowerCase().replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select className="ops-input" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} aria-label="Counterparty" style={{ maxWidth: 180 }}>
            <option value="">All counterparties</option>
            {(cps.state === 'ok' ? cps.data : []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="ops-input" value={ageDays} onChange={(e) => setAgeDays(e.target.value)} aria-label="Minimum age" style={{ maxWidth: 140 }}>
            <option value="">Any age</option>
            <option value="1">1+ days</option>
            <option value="3">3+ days</option>
            <option value="7">7+ days</option>
          </select>
          <button
            className="ops-btn small"
            type="button"
            onClick={() =>
              apiDownload(`/api/v1/recon/breaks${qs({ family, severity, status, counterpartyId, ageDays, mine: mine ? '1' : undefined, q: q.trim(), format: 'csv' })}`, 'recon-breaks.csv').then(
                () => setExportError(null),
                (e: unknown) => setExportError(e instanceof Error ? e.message : 'Export failed'),
              )
            }
          >
            Export CSV
          </button>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
          </label>
        </div>
      }
    >
      {exportError && <Alert>{exportError}</Alert>}
      <Loaded res={res} what="breaks">
        {(page) =>
          page.data.length === 0 ? (
            <Empty>No breaks match these filters. Use the Run matching tab to compare the books.</Empty>
          ) : (
            <>
              <p className="ops-muted" style={{ marginTop: 0 }}>
                {page.total} break{page.total === 1 ? '' : 's'} · {page.summary.open} open · {page.summary.overdue} overdue. Oldest first.
              </p>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Break</th>
                      <th>Family</th>
                      <th>Detail</th>
                      <th className="r">Difference</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th className="r">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.data.map((b) => (
                      <tr key={b.id} onClick={() => onOpen(b.id)} style={{ cursor: 'pointer' }}>
                        <td>
                          <button className="ops-btn small" type="button" onClick={(e) => { e.stopPropagation(); onOpen(b.id); }}>{b.ref}</button>
                          <span className="ops-sub">{b.asOfDate}</span>
                        </td>
                        <td>
                          {b.familyLabel}
                          <span className="ops-sub">{b.counterparty?.name ?? ''}</span>
                        </td>
                        <td style={{ maxWidth: 380 }}>{b.label}</td>
                        <td className="r">{b.difference === null ? 'missing' : `${formatDecimal(b.difference, 2)}${b.currency ? ` ${b.currency}` : ''}`}</td>
                        <td><Tone value={b.severity} /></td>
                        <td>
                          <Tone value={b.status} />
                          {b.overdue && <span className="ops-sub" style={{ color: 'var(--ops-red)' }}>overdue</span>}
                        </td>
                        <td>{b.ownerName ?? '—'}</td>
                        <td className="r">{ageText(b.ageDays, b.ageHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        }
      </Loaded>
    </Card>
  );
}
