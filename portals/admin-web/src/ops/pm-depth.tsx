'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, apiRequest, describeError, OpsError, qs, v1 } from './api';
import { DataTable, label, m2, ReasonModal, Tag, Tile } from './rp';
import { useCan } from './session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, formatDate, Loaded, Modal, optStr, str, useAction, useResource } from './ui';

const P = (p: string) => v1(`/private-markets${p}`);
const STRATEGIES = ['PRIVATE_EQUITY', 'VENTURE', 'REAL_ASSETS', 'PRIVATE_CREDIT', 'INFRASTRUCTURE', 'OTHER'];
const CURRENCIES = ['USD', 'ZWG', 'ZAR', 'EUR', 'GBP', 'BWP'];
const STAGES = ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC', 'APPROVED', 'CLOSED', 'DECLINED', 'ON_HOLD'];
const STAGE_TONE: Record<string, string> = { SOURCED: 'grey', SCREENING: 'blue', DILIGENCE: 'blue', IC: 'amber', APPROVED: 'green', CLOSED: 'grey', DECLINED: 'red', ON_HOLD: 'amber' };
const today = () => new Date().toISOString().slice(0, 10);
const stageText = (s: string) => (s === 'IC' ? 'IC' : label(s));

interface Deal {
  id: string;
  ref: string;
  name: string;
  sponsor: string;
  strategy: string;
  vintage: number;
  currency: string;
  proposedAmount: string;
  expectedClose: string | null;
  stage: string;
  fairValueLevel: number | null;
  valuationDate: string | null;
  ownerName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  nextStages: string[];
  diligenceCases: number | null;
  scenarios: number | null;
  version: number;
  diligence?: Diligence[];
  scenarioList?: Scenario[];
}
interface ChecklistItem {
  key: string;
  label: string;
  status: 'OPEN' | 'DONE' | 'NA' | 'FLAGGED';
  note: string | null;
}
interface Diligence {
  id: string;
  ref: string;
  dealId: string;
  dealRef: string | null;
  dealName: string | null;
  title: string;
  leadName: string | null;
  status: string;
  checklist: ChecklistItem[];
  progress: { done: number; total: number; flagged: number };
  findings: string | null;
  recommendation: string | null;
  version: number;
}
interface Scenario {
  id: string;
  ref: string;
  name: string;
  kind: string;
  currency: string;
  dealRef: string | null;
  dealId: string | null;
  flows: { date: string; kind: 'CALL' | 'DISTRIBUTION'; amount: string }[];
  metrics: { called: string; distributed: string; net: string; moic: string | null; irrPct: string | null; peakNet: string };
  ownerName: string | null;
  mine: boolean;
}
interface Summary {
  stages: { stage: string; count: number; amounts: { currency: string; amount: string }[] }[];
}

/** Local validation for the New investment form (FR-PM-002); the server enforces the same rules. */
export function validateDeal(fd: FormData, now = new Date()): Record<string, string> {
  const e: Record<string, string> = {};
  const year = now.getUTCFullYear();
  if (str(fd, 'name').length < 2) e.name = 'Name the investment';
  if (str(fd, 'sponsor').length < 2) e.sponsor = 'Name the sponsor or manager';
  const amt = str(fd, 'proposedAmount').replace(/,/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(amt) || !(Number(amt) > 0)) e.proposedAmount = 'Enter an amount greater than zero';
  const v = Number(str(fd, 'vintage'));
  if (!Number.isInteger(v) || v < 1990 || v > year) e.vintage = `Vintage must be a year from 1990 to ${year}`;
  const lvl = str(fd, 'fairValueLevel');
  if (lvl && !['1', '2', '3'].includes(lvl)) e.fairValueLevel = 'Fair-value level is 1, 2 or 3';
  const vd = str(fd, 'valuationDate');
  if (vd && vd > now.toISOString().slice(0, 10)) e.valuationDate = 'The valuation date cannot be in the future';
  if (lvl && !vd) e.valuationDate = 'Give the date of the valuation behind the level';
  return e;
}

export function PipelineTab() {
  const canManage = useCan('portfolio.manage');
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const summary = useResource<Summary>(() => api.get<Summary>(P('/pipeline/summary')), []);
  const list = useResource<{ data: Deal[]; total: number }>(() => apiRequest('GET', P(`/pipeline${qs({ stage, q, limit: '100' })}`)), [stage, q]);
  const reload = () => {
    summary.reload();
    list.reload();
  };
  return (
    <>
      <Loaded res={summary} what="pipeline summary">
        {(s) => (
          <div className="ops-tiles">
            {s.stages
              .filter((x) => ['SOURCED', 'SCREENING', 'DILIGENCE', 'IC', 'APPROVED'].includes(x.stage))
              .map((x) => (
                <Tile key={x.stage} label={stageText(x.stage)} value={String(x.count)} hint={x.amounts.length ? x.amounts.map((a) => `${a.currency} ${m2(a.amount)}`).join(' · ') : 'Nothing proposed'} onClick={() => setStage(stage === x.stage ? '' : x.stage)} active={stage === x.stage} />
              ))}
          </div>
        )}
      </Loaded>
      <Card title="Investment pipeline" actions={canManage && <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>New investment</button>}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="ops-input" aria-label="Search pipeline" placeholder="Search name, sponsor or reference" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
          <select className="ops-input" aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{stageText(s)}</option>)}
          </select>
        </div>
        <Loaded res={list} what="the pipeline">
          {(r) =>
            r.data.length === 0 ? (
              <Empty>No investments in the pipeline{stage || q ? ' match' : ' yet'}.</Empty>
            ) : (
              <DataTable head={['Investment', 'Sponsor', 'Strategy', 'Vintage', 'Proposed', 'Stage', 'Diligence', 'Scenarios', 'Owner']}>
                {r.data.map((d) => (
                  <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                    <td><strong>{d.ref}</strong><div className="ops-muted">{d.name}</div></td>
                    <td>{d.sponsor}</td>
                    <td>{label(d.strategy)}</td>
                    <td>{d.vintage}</td>
                    <td className="r">{d.currency} {m2(d.proposedAmount)}</td>
                    <td><Tag value={d.stage} tone={STAGE_TONE[d.stage]} /></td>
                    <td className="r">{d.diligenceCases ?? 0}</td>
                    <td className="r">{d.scenarios ?? 0}</td>
                    <td>{d.ownerName ?? '—'}</td>
                  </tr>
                ))}
              </DataTable>
            )
          }
        </Loaded>
      </Card>
      <ScenariosCard />
      {creating && <DealModal onClose={() => setCreating(false)} onDone={(id) => { reload(); setOpen(id); }} />}
      {open && <DealDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

// ------------------------------------------------------------------ new investment

function Err({ msg }: { msg?: string }) {
  return msg ? <span className="ops-hint" role="alert" style={{ color: 'var(--ops-red, #b42318)' }}>{msg}</span> : null;
}

function DealModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const action = useAction();
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const local = validateDeal(fd);
    setErrors(local);
    if (Object.keys(local).length) return;
    let created: Deal | undefined;
    await action.run(async (key) => {
      try {
        created = await api.post<Deal>(
          P('/pipeline'),
          JSON.parse(
            JSON.stringify({
              name: str(fd, 'name'),
              sponsor: str(fd, 'sponsor'),
              strategy: str(fd, 'strategy'),
              vintage: Number(str(fd, 'vintage')),
              currency: str(fd, 'currency'),
              proposedAmount: str(fd, 'proposedAmount').replace(/,/g, ''),
              expectedClose: optStr(fd, 'expectedClose'),
              fairValueLevel: str(fd, 'fairValueLevel') ? Number(str(fd, 'fairValueLevel')) : undefined,
              valuationDate: optStr(fd, 'valuationDate'),
              notes: optStr(fd, 'notes'),
            }),
          ),
          { idempotencyKey: key },
        );
      } catch (e) {
        const d = e instanceof OpsError && Array.isArray(e.details) ? (e.details as { path?: string; message?: string }[]) : [];
        const mapped: Record<string, string> = {};
        for (const x of d) if (x.path && x.message) mapped[x.path] = x.message;
        if (Object.keys(mapped).length) setErrors(mapped);
        throw e;
      }
    });
    if (created) {
      onDone(created.id);
      onClose();
    }
  }
  return (
    <Modal title="New investment" kicker="Private Markets" subtitle="A prospective private investment. It moves through screening, diligence and committee before it can be approved." onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <div className="ops-modal-body">
          <FieldGrid>
            <Field label="Name"><input className="ops-input" name="name" maxLength={200} aria-invalid={!!errors.name} /><Err msg={errors.name} /></Field>
            <Field label="Sponsor or manager"><input className="ops-input" name="sponsor" maxLength={160} aria-invalid={!!errors.sponsor} /><Err msg={errors.sponsor} /></Field>
            <Field label="Strategy">
              <select className="ops-input" name="strategy" defaultValue="PRIVATE_EQUITY">{STRATEGIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
            </Field>
            <Field label="Vintage" hint={`1990 to ${new Date().getUTCFullYear()}`}><input className="ops-input" name="vintage" type="number" defaultValue={new Date().getUTCFullYear()} aria-invalid={!!errors.vintage} /><Err msg={errors.vintage} /></Field>
            <Field label="Currency">
              <select className="ops-input" name="currency" defaultValue="USD">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
            <Field label="Proposed amount"><input className="ops-input" name="proposedAmount" inputMode="decimal" aria-invalid={!!errors.proposedAmount} /><Err msg={errors.proposedAmount} /></Field>
            <Field label="Expected close"><input className="ops-input" name="expectedClose" type="date" /></Field>
            <Field label="Fair-value level" hint="Level 1 quoted, 2 observable, 3 unobservable inputs">
              <select className="ops-input" name="fairValueLevel" defaultValue="" aria-invalid={!!errors.fairValueLevel}>
                <option value="">Not assessed</option>
                <option value="1">Level 1</option>
                <option value="2">Level 2</option>
                <option value="3">Level 3</option>
              </select>
              <Err msg={errors.fairValueLevel} />
            </Field>
            <Field label="Valuation date"><input className="ops-input" name="valuationDate" type="date" max={today()} aria-invalid={!!errors.valuationDate} /><Err msg={errors.valuationDate} /></Field>
            <Field label="Notes" span={2}><textarea className="ops-input" name="notes" rows={2} maxLength={500} /></Field>
          </FieldGrid>
          <Alert>{action.error}</Alert>
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn" type="button" onClick={onClose} disabled={action.busy}>Cancel</button>
          <button className="ops-btn primary" type="submit" disabled={action.busy}>{action.busy ? 'Working…' : 'Save investment'}</button>
        </footer>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ deal detail

function DealDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan('portfolio.manage');
  const res = useResource<Deal>(() => api.get<Deal>(P(`/pipeline/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | { reason: 'DECLINED' | 'ON_HOLD' } | 'diligence' | 'scenario' | { case: string }>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  const move = (d: Deal, stage: string, note?: string) => api.post(P(`/pipeline/${d.id}/stage`), { stage, note }, {});
  return (
    <Modal title="Investment" kicker="Private Markets" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this investment">
          {(d) => (
            <>
              <h3 style={{ marginTop: 0 }}>{d.ref} · {d.name} <Tag value={d.stage} tone={STAGE_TONE[d.stage]} /></h3>
              <p className="ops-muted">{d.sponsor} · {label(d.strategy)} · vintage {d.vintage} · proposed {d.currency} {m2(d.proposedAmount)} · owner {d.ownerName}</p>
              <dl className="ops-dl">
                <div><dt>Expected close</dt><dd>{d.expectedClose ? formatDate(d.expectedClose) : '—'}</dd></div>
                <div><dt>Fair-value level</dt><dd>{d.fairValueLevel ? `Level ${d.fairValueLevel}${d.valuationDate ? ` as of ${formatDate(d.valuationDate)}` : ''}` : 'Not assessed'}</dd></div>
                {d.decidedByName && <div><dt>Decision</dt><dd>{d.decidedByName}, {d.decidedAt ? formatDate(d.decidedAt) : ''}{d.decisionNote ? `: ${d.decisionNote}` : ''}</dd></div>}
              </dl>
              {canManage && d.nextStages.length > 0 && (
                <div className="ops-actions" style={{ flexWrap: 'wrap' }} aria-label="Move to the next stage">
                  {d.nextStages.filter((s) => s !== 'DECLINED' && s !== 'ON_HOLD').map((s) => (
                    <ActionButton key={s} primary={s !== 'DILIGENCE' || d.stage !== 'IC'} label={d.stage === 'IC' && s === 'DILIGENCE' ? 'Send back to diligence' : `Move to ${stageText(s)}`} confirm={s === 'APPROVED' ? 'Approve this investment? The decision is recorded against your name and the owner cannot approve it.' : undefined} onRun={() => move(d, s)} onDone={done} />
                  ))}
                  {d.nextStages.includes('ON_HOLD') && <button className="ops-btn" type="button" onClick={() => setSub({ reason: 'ON_HOLD' })}>Put on hold</button>}
                  {d.nextStages.includes('DECLINED') && <button className="ops-btn danger" type="button" onClick={() => setSub({ reason: 'DECLINED' })}>Decline</button>}
                </div>
              )}
              <h4>Diligence cases</h4>
              {(d.diligence ?? []).length === 0 ? (
                <Empty>No diligence case yet.</Empty>
              ) : (
                <DataTable head={['Case', 'Status', 'Checklist', 'Flagged', 'Recommendation', 'Lead']}>
                  {(d.diligence ?? []).map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setSub({ case: c.id })}>
                      <td><strong>{c.ref}</strong><div className="ops-muted">{c.title}</div></td>
                      <td><Tag value={c.status} /></td>
                      <td>{c.progress.done} of {c.progress.total}</td>
                      <td>{c.progress.flagged}</td>
                      <td>{c.recommendation ? label(c.recommendation) : '—'}</td>
                      <td>{c.leadName ?? '—'}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
              {canManage && !['CLOSED', 'DECLINED'].includes(d.stage) && (
                <p><button className="ops-btn" type="button" onClick={() => setSub('diligence')}>Open diligence case</button></p>
              )}
              <h4>Cashflow scenarios</h4>
              <ScenarioTable rows={d.scenarioList ?? []} onChanged={done} />
              {canManage && (
                <p><button className="ops-btn" type="button" onClick={() => setSub('scenario')}>New cashflow scenario</button></p>
              )}
              {sub && typeof sub === 'object' && 'reason' in sub && (
                <ReasonModal title={sub.reason === 'DECLINED' ? 'Decline investment' : 'Put on hold'} submitLabel={sub.reason === 'DECLINED' ? 'Decline' : 'Put on hold'} danger={sub.reason === 'DECLINED'} onClose={() => setSub(null)} onSubmit={(reason) => move(d, sub.reason, reason)} onDone={done} />
              )}
              {sub === 'diligence' && <DiligenceOpen dealId={d.id} onClose={() => setSub(null)} onDone={(cid) => { done(); setSub({ case: cid }); }} />}
              {sub && typeof sub === 'object' && 'case' in sub && <DiligenceModal id={sub.case} onClose={() => setSub(null)} onChanged={done} />}
              {sub === 'scenario' && <ScenarioModal dealId={d.id} currency={d.currency} onClose={() => setSub(null)} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

function DiligenceOpen({ dealId, onClose, onDone }: { dealId: string; onClose: () => void; onDone: (caseId: string) => void }) {
  const action = useAction();
  const [error, setError] = useState('');
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const title = str(new FormData(ev.currentTarget), 'title');
    if (title.length < 3) return setError('Give the case a title');
    setError('');
    let c: Diligence | undefined;
    await action.run(async (key) => {
      c = await api.post<Diligence>(P(`/pipeline/${dealId}/diligence`), { title }, { idempotencyKey: key });
    });
    if (c) {
      onDone(c.id);
      onClose();
    }
  }
  return (
    <Modal title="Open diligence case" kicker="Private Markets" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="ops-modal-body">
          <Field label="Title"><input className="ops-input" name="title" maxLength={200} aria-invalid={!!error} /><Err msg={error} /></Field>
          <p className="ops-muted">The case starts with the standard eight-point checklist: sponsor, financials, legal, KYC and AML, valuation, ESG, fees and liquidity.</p>
          <Alert>{action.error}</Alert>
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ops-btn primary" type="submit" disabled={action.busy}>{action.busy ? 'Working…' : 'Open case'}</button>
        </footer>
      </form>
    </Modal>
  );
}

function DiligenceModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan('portfolio.manage');
  const res = useResource<Diligence>(() => api.get<Diligence>(P(`/diligence/${encodeURIComponent(id)}`)), [id]);
  const action = useAction();
  const [error, setError] = useState('');
  const [reopen, setReopen] = useState(false);
  const locked = (c: Diligence) => c.status === 'COMPLETE' || c.status === 'CLOSED';
  async function save(ev: FormEvent<HTMLFormElement>, c: Diligence) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const items = c.checklist.map((i) => ({ key: i.key, status: str(fd, `status.${i.key}`) as ChecklistItem['status'], note: optStr(fd, `note.${i.key}`) ?? null }));
    const flaggedNoNote = items.find((i) => i.status === 'FLAGGED' && !i.note);
    if (flaggedNoNote) return setError(`Explain why "${c.checklist.find((x) => x.key === flaggedNoNote.key)!.label}" is flagged`);
    setError('');
    await action.run(async () => {
      await api.patch(P(`/diligence/${c.id}`), { items, findings: optStr(fd, 'findings') ?? null, recommendation: optStr(fd, 'recommendation') ?? null, version: c.version });
      res.reload();
      onChanged();
    });
  }
  return (
    <Modal title="Diligence case" kicker="Private Markets" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this case">
          {(c) => (
            <form onSubmit={(e) => save(e, c)} noValidate>
              <h3 style={{ marginTop: 0 }}>{c.ref} · {c.title} <Tag value={c.status} /></h3>
              <p className="ops-muted">{c.dealRef} {c.dealName} · lead {c.leadName} · {c.progress.done} of {c.progress.total} items decided</p>
              <DataTable head={['Checklist item', 'Status', 'Note']}>
                {c.checklist.map((i) => (
                  <tr key={i.key}>
                    <td>{i.label}</td>
                    <td>
                      <select className="ops-input" name={`status.${i.key}`} defaultValue={i.status} disabled={locked(c) || !canManage} aria-label={`Status of ${i.label}`}>
                        <option value="OPEN">Open</option>
                        <option value="DONE">Done</option>
                        <option value="NA">Not applicable</option>
                        <option value="FLAGGED">Flagged</option>
                      </select>
                    </td>
                    <td><input className="ops-input" name={`note.${i.key}`} defaultValue={i.note ?? ''} maxLength={300} disabled={locked(c) || !canManage} aria-label={`Note for ${i.label}`} /></td>
                  </tr>
                ))}
              </DataTable>
              <FieldGrid>
                <Field label="Findings" span={2}><textarea className="ops-input" name="findings" rows={3} defaultValue={c.findings ?? ''} maxLength={8000} disabled={locked(c) || !canManage} /></Field>
                <Field label="Recommendation" hint="Flagged items need conditions or a decline">
                  <select className="ops-input" name="recommendation" defaultValue={c.recommendation ?? ''} disabled={locked(c) || !canManage}>
                    <option value="">Not decided</option>
                    <option value="PROCEED">Proceed</option>
                    <option value="PROCEED_WITH_CONDITIONS">Proceed with conditions</option>
                    <option value="DECLINE">Decline</option>
                  </select>
                </Field>
              </FieldGrid>
              <Err msg={error} />
              <Alert>{action.error}</Alert>
              {canManage && (
                <div className="ops-actions" style={{ flexWrap: 'wrap' }}>
                  {!locked(c) && <button className="ops-btn primary" type="submit" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save checklist'}</button>}
                  {!locked(c) && <ActionButton label="Complete case" confirm="Complete this diligence case? Items and findings are then locked." onRun={(k) => api.post(P(`/diligence/${c.id}/complete`), {}, { idempotencyKey: k })} onDone={() => { res.reload(); onChanged(); }} />}
                  {c.status === 'COMPLETE' && <button className="ops-btn" type="button" onClick={() => setReopen(true)}>Reopen</button>}
                </div>
              )}
              {reopen && <ReasonModal title="Reopen diligence case" submitLabel="Reopen" onClose={() => setReopen(false)} onSubmit={(reason) => api.post(P(`/diligence/${c.id}/reopen`), { reason })} onDone={() => { res.reload(); onChanged(); }} />}
            </form>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ cashflow scenarios

function ScenarioTable({ rows, onChanged }: { rows: Scenario[]; onChanged: () => void }) {
  const canManage = useCan('portfolio.manage');
  const [err, setErr] = useState('');
  if (!rows.length) return <Empty>No saved scenarios.</Empty>;
  return (
    <>
      <Alert>{err}</Alert>
      <DataTable head={['Scenario', 'Kind', 'Called', 'Distributed', 'MOIC', 'IRR', 'Peak net', 'Owner', '']}>
        {rows.map((s) => (
          <tr key={s.id}>
            <td><strong>{s.ref}</strong><div className="ops-muted">{s.name}{s.dealRef ? ` · ${s.dealRef}` : ''}</div></td>
            <td>{label(s.kind)}</td>
            <td className="r">{s.currency} {m2(s.metrics.called)}</td>
            <td className="r">{s.currency} {m2(s.metrics.distributed)}</td>
            <td className="r">{s.metrics.moic ? `${s.metrics.moic}x` : '—'}</td>
            <td className="r">{s.metrics.irrPct ? `${s.metrics.irrPct}%` : '—'}</td>
            <td className="r">{m2(s.metrics.peakNet)}</td>
            <td>{s.ownerName}</td>
            <td>
              {canManage && s.mine && (
                <ActionButton label="Delete" danger confirm={`Delete the scenario "${s.name}"? This cannot be undone.`} onRun={async () => { setErr(''); try { await apiRequest('DELETE', P(`/scenarios/${s.id}`)); } catch (e) { setErr(describeError(e)); throw e; } }} onDone={onChanged} />
              )}
            </td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

function ScenariosCard() {
  const res = useResource<{ data: Scenario[] }>(() => apiRequest('GET', P(`/scenarios${qs({ limit: '100' })}`)), []);
  return (
    <Card title="Saved cashflow scenarios">
      <Loaded res={res} what="scenarios">{(r) => <ScenarioTable rows={r.data} onChanged={res.reload} />}</Loaded>
    </Card>
  );
}

interface FlowRow {
  date: string;
  kind: 'CALL' | 'DISTRIBUTION';
  amount: string;
}

export function scenarioPreview(flows: FlowRow[]) {
  let called = 0;
  let dist = 0;
  for (const f of flows) {
    const a = Number(f.amount.replace(/,/g, ''));
    if (!Number.isFinite(a) || a <= 0) continue;
    if (f.kind === 'CALL') called += a;
    else dist += a;
  }
  return { called, dist, moic: called > 0 ? dist / called : null };
}

export function validateScenario(name: string, flows: FlowRow[], now = today()): string[] {
  const e: string[] = [];
  if (name.trim().length < 2) e.push('Name the scenario');
  if (flows.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f.date))) e.push('Every flow needs a date');
  if (flows.some((f) => !(Number(f.amount.replace(/,/g, '')) > 0))) e.push('Every amount must be greater than zero');
  if (!flows.some((f) => f.kind === 'CALL')) e.push('Add at least one capital call');
  if (!flows.some((f) => f.kind === 'DISTRIBUTION')) e.push('Add at least one distribution');
  void now;
  return e;
}

function ScenarioModal({ dealId, currency, onClose, onDone }: { dealId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const action = useAction();
  const [flows, setFlows] = useState<FlowRow[]>([
    { date: '', kind: 'CALL', amount: '' },
    { date: '', kind: 'DISTRIBUTION', amount: '' },
  ]);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (i: number, patch: Partial<FlowRow>) => setFlows((cur) => cur.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  const prev = scenarioPreview(flows);
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const local = validateScenario(str(fd, 'name'), flows);
    setErrors(local);
    if (local.length) return;
    let ok = false;
    await action.run(async (key) => {
      await api.post(P('/scenarios'), { name: str(fd, 'name'), kind: str(fd, 'kind'), currency: str(fd, 'currency'), dealId, flows: flows.map((f) => ({ date: f.date, kind: f.kind, amount: f.amount.replace(/,/g, '') })) }, { idempotencyKey: key });
      ok = true;
    });
    if (ok) {
      onDone();
      onClose();
    }
  }
  return (
    <Modal title="Cashflow scenario" kicker="Private Markets" subtitle="Dated capital calls and distributions. MOIC, IRR and peak net cash are worked out from them when you save." onClose={onClose} wide>
      <form onSubmit={submit} noValidate>
        <div className="ops-modal-body">
          <FieldGrid>
            <Field label="Name"><input className="ops-input" name="name" maxLength={160} /></Field>
            <Field label="Case">
              <select className="ops-input" name="kind" defaultValue="BASE"><option value="BASE">Base</option><option value="UPSIDE">Upside</option><option value="DOWNSIDE">Downside</option></select>
            </Field>
            <Field label="Currency">
              <select className="ops-input" name="currency" defaultValue={currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </Field>
          </FieldGrid>
          <DataTable head={['Date', 'Kind', 'Amount', '']}>
            {flows.map((f, i) => (
              <tr key={i}>
                <td><input className="ops-input" type="date" aria-label={`Flow ${i + 1} date`} value={f.date} onChange={(e) => set(i, { date: e.target.value })} /></td>
                <td>
                  <select className="ops-input" aria-label={`Flow ${i + 1} kind`} value={f.kind} onChange={(e) => set(i, { kind: e.target.value as FlowRow['kind'] })}>
                    <option value="CALL">Capital call</option>
                    <option value="DISTRIBUTION">Distribution</option>
                  </select>
                </td>
                <td><input className="ops-input" inputMode="decimal" aria-label={`Flow ${i + 1} amount`} value={f.amount} onChange={(e) => set(i, { amount: e.target.value })} /></td>
                <td>{flows.length > 2 && <button className="ops-btn small" type="button" onClick={() => setFlows((cur) => cur.filter((_, n) => n !== i))}>Remove</button>}</td>
              </tr>
            ))}
          </DataTable>
          <p><button className="ops-btn small" type="button" onClick={() => setFlows((cur) => [...cur, { date: '', kind: 'CALL', amount: '' }])}>Add a flow</button></p>
          <p className="ops-muted" role="status">Preview: called {prev.called.toLocaleString()} · distributed {prev.dist.toLocaleString()} · MOIC {prev.moic === null ? '—' : `${prev.moic.toFixed(2)}x`}</p>
          {errors.map((m) => <Alert key={m}>{m}</Alert>)}
          <Alert>{action.error}</Alert>
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn" type="button" onClick={onClose} disabled={action.busy}>Cancel</button>
          <button className="ops-btn primary" type="submit" disabled={action.busy}>{action.busy ? 'Working…' : 'Save scenario'}</button>
        </footer>
      </form>
    </Modal>
  );
}

