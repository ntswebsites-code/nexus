'use client';

import { useState } from 'react';
import { api } from '../api';
import { formatDecimal } from '../money';
import { Card, DateText, Empty, Field, FormModal, Loaded, optStr, str, useResource } from '../ui';
import { risk, Tone } from './common';
import { isFloor, metricShort, type RiskBreach } from './types';

export function BreachesTab({ canManage, onOpenCase }: { canManage: boolean; onOpenCase: (ref: string) => void }) {
  const [status, setStatus] = useState('');
  const [acking, setAcking] = useState<RiskBreach | null>(null);
  const [opening, setOpening] = useState<RiskBreach | null>(null);
  const res = useResource<RiskBreach[]>(() => api.get<RiskBreach[]>(risk(`/breaches${status ? `?status=${status}` : ''}`)), [status]);

  return (
    <>
      <Card
        title="Limit breaches"
        actions={
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" style={{ maxWidth: 190 }}>
            <option value="">All statuses</option>
            {['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        }
      >
        <p className="ops-muted" style={{ marginTop: 0 }}>
          The daily monitor records each breach once per limit, portfolio and day and opens a case for it. A breach is resolved when its case is resolved or closed.
        </p>
        <Loaded res={res} what="breaches">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No breaches recorded. Use “Run monitor” to evaluate the active limits now.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Detected</th>
                      <th>Limit</th>
                      <th>Portfolio</th>
                      <th className="r">Value vs limit</th>
                      <th>Status</th>
                      <th>Case</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <DateText value={b.detectedOn} />
                        </td>
                        <td>
                          <strong>{b.limitRef}</strong> {metricShort(b.metric)}
                        </td>
                        <td>
                          {b.portfolioName ?? '—'}
                          <span className="ops-sub">{b.portfolioRef}</span>
                        </td>
                        <td className="r">
                          {formatDecimal(b.value, 2)}%<span className="ops-sub">{isFloor(b.metric) ? 'floor' : 'limit'} {formatDecimal(b.threshold, 2)}%</span>
                        </td>
                        <td>
                          <Tone value={b.status} />
                          {b.ackByName && (
                            <span className="ops-sub">
                              {b.ackByName}
                              {b.ackNote ? `: ${b.ackNote}` : ''}
                            </span>
                          )}
                        </td>
                        <td>
                          {b.caseRef ? (
                            <button className="ops-btn small" type="button" onClick={() => onOpenCase(b.caseRef!)}>
                              {b.caseRef}
                            </button>
                          ) : (
                            '—'
                          )}
                          {b.caseStatus && <span className="ops-sub">{b.caseStatus.toLowerCase()}</span>}
                        </td>
                        <td>
                          {canManage && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {b.status === 'OPEN' && (
                                <button className="ops-btn small" type="button" onClick={() => setAcking(b)}>
                                  Acknowledge
                                </button>
                              )}
                              {!b.caseId && (
                                <button className="ops-btn small" type="button" onClick={() => setOpening(b)}>
                                  Open case
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>

      {acking && (
        <FormModal
          kicker="Breach"
          title={`Acknowledge ${acking.limitRef} breach`}
          subtitle={`${acking.portfolioName ?? 'Portfolio'} at ${formatDecimal(acking.value, 2)}%. Acknowledging records that you have seen it; it stays open until its case is resolved.`}
          submitLabel="Acknowledge"
          onClose={() => setAcking(null)}
          onSubmit={(fd) => api.post(risk(`/breaches/${acking.id}/acknowledge`), { note: optStr(fd, 'note') })}
          onDone={res.reload}
        >
          <Field label="Note (optional)">
            <input className="ops-input" name="note" maxLength={500} />
          </Field>
        </FormModal>
      )}

      {opening && (
        <FormModal
          kicker="Breach"
          title={`Open a case for ${opening.limitRef}`}
          submitLabel="Open case"
          onClose={() => setOpening(null)}
          onSubmit={(fd, key) =>
            api.post(
              risk('/cases'),
              {
                type: 'LIMIT_BREACH',
                severity: str(fd, 'severity'),
                description: str(fd, 'description'),
                sourceBreachId: opening.id,
              },
              { idempotencyKey: key },
            )
          }
          onDone={res.reload}
        >
          <Field label="Severity">
            <select className="ops-input" name="severity" defaultValue="MEDIUM">
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              className="ops-input"
              name="description"
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              defaultValue={`${opening.limitRef} ${metricShort(opening.metric)}: ${opening.portfolioName ?? ''} at ${formatDecimal(opening.value, 2)}% against ${formatDecimal(opening.threshold, 2)}%.`}
            />
          </Field>
        </FormModal>
      )}
    </>
  );
}
