'use client';

import { useState, type FormEvent } from 'react';
import { api, apiDownload, apiUpload, v1 } from './api';
import { Alert, Card, Empty, Field, FieldGrid, formatDateTime, Loaded, useAction, useResource } from './ui';

export interface ImportColumn {
  key: string;
  label: string;
  required: boolean;
  example: string;
  hint: string;
}
export interface ImportKindInfo {
  kind: string;
  title: string;
  stepUp: boolean;
  controlTotals: { column: string; required: boolean } | null;
  fields: { key: string; label: string; hint?: string }[];
  columns: ImportColumn[];
}
export interface ImportBatchView {
  id: string;
  ref: string;
  kind: string;
  filename: string;
  format: string;
  status: 'PREVIEWED' | 'COMMITTED' | 'REJECTED' | string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  fileErrors: string[];
  warnings: string[];
  errors: { line: number; field?: string; message: string }[];
  errorsTruncated: boolean;
  preview: { line: number; ok: boolean; values: Record<string, string>; errors: string[]; warnings: string[] }[];
  control: unknown;
  duplicateOf: { ref: string; committedAt: string | null } | null;
  canCommit: boolean;
  result: Record<string, unknown> | null;
  createdAt: string;
  committedAt: string | null;
  createdByName?: string | null;
}

const imp = (p: string) => v1(`/imports${p}`);

/** Whether the commit button may be pressed for a dry run and the two tick boxes. Exported for the screen test. */
export function commitAllowed(b: ImportBatchView, skipInvalid: boolean, allowDuplicate: boolean): boolean {
  if (b.status !== 'PREVIEWED' || b.fileErrors.length > 0 || b.validCount === 0) return false;
  if (b.errorCount > 0 && !skipInvalid) return false;
  if (b.duplicateOf && !allowDuplicate) return false;
  return true;
}

/**
 * Shared import screen (build-plan S3): pick a kind, download its template, upload a CSV, XLSX or JSON file, review the
 * dry run (row errors, control totals, first rows as validated) and only then commit. A file with row errors needs the
 * explicit "skip invalid rows" tick; a rejected file or a duplicate of a committed one cannot be committed by accident.
 * `only` limits the kinds shown (an embedded panel on a domain page); `onCommitted` lets the host page reload.
 */
export function ImportPanel({ only, onCommitted }: { only?: string[]; onCommitted?: (b: ImportBatchView) => void }) {
  const kinds = useResource<ImportKindInfo[]>(() => api.get<ImportKindInfo[]>(imp('/kinds')), []);
  const batches = useResource<ImportBatchView[]>(() => api.get<ImportBatchView[]>(imp('/batches?limit=15')), []);
  const [kind, setKind] = useState('');
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const preview = useAction();
  const commit = useAction();
  const [done, setDone] = useState<string | null>(null);

  return (
    <>
      <Card
        title="Import a file"
        actions={
          <button className="ops-btn small" type="button" onClick={() => { kinds.reload(); batches.reload(); }}>
            Refresh
          </button>
        }
      >
        <Loaded res={kinds} what="import kinds">
          {(all) => {
            const list = only ? all.filter((k) => only.includes(k.kind)) : all;
            if (list.length === 0) return <Empty>Your role does not include any import. Ask an administrator for the permission behind the file type you need.</Empty>;
            const k = list.find((x) => x.kind === kind) ?? list[0]!;
            async function upload(e: FormEvent<HTMLFormElement>) {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.delete('kindSelect');
              const file = fd.get('file');
              if (!file || typeof file === 'string') return;
              setDone(null);
              const b = await preview.run((key) => apiUpload<{ data: ImportBatchView }>('POST', imp(`/${k.kind}/preview`), fd, { idempotencyKey: key }));
              if (b) {
                setBatch(b.data);
                setSkipInvalid(false);
                setAllowDuplicate(false);
                batches.reload();
              }
            }
            return (
              <form onSubmit={upload}>
                <FieldGrid>
                  <Field label="File type">
                    <select className="ops-input" name="kindSelect" value={k.kind} onChange={(e) => { setKind(e.target.value); setBatch(null); }}>
                      {list.map((x) => (
                        <option key={x.kind} value={x.kind}>{x.title}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="File" hint="CSV, XLSX or JSON, up to 2000 rows">
                    <input className="ops-input" type="file" name="file" accept=".csv,.xlsx,.json,text/csv" required />
                  </Field>
                  {k.fields.filter((f) => f.key !== 'controlCount' && f.key !== 'controlTotal').map((f) => (
                    <Field key={f.key} label={f.label} hint={f.hint}>
                      <input className="ops-input" name={f.key} maxLength={40} />
                    </Field>
                  ))}
                  {k.controlTotals && (
                    <>
                      <Field label="Control: row count" hint={k.controlTotals.required ? 'Required' : 'Optional; checked against the file'}>
                        <input className="ops-input" name="controlCount" inputMode="numeric" required={k.controlTotals.required} />
                      </Field>
                      <Field label={`Control: total of ${k.controlTotals.column}`} hint={k.controlTotals.required ? 'Required' : 'Optional; checked against the file'}>
                        <input className="ops-input" name="controlTotal" inputMode="decimal" required={k.controlTotals.required} />
                      </Field>
                    </>
                  )}
                </FieldGrid>
                <details style={{ margin: '8px 0' }}>
                  <summary>Columns this file needs</summary>
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead><tr><th>Column</th><th>Required</th><th>Example</th><th>Notes</th></tr></thead>
                      <tbody>
                        {k.columns.map((c) => (
                          <tr key={c.key}><td>{c.label}</td><td>{c.required ? 'Yes' : 'No'}</td><td><code>{c.example}</code></td><td>{c.hint}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <Alert>{preview.error}</Alert>
                <div className="ops-actions">
                  <button className="ops-btn primary" type="submit" disabled={preview.busy}>{preview.busy ? 'Checking…' : 'Preview (dry run)'}</button>
                  <button className="ops-btn" type="button" onClick={() => void apiDownload(imp(`/${k.kind}/template`), `${k.kind}-template.csv`).catch((er: Error) => window.alert(er.message))}>
                    Download template
                  </button>
                </div>
              </form>
            );
          }}
        </Loaded>
      </Card>

      {batch && (
        <Card title={`Dry run ${batch.ref}`}>
          <p className="ops-muted" style={{ marginTop: 0 }}>
            {batch.filename} ({batch.format.toUpperCase()}): {batch.rowCount} row{batch.rowCount === 1 ? '' : 's'}, {batch.validCount} valid, {batch.errorCount} with errors. Nothing has been written yet.
          </p>
          {batch.fileErrors.map((m) => (
            <Alert key={m}>{m}</Alert>
          ))}
          {batch.warnings.map((m) => (
            <Alert key={m} kind="warn">{m}</Alert>
          ))}
          {batch.duplicateOf && <Alert kind="warn">This exact file was already committed as {batch.duplicateOf.ref}. Tick the box below only if it is meant to be applied again.</Alert>}
          {batch.errors.length > 0 && (
            <div className="ops-table-wrap">
              <table className="ops-table" aria-label="Row errors">
                <thead><tr><th>Line</th><th>Field</th><th>Problem</th></tr></thead>
                <tbody>
                  {batch.errors.map((er, i) => (
                    <tr key={i}><td>{er.line}</td><td>{er.field ?? ''}</td><td>{er.message}</td></tr>
                  ))}
                </tbody>
              </table>
              {batch.errorsTruncated && <div className="ops-muted">Only the first {batch.errors.length} errors are listed.</div>}
            </div>
          )}
          {batch.preview.length > 0 && (
            <div className="ops-table-wrap" style={{ marginTop: 10 }}>
              <table className="ops-table" aria-label="Rows as validated">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Result</th>
                    {Object.keys(batch.preview[0]!.values).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batch.preview.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td>{r.ok ? (r.warnings.length ? `OK: ${r.warnings.join('; ')}` : 'OK') : r.errors.join('; ')}</td>
                      {Object.keys(batch.preview[0]!.values).map((h) => (
                        <td key={h}>{r.values[h] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {batch.status === 'PREVIEWED' && (
            <div style={{ marginTop: 12 }}>
              {batch.errorCount > 0 && (
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /> Skip the {batch.errorCount} invalid row{batch.errorCount === 1 ? '' : 's'} and apply the {batch.validCount} valid
                </label>
              )}
              {batch.duplicateOf && (
                <label style={{ display: 'block', marginBottom: 6 }}>
                  <input type="checkbox" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} /> Apply this file again
                </label>
              )}
              <Alert>{commit.error}</Alert>
              <button
                className="ops-btn primary"
                type="button"
                disabled={commit.busy || !commitAllowed(batch, skipInvalid, allowDuplicate)}
                onClick={async () => {
                  const r = await commit.run((key) =>
                    api.post<ImportBatchView>(imp(`/${batch.kind}/${batch.id}/commit`), { skipInvalid: skipInvalid || undefined, allowDuplicate: allowDuplicate || undefined }, { idempotencyKey: key }),
                  );
                  if (r) {
                    setBatch(r);
                    setDone(`${r.ref} committed: ${r.validCount} row${r.validCount === 1 ? '' : 's'} applied.`);
                    batches.reload();
                    onCommitted?.(r);
                  }
                }}
              >
                {commit.busy ? 'Applying…' : `Commit ${batch.validCount} row${batch.validCount === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
          {batch.status === 'COMMITTED' && done && <Alert kind="ok">{done}</Alert>}
        </Card>
      )}

      <Card title="Recent imports">
        <Loaded res={batches} what="import batches">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No imports yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Batch</th><th>Type</th><th>File</th><th>Status</th><th>Rows</th><th>Valid</th><th>Errors</th><th>By</th><th>Uploaded</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td><strong>{r.ref}</strong></td>
                        <td>{r.kind}</td>
                        <td>{r.filename}</td>
                        <td>{r.status.toLowerCase()}</td>
                        <td>{r.rowCount}</td>
                        <td>{r.validCount}</td>
                        <td>{r.errorCount}</td>
                        <td>{r.createdByName ?? ''}</td>
                        <td>{formatDateTime(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
    </>
  );
}
