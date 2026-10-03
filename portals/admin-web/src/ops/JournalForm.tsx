'use client';

import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import type { AccountRow, JournalDetail } from '@/ops/accounting';
import type { PortfolioSummary } from '@/ops/types';
import { Alert, Field, FieldGrid, Modal, useAction, useResource } from '@/ops/ui';

const today = () => new Date().toISOString().slice(0, 10);

interface JLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

const blankLine = (): JLine => ({ accountId: '', debit: '', credit: '', memo: '' });
const num = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v.replace(/,/g, '')) * 10000));

/** Create or edit a draft: a line grid with a live debit/credit total. Exported for the detail page. */
export function JournalForm({
  entity,
  portfolios,
  onClose,
  onDone,
  existing,
}: {
  entity: string;
  portfolios: PortfolioSummary[];
  onClose: () => void;
  onDone: (id: string) => void;
  existing?: JournalDetail;
}) {
  const action = useAction();
  const [portfolioId, setPortfolioId] = useState(existing?.portfolioId ?? entity);
  const [entryDate, setEntryDate] = useState(existing?.entryDate ?? today());
  const [description, setDescription] = useState(existing?.description ?? '');
  const [lines, setLines] = useState<JLine[]>(
    existing ? existing.lines.map((l) => ({ accountId: l.accountId, debit: /^0+(\.0+)?$/.test(l.debit) ? '' : l.debit, credit: /^0+(\.0+)?$/.test(l.credit) ? '' : l.credit, memo: l.memo ?? '' })) : [blankLine(), blankLine()],
  );
  const accounts = useResource<AccountRow[]>(() => (portfolioId ? api.get<AccountRow[]>(v1(`/accounting/accounts${qs({ portfolioId, active: 'true' })}`)) : Promise.resolve([])), [portfolioId]);
  const set = (i: number, patch: Partial<JLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dr = lines.reduce((s, l) => s + num(l.debit), 0);
  const cr = lines.reduce((s, l) => s + num(l.credit), 0);
  const balanced = dr === cr && dr > 0;

  async function submit() {
    const body = {
      entryDate,
      description,
      lines: lines
        .filter((l) => l.accountId || l.debit || l.credit)
        .map((l) => ({ accountId: l.accountId, ...(l.debit ? { debit: l.debit.replace(/,/g, '') } : {}), ...(l.credit ? { credit: l.credit.replace(/,/g, '') } : {}), ...(l.memo ? { memo: l.memo } : {}) })),
    };
    const out = await action.run((key) =>
      existing ? api.patch<JournalDetail>(v1(`/accounting/journals/${existing.id}`), body) : api.post<JournalDetail>(v1('/accounting/journals'), { portfolioId, ...body }, { idempotencyKey: key }),
    );
    if (out) {
      onClose();
      onDone(out.id);
    }
  }

  return (
    <Modal title={existing ? `Edit ${existing.ref}` : 'New journal'} kicker="Accounting" subtitle="Each line is a debit or a credit. Debits must equal credits. The draft is submitted for a different person to post." onClose={onClose} wide>
      <div className="ops-modal-body">
        <FieldGrid>
          <Field label="Entity" span={2}>
            <select className="ops-input" value={portfolioId} disabled={!!existing} onChange={(e) => setPortfolioId(e.target.value)}>
              <option value="">Choose an entity</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.ref}, {p.baseCurrency})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry date">
            <input className="ops-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Description">
            <input className="ops-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </FieldGrid>
        {portfolioId && accounts.state === 'ok' && accounts.data.length === 0 && <Alert kind="warn">This entity has no active accounts. Add them in Chart of accounts first.</Alert>}
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="r">Debit</th>
                <th className="r">Credit</th>
                <th>Memo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="ops-input" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                      <option value="">Choose</option>
                      {accounts.state === 'ok' &&
                        accounts.data.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} {a.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <input className="ops-input" inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                  </td>
                  <td>
                    <input className="ops-input" inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                  </td>
                  <td>
                    <input className="ops-input" value={l.memo} maxLength={255} onChange={(e) => set(i, { memo: e.target.value })} />
                  </td>
                  <td>
                    <button className="ops-btn small" type="button" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr style={{ fontWeight: 800 }}>
                <td>Totals</td>
                <td className="r">{(dr / 10000).toFixed(2)}</td>
                <td className="r">{(cr / 10000).toFixed(2)}</td>
                <td colSpan={2}>{balanced ? <span className="ops-badge green">Balanced</span> : <span className="ops-badge amber">Out by {(Math.abs(dr - cr) / 10000).toFixed(2)}</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <button className="ops-btn small" type="button" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            Add line
          </button>
        </p>
        <Alert>{action.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose} disabled={action.busy}>
          Cancel
        </button>
        <button className="ops-btn primary" type="button" onClick={submit} disabled={action.busy || !balanced || !portfolioId || description.trim().length < 3}>
          {action.busy ? 'Working…' : existing ? 'Save draft' : 'Save draft'}
        </button>
      </footer>
    </Modal>
  );
}

