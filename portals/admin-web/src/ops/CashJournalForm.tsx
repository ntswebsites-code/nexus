'use client';

import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { label, PURPOSES, type CashJournalDetail, type LedgerRow } from '@/ops/cash';
import type { PortfolioSummary } from '@/ops/types';
import { Alert, Field, FieldGrid, Modal, useAction, useResource } from '@/ops/ui';

const today = () => new Date().toISOString().slice(0, 10);

interface JLine {
  ledgerId: string;
  debit: string;
  credit: string;
  memo: string;
}
const blank = (): JLine => ({ ledgerId: '', debit: '', credit: '', memo: '' });
const num = (v: string) => (v.trim() === '' ? 0 : Math.round(Number(v.replace(/,/g, '')) * 10000));
const isZero = (v: string) => /^0+(\.0+)?$/.test(v);

/** Create or edit a cash journal draft. For a bank line, a debit is cash in and a credit is cash out. */
export function CashJournalForm({
  entity,
  portfolios,
  onClose,
  onDone,
  existing,
  preset,
}: {
  entity: string;
  portfolios: PortfolioSummary[];
  onClose: () => void;
  onDone: (id: string) => void;
  existing?: CashJournalDetail;
  preset?: { reservationId?: string; expectationId?: string; description?: string };
}) {
  const action = useAction();
  const [portfolioId, setPortfolioId] = useState(existing?.portfolioId ?? entity);
  const [entryDate, setEntryDate] = useState(existing?.entryDate ?? today());
  const [description, setDescription] = useState(existing?.description ?? preset?.description ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? 'MANUAL_CORRECTION');
  const [sourceRef, setSourceRef] = useState(existing?.sourceRef ?? '');
  const [evidenceRef, setEvidenceRef] = useState(existing?.evidenceRef ?? '');
  const [lines, setLines] = useState<JLine[]>(
    existing ? existing.lines.map((l) => ({ ledgerId: l.ledgerId, debit: isZero(l.debit) ? '' : l.debit, credit: isZero(l.credit) ? '' : l.credit, memo: l.memo ?? '' })) : [blank(), blank()],
  );
  const ledgers = useResource<{ data: LedgerRow[] }>(() => (portfolioId ? api.get<{ data: LedgerRow[] }>(v1(`/cash/ledgers${qs({ portfolioId, status: 'ACTIVE' })}`)) : Promise.resolve({ data: [] })), [portfolioId]);
  const set = (i: number, patch: Partial<JLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dr = lines.reduce((s, l) => s + num(l.debit), 0);
  const cr = lines.reduce((s, l) => s + num(l.credit), 0);
  const balanced = dr === cr && dr > 0;
  const list = ledgers.state === 'ok' ? ledgers.data.data : [];

  async function submit() {
    const body = {
      entryDate,
      description,
      purpose,
      sourceRef: sourceRef || null,
      evidenceRef: evidenceRef || null,
      expectationId: existing?.expectationId ?? preset?.expectationId ?? null,
      reservationId: existing?.reservationId ?? preset?.reservationId ?? null,
      lines: lines
        .filter((l) => l.ledgerId || l.debit || l.credit)
        .map((l) => ({ ledgerId: l.ledgerId, ...(l.debit ? { debit: l.debit.replace(/,/g, '') } : {}), ...(l.credit ? { credit: l.credit.replace(/,/g, '') } : {}), ...(l.memo ? { memo: l.memo } : {}) })),
    };
    const out = await action.run((key) =>
      existing ? api.patch<CashJournalDetail>(v1(`/cash/journals/${existing.id}`), body) : api.post<CashJournalDetail>(v1('/cash/journals'), { portfolioId, ...body }, { idempotencyKey: key }),
    );
    if (out) {
      onClose();
      onDone(out.id);
    }
  }

  return (
    <Modal title={existing ? `Edit ${existing.ref}` : 'New controlled journal'} kicker="Cash & Ledgers" subtitle="Debits must equal credits. A debit to a bank ledger is cash in; a credit is cash out. A different person approves and posts the draft." onClose={onClose} wide>
      <div className="ops-modal-body">
        <FieldGrid>
          <Field label="Portfolio" span={2}>
            <select className="ops-input" value={portfolioId} disabled={!!existing} onChange={(e) => setPortfolioId(e.target.value)}>
              <option value="">Choose a portfolio</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.ref}, {p.baseCurrency})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Value date">
            <input className="ops-input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </Field>
          <Field label="Purpose">
            <select className="ops-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description" span={2}>
            <input className="ops-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Source event" hint="e.g. ORDER-784, DEP-49021">
            <input className="ops-input" value={sourceRef} maxLength={80} onChange={(e) => setSourceRef(e.target.value)} />
          </Field>
          <Field label="Evidence reference">
            <input className="ops-input" value={evidenceRef} maxLength={120} onChange={(e) => setEvidenceRef(e.target.value)} />
          </Field>
        </FieldGrid>
        {(preset?.reservationId || existing?.reservationId) && <Alert kind="info">Posting consumes the linked reservation by the cash credited to its ledger.</Alert>}
        {(preset?.expectationId || existing?.expectationId) && <Alert kind="info">Posting settles the linked expected movement.</Alert>}
        {portfolioId && ledgers.state === 'ok' && list.length === 0 && <Alert kind="warn">This portfolio has no active cash ledgers. Add the standard set on the Balances tab first.</Alert>}
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Ledger</th>
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
                    <select className="ops-input" value={l.ledgerId} onChange={(e) => set(i, { ledgerId: e.target.value })}>
                      <option value="">Choose</option>
                      {list.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.ref} {a.name} ({a.currency})
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
          <button className="ops-btn small" type="button" onClick={() => setLines((ls) => [...ls, blank()])}>
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
          {action.busy ? 'Working…' : 'Save draft'}
        </button>
      </footer>
    </Modal>
  );
}
