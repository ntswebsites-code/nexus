'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { InvesteeRequisition, TrancheLedger } from '@/lib/investee/types';
import { useNative } from './NativeShell';
import { Chip, Section, Stat, Table, btn, ghost, input, money, muted, row, type Tone } from './ui';

/** Requisition statuses (workspace/requisitions.ts TRANSITIONS) and how the company sees them. */
export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Pending VC executive review', tone: 'info' },
  PENDING_VC_EXECUTIVE_REVIEW: { label: 'Pending VC executive review', tone: 'info' },
  PENDING_APPROVAL: { label: 'Pending VC executive review', tone: 'info' },
  RETURNED: { label: 'Returned for changes', tone: 'warn' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  APPROVED: { label: 'Approved', tone: 'good' },
  RFQ_SENT: { label: 'RFQ sent to suppliers', tone: 'good' },
  CONVERTED_TO_PO: { label: 'Converted to purchase order', tone: 'good' },
  FULFILLED: { label: 'Fulfilled', tone: 'good' },
};

export function statusOf(status: string) {
  return REQUEST_STATUS[status] ?? { label: status.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' as Tone };
}

interface Form {
  title: string;
  description: string;
  type: string;
  category: string;
  amount: string;
  currency: string;
  needBy: string;
  priority: string;
}

const EMPTY: Form = { title: '', description: '', type: 'Capital request', category: 'Growth capital', amount: '', currency: '', needBy: '', priority: 'Medium' };
const TYPES = ['Capital request', 'Drawdown', 'Procurement'];

function splitCategory(sourcing: string): { type: string; category: string } {
  const [type = 'Capital request', ...rest] = sourcing.split(': ');
  return { type, category: rest.join(': ') || 'Growth capital' };
}

export function RequestsScreen() {
  const { api, run, meId } = useNative();
  const [items, setItems] = useState<InvesteeRequisition[] | null>(null);
  const [tranche, setTranche] = useState<TrancheLedger | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [editing, setEditing] = useState<{ ref: string; form: Form } | null>(null);
  const busy = useRef(false);
  const canCreate = api.isLive('requests.create');

  const load = useCallback(async () => {
    const out = await run('', () => api.getRequestsWithTranche());
    if (out) {
      setItems(out.requisitions);
      setTranche(out.tranche);
    }
  }, [api, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const currency = tranche?.currency ?? 'USD';
  const amount = Number(f.amount);
  const overDraw = !!tranche?.configured && f.amount !== '' && amount > tranche.available;

  /** One request at a time: a double click must not send it twice. */
  async function once(fn: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
    } finally {
      busy.current = false;
    }
  }

  function body(form: Form) {
    return {
      title: form.title.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      type: form.type,
      category: form.category.trim() || 'Growth capital',
      ...(form.currency ? { currency: form.currency.toUpperCase() } : {}),
      amount: Number(form.amount || 0),
      ...(form.needBy ? { needBy: form.needBy } : {}),
      priority: form.priority,
    };
  }

  function create(draft: boolean) {
    return (e?: FormEvent) => {
      e?.preventDefault();
      void once(async () => {
        const out = await run(draft ? 'Draft saved. Submit it when it is ready for review.' : 'Request submitted for VC executive review', () =>
          api.createRequest({ ...body(f), draft }),
        );
        if (out) {
          setF(EMPTY);
          await load();
        }
      });
    };
  }

  const submitDraft = (ref: string) =>
    once(async () => {
      if (await run(`${ref} submitted for VC executive review`, () => api.submitDraftRequest(ref))) await load();
    });

  function startEdit(r: InvesteeRequisition) {
    const { type, category } = splitCategory(r.sourcingCategory);
    setEditing({
      ref: r.id,
      form: { title: r.title, description: r.description, type, category, amount: String(r.estimatedAmount), currency: r.currency, needBy: r.needBy, priority: r.priority },
    });
  }

  function resubmit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    void once(async () => {
      if (await run(`${editing.ref} resubmitted for VC executive review`, () => api.resubmitRequest(editing.ref, body(editing.form)))) {
        setEditing(null);
        await load();
      }
    });
  }

  const mine = (r: InvesteeRequisition) => !r.createdById || !meId || r.createdById === meId;

  return (
    <>
      <Section title="Investment tranche">
        {tranche === null ? (
          <p role="status" style={muted}>{items === null ? 'Loading...' : 'The tranche position is not available.'}</p>
        ) : !tranche.configured ? (
          <p style={{ fontSize: 13, margin: 0 }}>No investment tranche is on record for this company yet, so requests are not checked against an available amount. Matanho sets the committed tranche.</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Stat label="Committed" value={money(currency, tranche.committed)} hint={tranche.source === 'tranche' ? 'Agreed tranche' : 'From executed term sheets'} />
              <Stat label="Reserved by requests" value={money(currency, tranche.reserved)} hint="Under review, approved, RFQ, PO or fulfilled" />
              <Stat label="Available to request" value={money(currency, tranche.available)} tone={tranche.available <= 0 ? 'bad' : 'good'} />
              <Stat label="Approved this quarter" value={money(currency, tranche.approvedThisQuarter)} />
              <Stat label="Approved to date" value={money(currency, tranche.totalApproved)} />
            </div>
            <p style={{ ...muted, marginTop: 8 }}>A request that would take the reserved total above the committed tranche is refused.</p>
          </>
        )}
      </Section>

      {canCreate && (
        <Section title="New request">
          <RequestFields form={f} onChange={setF} />
          {overDraw && (
            <p role="alert" style={{ fontSize: 13, color: '#991b1b', margin: '8px 0 0' }}>
              This amount is more than the {money(currency, tranche!.available)} still available in the tranche, so it will be refused on submission.
            </p>
          )}
          <div style={row}>
            <button type="button" style={btn} onClick={create(false)} disabled={f.title.trim().length < 3}>Submit for review</button>
            <button type="button" style={ghost} onClick={create(true)} disabled={f.title.trim().length < 3}>Save as draft</button>
          </div>
          <p style={muted}>Submitted requests go to the Matanho VC executive, who aims to respond within 48 hours. A draft is not checked against the tranche until you submit it.</p>
        </Section>
      )}

      {editing && (
        <Section title={`Edit and resubmit ${editing.ref}`}>
          <form onSubmit={resubmit}>
            <RequestFields form={editing.form} onChange={(form) => setEditing({ ...editing, form })} />
            <div style={row}>
              <button style={btn}>Resubmit</button>
              <button type="button" style={ghost} onClick={() => setEditing(null)}>Cancel</button>
            </div>
            <p style={muted}>Change what the reviewer asked for; an unchanged request cannot be resubmitted.</p>
          </form>
        </Section>
      )}

      <Section title="Requests">
        <Table
          head={['Ref', 'Request', 'Amount', 'Need by', 'Status', 'Progress', '']}
          empty="No requests yet."
          rows={
            items
              ? items.map((r) => {
                  const s = statusOf(r.status);
                  return [
                    r.id,
                    <span key="t">
                      <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                      <span style={{ display: 'block', ...muted }}>{r.sourcingCategory} - {r.createdByName}</span>
                      {r.note && (r.status === 'RETURNED' || r.status === 'REJECTED') && <span style={{ display: 'block', fontSize: 12, color: '#92400e' }}>Reviewer: {r.note}</span>}
                    </span>,
                    money(r.currency, r.estimatedAmount),
                    r.needBy || '',
                    <span key="s">
                      <Chip tone={s.tone}>{s.label}</Chip>
                      {r.slaBreached && <span style={{ display: 'block', fontSize: 12, color: '#b45309' }}>Waiting {r.hoursPending} h</span>}
                    </span>,
                    <Progress key="p" r={r} />,
                    r.status === 'DRAFT' && canCreate && mine(r) ? (
                      <button key="a" style={btn} onClick={() => void submitDraft(r.id)}>Submit</button>
                    ) : r.canResubmit && canCreate && mine(r) ? (
                      <button key="a" style={ghost} onClick={() => startEdit(r)}>Edit and resubmit</button>
                    ) : (
                      ''
                    ),
                  ];
                })
              : null
          }
        />
      </Section>
    </>
  );
}

function Progress({ r }: { r: InvesteeRequisition }) {
  const steps: string[] = [];
  if (r.submittedAt) steps.push(`Submitted ${r.submittedAt.slice(0, 10)}`);
  if (r.approvedAt) steps.push(`Approved ${r.approvedAt.slice(0, 10)}`);
  if (r.rfqSentAt) steps.push(`RFQ ${r.rfqSentAt.slice(0, 10)}`);
  if (r.poRef) steps.push(`PO ${r.poRef}`);
  return <span style={muted}>{steps.join(' - ')}</span>;
}

function RequestFields({ form, onChange }: { form: Form; onChange: (f: Form) => void }) {
  const set = (k: keyof Form) => (e: { target: { value: string } }) => onChange({ ...form, [k]: e.target.value });
  return (
    <>
      <div style={row}>
        <input aria-label="Title" style={{ ...input, flex: '2 1 240px' }} placeholder="What the money is for" value={form.title} onChange={set('title')} required minLength={3} />
        <select aria-label="Type" style={input} value={form.type} onChange={set('type')}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input aria-label="Category" style={input} placeholder="Category" value={form.category} onChange={set('category')} />
      </div>
      <div style={row}>
        <input aria-label="Amount" style={{ ...input, width: 140 }} type="number" min="0" step="any" placeholder="Amount" value={form.amount} onChange={set('amount')} />
        <input aria-label="Currency" style={{ ...input, width: 80 }} placeholder="USD" maxLength={3} value={form.currency} onChange={set('currency')} />
        <input aria-label="Need by" style={input} type="date" value={form.needBy} onChange={set('needBy')} />
        <select aria-label="Priority" style={input} value={form.priority} onChange={set('priority')}>
          {['High', 'Medium', 'Low'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <textarea aria-label="Description" style={{ ...input, width: '100%', marginTop: 10, minHeight: 60, boxSizing: 'border-box' }} placeholder="Description and justification" value={form.description} onChange={set('description')} />
    </>
  );
}
