'use client';

import { useState } from 'react';
import { api, apiRequest, apiUpload, v1 } from './api';
import type { PortfolioSnapshot } from './types';
import { Alert, Card, Empty, Field, FormModal, formatDateTime, Loaded, optStr, str, useResource } from './ui';

interface Evidence {
  documentRef: string;
  name: string;
  label: string | null;
  status: string;
  version: number | null;
  sha256: string | null;
  addedBy: string | null;
  addedAt: string;
}

const isFile = (v: FormDataEntryValue | null): v is File => !!v && typeof v !== 'string' && v.size > 0;

/**
 * Creates a portfolio from the wizard form. With an evidence file it is one multipart request (a `payload` JSON field
 * plus the `evidence` file) so the portfolio and its vault document commit together; without one it is plain JSON.
 */
export async function createPortfolio(fd: FormData, key: string): Promise<PortfolioSnapshot> {
  const num = (n: string) => (str(fd, n) ? Number(str(fd, n)) : undefined);
  const mandate = { maxSingleNamePct: num('maxSingleNamePct'), maxSectorPct: num('maxSectorPct'), cashFloorPct: num('cashFloorPct'), maxCashPct: num('maxCashPct') };
  const body = JSON.parse(
    JSON.stringify({
      name: str(fd, 'name'),
      type: str(fd, 'type'),
      baseCurrency: str(fd, 'baseCurrency').toUpperCase(),
      benchmark: optStr(fd, 'benchmark'),
      strategy: optStr(fd, 'strategy'),
      riskProfile: optStr(fd, 'riskProfile'),
      status: str(fd, 'status') || undefined,
      mandate,
    }),
  );
  const file = fd.get('evidence');
  if (isFile(file)) {
    const form = new FormData();
    form.set('payload', JSON.stringify({ ...body, evidenceKind: str(fd, 'evidenceKind') || 'MANDATE' }));
    form.set('evidence', file, file.name);
    return (await apiUpload<{ data: PortfolioSnapshot }>('POST', v1('/portfolios'), form, { idempotencyKey: key })).data;
  }
  return api.post<PortfolioSnapshot>(v1('/portfolios'), body, { idempotencyKey: key });
}

/** Adds an evidence file to an existing portfolio (multipart: kind, optional title, file). */
export function addEvidence(portfolioId: string, fd: FormData, key: string) {
  const file = fd.get('file');
  if (!isFile(file)) return Promise.reject(new Error('Choose the file to store'));
  const form = new FormData();
  form.set('kind', str(fd, 'kind') || 'OTHER');
  const title = optStr(fd, 'title');
  if (title) form.set('title', title);
  form.set('file', file, file.name);
  return apiUpload('POST', v1(`/portfolios/${encodeURIComponent(portfolioId)}/evidence`), form, { idempotencyKey: key });
}

/** FR-PORT-011: files kept as evidence for a portfolio live in the document vault; this lists and adds them. */
export function EvidenceCard({ portfolioId, canManage }: { portfolioId: string; canManage: boolean }) {
  const res = useResource<Evidence[]>(() => api.get<Evidence[]>(v1(`/portfolios/${encodeURIComponent(portfolioId)}/evidence`)), [portfolioId]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = async (ref: string) => {
    setErr(null);
    try {
      const r = await apiRequest<{ url: string }>('GET', v1(`/portfolios/${encodeURIComponent(portfolioId)}/evidence/${encodeURIComponent(ref)}/download-url`));
      window.open(r.url, '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The file could not be opened');
    }
  };
  return (
    <Card
      title="Evidence in the vault"
      actions={
        canManage && (
          <button className="ops-btn" type="button" onClick={() => setAdding(true)}>
            Add evidence
          </button>
        )
      }
    >
      <Alert>{err}</Alert>
      <Loaded res={res} what="evidence">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No evidence filed yet. Mandates, approvals and KYC extracts for this portfolio are stored in the document vault.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Vault document</th>
                    <th>Kind</th>
                    <th>Version</th>
                    <th>Added</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.documentRef}>
                      <td>
                        <strong>{d.documentRef}</strong>
                        <span className="ops-sub">{d.name}</span>
                      </td>
                      <td>{d.label ?? '—'}</td>
                      <td>{d.version ?? '—'}</td>
                      <td>
                        {formatDateTime(d.addedAt)}
                        <span className="ops-sub">{d.addedBy}</span>
                      </td>
                      <td>
                        <button className="ops-btn small" type="button" onClick={() => open(d.documentRef)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {adding && (
        <FormModal
          kicker="Portfolio"
          title="Add evidence"
          subtitle="The file is stored in the document vault (restricted) and linked to this portfolio."
          submitLabel="Store in the vault"
          onClose={() => setAdding(false)}
          onSubmit={(fd, key) => addEvidence(portfolioId, fd, key)}
          onDone={() => res.reload()}
        >
          <Field label="Kind">
            <select className="ops-input" name="kind" defaultValue="MANDATE">
              <option value="MANDATE">Mandate</option>
              <option value="APPROVAL">Approval</option>
              <option value="KYC">KYC</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Title" hint="Optional; defaults to the portfolio reference and kind">
            <input className="ops-input" name="title" maxLength={160} />
          </Field>
          <Field label="File">
            <input className="ops-input" name="file" type="file" required />
          </Field>
        </FormModal>
      )}
    </Card>
  );
}
