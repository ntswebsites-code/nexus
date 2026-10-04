'use client';

import { useState } from 'react';
import { apiRequest } from '@/ops/api';
import { coGet, coPost } from '@/ops/clientops';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, optStr, str, useResource } from '@/ops/ui';

/** FR-DOC-017: retention schedules (minimum years per document type and classification) with the legal-hold count. */
interface Schedule {
  id: string;
  docType: string;
  classification: string;
  retentionYears: number;
  basis: string | null;
  active: boolean;
  version: number;
  updatedAt: string;
}
interface Payload {
  data: Schedule[];
  activeHolds: number;
  documents: number;
  types: string[];
  classifications: string[];
}

const any = (v: string) => (v === '*' ? 'Any' : v);

export function RetentionSchedules() {
  const canEdit = useCan('documents.approve');
  const res = useResource<Payload>(() => coGet<Payload>('/vault/retention-schedules'), []);
  const [dlg, setDlg] = useState<{ edit: Schedule | null } | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <Loaded res={res} what="retention schedules">
      {(p) => (
        <>
          <p className="ops-muted">
            A schedule sets the minimum retention for a document type and classification. The most specific active row applies: type and classification, then type, then classification, then any. New documents, retention changes and the nightly purge job all enforce it. Enforcement only raises retention; documents are never deleted, and a legal hold ({p.activeHolds} active) blocks shortening and disposal.
          </p>
          {applied && <Alert kind="ok">{applied}</Alert>}
          <Card
            title={`Schedules (${p.data.length})`}
            actions={
              canEdit ? (
                <>
                  <button className="ops-btn primary" type="button" onClick={() => setDlg({ edit: null })}>
                    Add schedule
                  </button>
                  <ActionButton
                    label="Apply to existing documents"
                    confirm="Raise the retention of every document below its schedule minimum? Retention is only ever raised."
                    onRun={(key) => coPost<{ raised: number; eligible: number; heldPastRetention: number }>('/vault/retention-schedules/apply', { dryRun: false }, key).then((r) => setApplied(`${r.raised} documents raised to their schedule; ${r.eligible} are past retention and eligible for disposal; ${r.heldPastRetention} are past retention but on legal hold.`))}
                  />
                </>
              ) : undefined
            }
          >
            {p.data.length === 0 ? (
              <Empty>No schedules yet. Documents keep the retention chosen at upload (7 years by default).</Empty>
            ) : (
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Document type</th>
                    <th>Classification</th>
                    <th className="r">Minimum years</th>
                    <th>Basis</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.data.map((s) => (
                    <tr key={s.id}>
                      <td>{any(s.docType)}</td>
                      <td>{any(s.classification)}</td>
                      <td className="r">{s.retentionYears}</td>
                      <td>{s.basis ?? '-'}</td>
                      <td>{s.active ? 'Active' : 'Inactive'}</td>
                      <td>
                        {canEdit && (
                          <button className="ops-btn small" type="button" onClick={() => setDlg({ edit: s })}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {dlg && (
            <FormModal
              title={dlg.edit ? 'Edit retention schedule' : 'Add retention schedule'}
              subtitle="Applies to documents uploaded from now on, to retention change requests, and to the nightly purge job. Recorded in the audit trail with your reason."
              submitLabel={dlg.edit ? 'Save schedule' : 'Add schedule'}
              onClose={() => setDlg(null)}
              onDone={() => res.reload()}
              onSubmit={(fd, key) =>
                dlg.edit
                  ? apiRequest('PATCH', `/api/v1/client-ops/vault/retention-schedules/${dlg.edit.id}`, { retentionYears: Number(str(fd, 'retentionYears')), basis: optStr(fd, 'basis') ?? null, active: fd.get('active') === 'on', version: dlg.edit.version, reason: str(fd, 'reason') }, { idempotencyKey: key })
                  : coPost('/vault/retention-schedules', { docType: str(fd, 'docType'), classification: str(fd, 'classification'), retentionYears: Number(str(fd, 'retentionYears')), basis: optStr(fd, 'basis'), reason: str(fd, 'reason') }, key)
              }
            >
              <FieldGrid>
                <Field label="Document type">
                  <select className="ops-input" name="docType" defaultValue={dlg.edit?.docType ?? '*'} disabled={!!dlg.edit}>
                    <option value="*">Any</option>
                    {p.types.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Classification">
                  <select className="ops-input" name="classification" defaultValue={dlg.edit?.classification ?? '*'} disabled={!!dlg.edit}>
                    <option value="*">Any</option>
                    {p.classifications.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Minimum retention (years)">
                  <input className="ops-input" type="number" name="retentionYears" min={1} max={50} defaultValue={dlg.edit?.retentionYears ?? 7} required />
                </Field>
                <Field label="Legal or policy basis">
                  <input className="ops-input" name="basis" maxLength={300} defaultValue={dlg.edit?.basis ?? ''} />
                </Field>
                {dlg.edit && (
                  <label>
                    <input type="checkbox" name="active" defaultChecked={dlg.edit.active} /> Active
                  </label>
                )}
                <Field label="Reason">
                  <input className="ops-input" name="reason" minLength={5} maxLength={500} required />
                </Field>
              </FieldGrid>
            </FormModal>
          )}
        </>
      )}
    </Loaded>
  );
}
