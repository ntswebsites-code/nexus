'use client';

import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { Badge } from '@/ops/admin-core';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FormModal, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

/**
 * Integrations (WP-8): every external adapter with its mode (fake or live), health, last call and error count; a test
 * call per adapter, failure simulation for fakes, the call log, the fake inbox, and the fake feeds that write into the
 * platform (market data, bank statements, custodian day-end packages). Permission admin.settings.
 */

interface AdapterRow {
  name: string;
  label: string;
  gap: string;
  description: string;
  flag: string;
  mode: 'fake' | 'live';
  requiredEnv: string[];
  missingEnv: string[];
  vendorCalls: Record<string, string>;
  health: { ok: boolean; detail: string };
  productionWarning: boolean;
  failure: { mode: string; remaining: number } | null;
  calls: number;
  errors24h: number;
  lastCall: { at: string; operation: string; status: string; durationMs: number } | null;
  lastError: { at: string; operation: string; message: string | null } | null;
}
interface CallRow {
  id: string;
  adapter: string;
  mode: string;
  operation: string;
  status: string;
  durationMs: number;
  error: string | null;
  correlationId: string | null;
  at: string;
}
interface CallDetail extends CallRow {
  requestHash: string;
  request: unknown;
  result: unknown;
}
interface InboxRow {
  id: string;
  adapter: string;
  kind: string;
  externalRef: string | null;
  status: string;
  payload: unknown;
  at: string;
  processedAt: string | null;
}
interface TestResult {
  name: string;
  mode: string;
  ok: boolean;
  durationMs: number;
  summary?: unknown;
  error?: string;
  code?: string;
}
interface Ledger {
  id: string;
  ref: string;
  name: string;
}
interface Counterparty {
  id: string;
  ref: string;
  name: string;
  accounts: string[];
}

const IC = (p: string) => v1(`/admin-core/integrations${p}`);
type Tab = 'adapters' | 'calls' | 'inbox';
type Feed = 'market-data' | 'bank-statement' | 'custodian-feed';

export default function IntegrationsPage() {
  const can = useCan('admin.settings');
  const [tab, setTab] = useState<Tab>('adapters');
  const [focus, setFocus] = useState('');
  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="Integrations" />
        <Alert>Your role does not include platform settings. Ask a System Administrator for the admin.settings permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Administration"
        title="Integrations"
        subtitle="External providers sit behind adapters. Fake adapters simulate the vendor and keep what they would have sent; live adapters need credentials. Every call is logged."
      />
      <TabBar
        tabs={[
          { key: 'adapters', label: 'Adapters' },
          { key: 'calls', label: 'Call log' },
          { key: 'inbox', label: 'Simulated inbox' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'adapters' && (
        <AdaptersTab
          onCalls={(n) => {
            setFocus(n);
            setTab('calls');
          }}
        />
      )}
      {tab === 'calls' && <CallsTab adapter={focus} onAdapter={setFocus} />}
      {tab === 'inbox' && <InboxTab adapter={focus} onAdapter={setFocus} />}
    </>
  );
}

const modeBadge = (a: AdapterRow) => <Badge tone={a.mode === 'live' ? 'green' : a.productionWarning ? 'red' : 'amber'}>{a.mode}</Badge>;

function AdaptersTab({ onCalls }: { onCalls: (adapter: string) => void }) {
  const res = useResource<AdapterRow[]>(() => api.get<AdapterRow[]>(IC('')), []);
  const [note, setNote] = useState('');
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [feed, setFeed] = useState<Feed | null>(null);
  const [detail, setDetail] = useState<AdapterRow | null>(null);
  return (
    <>
      <Alert kind="ok">{note}</Alert>
      <Loaded res={res} what="integrations">
        {(rows) => (
          <>
            {rows.some((r) => r.productionWarning) && (
              <Alert kind="warn">
                {rows.filter((r) => r.productionWarning).length} adapter(s) are still simulated in this production build: {rows.filter((r) => r.productionWarning).map((r) => r.label).join(', ')}. Fake adapters do not reach a real provider.
              </Alert>
            )}
            <Card
              title="Adapters"
              actions={
                <button className="ops-btn small" type="button" onClick={res.reload}>
                  Refresh
                </button>
              }
            >
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Adapter</th>
                      <th>Mode</th>
                      <th>Health</th>
                      <th>Last call</th>
                      <th className="r">Calls</th>
                      <th className="r">Errors 24h</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const t = tests[a.name];
                      return (
                        <tr key={a.name}>
                          <td>
                            <strong>{a.label}</strong> <span className="ops-muted">{a.gap}</span>
                            <div className="ops-muted">{a.description}</div>
                            {t && (
                              <div className={t.ok ? 'ops-muted' : 'ops-error-text'}>
                                Test {t.ok ? 'passed' : 'failed'} in {t.durationMs} ms{t.ok ? '' : `: ${t.error}`}
                              </div>
                            )}
                          </td>
                          <td>
                            {modeBadge(a)}
                            {a.failure && (
                              <div>
                                <Badge tone="red">failing{a.failure.remaining ? ` x${a.failure.remaining}` : ''}</Badge>
                              </div>
                            )}
                          </td>
                          <td>
                            <Badge tone={a.health.ok ? 'green' : 'red'}>{a.health.ok ? 'healthy' : 'unhealthy'}</Badge>
                            <div className="ops-muted">{a.health.detail}</div>
                          </td>
                          <td>
                            {a.lastCall ? (
                              <>
                                {formatDateTime(a.lastCall.at)}
                                <div className="ops-muted">
                                  {a.lastCall.operation} · {a.lastCall.status} · {a.lastCall.durationMs} ms
                                </div>
                              </>
                            ) : (
                              'Never'
                            )}
                            {a.lastError && <div className="ops-error-text">{a.lastError.message}</div>}
                          </td>
                          <td className="r">{a.calls}</td>
                          <td className="r">{a.errors24h}</td>
                          <td className="r" style={{ whiteSpace: 'nowrap' }}>
                            <ActionButton
                              label="Test call"
                              onRun={async () => {
                                const r = await api.post<TestResult>(IC(`/${a.name}/test`), {});
                                setTests((p) => ({ ...p, [a.name]: r }));
                              }}
                              onDone={res.reload}
                            />{' '}
                            <button className="ops-btn" type="button" onClick={() => setDetail(a)}>
                              Details
                            </button>{' '}
                            <button className="ops-btn" type="button" onClick={() => onCalls(a.name)}>
                              Calls
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Simulated feeds">
              <p className="ops-muted">
                Pull data through a fake adapter into the platform, as the vendor feed would. Prices and FX run through the same checks as the scheduled feed: a value that moves more than the tolerance against the last price is rejected and raised as an exception, every accepted value has a run record and provenance, and a run can be reversed (Securities page, Recent refreshes, Undo run). A manual price always wins; bank statements are staged for a different person to commit; day-end packages arrive as Received.
              </p>
              <div className="ops-actions">
                <button className="ops-btn" type="button" onClick={() => setFeed('market-data')}>
                  Market data: prices and FX
                </button>
                <button className="ops-btn" type="button" onClick={() => setFeed('bank-statement')}>
                  Bank statement (CAMT.053)
                </button>
                <button className="ops-btn" type="button" onClick={() => setFeed('custodian-feed')}>
                  Custodian day-end package
                </button>
              </div>
            </Card>
            {feed && <FeedModal feed={feed} onClose={() => setFeed(null)} onDone={(m) => { setNote(m); res.reload(); }} />}
            {detail && <DetailModal a={detail} onClose={() => setDetail(null)} onChanged={(m) => { setNote(m); res.reload(); }} />}
          </>
        )}
      </Loaded>
    </>
  );
}

function DetailModal({ a, onClose, onChanged }: { a: AdapterRow; onClose: () => void; onChanged: (note: string) => void }) {
  const [count, setCount] = useState('0');
  const setFailure = (mode: 'none' | 'error') => api.put(IC(`/${a.name}/failure`), { mode, count: Number(count) || 0 });
  return (
    <Modal title={a.label} kicker={`${a.gap} · ${a.flag}=${a.mode}`} subtitle={a.description} onClose={onClose} wide>
      <div className="ops-modal-body">
        <h4>Live mode needs</h4>
        <p>
          {a.requiredEnv.map((k) => (
            <code key={k} style={{ marginRight: 8, color: a.missingEnv.includes(k) ? 'var(--ops-red, #b42318)' : undefined }}>
              {k}
              {a.missingEnv.includes(k) ? ' (not set)' : ''}
            </code>
          ))}
        </p>
        <h4>Vendor calls the live class must make</h4>
        <ul>
          {Object.entries(a.vendorCalls).map(([op, text]) => (
            <li key={op}>
              <code>{op}</code>: {text}
            </li>
          ))}
        </ul>
        {a.mode === 'fake' ? (
          <>
            <h4>Failure simulation</h4>
            <p className="ops-muted">Make the next calls fail so callers and retries can be exercised. Enter 0 to fail every call until you press Clear, which restores normal service.</p>
            <Field label="Number of calls to fail">
              <input className="ops-input" type="number" min={0} max={1000} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            <div className="ops-actions">
              <ActionButton label="Start failing" danger onRun={() => setFailure('error')} onDone={() => { onChanged(`${a.label}: failure simulation on.`); onClose(); }} />
              <ActionButton label="Clear" onRun={() => setFailure('none')} onDone={() => { onChanged(`${a.label}: failure simulation cleared.`); onClose(); }} disabled={!a.failure} />
            </div>
          </>
        ) : (
          <p className="ops-muted">Switching between fake and live is an environment change ({a.flag}) followed by an API and worker restart.</p>
        )}
      </div>
    </Modal>
  );
}

const WORDS: Record<string, string> = { pricesCreated: 'prices created', pricesSkipped: 'prices skipped', fxCreated: 'FX rates created', accepted: 'accepted', unchanged: 'unchanged', rejected: 'rejected', errors: 'errors', skipped: 'skipped', overridden: 'overridden by manual', stale: 'stale' };
function describeResult(r: unknown): string {
  if (!r || typeof r !== 'object') return 'done';
  const parts = Object.entries(r as Record<string, unknown>).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => `${WORDS[k] ?? k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`);
  return parts.length ? parts.join(', ') : 'done';
}
function describeMarketRun(r: unknown): string {
  const x = (r ?? {}) as Record<string, number | string>;
  const rejected = Number(x.rejected ?? 0);
  return `Market data feed ${String(x.status ?? '').toLowerCase()}: ${x.accepted ?? 0} price/FX values accepted, ${x.unchanged ?? 0} unchanged, ${rejected} rejected by the sanity bounds${rejected ? ' (see Securities, Market data feed, Open exceptions)' : ''}. The run can be reversed with Undo run under Recent refreshes on the Securities page.`;
}

function FeedModal({ feed, onClose, onDone }: { feed: Feed; onClose: () => void; onDone: (note: string) => void }) {
  const ledgers = useResource<Ledger[]>(() => (feed === 'bank-statement' ? api.get<Ledger[]>(v1('/cash/ledgers?kind=BANK')) : Promise.resolve([])), [feed]);
  const cps = useResource<{ items: Counterparty[] }>(() => (feed === 'custodian-feed' ? api.get<{ items: Counterparty[] }>(v1('/ops/counterparties')) : Promise.resolve({ items: [] })), [feed]);
  const [cpId, setCpId] = useState('');
  const accounts = cps.state === 'ok' ? (cps.data.items.find((c) => c.id === cpId)?.accounts ?? []) : [];
  const title = feed === 'market-data' ? 'Simulate market data feed' : feed === 'bank-statement' ? 'Simulate bank statement' : 'Simulate custodian day-end package';
  return (
    <FormModal
      title={title}
      kicker="Integrations"
      submitLabel="Run feed"
      onClose={onClose}
      onDone={(r) => onDone(feed === 'market-data' ? describeMarketRun(r) : `${title}: ${describeResult(r)}`)}
      onSubmit={(fd, key) => {
        const date = optStr(fd, 'date');
        if (feed === 'market-data') return api.post(v1('/market-data/simulate'), { ...(date ? { date } : {}) }, { idempotencyKey: key });
        if (feed === 'bank-statement') {
          return api.post(IC('/bank-statement/simulate'), { ledgerId: str(fd, 'ledgerId'), ...(optStr(fd, 'from') ? { from: optStr(fd, 'from') } : {}), ...(date ? { to: date } : {}), openingBalance: optStr(fd, 'openingBalance') ?? '0.00' }, { idempotencyKey: key });
        }
        return api.post(IC('/custodian-feed/simulate'), { counterpartyId: str(fd, 'counterpartyId'), accountRef: str(fd, 'accountRef'), ...(date ? { date } : {}), currency: optStr(fd, 'currency') ?? 'USD' }, { idempotencyKey: key });
      }}
    >
      <Field label={feed === 'bank-statement' ? 'Statement end date (default today)' : 'Date (default today)'}>
        <input className="ops-input" name="date" type="date" />
      </Field>
      {feed === 'bank-statement' && (
        <>
          <Field label="Bank ledger">
            <Loaded res={ledgers} what="ledgers">
              {(rows) => (
                <select className="ops-input" name="ledgerId" required>
                  {rows.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.ref} {l.name}
                    </option>
                  ))}
                </select>
              )}
            </Loaded>
          </Field>
          <Field label="Statement start date (default same as end)">
            <input className="ops-input" name="from" type="date" />
          </Field>
          <Field label="Opening balance">
            <input className="ops-input" name="openingBalance" defaultValue="0.00" pattern="-?\d+(\.\d{1,2})?" />
          </Field>
        </>
      )}
      {feed === 'custodian-feed' && (
        <>
          <Field label="Custodian">
            <Loaded res={cps} what="counterparties">
              {(d) => (
                <select className="ops-input" name="counterpartyId" required value={cpId} onChange={(e) => setCpId(e.target.value)}>
                  <option value="">Select…</option>
                  {d.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.ref} {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Loaded>
          </Field>
          <Field label="Account reference">
            <input className="ops-input" name="accountRef" required list="int-accounts" />
            <datalist id="int-accounts">
              {accounts.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="Currency">
            <input className="ops-input" name="currency" defaultValue="USD" maxLength={3} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

function AdapterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const res = useResource<AdapterRow[]>(() => api.get<AdapterRow[]>(IC('')), []);
  return (
    <Field label="Adapter">
      <select className="ops-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All adapters</option>
        {res.state === 'ok' && res.data.map((a) => (
          <option key={a.name} value={a.name}>
            {a.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function CallsTab({ adapter, onAdapter }: { adapter: string; onAdapter: (v: string) => void }) {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const res = useResource<CallRow[]>(() => api.get<CallRow[]>(IC(`/calls?limit=100${adapter ? `&adapter=${encodeURIComponent(adapter)}` : ''}${status ? `&status=${status}` : ''}`)), [adapter, status]);
  const one = useResource<CallDetail | null>(() => (open ? api.get<CallDetail>(IC(`/calls/${open}`)) : Promise.resolve(null)), [open]);
  return (
    <Card title="Call log">
      <div className="ops-filters">
        <AdapterSelect value={adapter} onChange={onAdapter} />
        <Field label="Outcome">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="OK">OK</option>
            <option value="ERROR">Error</option>
          </select>
        </Field>
      </div>
      <Loaded res={res} what="calls">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No calls recorded.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Adapter</th>
                    <th>Operation</th>
                    <th>Mode</th>
                    <th>Outcome</th>
                    <th className="r">ms</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDateTime(c.at)}</td>
                      <td>{c.adapter}</td>
                      <td>{c.operation}</td>
                      <td>{c.mode}</td>
                      <td>
                        <Badge tone={c.status === 'OK' ? 'green' : 'red'}>{c.status}</Badge>
                        {c.error && <div className="ops-error-text">{c.error}</div>}
                      </td>
                      <td className="r">{c.durationMs}</td>
                      <td className="r">
                        <button className="ops-btn small" type="button" onClick={() => setOpen(c.id)}>
                          Detail
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
      {open && (
        <Modal title="Call detail" kicker="Integrations" onClose={() => setOpen(null)} wide>
          <div className="ops-modal-body">
            <Loaded res={one} what="call">
              {(c) =>
                c && (
                  <>
                    <p className="ops-muted">
                      {c.adapter}.{c.operation} · {c.mode} · {c.status} · correlation {c.correlationId ?? 'none'} · request hash {c.requestHash.slice(0, 16)}
                    </p>
                    <h4>Request (redacted)</h4>
                    <pre className="ops-pre">{JSON.stringify(c.request, null, 2)}</pre>
                    <h4>Result (redacted)</h4>
                    <pre className="ops-pre">{JSON.stringify(c.result, null, 2)}</pre>
                    {c.error && <Alert>{c.error}</Alert>}
                  </>
                )
              }
            </Loaded>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function InboxTab({ adapter, onAdapter }: { adapter: string; onAdapter: (v: string) => void }) {
  const res = useResource<InboxRow[]>(() => api.get<InboxRow[]>(IC(`/inbox?limit=50${adapter ? `&adapter=${encodeURIComponent(adapter)}` : ''}`)), [adapter]);
  return (
    <Card title="Simulated inbox">
      <p className="ops-muted">What fake adapters would have received or sent: emails, SMS codes, payment instructions, signature envelopes, filing receipts. Message bodies and codes are hidden in production.</p>
      <div className="ops-filters">
        <AdapterSelect value={adapter} onChange={onAdapter} />
      </div>
      <Loaded res={res} what="inbox">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>Nothing simulated yet.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Adapter</th>
                    <th>Kind</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th>Content</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.at)}</td>
                      <td>{r.adapter}</td>
                      <td>{r.kind}</td>
                      <td>{r.externalRef ?? ''}</td>
                      <td>
                        <Badge tone={r.status === 'FAILED' ? 'red' : r.status === 'PENDING' ? 'amber' : 'green'}>{r.status}</Badge>
                      </td>
                      <td>
                        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{JSON.stringify(r.payload).slice(0, 220)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
    </Card>
  );
}
