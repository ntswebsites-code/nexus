'use client';

import { useEffect, useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import { ImportPanel } from '@/ops/imports';
import { AccessDenied, DataTable, label, m2, PortfolioSelect, ReasonModal, ratioText, Tag, Tile, today, usePortfolios, useSecurities } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

const F = (p: string) => v1(`/financing${p}`);
const NEEDS_MANAGE = 'Needs the financing.manage permission';
const TYPES = ['MARGIN_LOAN', 'REPO', 'SEC_LENDING', 'OVERDRAFT'];

interface MarginView {
  drawn: string;
  counted: string;
  coverage: string | null;
  state: string;
  excess: string;
  callAmount: string;
  availableToDraw: string;
}
interface ValLine {
  itemId: string;
  ticker: string;
  assetClass: string;
  market: string;
  quantity: string;
  marketValue: string | null;
  eligible: boolean;
  haircutPct: string | null;
  afterHaircut: string | null;
  counted: string | null;
  capped: boolean;
  reason: string | null;
}
interface Valuation {
  marketValue: string;
  afterHaircut: string;
  counted: string;
  ineligible: string;
  warnings: string[];
  lines: ValLine[];
}
interface Facility {
  id: string;
  ref: string;
  name: string;
  type: string;
  lender: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  poolId: string | null;
  poolRef: string | null;
  poolName: string | null;
  currency: string;
  limitAmount: string;
  ratePct: string;
  initialRatio: string;
  maintenanceRatio: string;
  callDueDays: number;
  status: string;
  makerId: string;
  makerName: string | null;
  approverName: string | null;
  margin: MarginView;
  openCalls: number;
  overdueCalls: number;
  version: number;
  valuation?: Valuation | null;
  movements?: { id: string; kind: string; amount: string; valueDate: string; note: string | null; createdByName: string | null }[];
  calls?: Call[];
}
interface Call {
  id: string;
  ref: string;
  facilityRef: string | null;
  facilityName: string | null;
  lender: string | null;
  currency: string | null;
  status: string;
  calledAmount: string;
  drawn: string;
  eligibleValue: string;
  coverageRatio: string;
  coverageAfter: string | null;
  dueAt: string;
  overdue: boolean;
  issuedBy: string;
  issuedByName: string | null;
  acknowledgedByName: string | null;
  resolvedByName: string | null;
  resolution: string | null;
  portfolioId?: string | null;
  disposition?: Disposition | null;
  current?: MarginView;
}
interface Disposition {
  kind: 'FUNDED' | 'DISPUTE_RESOLVED';
  outcome: string | null;
  reason: string | null;
  proposedBy: string | null;
  proposedByName: string | null;
  proposedAt: string | null;
  priorStatus: string | null;
  counterpartyEvidenceRef: string | null;
  houseCalcAmount: string | null;
  houseCalcNote: string | null;
  fundingLedgerId: string | null;
  fundingAmount: string | null;
  expectationId: string | null;
  journalId: string | null;
}
interface BankLedger {
  id: string;
  ref: string;
  name: string;
  currency: string;
}
interface Pool {
  id: string;
  ref: string;
  name: string;
  portfolioId: string;
  portfolioName: string | null;
  currency: string;
  status: string;
  valuation: Valuation | null;
  facilities: { id: string; ref: string; name: string; status: string }[];
  items?: number;
}
interface Rule {
  id: string;
  assetClass: string;
  market: string;
  eligible: boolean;
  haircutPct: string;
  maxPoolPct: string | null;
  note: string | null;
  updatedByName: string | null;
}
interface Summary {
  facilities: number;
  pendingApproval: number;
  inDeficit: number;
  warning: number;
  openCalls: number;
  overdueCalls: number;
  exposure: { currency: string; limit: string; drawn: string }[];
  watchlist: Facility[];
}

type Tab = 'facilities' | 'calls' | 'pools' | 'rules' | 'import';
const OPEN = ['ISSUED', 'ACKNOWLEDGED', 'DISPUTED', 'PENDING_CHECK'];

export default function FinancingPage() {
  const canView = useCan('risk.view');
  const canManage = useCan('financing.manage');
  const [tab, setTab] = useState<Tab>('facilities');
  const [open, setOpen] = useState<{ kind: 'facility' | 'call' | 'pool'; id: string } | null>(null);
  const [tick, setTick] = useState(0);
  const summary = useResource<Summary>(() => api.get<Summary>(F('/summary')), [tick]);
  const bump = () => setTick((t) => t + 1);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('facility')) setOpen({ kind: 'facility', id: sp.get('facility')! });
    else if (sp.get('call')) {
      setTab('calls');
      setOpen({ kind: 'call', id: sp.get('call')! });
    }
  }, []);

  if (!canView) return <AccessDenied kicker="Risk" title="Collateral & Financing" perm="risk.view" />;
  return (
    <>
      <PageHeader
        kicker="Risk"
        title="Collateral & Financing"
        subtitle="Margin and financing facilities, the collateral pools behind them, haircut and eligibility rules, and the margin call lifecycle. Drawn balance and coverage are derived, never typed in."
        actions={canManage ? <MonitorButton onDone={bump} /> : <button className="ops-btn" type="button" disabled title={NEEDS_MANAGE}>Run margin monitor</button>}
      />
      <Loaded res={summary} what="financing summary">
        {(s) => (
          <div className="ops-tiles">
            <Tile label="Live facilities" value={String(s.facilities)} hint={`${s.pendingApproval} awaiting approval`} onClick={() => setTab('facilities')} />
            <Tile label="Margin deficit" value={String(s.inDeficit)} hint={`${s.warning} on warning`} onClick={() => setTab('facilities')} />
            <Tile label="Open margin calls" value={String(s.openCalls)} hint={`${s.overdueCalls} overdue`} onClick={() => setTab('calls')} />
            {s.exposure.map((e) => (
              <Tile key={e.currency} label={`Drawn (${e.currency})`} value={m2(e.drawn)} hint={`of ${m2(e.limit)} limit`} />
            ))}
          </div>
        )}
      </Loaded>
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['facilities', 'calls', 'pools', 'rules', 'import'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ops-btn${tab === t ? ' primary' : ''}`} type="button" onClick={() => setTab(t)}>
            {t === 'facilities' ? 'Facilities' : t === 'calls' ? 'Margin calls' : t === 'pools' ? 'Collateral pools' : t === 'rules' ? 'Haircuts & eligibility' : 'Margin statement import'}
          </button>
        ))}
      </div>
      {tab === 'facilities' && <FacilitiesTab key={tick} onOpen={(id) => setOpen({ kind: 'facility', id })} onChanged={bump} />}
      {tab === 'calls' && <CallsTab key={tick} onOpen={(id) => setOpen({ kind: 'call', id })} />}
      {tab === 'pools' && <PoolsTab key={tick} onOpen={(id) => setOpen({ kind: 'pool', id })} onChanged={bump} />}
      {tab === 'rules' && <RulesTab key={tick} onChanged={bump} />}
      {tab === 'import' && <ImportPanel only={['margin-statement']} onCommitted={bump} />}
      {open?.kind === 'facility' && <FacilityModal id={open.id} onClose={() => setOpen(null)} onChanged={bump} onOpenCall={(id) => setOpen({ kind: 'call', id })} />}
      {open?.kind === 'call' && <CallModal id={open.id} onClose={() => setOpen(null)} onChanged={bump} />}
      {open?.kind === 'pool' && <PoolModal id={open.id} onClose={() => setOpen(null)} onChanged={bump} />}
    </>
  );
}

function MonitorButton({ onDone }: { onDone: () => void }) {
  return <ActionButton label="Run margin monitor" title="Value every live facility and raise a call where coverage is below maintenance" onRun={() => api.post(F('/monitor'), {})} onDone={onDone} />;
}

const StateTag = ({ m }: { m: MarginView }) => <Tag value={m.state} />;

// ================================================================ facilities

function FacilitiesTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const canManage = useCan('financing.manage');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const res = useResource<Facility[]>(() => api.get<Facility[]>(F(`/facilities${qs({ status })}`)), [status]);
  return (
    <Card title="Facilities" actions={<button className="ops-btn primary" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setCreating(true)}>New facility</button>}>
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="facilities">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No facilities yet.</Empty>
          ) : (
            <DataTable head={['Facility', 'Lender', 'Portfolio', 'Limit', 'Drawn', 'Coverage', 'Maintenance', 'Margin', 'Calls', 'Status']}>
              {rows.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => onOpen(f.id)}>
                  <td><strong>{f.ref}</strong><div className="ops-muted">{f.name} · {label(f.type)}</div></td>
                  <td>{f.lender}</td>
                  <td>{f.portfolioName}</td>
                  <td className="r">{f.currency} {m2(f.limitAmount)}</td>
                  <td className="r">{m2(f.margin.drawn)}</td>
                  <td className="r">{ratioText(f.margin.coverage)}</td>
                  <td className="r">{ratioText(f.maintenanceRatio)}</td>
                  <td><StateTag m={f.margin} /></td>
                  <td className="r">{f.openCalls}{f.overdueCalls ? ` (${f.overdueCalls} overdue)` : ''}</td>
                  <td><Tag value={f.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && <FacilityForm onClose={() => setCreating(false)} onDone={() => { res.reload(); onChanged(); }} />}
    </Card>
  );
}

function FacilityForm({ facility, onClose, onDone }: { facility?: Facility; onClose: () => void; onDone: () => void }) {
  const portfolios = usePortfolios();
  const pools = useResource<Pool[]>(() => api.get<Pool[]>(F('/pools')), []);
  const [portfolioId, setPortfolioId] = useState(facility?.portfolioId ?? '');
  return (
    <FormModal
      title={facility ? `Edit ${facility.ref}` : 'New financing facility'}
      subtitle="Coverage = eligible collateral after haircuts / drawn. A margin call restores the initial ratio when coverage falls below the maintenance ratio."
      submitLabel={facility ? 'Save draft' : 'Create draft'}
      wide
      onClose={onClose}
      onSubmit={(fd, key) => {
        const body = { name: str(fd, 'name'), type: str(fd, 'type'), lender: str(fd, 'lender'), portfolioId, poolId: optStr(fd, 'poolId'), currency: str(fd, 'currency') || 'USD', limitAmount: str(fd, 'limit').replace(/,/g, ''), ratePct: str(fd, 'rate') || '0', initialRatio: str(fd, 'initial'), maintenanceRatio: str(fd, 'maintenance'), callDueDays: Number(str(fd, 'due') || 2), ...(facility ? { version: facility.version } : {}) };
        return facility ? api.patch(F(`/facilities/${facility.id}`), body) : api.post(F('/facilities'), body, { idempotencyKey: key });
      }}
      onDone={onDone}
    >
      <FieldGrid>
        <Field label="Name"><input className="ops-input" name="name" defaultValue={facility?.name} required minLength={2} /></Field>
        <Field label="Type"><select className="ops-input" name="type" defaultValue={facility?.type ?? 'MARGIN_LOAN'}>{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
        <Field label="Lender / counterparty"><input className="ops-input" name="lender" defaultValue={facility?.lender} required /></Field>
        <Field label="Portfolio"><PortfolioSelect list={portfolios} value={portfolioId} onChange={setPortfolioId} /></Field>
        <Field label="Collateral pool" hint="Must belong to the same portfolio">
          <select className="ops-input" name="poolId" defaultValue={facility?.poolId ?? ''}>
            <option value="">None yet</option>
            {pools.state === 'ok' && pools.data.filter((p) => !portfolioId || p.portfolioId === portfolioId).map((p) => <option key={p.id} value={p.id}>{p.ref} · {p.name}</option>)}
          </select>
        </Field>
        <Field label="Currency"><input className="ops-input" name="currency" defaultValue={facility?.currency ?? 'USD'} maxLength={3} /></Field>
        <Field label="Limit"><input className="ops-input" name="limit" defaultValue={facility?.limitAmount} inputMode="decimal" required /></Field>
        <Field label="Rate %"><input className="ops-input" name="rate" defaultValue={facility?.ratePct ?? '0'} inputMode="decimal" /></Field>
        <Field label="Initial ratio (x)"><input className="ops-input" name="initial" defaultValue={facility?.initialRatio ?? '1.5'} inputMode="decimal" required /></Field>
        <Field label="Maintenance ratio (x)"><input className="ops-input" name="maintenance" defaultValue={facility?.maintenanceRatio ?? '1.25'} inputMode="decimal" required /></Field>
        <Field label="Days to meet a call"><input className="ops-input" name="due" type="number" min={0} max={30} defaultValue={facility?.callDueDays ?? 2} /></Field>
      </FieldGrid>
    </FormModal>
  );
}

function ValuationTable({ v }: { v: Valuation }) {
  return (
    <>
      <dl className="ops-dl">
        <div><dt>Market value</dt><dd>{m2(v.marketValue)}</dd></div>
        <div><dt>After haircuts</dt><dd>{m2(v.afterHaircut)}</dd></div>
        <div><dt>Counted as collateral</dt><dd>{m2(v.counted)}</dd></div>
        <div><dt>Ineligible</dt><dd>{m2(v.ineligible)}</dd></div>
      </dl>
      {v.warnings.map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
      <DataTable head={['Security', 'Class', 'Quantity', 'Market value', 'Haircut', 'Counted', 'Note']}>
        {v.lines.map((l) => (
          <tr key={l.itemId}>
            <td>{l.ticker}</td>
            <td>{l.assetClass} {l.market}</td>
            <td className="r">{l.quantity}</td>
            <td className="r">{m2(l.marketValue)}</td>
            <td className="r">{l.eligible ? `${l.haircutPct}%` : <Tag value="Ineligible" tone="red" />}</td>
            <td className="r">{m2(l.counted)}</td>
            <td className="ops-muted">{l.reason ?? ''}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

function FacilityModal({ id, onClose, onChanged, onOpenCall }: { id: string; onClose: () => void; onChanged: () => void; onOpenCall: (id: string) => void }) {
  const { user } = useSession();
  const canManage = useCan('financing.manage');
  const canApprove = useCan('financing.approve');
  const res = useResource<Facility>(() => api.get<Facility>(F(`/facilities/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'edit' | 'draw' | 'repay' | 'return' | 'suspend' | 'reactivate' | 'close'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Facility" kicker="Collateral & Financing" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this facility">
          {(f) => {
            const maker = f.makerId === user.id;
            const moveForm = (kind: 'draw' | 'repay') => (
              <FormModal title={kind === 'draw' ? 'Draw down' : 'Repay'} subtitle={kind === 'draw' ? `Available to draw: ${f.currency} ${m2(f.margin.availableToDraw)} (limit and ${ratioText(f.initialRatio)} initial cover)` : `Drawn: ${f.currency} ${m2(f.margin.drawn)}`} submitLabel={kind === 'draw' ? 'Draw' : 'Repay'} onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(F(`/facilities/${f.id}/${kind}`), { amount: str(fd, 'amount').replace(/,/g, ''), valueDate: optStr(fd, 'valueDate'), note: optStr(fd, 'note') }, { idempotencyKey: k })} onDone={done}>
                <FieldGrid>
                  <Field label="Amount"><input className="ops-input" name="amount" inputMode="decimal" required /></Field>
                  <Field label="Value date"><input className="ops-input" name="valueDate" type="date" defaultValue={today()} max={today()} /></Field>
                  <Field label="Note" span={2}><input className="ops-input" name="note" maxLength={255} /></Field>
                </FieldGrid>
              </FormModal>
            );
            return (
              <>
                <h3 style={{ marginTop: 0 }}>{f.ref} · {f.name} <Tag value={f.status} /> <StateTag m={f.margin} /></h3>
                <p className="ops-muted">{label(f.type)} · {f.lender} · {f.portfolioName} · prepared by {f.makerName}{f.approverName ? ` · approved by ${f.approverName}` : ''}</p>
                <dl className="ops-dl">
                  <div><dt>Limit</dt><dd>{f.currency} {m2(f.limitAmount)}</dd></div>
                  <div><dt>Drawn</dt><dd>{m2(f.margin.drawn)}</dd></div>
                  <div><dt>Eligible collateral</dt><dd>{m2(f.margin.counted)}</dd></div>
                  <div><dt>Coverage</dt><dd>{ratioText(f.margin.coverage)}</dd></div>
                  <div><dt>Initial / maintenance</dt><dd>{ratioText(f.initialRatio)} / {ratioText(f.maintenanceRatio)}</dd></div>
                  <div><dt>Excess over maintenance</dt><dd>{m2(f.margin.excess)}</dd></div>
                  <div><dt>Available to draw</dt><dd>{m2(f.margin.availableToDraw)}</dd></div>
                  <div><dt>Pool</dt><dd>{f.poolRef ? `${f.poolRef} · ${f.poolName}` : 'None'}</dd></div>
                  <div><dt>Rate</dt><dd>{f.ratePct}%</dd></div>
                </dl>
                {f.margin.state === 'DEFICIT' && <Alert kind="warn">Coverage is below the maintenance ratio. A margin call would ask for {f.currency} {m2(f.margin.callAmount)}.</Alert>}
                <h4>Collateral</h4>
                {f.valuation ? <ValuationTable v={f.valuation} /> : <p className="ops-muted">No pool linked.</p>}
                <h4>Drawdowns and repayments</h4>
                {f.movements && f.movements.length ? (
                  <DataTable head={['Value date', 'Kind', 'Amount', 'Note', 'By']}>
                    {f.movements.map((m) => (
                      <tr key={m.id}><td>{formatDate(m.valueDate)}</td><td><Tag value={m.kind} tone={m.kind === 'DRAW' ? 'amber' : 'green'} /></td><td className="r">{m2(m.amount)}</td><td>{m.note}</td><td>{m.createdByName}</td></tr>
                    ))}
                  </DataTable>
                ) : (
                  <p className="ops-muted">Nothing drawn.</p>
                )}
                <h4>Margin calls</h4>
                {f.calls && f.calls.length ? (
                  <DataTable head={['Call', 'Amount', 'Coverage then', 'Due', 'Status']}>
                    {f.calls.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => onOpenCall(c.id)}><td>{c.ref}</td><td className="r">{m2(c.calledAmount)}</td><td className="r">{ratioText(c.coverageRatio)}</td><td>{formatDateTime(c.dueAt)} {c.overdue && <Tag value="Overdue" tone="red" />}</td><td><Tag value={c.status} /></td></tr>
                    ))}
                  </DataTable>
                ) : (
                  <p className="ops-muted">No margin calls.</p>
                )}
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  {f.status === 'DRAFT' && canManage && maker && (
                    <>
                      <button className="ops-btn" type="button" onClick={() => setSub('edit')}>Edit</button>
                      <ActionButton primary label="Submit for approval" onRun={(k) => api.post(F(`/facilities/${f.id}/submit`), {}, { idempotencyKey: k })} onDone={done} />
                    </>
                  )}
                  {f.status === 'PENDING_APPROVAL' && canApprove && !maker && (
                    <>
                      <ActionButton primary label="Approve and activate" confirm="Activate this facility?" onRun={(k) => api.post(F(`/facilities/${f.id}/approve`), {}, { idempotencyKey: k })} onDone={done} />
                      <button className="ops-btn" type="button" onClick={() => setSub('return')}>Return</button>
                    </>
                  )}
                  {f.status === 'PENDING_APPROVAL' && maker && <span className="ops-muted">A different person with financing.approve activates it.</span>}
                  {f.status === 'ACTIVE' && canManage && (
                    <>
                      <button className="ops-btn primary" type="button" onClick={() => setSub('draw')}>Draw</button>
                      <button className="ops-btn" type="button" onClick={() => setSub('repay')}>Repay</button>
                      <ActionButton label="Check margin" onRun={(k) => api.post(F(`/facilities/${f.id}/check`), {}, { idempotencyKey: k })} onDone={done} />
                      <button className="ops-btn" type="button" onClick={() => setSub('suspend')}>Suspend</button>
                    </>
                  )}
                  {f.status === 'SUSPENDED' && canApprove && <button className="ops-btn" type="button" onClick={() => setSub('reactivate')}>Reactivate</button>}
                  {f.status !== 'CLOSED' && canManage && <button className="ops-btn" type="button" onClick={() => setSub('close')}>Close</button>}
                  {!canManage && f.status !== 'CLOSED' && (
                    <>
                      {f.status === 'ACTIVE' && <button className="ops-btn primary" type="button" disabled title={NEEDS_MANAGE}>Draw</button>}
                      {f.status === 'ACTIVE' && <button className="ops-btn" type="button" disabled title={NEEDS_MANAGE}>Repay</button>}
                      <button className="ops-btn" type="button" disabled title={NEEDS_MANAGE}>Close</button>
                      <span className="ops-muted">{NEEDS_MANAGE}.</span>
                    </>
                  )}
                  {f.status === 'PENDING_APPROVAL' && !canApprove && <button className="ops-btn primary" type="button" disabled title="Needs the financing.approve permission">Approve and activate</button>}
                </div>
                {sub === 'edit' && <FacilityForm facility={f} onClose={() => setSub(null)} onDone={done} />}
                {sub === 'draw' && moveForm('draw')}
                {sub === 'repay' && moveForm('repay')}
                {sub === 'return' && <ReasonModal title="Return to preparer" submitLabel="Return" onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/facilities/${f.id}/return`), { reason })} onDone={done} />}
                {sub === 'suspend' && <ReasonModal title="Suspend facility" submitLabel="Suspend" onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/facilities/${f.id}/suspend`), { reason })} onDone={done} />}
                {sub === 'reactivate' && <ReasonModal title="Reactivate facility" submitLabel="Reactivate" onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/facilities/${f.id}/reactivate`), { reason })} onDone={done} />}
                {sub === 'close' && <ReasonModal title="Close facility" hint="Needs a zero balance and no open calls" submitLabel="Close" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/facilities/${f.id}/close`), { reason })} onDone={done} />}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ margin calls

function CallsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('');
  const res = useResource<Call[]>(() => api.get<Call[]>(F(`/calls${qs({ status })}`)), [status]);
  return (
    <Card title="Margin calls">
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['ISSUED', 'ACKNOWLEDGED', 'DISPUTED', 'MET', 'WAIVED', 'CANCELLED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="margin calls">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No margin calls.</Empty>
          ) : (
            <DataTable head={['Call', 'Facility', 'Lender', 'Amount', 'Coverage then', 'Due', 'Status']}>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                  <td><strong>{c.ref}</strong></td>
                  <td>{c.facilityRef} <span className="ops-muted">{c.facilityName}</span></td>
                  <td>{c.lender}</td>
                  <td className="r">{c.currency} {m2(c.calledAmount)}</td>
                  <td className="r">{ratioText(c.coverageRatio)}</td>
                  <td>{formatDateTime(c.dueAt)} {c.overdue && <Tag value="Overdue" tone="red" />}</td>
                  <td><Tag value={c.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
    </Card>
  );
}

function CallModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const canManage = useCan('financing.manage');
  const canApprove = useCan('financing.approve');
  const res = useResource<Call>(() => api.get<Call>(F(`/calls/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'dispute' | 'resolve' | 'waive' | 'cancel' | 'fund' | 'disputeResolve' | 'approveDisp' | 'returnDisp'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Margin call" kicker="Collateral & Financing" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this call">
          {(c) => {
            const open = OPEN.includes(c.status);
            const issuer = c.issuedBy === user.id;
            const pending = c.status === 'PENDING_CHECK' && !!c.disposition;
            const proposer = c.disposition?.proposedBy === user.id;
            return (
              <>
                <h3 style={{ marginTop: 0 }}>{c.ref} · {c.facilityRef} <Tag value={c.status} /> {c.overdue && <Tag value="Overdue" tone="red" />}</h3>
                <p className="ops-muted">{c.facilityName} · {c.lender} · issued by {c.issuedByName} · due {formatDateTime(c.dueAt)}</p>
                <dl className="ops-dl">
                  <div><dt>Called</dt><dd>{c.currency} {m2(c.calledAmount)}</dd></div>
                  <div><dt>Drawn then</dt><dd>{m2(c.drawn)}</dd></div>
                  <div><dt>Eligible then</dt><dd>{m2(c.eligibleValue)}</dd></div>
                  <div><dt>Coverage then</dt><dd>{ratioText(c.coverageRatio)}</dd></div>
                  {c.current && <div><dt>Coverage now</dt><dd>{ratioText(c.current.coverage)}</dd></div>}
                  {c.coverageAfter && <div><dt>Coverage when met</dt><dd>{ratioText(c.coverageAfter)}</dd></div>}
                  {c.acknowledgedByName && <div><dt>Acknowledged by</dt><dd>{c.acknowledgedByName}</dd></div>}
                  {c.resolvedByName && <div><dt>Resolved by</dt><dd>{c.resolvedByName}</dd></div>}
                </dl>
                {c.resolution && <p>{c.resolution}</p>}
                {c.disposition && (
                  <Alert kind={pending ? 'warn' : 'info'}>
                    {pending ? 'Awaiting an independent checker: ' : 'Disposition: '}
                    {c.disposition.kind === 'FUNDED' ? `funding of ${m2(c.disposition.fundingAmount)} ${c.currency ?? ''}` : `dispute resolution (${(c.disposition.outcome ?? '').toLowerCase().replace(/_/g, ' ')})`} proposed by {c.disposition.proposedByName ?? 'unknown'}. {c.disposition.reason}
                    {c.disposition.counterpartyEvidenceRef ? ` Counterparty evidence: ${c.disposition.counterpartyEvidenceRef}.` : ''}
                    {c.disposition.houseCalcAmount ? ` House calculation: ${m2(c.disposition.houseCalcAmount)} (${c.disposition.houseCalcNote ?? ''}).` : ''}
                    {c.disposition.expectationId ? ' A cash expectation was raised for the funding.' : ''}
                    {c.disposition.journalId ? ' A cash journal is linked to it.' : ''}
                  </Alert>
                )}
                {open && c.current && !pending && c.current.state === 'DEFICIT' && <Alert kind="warn">Still in deficit: post collateral or repay about {m2(c.current.callAmount)} to restore the initial ratio, then resolve.</Alert>}
                {pending && (
                  <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                    {canApprove && !proposer && <button className="ops-btn primary" type="button" onClick={() => setSub('approveDisp')}>Approve disposition</button>}
                    {(canApprove || proposer) && <button className="ops-btn" type="button" onClick={() => setSub('returnDisp')}>Return disposition</button>}
                    {canApprove && proposer && <span className="ops-muted">You proposed this, so a different approver must approve it.</span>}
                  </div>
                )}
                {open && !pending && canManage && (
                  <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                    {['ISSUED', 'ACKNOWLEDGED'].includes(c.status) && <button className="ops-btn" type="button" onClick={() => setSub('fund')}>Record funding</button>}
                    {c.status === 'DISPUTED' && <button className="ops-btn" type="button" onClick={() => setSub('disputeResolve')}>Resolve dispute</button>}
                    {['ISSUED', 'DISPUTED'].includes(c.status) && <ActionButton primary label="Acknowledge" onRun={(k) => api.post(F(`/calls/${c.id}/acknowledge`), {}, { idempotencyKey: k })} onDone={done} />}
                    {['ISSUED', 'ACKNOWLEDGED'].includes(c.status) && <button className="ops-btn" type="button" onClick={() => setSub('dispute')}>Dispute</button>}
                    <button className="ops-btn primary" type="button" onClick={() => setSub('resolve')}>Mark as met</button>
                    {canApprove && !issuer && <button className="ops-btn" type="button" onClick={() => setSub('waive')}>Waive</button>}
                    {issuer && <button className="ops-btn" type="button" onClick={() => setSub('cancel')}>Cancel (raised in error)</button>}
                  </div>
                )}
                {open && !pending && !canManage && (
                  <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                    <button className="ops-btn primary" type="button" disabled title={NEEDS_MANAGE}>Acknowledge</button>
                    <button className="ops-btn" type="button" disabled title={NEEDS_MANAGE}>Dispute</button>
                    <button className="ops-btn primary" type="button" disabled title={NEEDS_MANAGE}>Mark as met</button>
                    <button className="ops-btn" type="button" disabled title="Needs the financing.approve permission">Waive</button>
                    <span className="ops-muted">{NEEDS_MANAGE} to act on a margin call.</span>
                  </div>
                )}
                {sub === 'fund' && <FundCallModal call={c} onClose={() => setSub(null)} onDone={done} />}
                {sub === 'disputeResolve' && (
                  <FormModal
                    title="Resolve dispute"
                    subtitle="Records the counterparty evidence and the house calculation, then goes to an independent checker."
                    submitLabel="Send to checker"
                    onClose={() => setSub(null)}
                    onSubmit={(fd, k) =>
                      api.post(
                        F(`/calls/${c.id}/disposition`),
                        { kind: 'DISPUTE_RESOLVED', outcome: str(fd, 'outcome'), reason: str(fd, 'reason'), counterpartyEvidenceRef: str(fd, 'counterpartyEvidenceRef'), houseCalcAmount: str(fd, 'houseCalcAmount').replace(/,/g, ''), houseCalcNote: str(fd, 'houseCalcNote') },
                        { idempotencyKey: k },
                      )
                    }
                    onDone={done}
                  >
                    <FieldGrid>
                      <Field label="Outcome">
                        <select className="ops-input" name="outcome" required defaultValue="">
                          <option value="">Choose</option>
                          <option value="CALL_STANDS">The call stands</option>
                          <option value="CALL_WITHDRAWN">The call is withdrawn</option>
                        </select>
                      </Field>
                      <Field label="House-calculated amount"><input className="ops-input" name="houseCalcAmount" inputMode="decimal" required /></Field>
                      <Field label="Counterparty evidence" hint="Statement, email or valuation reference from the lender" span={2}><input className="ops-input" name="counterpartyEvidenceRef" required minLength={3} maxLength={255} /></Field>
                      <Field label="House calculation" hint="How the house number was reached" span={2}><textarea className="ops-input" name="houseCalcNote" rows={2} required minLength={5} maxLength={1000} /></Field>
                      <Field label="Reason" span={2}><textarea className="ops-input" name="reason" rows={2} required minLength={10} maxLength={500} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {sub === 'approveDisp' && (
                  <FormModal title="Approve disposition" subtitle="You are the independent checker. Funding links its cash expectation and journal; a dispute resolution applies its outcome." submitLabel="Approve" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(F(`/calls/${c.id}/disposition/approve`), { note: optStr(fd, 'note') }, { idempotencyKey: k })} onDone={done}>
                    <Field label="Note (optional)"><input className="ops-input" name="note" maxLength={500} /></Field>
                  </FormModal>
                )}
                {sub === 'returnDisp' && <ReasonModal title="Return disposition" submitLabel="Return" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/calls/${c.id}/disposition/return`), { reason })} onDone={done} />}
                {sub === 'dispute' && <ReasonModal title="Dispute call" submitLabel="Dispute" onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/calls/${c.id}/dispute`), { reason })} onDone={done} />}
                {sub === 'waive' && <ReasonModal title="Waive call" hint="Needs a person other than the issuer; recorded in the audit trail" submitLabel="Waive" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/calls/${c.id}/waive`), { reason })} onDone={done} />}
                {sub === 'cancel' && <ReasonModal title="Cancel call" submitLabel="Cancel call" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/calls/${c.id}/cancel`), { reason })} onDone={done} />}
                {sub === 'resolve' && (
                  <FormModal title="Mark the call as met" subtitle="Coverage must be back at the initial ratio on the live valuation." submitLabel="Mark as met" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(F(`/calls/${c.id}/resolve`), { note: str(fd, 'note') }, { idempotencyKey: k })} onDone={done}>
                    <Field label="How it was met"><textarea className="ops-input" name="note" rows={3} minLength={5} maxLength={500} required /></Field>
                  </FormModal>
                )}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}

/** Funding of a margin call: raises a cash expectation on the chosen bank ledger and goes to an independent checker. */
function FundCallModal({ call, onClose, onDone }: { call: Call; onClose: () => void; onDone: () => void }) {
  const ledgers = useResource<BankLedger[]>(
    () => apiRequest<{ data: BankLedger[] }>('GET', v1(`/cash/ledgers${qs({ portfolioId: call.portfolioId ?? '', kind: 'BANK', status: 'ACTIVE' })}`)).then((r) => r.data),
    [call.portfolioId],
  );
  const options = (ledgers.state === 'ok' ? ledgers.data : []).filter((l) => !call.currency || l.currency === call.currency);
  return (
    <FormModal
      title="Record funding"
      subtitle={`Raises a cash expectation (cash out, margin call) on the bank ledger and sends the funding to an independent checker. Called ${call.currency ?? ''} ${m2(call.calledAmount)}.`}
      submitLabel="Send to checker"
      onClose={onClose}
      onSubmit={(fd, k) => api.post(F(`/calls/${call.id}/disposition`), { kind: 'FUNDED', reason: str(fd, 'reason'), fundingLedgerId: str(fd, 'fundingLedgerId'), fundingAmount: str(fd, 'fundingAmount').replace(/,/g, ''), counterpartyEvidenceRef: optStr(fd, 'counterpartyEvidenceRef') }, { idempotencyKey: k })}
      onDone={onDone}
    >
      <FieldGrid>
        <Field label="Bank ledger" span={2}>
          {options.length > 0 ? (
            <select className="ops-input" name="fundingLedgerId" required defaultValue="">
              <option value="">Choose</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>{l.ref} {l.name} ({l.currency})</option>
              ))}
            </select>
          ) : (
            <input className="ops-input" name="fundingLedgerId" required placeholder="Ledger reference, e.g. CLG-1001" maxLength={36} />
          )}
        </Field>
        <Field label="Amount funded"><input className="ops-input" name="fundingAmount" inputMode="decimal" required defaultValue={call.calledAmount} /></Field>
        <Field label="Lender confirmation (optional)"><input className="ops-input" name="counterpartyEvidenceRef" maxLength={255} /></Field>
        <Field label="Reason" span={2}><textarea className="ops-input" name="reason" rows={2} required minLength={10} maxLength={500} /></Field>
      </FieldGrid>
    </FormModal>
  );
}

// ================================================================ pools

function PoolsTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const canManage = useCan('financing.manage');
  const portfolios = usePortfolios();
  const [creating, setCreating] = useState(false);
  const res = useResource<Pool[]>(() => api.get<Pool[]>(F('/pools')), []);
  return (
    <Card title="Collateral pools" actions={<button className="ops-btn primary" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setCreating(true)}>New pool</button>}>
      <Loaded res={res} what="pools">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No pools yet.</Empty>
          ) : (
            <DataTable head={['Pool', 'Portfolio', 'Items', 'Market value', 'Counted', 'Facilities', 'Status']}>
              {rows.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => onOpen(p.id)}>
                  <td><strong>{p.ref}</strong><div className="ops-muted">{p.name}</div></td>
                  <td>{p.portfolioName}</td>
                  <td className="r">{p.items}</td>
                  <td className="r">{p.currency} {m2(p.valuation?.marketValue)}</td>
                  <td className="r">{m2(p.valuation?.counted)}</td>
                  <td>{p.facilities.map((f) => f.ref).join(', ') || '—'}</td>
                  <td><Tag value={p.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && (
        <FormModal title="New collateral pool" submitLabel="Create pool" onClose={() => setCreating(false)} onSubmit={(fd, k) => api.post(F('/pools'), { name: str(fd, 'name'), portfolioId: str(fd, 'portfolioId') }, { idempotencyKey: k })} onDone={() => { res.reload(); onChanged(); }}>
          <FieldGrid>
            <Field label="Name"><input className="ops-input" name="name" required minLength={2} /></Field>
            <Field label="Portfolio"><PortfolioSelect name="portfolioId" list={portfolios} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function PoolModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan('financing.manage');
  const securities = useSecurities();
  const res = useResource<Pool>(() => api.get<Pool>(F(`/pools/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'post' | { release: string }>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Collateral pool" kicker="Collateral & Financing" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this pool">
          {(p) => (
            <>
              <h3 style={{ marginTop: 0 }}>{p.ref} · {p.name} <Tag value={p.status} /></h3>
              <p className="ops-muted">{p.portfolioName} · valued in {p.currency} · backs {p.facilities.map((f) => f.ref).join(', ') || 'no facility yet'}</p>
              {p.valuation && <ValuationTable v={p.valuation} />}
              {canManage && p.status === 'ACTIVE' && (
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  <button className="ops-btn primary" type="button" onClick={() => setSub('post')}>Post collateral</button>
                  {p.valuation?.lines.map((l) => (
                    <button key={l.itemId} className="ops-btn small" type="button" onClick={() => setSub({ release: l.itemId })}>Release {l.ticker}</button>
                  ))}
                </div>
              )}
              {!canManage && p.status === 'ACTIVE' && (
                <div className="ops-actions" style={{ marginTop: 14 }}>
                  <button className="ops-btn primary" type="button" disabled title={NEEDS_MANAGE}>Post collateral</button>
                  <span className="ops-muted">{NEEDS_MANAGE}.</span>
                </div>
              )}
              {sub === 'post' && (
                <FormModal title="Post collateral" subtitle="Only an eligible security the portfolio holds and has not already pledged." submitLabel="Pledge" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(F(`/pools/${p.id}/collateral`), { securityId: str(fd, 'securityId'), quantity: str(fd, 'quantity').replace(/,/g, '') }, { idempotencyKey: k })} onDone={done}>
                  <FieldGrid>
                    <Field label="Security">
                      <select className="ops-input" name="securityId" required>
                        <option value="">Choose a security</option>
                        {securities.map((s) => <option key={s.id} value={s.id}>{s.ticker} · {s.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Quantity"><input className="ops-input" name="quantity" inputMode="decimal" required /></Field>
                  </FieldGrid>
                </FormModal>
              )}
              {sub && typeof sub === 'object' && <ReasonModal title="Release collateral" hint="Refused if a linked facility would fall below its initial ratio" submitLabel="Release" onClose={() => setSub(null)} onSubmit={(reason) => api.post(F(`/pools/${p.id}/collateral/${sub.release}/release`), { reason })} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ rules

function RulesTab({ onChanged }: { onChanged: () => void }) {
  const canManage = useCan('financing.manage');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const res = useResource<Rule[]>(() => api.get<Rule[]>(F('/rules')), []);
  return (
    <Card title="Eligibility and haircut schedule" actions={<button className="ops-btn primary" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setEditing('new')}>Set a rule</button>}>
      <p className="ops-muted">The most specific rule wins: asset class with market, then asset class alone. An asset with no rule is not eligible. Changes apply to every pool at once and need step-up confirmation.</p>
      <Loaded res={res} what="rules">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No rules: nothing is eligible as collateral.</Empty>
          ) : (
            <DataTable head={['Asset class', 'Market', 'Eligible', 'Haircut', 'Pool cap', 'Note', 'Updated by']}>
              {rows.map((r) => (
                <tr key={r.id} className={canManage ? 'clickable' : undefined} onClick={() => canManage && setEditing(r)}>
                  <td>{r.assetClass}</td>
                  <td>{r.market || 'Any'}</td>
                  <td><Tag value={r.eligible ? 'Pass' : 'Fail'} /></td>
                  <td className="r">{r.haircutPct}%</td>
                  <td className="r">{r.maxPoolPct ? `${r.maxPoolPct}%` : '—'}</td>
                  <td>{r.note}</td>
                  <td>{r.updatedByName}</td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {editing && (
        <FormModal title={editing === 'new' ? 'Set an eligibility rule' : `${editing.assetClass} ${editing.market || '(any market)'}`} submitLabel="Save rule" onClose={() => setEditing(null)} onSubmit={(fd) => api.put(F('/rules'), { assetClass: str(fd, 'assetClass'), market: str(fd, 'market'), eligible: str(fd, 'eligible') === 'yes', haircutPct: str(fd, 'haircut'), maxPoolPct: optStr(fd, 'cap'), note: optStr(fd, 'note') })} onDone={() => { res.reload(); onChanged(); }}>
          <FieldGrid>
            <Field label="Asset class"><input className="ops-input" name="assetClass" defaultValue={editing === 'new' ? '' : editing.assetClass} required readOnly={editing !== 'new'} /></Field>
            <Field label="Market"><select className="ops-input" name="market" defaultValue={editing === 'new' ? '' : editing.market} disabled={editing !== 'new'}><option value="">Any</option><option>ZSE</option><option>VFEX</option><option>OTC</option></select></Field>
            <Field label="Eligible"><select className="ops-input" name="eligible" defaultValue={editing === 'new' || editing.eligible ? 'yes' : 'no'}><option value="yes">Eligible</option><option value="no">Not eligible</option></select></Field>
            <Field label="Haircut %"><input className="ops-input" name="haircut" defaultValue={editing === 'new' ? '' : editing.haircutPct} inputMode="decimal" required /></Field>
            <Field label="Pool cap %" hint="Optional: most of the pool this group may be"><input className="ops-input" name="cap" defaultValue={editing === 'new' ? '' : (editing.maxPoolPct ?? '')} inputMode="decimal" /></Field>
            <Field label="Note"><input className="ops-input" name="note" defaultValue={editing === 'new' ? '' : (editing.note ?? '')} maxLength={255} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}
