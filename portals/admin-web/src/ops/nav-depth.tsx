'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, qs, v1 } from './api';
import { money2, nav4, NavStatusBadge, pct4, type NavDetail, type NavExternal } from './nav';
import { Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, str, useResource } from './ui';

// ------------------------------------------------------------------ types (mirror /api/v1/nav/history, /policy, external NAV)

export interface NavHistoryRow {
  id: string;
  ref: string;
  portfolioName: string | null;
  portfolioRef: string | null;
  navDate: string;
  version: number;
  status: string;
  official: boolean;
  runsForDate: number;
  baseCurrency: string;
  nav: string;
  navPerUnit: string | null;
  movePct: string | null;
  moveBasis: string | null;
  previousNavDate: string | null;
  makerName: string | null;
  reviewerName: string | null;
  checkerName: string | null;
  releasedAt: string | null;
  external: NavExternal | null;
  packUrl: string;
}

export interface NavPolicy {
  thresholds: { field: string; label: string; unit: string; help: string; value: number; default: number; custom: boolean }[];
  priceHierarchy: { rank: number; source: string; detail: string }[];
  governance: string[];
  canEdit: boolean;
}

export const signed = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${Number(v) > 0 ? '+' : ''}${money2(v)}`);

// ------------------------------------------------------------------ external NAV vs ABOR (FR-VAL-017)

export function ExternalNavCard({ run, base, canRecord, blocker, onChanged }: { run: NavDetail; base: string; canRecord: boolean; blocker: string | null; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const ext = run.external ?? null;
  return (
    <Card
      title="External NAV vs ABOR"
      actions={
        run.status !== 'SUPERSEDED' && (
          <button className="ops-btn small" type="button" disabled={!canRecord} title={canRecord ? 'Record the administrator figure for this run' : (blocker ?? undefined)} onClick={() => setEditing(true)}>
            {ext ? 'Update external NAV' : 'Record external NAV'}
          </button>
        )
      }
    >
      {ext ? (
        <>
          <DefinitionList
            items={[
              ['ABOR value (this run)', `${money2(ext.abor)} ${run.baseCurrency}`],
              ['External NAV', `${money2(ext.nav)} ${run.baseCurrency}`],
              ['Variance (external − ABOR)', <strong key="v">{signed(ext.variance)} {run.baseCurrency}{ext.variancePct ? ` (${Number(ext.variancePct) > 0 ? '+' : ''}${ext.variancePct}%)` : ''}</strong>],
              ['State', <span key="s" className={`ops-badge ${ext.state === 'Agree' ? 'green' : 'red'}`}>{ext.state === 'Agree' ? 'Agree' : 'Variance'}</span>],
              ['Tolerance', `${money2(ext.tolerance)} ${run.baseCurrency}`],
              ['Source', ext.source ?? '—'],
              ['Recorded', ext.recordedAt ? `${ext.recordedByName ?? 'Someone'} · ${formatDateTime(ext.recordedAt)}` : '—'],
              ['Note', ext.note ?? '—'],
            ]}
          />
          {ext.state === 'Variance' && <Alert kind="warn">The external NAV differs from the ABOR value by more than the tolerance. Investigate before relying on either figure.</Alert>}
        </>
      ) : (
        <Empty>No external NAV has been recorded. Record the administrator figure to see the variance against the ABOR value.</Empty>
      )}
      {editing && (
        <FormModal
          kicker="Valuation"
          title={`External NAV for ${run.ref}`}
          subtitle={`ABOR value ${money2(run.nav)} ${run.baseCurrency}. Variance = external NAV minus ABOR.`}
          submitLabel="Save external NAV"
          onClose={() => setEditing(false)}
          onDone={onChanged}
          onSubmit={(fd, key) =>
            api.put(`${base}/external-nav`, { externalNav: str(fd, 'externalNav').replace(/,/g, ''), source: str(fd, 'source'), note: optStr(fd, 'note') ?? null }, { idempotencyKey: key })
          }
        >
          <FieldGrid>
            <Field label={`External NAV (${run.baseCurrency})`}>
              <input className="ops-input" name="externalNav" inputMode="decimal" required defaultValue={ext?.nav ?? ''} />
            </Field>
            <Field label="Source">
              <input className="ops-input" name="source" required minLength={2} maxLength={80} defaultValue={ext?.source ?? ''} placeholder="Administrator statement" />
            </Field>
            <Field label="Note" span={2}>
              <input className="ops-input" name="note" maxLength={255} defaultValue={ext?.note ?? ''} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ NAV history (FR-VAL-015)

export function NavHistoryModal({ portfolioId, onClose }: { portfolioId: string; onClose: () => void }) {
  const res = useResource<NavHistoryRow[]>(() => api.get<NavHistoryRow[]>(v1(`/nav/history${qs({ portfolioId, limit: '60' })}`)), [portfolioId]);
  return (
    <Modal title="NAV history" kicker="Valuation" subtitle="Prior official NAVs, re-runs and the release evidence for each date." onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="NAV history">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No NAV has been released yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption className="ops-sr">Prior official NAVs</caption>
                  <thead>
                    <tr>
                      <th>NAV date</th>
                      <th>Portfolio</th>
                      <th>Run</th>
                      <th className="r">NAV</th>
                      <th className="r">NAV / unit</th>
                      <th className="r">Move</th>
                      <th>Re-runs</th>
                      <th>Prepared / reviewed / released</th>
                      <th>External NAV</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{formatDate(r.navDate)}</td>
                        <td>{r.portfolioName ?? r.portfolioRef ?? '—'}</td>
                        <td>
                          <Link href={`/ops-native/nav/${encodeURIComponent(r.id)}`}>{r.ref}</Link> v{r.version} <NavStatusBadge status={r.status} />
                        </td>
                        <td className="r">{money2(r.nav)}</td>
                        <td className="r">{nav4(r.navPerUnit)}</td>
                        <td className="r" title={r.moveBasis && r.previousNavDate ? `${r.moveBasis} against ${r.previousNavDate}` : undefined}>
                          {r.movePct ? `${Number(r.movePct) > 0 ? '+' : ''}${pct4(r.movePct)}` : '—'}
                        </td>
                        <td>{r.runsForDate > 1 ? `${r.runsForDate - 1} re-run${r.runsForDate === 2 ? '' : 's'}` : 'none'}</td>
                        <td>
                          {r.makerName ?? '—'} / {r.reviewerName ?? '—'} / {r.checkerName ?? '—'}
                          {r.releasedAt ? <span className="ops-sub">{formatDateTime(r.releasedAt)}</span> : null}
                        </td>
                        <td>{r.external ? `${r.external.state} (${signed(r.external.variance)})` : '—'}</td>
                        <td>
                          <Link href={`/ops-native/nav/${encodeURIComponent(r.id)}`}>Pack</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ valuation policy (FR-VAL-015)

export function NavPolicyModal({ onClose }: { onClose: () => void }) {
  const res = useResource<NavPolicy>(() => api.get<NavPolicy>(v1('/nav/policy')), []);
  return (
    <Modal title="Valuation policy" kicker="Valuation" subtitle="Price hierarchy, stale-price and materiality thresholds, and override governance." onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="the valuation policy">
          {(p) => (
            <>
              <h3 className="ops-kicker">Price hierarchy</h3>
              <ol>
                {p.priceHierarchy.map((h) => (
                  <li key={h.rank}>
                    <strong>{h.source}.</strong> {h.detail}
                  </li>
                ))}
              </ol>
              <h3 className="ops-kicker" style={{ marginTop: 14 }}>Thresholds</h3>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Threshold</th>
                      <th className="r">Value</th>
                      <th className="r">Default</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.thresholds.map((t) => (
                      <tr key={t.field}>
                        <td>{t.label}</td>
                        <td className="r">
                          {t.value}
                          {t.custom ? <span className="ops-sub">customised</span> : null}
                        </td>
                        <td className="r">{t.default}</td>
                        <td>{t.help}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {p.canEdit && <PolicyEditor thresholds={p.thresholds} onSaved={res.reload} />}
              <h3 className="ops-kicker" style={{ marginTop: 14 }}>Override governance</h3>
              <ul>
                {p.governance.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

function PolicyEditor({ thresholds, onSaved }: { thresholds: NavPolicy['thresholds']; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p style={{ marginTop: 10 }}>
        <button className="ops-btn small" type="button" onClick={() => setOpen(true)}>
          Change thresholds
        </button>
      </p>
      {open && (
        <FormModal
          kicker="Valuation policy"
          title="Change thresholds"
          subtitle="Applies to NAV runs calculated from now on. Needs a fresh authenticator code and is audited."
          submitLabel="Save thresholds"
          onClose={() => setOpen(false)}
          onDone={onSaved}
          onSubmit={(fd, key) => {
            const body: Record<string, unknown> = { reason: str(fd, 'reason') };
            for (const t of thresholds) {
              const v = str(fd, t.field).trim();
              if (v !== '' && Number(v) !== t.value) body[t.field] = Number(v);
            }
            return api.put(v1('/nav/policy'), body, { idempotencyKey: key });
          }}
        >
          <FieldGrid>
            {thresholds.map((t) => (
              <Field key={t.field} label={t.label}>
                <input className="ops-input" name={t.field} inputMode="decimal" defaultValue={String(t.value)} />
              </Field>
            ))}
            <Field label="Reason" span={2}>
              <input className="ops-input" name="reason" required minLength={5} maxLength={300} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
