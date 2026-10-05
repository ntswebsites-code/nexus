'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, qs, v1 } from './api';
import { formatDecimal } from './money';
import { useCan } from './session';
import { ActionButton, Alert, Card, DateText, Empty, Field, FieldGrid, FormModal, Loaded, Modal, formatDateTime, optStr, str, useAction, useResource } from './ui';
import { TabBar } from './recon/common';

// ------------------------------------------------------------------ types (mirror /api/v1/trading-feeds)

interface Overview {
  brokerRouting: { mode: string; note: string };
  marketData: { mode: string };
  openBreaks: number;
  breaksByReason: Record<string, number>;
  linesLast24h: Record<string, number>;
  lastFile: { filename: string; at: string; matched: number; breaks: number } | null;
  instructions: Record<string, number>;
  caFeed: { at: string; status: string; drafted: number; duplicates: number; rejected: number; error: string | null } | null;
  caDraftsAwaitingConfirmation: number;
  rules: { priceDeviationPct: number; settlementDays: Record<string, number> };
}
interface FeedFile {
  id: string;
  broker: string;
  adapter: string;
  filename: string;
  format: string;
  status: string;
  total: number;
  matched: number;
  breaks: number;
  duplicates: number;
  error: string | null;
  createdAt: string;
}
interface FeedLine {
  id: string;
  ref: string;
  source: string;
  externalRef: string;
  orderRef: string | null;
  orderId: string | null;
  ticker: string;
  side: string;
  quantity: string;
  price: string;
  fees: string;
  tradeDate: string;
  status: string;
  breakReason: string | null;
  detail: string | null;
  resolution: string | null;
  createdAt: string;
}
interface Instruction {
  id: string;
  ref: string;
  orderId: string;
  orderRef: string;
  ticker: string;
  side: string;
  instructionType: string;
  quantity: string;
  avgPrice: string;
  gross: string;
  fees: string;
  net: string;
  currency: string;
  tradeDate: string;
  settleDate: string;
  accountRef: string | null;
  status: string;
  failReason: string | null;
}
interface CaFeed {
  provider: string;
  items: { id: string; source: string; ticker: string; type: string; exDate: string | null; status: string; reason: string | null; seenCount: number; lastSeenAt: string; event: { id: string; ref: string | null; status: string | null } | null }[];
  runs: { id: string; trigger: string; provider: string; status: string; fetched: number; drafted: number; duplicates: number; rejected: number; error: string | null; startedAt: string }[];
}
interface BrokerOption {
  id: string;
  name: string;
}
interface NoteResult {
  total: number;
  matched: number;
  breaks: number;
  duplicates: number;
  lines: { ref: string | null; tradeRef: string; outcome: string; reason?: string; detail?: string }[];
}
interface FixResult {
  received: number;
  matched: number;
  breaks: number;
  duplicates: number;
  ignored: number;
  rejected: { index: number; message: string }[];
}

const tf = (p: string) => v1(`/trading-feeds${p}`);
const TABS = [
  { key: 'breaks', label: 'Breaks and lines' },
  { key: 'notes', label: 'Contract notes' },
  { key: 'fix', label: 'FIX fills' },
  { key: 'settle', label: 'Settlement instructions' },
  { key: 'ca', label: 'Corporate-action feed' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const TONE: Record<string, string> = { MATCHED: 'green', RESOLVED: 'green', CONFIRMED: 'green', IMPORTED: 'green', OK: 'green', DRAFTED: 'green', RELEASED: 'blue', BREAK: 'red', FAILED: 'red', ERROR: 'red', REJECTED: 'amber', GENERATED: 'amber', DUPLICATE: 'grey', CANCELLED: 'grey', UNSUPPORTED: 'grey' };
const Pill = ({ s }: { s: string }) => <span className={`ops-badge ${TONE[s.toUpperCase()] ?? 'grey'}`}>{s.replace(/_/g, ' ').toLowerCase()}</span>;
const readFile = (f: File) => f.text();

// ------------------------------------------------------------------ page

export function TradingFeedsPage() {
  const [tab, setTab] = useState<Tab>('breaks');
  const overview = useResource<Overview>(() => api.get<Overview>(tf('/overview')), []);
  return (
    <>
      <Loaded res={overview} what="trading feeds status">
        {(o) => (
          <Card title="Feed status">
            <p className="ops-sub" style={{ marginTop: 0 }}>
              Broker routing <strong>{o.brokerRouting.mode}</strong>. {o.brokerRouting.note} Market data <strong>{o.marketData.mode}</strong>. Market-order fills more than {o.rules.priceDeviationPct}% from the decision price are held as breaks. Settlement: ZSE T+{o.rules.settlementDays.ZSE}, VFEX T+{o.rules.settlementDays.VFEX}, OTC T+{o.rules.settlementDays.OTC} (weekends only; no holiday calendar).
            </p>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div>
                <div className="ops-kicker">Open breaks</div>
                <strong style={{ fontSize: 22 }}>{o.openBreaks}</strong>
                <span className="ops-sub">{Object.entries(o.breaksByReason).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(', ') || 'none'}</span>
              </div>
              <div>
                <div className="ops-kicker">Instructions</div>
                <strong style={{ fontSize: 22 }}>{(o.instructions.GENERATED ?? 0) + (o.instructions.RELEASED ?? 0)}</strong>
                <span className="ops-sub">awaiting release or confirmation</span>
              </div>
              <div>
                <div className="ops-kicker">Corporate-action drafts</div>
                <strong style={{ fontSize: 22 }}>{o.caDraftsAwaitingConfirmation}</strong>
                <span className="ops-sub">
                  <Link href="/ops-native/corporate-actions">awaiting confirmation</Link>
                </span>
              </div>
              <div>
                <div className="ops-kicker">Last contract note</div>
                <strong>{o.lastFile ? o.lastFile.filename : 'none yet'}</strong>
                {o.lastFile && <span className="ops-sub">{formatDateTime(o.lastFile.at)}: {o.lastFile.matched} matched, {o.lastFile.breaks} breaks</span>}
              </div>
            </div>
          </Card>
        )}
      </Loaded>
      <TabBar tabs={[...TABS]} value={tab} onChange={setTab} />
      {tab === 'breaks' && <LinesTab onChanged={() => overview.reload()} />}
      {tab === 'notes' && <NotesTab onChanged={() => overview.reload()} />}
      {tab === 'fix' && <FixTab onChanged={() => overview.reload()} />}
      {tab === 'settle' && <SettleTab onChanged={() => overview.reload()} />}
      {tab === 'ca' && <CaTab onChanged={() => overview.reload()} />}
    </>
  );
}

// ------------------------------------------------------------------ breaks and lines

function LinesTab({ onChanged }: { onChanged: () => void }) {
  const canManage = useCan('orders.route');
  const [status, setStatus] = useState('BREAK');
  const [q, setQ] = useState('');
  const [resolving, setResolving] = useState<FeedLine | null>(null);
  const lines = useResource<FeedLine[]>(() => api.get<FeedLine[]>(tf(`/lines${qs({ status, q, limit: '100' })}`)), [status, q]);
  return (
    <Card
      title="Inbound trade lines"
      actions={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ maxWidth: 150 }}>
            <option value="BREAK">Open breaks</option>
            <option value="MATCHED">Matched</option>
            <option value="RESOLVED">Resolved</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </select>
          <input className="ops-input" placeholder="Search ref, ticker, order" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />
        </span>
      }
    >
      <Loaded res={lines} what="trade lines">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>{status === 'BREAK' ? 'No open breaks.' : 'No lines.'}</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Source</th>
                    <th>Order</th>
                    <th>Trade</th>
                    <th className="r">Qty</th>
                    <th className="r">Price</th>
                    <th>Status</th>
                    <th>Detail</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{l.ref}</strong>
                        <span className="ops-sub">{l.externalRef}</span>
                      </td>
                      <td>{l.source === 'FIX' ? 'FIX' : 'Contract note'}</td>
                      <td>{l.orderId ? <Link href={`/ops-native/orders/${l.orderId}`}>{l.orderRef}</Link> : (l.orderRef ?? '—')}</td>
                      <td>
                        {l.side} {l.ticker}
                        <span className="ops-sub"><DateText value={l.tradeDate} /></span>
                      </td>
                      <td className="r">{formatDecimal(l.quantity, 0)}</td>
                      <td className="r">{formatDecimal(l.price, 4)}</td>
                      <td>
                        <Pill s={l.status} />
                        {l.breakReason && <span className="ops-sub">{l.breakReason.replace(/_/g, ' ').toLowerCase()}</span>}
                      </td>
                      <td>
                        {l.detail && <span className="ops-sub">{l.detail}</span>}
                        {l.resolution && <span className="ops-sub">Resolution: {l.resolution}</span>}
                      </td>
                      <td>
                        {canManage && l.status === 'BREAK' && (
                          <button className="ops-btn small" type="button" onClick={() => setResolving(l)}>
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {resolving && (
        <FormModal
          kicker={resolving.ref}
          title="Resolve break"
          subtitle={`${resolving.side} ${formatDecimal(resolving.quantity, 0)} ${resolving.ticker} at ${formatDecimal(resolving.price, 4)}: ${resolving.detail ?? ''} Accepting changes positions and cash and needs a different person from the uploader.`}
          submitLabel="Apply"
          onClose={() => setResolving(null)}
          onSubmit={(fd, key) => {
            const action = str(fd, 'action');
            return api.post(tf(`/lines/${resolving.id}/resolve`), { action, orderId: action === 'MATCH' ? optStr(fd, 'orderId') : undefined, note: str(fd, 'note'), force: fd.get('force') === 'on' }, { idempotencyKey: key });
          }}
          onDone={() => {
            lines.reload();
            onChanged();
          }}
        >
          <FieldGrid>
            <Field label="Action">
              <select className="ops-input" name="action" defaultValue="MATCH">
                <option value="MATCH">Accept: apply the fill to the order</option>
                <option value="REJECT">Reject: not our trade</option>
              </select>
            </Field>
            <Field label="Order reference" hint="Leave empty to use the matched order. Needed when the order was not found.">
              <input className="ops-input" name="orderId" defaultValue={resolving.orderRef ?? ''} placeholder="ORD-001234" />
            </Field>
          </FieldGrid>
          <Field label="Reason">
            <input className="ops-input" name="note" required minLength={5} maxLength={500} />
          </Field>
          <label style={{ display: 'block', marginTop: 8 }}>
            <input type="checkbox" name="force" /> Accept a price far from the decision price (does not override over-fills, limit breaches or ticker and side mismatches)
          </label>
        </FormModal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ contract notes

function NotesTab({ onChanged }: { onChanged: () => void }) {
  const canManage = useCan('orders.route');
  const brokers = useResource<BrokerOption[]>(() => api.get<BrokerOption[]>(v1('/brokers')), []);
  const files = useResource<FeedFile[]>(() => api.get<FeedFile[]>(tf('/files?limit=30')), []);
  const action = useAction();
  const [result, setResult] = useState<NoteResult | null>(null);
  const [tpl, setTpl] = useState<{ filename: string; content: string } | null>(null);

  async function upload(form: HTMLFormElement) {
    const fd = new FormData(form);
    const file = fd.get('file');
    const pasted = str(fd, 'content');
    const content = file instanceof File && file.size > 0 ? await readFile(file) : pasted;
    if (!content) throw new Error('Choose a file or paste the contract note.');
    const filename = file instanceof File && file.size > 0 ? file.name : 'pasted-contract-note.csv';
    setResult(await api.post<NoteResult>(tf('/contract-notes'), { brokerId: str(fd, 'brokerId'), filename, content }, { idempotencyKey: crypto.randomUUID() }));
    files.reload();
    onChanged();
  }
  return (
    <>
      {canManage && (
        <Card
          title="Upload a broker contract note"
          actions={
            <ActionButton
              label="Download template"
              onRun={async () => setTpl(await api.get<{ filename: string; content: string }>(tf('/contract-notes/template?format=csv')))}
            />
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void action.run(async () => {
                await upload(form);
              });
            }}
          >
            <FieldGrid>
              <Field label="Broker">
                <select className="ops-input" name="brokerId" required defaultValue="">
                  <option value="" disabled>
                    Choose a broker
                  </option>
                  {brokers.state === 'ok' && brokers.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="File (CSV or JSON)" hint="Lines are matched to routed orders by order reference; anything that does not fit becomes a break.">
                <input className="ops-input" type="file" name="file" accept=".csv,.json,text/csv,application/json,text/plain" />
              </Field>
            </FieldGrid>
            <Field label="Or paste the note">
              <textarea className="ops-input" name="content" rows={4} placeholder="trade_ref,order_ref,ticker,side,quantity,price,fees,trade_date" />
            </Field>
            <Alert>{action.error}</Alert>
            {result && (
              <Alert kind={result.breaks ? 'warn' : 'ok'}>
                {result.total} line(s): {result.matched} matched, {result.breaks} break(s), {result.duplicates} already seen.
                {result.lines.filter((l) => l.outcome === 'BREAK').slice(0, 5).map((l) => ` ${l.tradeRef}: ${l.detail}`).join(' ')}
              </Alert>
            )}
            <button className="ops-btn primary" type="submit" disabled={action.busy}>
              {action.busy ? 'Importing…' : 'Import'}
            </button>
          </form>
        </Card>
      )}
      <Card title="Recent files">
        <Loaded res={files} what="files">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No contract notes uploaded yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Broker</th>
                      <th>Status</th>
                      <th className="r">Lines</th>
                      <th className="r">Matched</th>
                      <th className="r">Breaks</th>
                      <th>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <strong>{f.filename}</strong>
                          <span className="ops-sub">{f.format} via {f.adapter}</span>
                        </td>
                        <td>{f.broker}</td>
                        <td>
                          <Pill s={f.status} />
                          {f.error && <span className="ops-error-text">{f.error}</span>}
                        </td>
                        <td className="r">{f.total}</td>
                        <td className="r">{f.matched}</td>
                        <td className="r">{f.breaks}</td>
                        <td>{formatDateTime(f.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {tpl && (
        <Modal title={tpl.filename} kicker="Template" onClose={() => setTpl(null)}>
          <div className="ops-modal-body">
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{tpl.content}</pre>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ FIX

function FixTab({ onChanged }: { onChanged: () => void }) {
  const canManage = useCan('orders.route');
  const [result, setResult] = useState<FixResult | null>(null);
  const [message, setMessage] = useState('');
  const show = (r: FixResult) => {
    setResult(r);
    onChanged();
  };
  return (
    <Card
      title="FIX execution reports"
      actions={canManage ? <ActionButton primary label="Poll broker session" onRun={async () => show(await api.post<FixResult>(tf('/fix/poll'), {}, { idempotencyKey: crypto.randomUUID() }))} /> : undefined}
    >
      <p className="ops-sub" style={{ marginTop: 0 }}>
        Fills arrive as FIX ExecutionReports (35=8) from the broker adapter. Each report is matched to its order by ClOrdID (our order reference) or the broker order id, applied once per ExecID, and anything that does not fit is held as a break. A fake broker generates a fill for every order sent to it in test mode; in production a gateway posts reports here.
      </p>
      {canManage && (
        <>
          <Field label="Paste ExecutionReports (one per line; | or SOH delimited)">
            <textarea className="ops-input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="8=FIX.4.4|35=8|37=BRK-1|11=ORD-001234|17=EXEC1|150=F|55=ECO.ZW|54=1|32=100|31=1.25|60=20261002-08:30:00|10=000|" />
          </Field>
          <ActionButton
            label="Ingest pasted reports"
            disabled={!message.trim()}
            onRun={async () => show(await api.post<FixResult>(tf('/fix/execution-reports'), { messages: message.split('\n').map((m) => m.trim()).filter(Boolean) }, { idempotencyKey: crypto.randomUUID() }))}
            onDone={() => setMessage('')}
          />
        </>
      )}
      {result && (
        <Alert kind={result.breaks || result.rejected.length ? 'warn' : 'ok'}>
          {result.received} received: {result.matched} matched, {result.breaks} break(s), {result.duplicates} duplicate(s), {result.ignored} not fills{result.rejected.length ? `, ${result.rejected.length} rejected (${result.rejected[0]!.message})` : ''}.
        </Alert>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ settlement

function SettleTab({ onChanged }: { onChanged: () => void }) {
  const canManage = useCan('orders.route');
  const canRelease = useCan('orders.approve');
  const [status, setStatus] = useState('GENERATED,RELEASED');
  const [reasoning, setReasoning] = useState<{ row: Instruction; kind: 'fail' | 'cancel' } | null>(null);
  const [file, setFile] = useState<{ filename: string; content: string } | null>(null);
  const rows = useResource<Instruction[]>(() => api.get<Instruction[]>(tf(`/settlement-instructions${qs({ status, limit: '100' })}`)), [status]);
  const done = () => {
    rows.reload();
    onChanged();
  };
  const post = (id: string, what: string, body: unknown = {}) => api.post(tf(`/settlement-instructions/${id}/${what}`), body, { idempotencyKey: crypto.randomUUID() });
  return (
    <Card
      title="Settlement instructions"
      actions={
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ maxWidth: 190 }}>
            <option value="GENERATED,RELEASED">Open</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="FAILED,CANCELLED">Failed or cancelled</option>
            <option value="">All</option>
          </select>
          {canManage && <ActionButton label="Generate for filled orders" onRun={() => api.post(tf('/settlement-instructions/generate-missing'), {}, { idempotencyKey: crypto.randomUUID() })} onDone={done} />}
        </span>
      }
    >
      <p className="ops-sub" style={{ marginTop: 0 }}>
        Created for every filled order (automatically when a feed completes one). A second person releases an instruction; the system-generated ones can be released by any approver. Download the file for the custodian or broker, then confirm once settlement is acknowledged. Posting the journals stays on the order (Settle).
      </p>
      <Loaded res={rows} what="settlement instructions">
        {(list) =>
          list.length === 0 ? (
            <Empty>No instructions here.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Order</th>
                    <th>Instruction</th>
                    <th className="r">Net</th>
                    <th>Settles</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.ref}</strong>
                        {r.accountRef && <span className="ops-sub">account {r.accountRef}</span>}
                      </td>
                      <td>
                        <Link href={`/ops-native/orders/${r.orderId}`}>{r.orderRef}</Link>
                      </td>
                      <td>
                        {r.instructionType} {r.side} {formatDecimal(r.quantity, 0)} {r.ticker}
                        <span className="ops-sub">at {formatDecimal(r.avgPrice, 4)}, gross {formatDecimal(r.gross)}, fees {formatDecimal(r.fees)}</span>
                      </td>
                      <td className="r">
                        {formatDecimal(r.net)} {r.currency}
                      </td>
                      <td>
                        <DateText value={r.settleDate} />
                      </td>
                      <td>
                        <Pill s={r.status} />
                        {r.failReason && <span className="ops-sub">{r.failReason}</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <ActionButton label="File" onRun={async () => setFile(await api.get<{ filename: string; content: string }>(tf(`/settlement-instructions/${r.id}/file?format=csv`)))} />
                        {canRelease && r.status === 'GENERATED' && <ActionButton primary label="Release" confirm={`Release ${r.ref} for ${r.orderRef}?`} onRun={() => post(r.id, 'release')} onDone={done} />}
                        {canManage && r.status === 'RELEASED' && <ActionButton primary label="Confirm settled" onRun={() => post(r.id, 'confirm')} onDone={done} />}
                        {canManage && r.status === 'RELEASED' && (
                          <button className="ops-btn small" type="button" onClick={() => setReasoning({ row: r, kind: 'fail' })}>
                            Failed
                          </button>
                        )}
                        {canManage && (r.status === 'GENERATED' || r.status === 'RELEASED') && (
                          <button className="ops-btn small" type="button" onClick={() => setReasoning({ row: r, kind: 'cancel' })}>
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {reasoning && (
        <FormModal
          kicker={reasoning.row.ref}
          title={reasoning.kind === 'fail' ? 'Mark settlement failed' : 'Cancel instruction'}
          submitLabel={reasoning.kind === 'fail' ? 'Mark failed' : 'Cancel instruction'}
          danger
          onClose={() => setReasoning(null)}
          onSubmit={(fd, key) => api.post(tf(`/settlement-instructions/${reasoning.row.id}/${reasoning.kind}`), { reason: str(fd, 'reason') }, { idempotencyKey: key })}
          onDone={done}
        >
          <Field label="Reason">
            <input className="ops-input" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </FormModal>
      )}
      {file && (
        <Modal title={file.filename} kicker="Instruction file" onClose={() => setFile(null)}>
          <div className="ops-modal-body">
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{file.content}</pre>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ corporate-action feed

function CaTab({ onChanged }: { onChanged: () => void }) {
  const canSync = useCan('corporate_actions.manage');
  const feed = useResource<CaFeed>(() => api.get<CaFeed>(tf('/ca-feed?limit=100')), []);
  return (
    <Card
      title="Corporate-action feed"
      actions={
        canSync ? (
          <ActionButton
            primary
            label="Sync now"
            onRun={() => api.post(tf('/ca-feed/sync'), {}, { idempotencyKey: crypto.randomUUID() })}
            onDone={() => {
              feed.reload();
              onChanged();
            }}
          />
        ) : undefined
      }
    >
      <Loaded res={feed} what="the corporate-action feed">
        {(f) => (
          <>
            <p className="ops-sub" style={{ marginTop: 0 }}>
              Announcements from the <strong>{f.provider}</strong> market-data provider become draft ANNOUNCED events (created by the system). A person confirms each one in <Link href="/ops-native/corporate-actions">Corporate actions</Link>, and a different person processes it. The same announcement seen again is counted, not re-created; one that matches an event already on file is marked duplicate.
              {f.provider === 'public' && ' The public provider has no corporate-action source: enter announcements by hand.'}
            </p>
            {f.runs[0] && (
              <Alert kind={f.runs[0].status === 'OK' ? 'ok' : 'warn'}>
                Last run {formatDateTime(f.runs[0].startedAt)} ({f.runs[0].trigger.toLowerCase()}): {f.runs[0].status.toLowerCase()}, {f.runs[0].fetched} announced, {f.runs[0].drafted} drafted, {f.runs[0].duplicates} duplicate, {f.runs[0].rejected} rejected.{f.runs[0].error ? ` ${f.runs[0].error}` : ''}
              </Alert>
            )}
            {f.items.length === 0 ? (
              <Empty>Nothing seen on the feed yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Security</th>
                      <th>Action</th>
                      <th>Ex-date</th>
                      <th>Status</th>
                      <th>Event</th>
                      <th className="r">Seen</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.ticker}</strong>
                          <span className="ops-sub">{i.source}</span>
                        </td>
                        <td>{i.type.replace(/_/g, ' ').toLowerCase()}</td>
                        <td>{i.exDate ? <DateText value={i.exDate} /> : '—'}</td>
                        <td>
                          <Pill s={i.status} />
                        </td>
                        <td>{i.event ? <Link href={`/ops-native/corporate-actions/${i.event.id}`}>{i.event.ref}</Link> : '—'}{i.event?.status && <span className="ops-sub">{i.event.status.toLowerCase()}</span>}</td>
                        <td className="r">{i.seenCount}</td>
                        <td>{i.reason && <span className="ops-sub">{i.reason}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}
