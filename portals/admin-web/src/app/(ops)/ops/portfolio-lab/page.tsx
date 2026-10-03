'use client';

import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { AccessDenied, DataTable, label, m2, PortfolioSelect, ReasonModal, Tag, Tile, usePortfolios, useSecurities } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useAction, useResource } from '@/ops/ui';

const L = (p: string) => v1(`/portfolio-lab${p}`);
const NEEDS_MANAGE = 'Needs the portfolio.manage permission';

interface Model {
  id: string;
  ref: string;
  name: string;
  description: string | null;
  cashTargetPct: string;
  status: string;
  holdings: number;
  totalPct: string;
  problems: string[];
  weights?: { securityId: string; ticker: string | null; name: string | null; sector: string | null; targetPct: string }[];
  createdBy: string;
  createdByName: string | null;
  version: number;
}
interface Constraint {
  key: string;
  label: string;
  limit: string;
  value: string;
  state: 'Pass' | 'Fail';
  detail: string;
}
interface LineChecks {
  result: string;
  preTrade: { key: string; label: string; result: string; detail: string }[];
  limits: { ref: string; metric: string; state: string; value: string; threshold: string; worsened: boolean; breachAction: string }[];
}
interface Line {
  securityId: string;
  ticker: string | null;
  name: string | null;
  side: string;
  quantity: string;
  price: string | null;
  currency: string;
  currentPct: string;
  targetPct: string;
  afterPct: string;
  notionalBase: string;
  checkResult: string;
  checks: LineChecks;
  orderRef?: string | null;
  exit?: boolean;
}
interface Preview {
  portfolioId: string;
  portfolioRef: string;
  portfolioName: string;
  modelId: string;
  modelRef: string;
  modelName: string;
  baseCurrency: string;
  totalValueBase: string;
  turnoverPct: string;
  cashAfterPct: string;
  cashAfterBase: string;
  warnings: string[];
  constraints: Constraint[];
  constraintsPassed: boolean;
  lines: Line[];
}
interface Rebalance {
  id: string;
  ref: string;
  status: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  modelRef: string | null;
  modelName: string | null;
  baseCurrency: string;
  totalValueBase: string;
  turnoverPct: string;
  cashAfterPct: string;
  driftThresholdPct: string;
  constraints: Constraint[];
  constraintsPassed: boolean;
  warnings: string[];
  stale: boolean;
  createdByName: string | null;
  createdAt: string;
  lines: Line[];
  lineCount?: number;
  failing?: number;
}

type Tab = 'models' | 'whatif' | 'proposals';

export default function PortfolioLabPage() {
  const canView = useCan('portfolio.view');
  const [tab, setTab] = useState<Tab>('models');
  const [open, setOpen] = useState<{ kind: 'model' | 'rebalance'; id: string } | null>(null);
  const [tick, setTick] = useState(0);
  if (!canView) return <AccessDenied kicker="Portfolio" title="Portfolio Construction" perm="portfolio.view" />;
  const bump = () => setTick((t) => t + 1);
  return (
    <>
      <PageHeader kicker="Portfolio" title="Portfolio Construction" subtitle="Model portfolios with target weights, and what-if rebalances against the live positions: sized in board lots, checked against the mandate and risk limits, and turned into draft orders only when you ask." />
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['models', 'whatif', 'proposals'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ops-btn${tab === t ? ' primary' : ''}`} type="button" onClick={() => setTab(t)}>
            {t === 'models' ? 'Model portfolios' : t === 'whatif' ? 'What-if rebalance' : 'Saved proposals'}
          </button>
        ))}
      </div>
      {tab === 'models' && <ModelsTab key={tick} onOpen={(id) => setOpen({ kind: 'model', id })} />}
      {tab === 'whatif' && <WhatIf onSaved={(id) => { bump(); setTab('proposals'); setOpen({ kind: 'rebalance', id }); }} />}
      {tab === 'proposals' && <ProposalsTab key={tick} onOpen={(id) => setOpen({ kind: 'rebalance', id })} />}
      {open?.kind === 'model' && <ModelModal id={open.id} onClose={() => setOpen(null)} onChanged={bump} />}
      {open?.kind === 'rebalance' && <RebalanceModal id={open.id} onClose={() => setOpen(null)} onChanged={bump} />}
    </>
  );
}

// ================================================================ models

function ModelsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const canManage = useCan('portfolio.manage');
  const [creating, setCreating] = useState(false);
  const res = useResource<Model[]>(() => api.get<Model[]>(L('/models')), []);
  return (
    <Card title="Model portfolios" actions={<button className="ops-btn primary" type="button" disabled={!canManage} title={canManage ? undefined : 'Needs the portfolio.manage permission'} onClick={() => setCreating(true)}>New model</button>}>
      <Loaded res={res} what="models">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No models yet.</Empty>
          ) : (
            <DataTable head={['Model', 'Holdings', 'Cash target', 'Total', 'Author', 'Status']}>
              {rows.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => onOpen(m.id)}>
                  <td><strong>{m.ref}</strong><div className="ops-muted">{m.name}</div></td>
                  <td className="r">{m.holdings}</td>
                  <td className="r">{m.cashTargetPct}%</td>
                  <td className="r">{m.totalPct}%{m.problems.length > 0 && <div><Tag value="Check" tone="amber" /> <span className="ops-muted" title={m.problems.join('. ')}>{m.problems[0]}</span></div>}</td>
                  <td>{m.createdByName}</td>
                  <td><Tag value={m.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && <ModelForm onClose={() => setCreating(false)} onDone={res.reload} />}
    </Card>
  );
}

function ModelForm({ model, onClose, onDone }: { model?: Model; onClose: () => void; onDone: () => void }) {
  const securities = useSecurities();
  const [rows, setRows] = useState<{ securityId: string; targetPct: string }[]>(model?.weights?.map((w) => ({ securityId: w.securityId, targetPct: w.targetPct })) ?? [{ securityId: '', targetPct: '' }]);
  const [cash, setCash] = useState(model?.cashTargetPct ?? '0');
  const sum = rows.reduce((s, r) => s + (Number(r.targetPct) || 0), 0) + (Number(cash) || 0);
  return (
    <FormModal
      title={model ? `Edit ${model.ref}` : 'New model portfolio'}
      subtitle="Weights plus the cash target must total 100% before a second person can activate the model."
      submitLabel={model ? 'Save draft' : 'Create draft'}
      wide
      onClose={onClose}
      onSubmit={(fd, key) => {
        const body = { name: str(fd, 'name'), description: optStr(fd, 'description'), cashTargetPct: cash || '0', weights: rows.filter((r) => r.securityId).map((r) => ({ securityId: r.securityId, targetPct: r.targetPct })), ...(model ? { version: model.version } : {}) };
        return model ? api.patch(L(`/models/${model.id}`), body) : api.post(L('/models'), body, { idempotencyKey: key });
      }}
      onDone={onDone}
    >
      <FieldGrid>
        <Field label="Name"><input className="ops-input" name="name" defaultValue={model?.name} required minLength={2} /></Field>
        <Field label="Cash target %"><input className="ops-input" value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Description" span={2}><input className="ops-input" name="description" defaultValue={model?.description ?? ''} maxLength={500} /></Field>
      </FieldGrid>
      <table className="ops-table" style={{ marginTop: 10 }}>
        <thead><tr><th>Security</th><th>Target %</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select className="ops-input" value={r.securityId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, securityId: e.target.value } : x)))}>
                  <option value="">Choose a security</option>
                  {securities.map((s) => <option key={s.id} value={s.id}>{s.ticker} · {s.name}</option>)}
                </select>
              </td>
              <td><input className="ops-input" value={r.targetPct} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, targetPct: e.target.value } : x)))} /></td>
              <td><button className="ops-btn small" type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td><button className="ops-btn small" type="button" onClick={() => setRows([...rows, { securityId: '', targetPct: '' }])}>Add holding</button></td><td className="r">{sum.toFixed(2)}% with cash</td><td /></tr></tfoot>
      </table>
    </FormModal>
  );
}

function ModelModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const canManage = useCan('portfolio.manage');
  const res = useResource<Model>(() => api.get<Model>(L(`/models/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'edit' | 'retire'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Model portfolio" kicker="Portfolio Construction" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this model">
          {(m) => (
            <>
              <h3 style={{ marginTop: 0 }}>{m.ref} · {m.name} <Tag value={m.status} /></h3>
              <p className="ops-muted">{m.description} · author {m.createdByName} · cash target {m.cashTargetPct}% · total {m.totalPct}%</p>
              {m.problems.length > 0 && <Alert kind="warn">{m.problems.join('. ')}</Alert>}
              <DataTable head={['Security', 'Sector', 'Target']}>
                {(m.weights ?? []).map((w) => (
                  <tr key={w.securityId}><td>{w.ticker} <span className="ops-muted">{w.name}</span></td><td>{w.sector}</td><td className="r">{w.targetPct}%</td></tr>
                ))}
              </DataTable>
              <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                {m.status === 'DRAFT' && <button className="ops-btn" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setSub('edit')}>Edit</button>}
                {m.status === 'DRAFT' && m.createdBy !== user.id && (canManage ? <ActionButton primary label="Activate" confirm="Activate this model? Rebalances can then target it." onRun={(k) => api.post(L(`/models/${m.id}/activate`), {}, { idempotencyKey: k })} onDone={done} /> : <button className="ops-btn primary" type="button" disabled title={NEEDS_MANAGE}>Activate</button>)}
                {m.status === 'DRAFT' && m.createdBy === user.id && <span className="ops-muted">A second person activates your model.</span>}
                {canManage ? <ActionButton label="Clone" onRun={(k) => api.post(L(`/models/${m.id}/clone`), {}, { idempotencyKey: k })} onDone={done} /> : <button className="ops-btn" type="button" disabled title={NEEDS_MANAGE}>Clone</button>}
                {m.status !== 'RETIRED' && <button className="ops-btn" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setSub('retire')}>Retire</button>}
                {!canManage && <span className="ops-muted">{NEEDS_MANAGE}.</span>}
              </div>
              {sub === 'edit' && <ModelForm model={m} onClose={() => setSub(null)} onDone={done} />}
              {sub === 'retire' && <ReasonModal title="Retire model" submitLabel="Retire" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(L(`/models/${m.id}/retire`), { reason })} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ what-if

function Constraints({ items }: { items: Constraint[] }) {
  return (
    <DataTable head={['Mandate check', 'Limit', 'After trades', 'Result', 'Detail']}>
      {items.map((c) => (
        <tr key={c.key}><td>{c.label}</td><td>{c.limit}</td><td>{c.value}</td><td><Tag value={c.state} /></td><td className="ops-muted">{c.detail}</td></tr>
      ))}
    </DataTable>
  );
}

function LinesTable({ lines }: { lines: Line[] }) {
  return (
    <DataTable head={['Security', 'Side', 'Quantity', 'Price', 'Now', 'Target', 'After', 'Value (base)', 'Checks', 'Order']}>
      {lines.map((l) => (
        <tr key={l.securityId + l.side}>
          <td>{l.ticker}{l.exit ? ' (exit)' : ''}</td>
          <td><Tag value={l.side} tone={l.side === 'BUY' ? 'green' : 'amber'} /></td>
          <td className="r">{l.quantity}</td>
          <td className="r">{l.currency} {l.price}</td>
          <td className="r">{l.currentPct}%</td>
          <td className="r">{l.targetPct}%</td>
          <td className="r">{l.afterPct}%</td>
          <td className="r">{m2(l.notionalBase)}</td>
          <td>
            <Tag value={l.checkResult} />
            {[...l.checks.preTrade.map((c) => `${c.label}: ${c.detail}`), ...l.checks.limits.map((x) => `${x.ref} ${x.metric} ${x.state} (${x.value} vs ${x.threshold})`)].map((t) => (
              <div key={t} className="ops-muted" style={{ fontSize: 11 }}>{t}</div>
            ))}
          </td>
          <td>{l.orderRef ?? '—'}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function WhatIf({ onSaved }: { onSaved: (id: string) => void }) {
  const canManage = useCan('portfolio.manage');
  const portfolios = usePortfolios();
  const models = useResource<Model[]>(() => api.get<Model[]>(L('/models?status=ACTIVE')), []);
  const [portfolioId, setPortfolioId] = useState('');
  const [modelId, setModelId] = useState('');
  const [drift, setDrift] = useState('0.5');
  const [keep, setKeep] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const run = useAction();
  const save = useAction();
  const body = { portfolioId, modelId, driftThresholdPct: drift || '0.5', keepUnmodelled: keep };
  const failing = preview ? preview.lines.filter((l) => l.checkResult === 'Fail').length : 0;
  const review = preview ? preview.lines.filter((l) => l.checkResult === 'Review').length : 0;
  return (
    <>
      <Card title="Rebalance a portfolio to a model">
        <div className="ops-filters">
          <Field label="Portfolio"><PortfolioSelect list={portfolios} value={portfolioId} onChange={(v) => { setPortfolioId(v); setPreview(null); }} /></Field>
          <Field label="Active model">
            <select className="ops-input" value={modelId} onChange={(e) => { setModelId(e.target.value); setPreview(null); }}>
              <option value="">Choose a model</option>
              {models.state === 'ok' && models.data.map((m) => <option key={m.id} value={m.id}>{m.ref} · {m.name}</option>)}
            </select>
          </Field>
          <Field label="Skip drift below (pp)"><input className="ops-input" value={drift} onChange={(e) => setDrift(e.target.value)} inputMode="decimal" /></Field>
          <Field label="Keep unmodelled holdings"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /></Field>
          <div style={{ alignSelf: 'end' }}>
            <button className="ops-btn primary" type="button" disabled={!portfolioId || !modelId || run.busy} onClick={async () => { const r = await run.run(() => api.post<Preview>(L('/whatif'), body)); if (r) setPreview(r); }}>
              {run.busy ? 'Calculating…' : 'Run what-if'}
            </button>
          </div>
        </div>
        <Alert>{run.error}</Alert>
        <p className="ops-muted">A what-if reads the live positions, cash and prices and saves nothing.</p>
      </Card>
      {preview && (
        <>
          <div className="ops-tiles">
            <Tile label="Portfolio value" value={`${preview.baseCurrency} ${m2(preview.totalValueBase)}`} hint={`${preview.portfolioName} → ${preview.modelName}`} />
            <Tile label="Turnover" value={`${preview.turnoverPct}%`} hint={`${preview.lines.length} trade(s)`} />
            <Tile label="Cash after" value={`${preview.cashAfterPct}%`} hint={`${preview.baseCurrency} ${m2(preview.cashAfterBase)}`} />
            <Tile label="Mandate (whole book)" value={preview.constraintsPassed ? 'Within' : 'Breached'} hint={preview.constraintsPassed ? 'Whole-book checks pass after the trades' : 'Fix the model or threshold before ordering'} />
            <Tile label="Trade checks" value={failing === 0 && review === 0 ? 'All pass' : `${failing} fail · ${review} review`} hint={`${preview.lines.length} proposed trade(s), checked one by one`} />
          </div>
          {failing > 0 && <Alert kind="warn">{`${failing} of ${preview.lines.length} proposed trades fail their own pre-trade or risk checks. The whole-book mandate result above does not cover liquidity, cash or limit checks on individual trades; those trades cannot be turned into orders.`}</Alert>}
          {preview.warnings.map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
          <Card title="Proposed trades">{preview.lines.length ? <LinesTable lines={preview.lines} /> : <Empty>The portfolio is already within the drift threshold of the model.</Empty>}</Card>
          <Card title="Whole-book mandate checks after the trades"><Constraints items={preview.constraints} /></Card>
          {preview.lines.length > 0 && (
            <div className="ops-actions">
              <button className="ops-btn primary" type="button" disabled={!canManage || save.busy} title={canManage ? undefined : NEEDS_MANAGE} onClick={async () => { const r = await save.run((k) => api.post<Rebalance>(L('/rebalances'), body, { idempotencyKey: k })); if (r) onSaved(r.id); }}>
                {save.busy ? 'Saving…' : 'Save as proposal'}
              </button>
              <Alert>{save.error}</Alert>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ================================================================ proposals

function ProposalsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [status, setStatus] = useState('');
  const res = useResource<Rebalance[]>(() => api.get<Rebalance[]>(L(`/rebalances${qs({ status })}`)), [status]);
  return (
    <Card title="Saved proposals">
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['PROPOSED', 'ORDERS_CREATED', 'DISCARDED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="proposals">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No proposals saved. Run a what-if and save it.</Empty>
          ) : (
            <DataTable head={['Proposal', 'Portfolio', 'Model', 'Trades', 'Turnover', 'Mandate', 'Created', 'Status']}>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => onOpen(r.id)}>
                  <td><strong>{r.ref}</strong></td>
                  <td>{r.portfolioName}</td>
                  <td>{r.modelRef}</td>
                  <td className="r">{r.lineCount}{r.failing ? ` (${r.failing} failing)` : ''}</td>
                  <td className="r">{r.turnoverPct}%</td>
                  <td><Tag value={r.constraintsPassed ? 'Pass' : 'Fail'} /></td>
                  <td>{formatDateTime(r.createdAt)}{r.stale && r.status === 'PROPOSED' ? ' · stale' : ''}</td>
                  <td><Tag value={r.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
    </Card>
  );
}

function RebalanceModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const canManage = useCan('portfolio.manage');
  const canOrder = useCan('orders.create');
  const res = useResource<Rebalance>(() => api.get<Rebalance>(L(`/rebalances/${encodeURIComponent(id)}`)), [id]);
  const [discard, setDiscard] = useState(false);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Rebalance proposal" kicker="Portfolio Construction" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this proposal">
          {(r) => (
            <>
              <h3 style={{ marginTop: 0 }}>{r.ref} · {r.portfolioName} → {r.modelName} <Tag value={r.status} /></h3>
              <p className="ops-muted">Value {r.baseCurrency} {m2(r.totalValueBase)} · turnover {r.turnoverPct}% · cash after {r.cashAfterPct}% · drift threshold {r.driftThresholdPct}pp · saved by {r.createdByName} {formatDateTime(r.createdAt)}</p>
              {r.stale && r.status === 'PROPOSED' && <Alert kind="warn">This proposal is more than a day old; prices have moved. Run a new one before ordering.</Alert>}
              {r.warnings.map((w) => <Alert key={w} kind="warn">{w}</Alert>)}
              <LinesTable lines={r.lines} />
              <h4>Mandate checks after the trades</h4>
              <Constraints items={r.constraints} />
              {r.status === 'PROPOSED' && (
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  {canManage && canOrder && (
                    <ActionButton primary label="Create draft orders" disabled={r.stale || !r.constraintsPassed} title={!r.constraintsPassed ? 'The mandate is breached after these trades' : r.stale ? 'The proposal is stale; run a new what-if' : undefined} confirm="Create DRAFT orders for the trades that did not fail their checks? They still need approval in Orders." onRun={(k) => api.post(L(`/rebalances/${r.id}/orders`), {}, { idempotencyKey: k })} onDone={done} />
                  )}
                  {(!canManage || !canOrder) && <button className="ops-btn primary" type="button" disabled title={!canManage ? NEEDS_MANAGE : 'Needs the orders.create permission'}>Create draft orders</button>}
                  <button className="ops-btn" type="button" disabled={!canManage} title={canManage ? undefined : NEEDS_MANAGE} onClick={() => setDiscard(true)}>Discard</button>
                  {canManage && !canOrder && <span className="ops-muted">Creating orders needs the orders.create permission.</span>}
                </div>
              )}
              {r.status === 'ORDERS_CREATED' && <p>Draft orders are in Orders: {r.lines.map((l) => l.orderRef).filter(Boolean).join(', ') || '—'}.</p>}
              {discard && <ReasonModal title="Discard proposal" submitLabel="Discard" danger onClose={() => setDiscard(false)} onSubmit={(reason) => api.post(L(`/rebalances/${r.id}/discard`), { reason })} onDone={done} />}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}
