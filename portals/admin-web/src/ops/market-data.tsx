'use client';

import { useState, type ChangeEvent } from 'react';
import { api, v1 } from './api';
import { formatDecimal } from './money';
import { useCan } from './session';
import { ActionButton, Alert, Card, DateText, Empty, Field, FieldGrid, Loaded, Modal, StatusBadge, useAction, useResource } from './ui';
import { useCounterparties } from './recon/common';

// ------------------------------------------------------------------ market data (/ops/securities)

interface SourceRow {
  source: string;
  label: string;
  url: string;
  note: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string;
  lastError: string | null;
  lastCount: number;
  consecutiveFailures: number;
  backoffUntil: string | null;
  stale: boolean;
}
interface SecurityFresh {
  id: string;
  ticker: string;
  market: string;
  currency: string;
  price: string | null;
  priceDate: string | null;
  priceSource: string | null;
  ageBusinessDays: number | null;
  stale: boolean;
  publicSource: boolean;
  provenance: { source: string; url: string; fetchedAt: string; rawHash: string; status: string; reason: string | null } | null;
}
interface MdStatus {
  provider: string;
  scheduler: boolean;
  staleAfterBusinessDays: number;
  sources: SourceRow[];
  runs: { id: string; trigger: string; scope: string; status: string; startedAt: string; accepted: number; rejected: number; errors: number; skipped: number }[];
  securities: SecurityFresh[];
  fx: { pair: string; rate: string; rateDate: string; source: string; ageBusinessDays: number }[];
  exceptions: { id: string; refType: string; ticker: string; source: string; status: string; reason: string | null; url: string; fetchedAt: string; seenCount: number; rawValue: string | null }[];
}
interface RefreshResult {
  provider: string;
  scope: string;
  status: string;
  accepted: number;
  unchanged: number;
  rejected: number;
  errors: number;
  skipped: number;
  overridden: number;
  stale: number;
  message?: string;
}
interface ProvRow {
  id: string;
  source: string;
  url: string;
  fetchedAt: string;
  rawHash: string;
  rawValue: string | null;
  priceDate: string | null;
  value: string | null;
  previousValue: string | null;
  status: string;
  reason: string | null;
  seenCount: number;
}

const tone = (s: string) => (s === 'OK' || s === 'ACCEPTED' ? 'green' : s === 'NEVER' || s === 'OVERRIDDEN' ? 'grey' : s === 'BACKOFF' || s === 'PARTIAL' ? 'amber' : 'red');
const Pill = ({ s, label }: { s: string; label?: string }) => <span className={`ops-badge ${tone(s)}`}>{(label ?? s).replace(/_/g, ' ').toLowerCase()}</span>;
const short = (h: string) => `${h.slice(0, 10)}…`;

export function MarketDataSection({ onChanged }: { onChanged?: () => void }) {
  const canManage = useCan('portfolio.manage');
  const status = useResource<MdStatus>(() => api.get<MdStatus>(v1('/market-data/status')), []);
  const [scope, setScope] = useState('ALL');
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [staleOnly, setStaleOnly] = useState(false);
  const [prov, setProv] = useState<string | null>(null);
  const provRes = useResource<{ ticker: string; rows: ProvRow[] } | null>(() => (prov ? api.get<{ ticker: string; rows: ProvRow[] }>(v1(`/market-data/securities/${encodeURIComponent(prov)}/provenance`)) : Promise.resolve(null)), [prov]);

  return (
    <Card
      title="Market data feed"
      actions={
        canManage ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <select className="ops-input" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Refresh scope" style={{ maxWidth: 150 }}>
              <option value="ALL">Prices and FX</option>
              <option value="EOD">Prices only</option>
              <option value="FX">FX only</option>
            </select>
            <ActionButton
              primary
              label="Refresh now"
              onRun={async () => setResult(await api.post<RefreshResult>(v1('/market-data/refresh'), { scope, force: false }))}
              onDone={() => {
                status.reload();
                onChanged?.();
              }}
            />
          </span>
        ) : undefined
      }
    >
      <Loaded res={status} what="market data status">
        {(s) => {
          const rows = s.securities.filter((x) => !staleOnly || x.stale);
          return (
            <>
              <p className="ops-sub" style={{ marginTop: 0 }}>
                Provider <strong>{s.provider}</strong>
                {s.provider === 'fake' && ' (test data only: set INTEGRATION_MARKET_DATA=public in production)'}
                {s.provider === 'live' && ' (paid feed not configured yet)'}. Scheduler {s.scheduler ? 'on: intraday during exchange hours, end of day after 15:00 Harare, FX daily' : 'off'}. A manual price (Set price above) always wins over a feed price for the same date. Prices older than {s.staleAfterBusinessDays} business days are flagged stale.
              </p>
              {result && (
                <Alert kind={result.status === 'OK' ? 'ok' : result.status === 'PARTIAL' ? 'warn' : 'error'}>
                  Refresh {result.status.toLowerCase()}: {result.accepted} updated, {result.unchanged} unchanged, {result.rejected} rejected, {result.errors} errors, {result.skipped} skipped (no public source), {result.overridden} kept manual
                  {result.message ? `. ${result.message}` : ''}
                </Alert>
              )}
              <h4 style={{ margin: '12px 0 6px' }}>Sources</h4>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Last fetch</th>
                      <th className="r">Rows</th>
                      <th>Freshness</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.sources.map((x) => (
                      <tr key={x.source}>
                        <td>
                          <strong>{x.source}</strong>
                          <span className="ops-sub">{x.label}</span>
                          {x.url && (
                            <a className="ops-sub" href={x.url} target="_blank" rel="noreferrer noopener">
                              {x.url}
                            </a>
                          )}
                        </td>
                        <td>
                          <Pill s={x.lastStatus} />
                        </td>
                        <td>{x.lastSuccessAt ? <DateText value={x.lastSuccessAt} time /> : 'never'}</td>
                        <td className="r">{x.lastCount}</td>
                        <td>
                          <Pill s={x.stale ? 'STALE' : 'OK'} label={x.stale ? 'stale' : 'fresh'} />
                        </td>
                        <td>
                          {x.lastError && <span className="ops-error-text">{x.lastError}</span>}
                          {x.backoffUntil && <span className="ops-sub">Backing off until {new Date(x.backoffUntil).toLocaleTimeString()} after {x.consecutiveFailures} failures</span>}
                          {x.note && <span className="ops-sub">{x.note}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 style={{ margin: '16px 0 6px' }}>
                Price freshness and provenance{' '}
                <label style={{ fontWeight: 400, fontSize: 13, marginLeft: 12 }}>
                  <input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} /> stale only
                </label>
              </h4>
              {rows.length === 0 ? (
                <Empty>{staleOnly ? 'No stale prices.' : 'No securities.'}</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Ticker</th>
                        <th className="r">Price</th>
                        <th>Date</th>
                        <th>Price source</th>
                        <th>Age</th>
                        <th>Last fetched from</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <strong>{x.ticker}</strong>
                            <span className="ops-sub">{x.market}</span>
                          </td>
                          <td className="r">{x.price ? `${formatDecimal(x.price, 4)} ${x.currency}` : '—'}</td>
                          <td>{x.priceDate ? <DateText value={x.priceDate} /> : '—'}</td>
                          <td>{x.priceSource ?? '—'}</td>
                          <td>
                            <Pill s={x.stale ? 'STALE' : 'OK'} label={x.ageBusinessDays === null ? 'no price' : x.stale ? `stale ${x.ageBusinessDays}d` : `${x.ageBusinessDays}d`} />
                          </td>
                          <td>
                            {x.provenance ? (
                              <>
                                {x.provenance.source} <DateText value={x.provenance.fetchedAt} time />
                                <span className="ops-sub">hash {short(x.provenance.rawHash)}</span>
                              </>
                            ) : x.publicSource ? (
                              'not fetched yet'
                            ) : (
                              <span className="ops-sub">no free public source: use manual price or a paid feed</span>
                            )}
                          </td>
                          <td>
                            <button className="ops-btn small" type="button" onClick={() => setProv(x.ticker)}>
                              Provenance
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ margin: '16px 0 6px' }}>Exceptions (rejected or failed values, last 7 days)</h4>
              {s.exceptions.length === 0 ? (
                <Empty>No open exceptions.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Item</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Reason</th>
                        <th className="r">Seen</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {s.exceptions.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <DateText value={e.fetchedAt} time />
                          </td>
                          <td>
                            <strong>{e.ticker}</strong>
                            <span className="ops-sub">{e.refType}{e.rawValue ? ` raw "${e.rawValue}"` : ''}</span>
                          </td>
                          <td>{e.source}</td>
                          <td>
                            <Pill s={e.status} />
                          </td>
                          <td>{e.reason}</td>
                          <td className="r">{e.seenCount}</td>
                          <td>{canManage && <ActionButton label="Acknowledge" onRun={() => api.post(v1(`/market-data/exceptions/${e.id}/acknowledge`), {})} onDone={() => status.reload()} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ margin: '16px 0 6px' }}>FX rates</h4>
              {s.fx.length === 0 ? (
                <Empty>No FX rates stored.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Pair</th>
                        <th className="r">Rate</th>
                        <th>Date</th>
                        <th>Source</th>
                        <th>Age</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.fx.slice(0, 12).map((f, i) => (
                        <tr key={`${f.pair}${f.rateDate}${i}`}>
                          <td>{f.pair}</td>
                          <td className="r">{formatDecimal(f.rate, 6)}</td>
                          <td>
                            <DateText value={f.rateDate} />
                          </td>
                          <td>{f.source}</td>
                          <td>
                            <Pill s={f.ageBusinessDays > s.staleAfterBusinessDays ? 'STALE' : 'OK'} label={`${f.ageBusinessDays}d`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h4 style={{ margin: '16px 0 6px' }}>Recent refreshes</h4>
              {s.runs.length === 0 ? (
                <Empty>No refresh has run yet.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Trigger</th>
                        <th>Scope</th>
                        <th>Status</th>
                        <th className="r">Updated</th>
                        <th className="r">Rejected</th>
                        <th className="r">Errors</th>
                        <th className="r">Skipped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.runs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <DateText value={r.startedAt} time />
                          </td>
                          <td>{r.trigger.toLowerCase()}</td>
                          <td>{r.scope}</td>
                          <td>
                            <Pill s={r.status === 'FAILED' ? 'ERROR' : r.status} label={r.status} />
                          </td>
                          <td className="r">{r.accepted}</td>
                          <td className="r">{r.rejected}</td>
                          <td className="r">{r.errors}</td>
                          <td className="r">{r.skipped}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
      {prov && (
        <Modal title={prov} kicker="Provenance" wide onClose={() => setProv(null)}>
          <div className="ops-modal-body">
            <Loaded res={provRes} what="provenance">
              {(d) =>
                !d?.rows.length ? (
                  <Empty>No feed values recorded for this security.</Empty>
                ) : (
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Fetched</th>
                        <th>Price date</th>
                        <th className="r">Value</th>
                        <th className="r">Previous</th>
                        <th>Status</th>
                        <th>Source and page</th>
                        <th>Raw hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <DateText value={r.fetchedAt} time />
                          </td>
                          <td>{r.priceDate ? <DateText value={r.priceDate} /> : '—'}</td>
                          <td className="r">{r.value ? formatDecimal(r.value, 4) : r.rawValue ?? '—'}</td>
                          <td className="r">{r.previousValue ? formatDecimal(r.previousValue, 4) : '—'}</td>
                          <td>
                            <Pill s={r.status} />
                            {r.reason && <span className="ops-sub">{r.reason}</span>}
                          </td>
                          <td>
                            {r.source}
                            <span className="ops-sub">{r.url}</span>
                          </td>
                          <td title={r.rawHash}>
                            <code>{short(r.rawHash)}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </Loaded>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ custodian feed (/ops/reconciliation)

interface FeedFile {
  id: string;
  counterpartyId: string;
  adapter: string;
  filename: string;
  format: string;
  accountRef: string | null;
  statementDate: string | null;
  currency: string | null;
  closingCash: string | null;
  holdingsMv: string | null;
  status: string;
  tradesImported: number;
  tradesSkipped: number;
  holdingsCount: number;
  dayEndRef: string | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
}
interface FeedStatus {
  mode: string;
  live: { configured: boolean; requiredEnv: string[]; missingEnv: string[]; note: string };
  formats: string[];
  counterparties: { id: string; ref: string; name: string; type: string; lastFile: { filename: string; statementDate: string | null; at: string } | null }[];
  files: FeedFile[];
}
interface IngestResult {
  fileId: string;
  statements: { accountRef: string; statementDate: string; tradesImported: number; tradesSkipped: number; holdings: number; dayEndRef: string | null; warnings: string[] }[];
  warnings: string[];
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CustodianFeedSection({ canManage, onChanged }: { canManage: boolean; onChanged?: () => void }) {
  const status = useResource<FeedStatus>(() => api.get<FeedStatus>(v1('/custodian-feed/status')), []);
  const cps = useCounterparties();
  const [cp, setCp] = useState('');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [sampleAccount, setSampleAccount] = useState('');
  const upload = useAction();

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setResult(null);
    if (!f) return setFile(null);
    if (f.size > 900_000) return upload.run(async () => Promise.reject(new Error('File is larger than 900 KB')));
    setFile({ name: f.name, text: await f.text() });
  };

  async function send() {
    if (!file || !cp) return;
    const r = await upload.run((key) => api.post<IngestResult>(v1('/custodian-feed/upload'), { counterpartyId: cp, filename: file.name, content: file.text }, { idempotencyKey: key }));
    if (r) {
      setResult(r);
      setFile(null);
      status.reload();
      onChanged?.();
    }
  }

  return (
    <Card title="Custodian statement feed">
      <Loaded res={status} what="feed status">
        {(s) => (
          <>
            <p className="ops-sub" style={{ marginTop: 0 }}>
              Adapter <strong>{s.mode}</strong>. Upload a custodian statement (CSV, MT940-like or JSON). Trades load into the custodian executions, cash and holdings value into a day-end package, and holdings lines are kept for detail; Reconciliation then matches them as if the custodian had submitted them. Live SWIFT/API connectivity is a placeholder:{' '}
              {s.live.missingEnv.length ? `needs ${s.live.requiredEnv.join(', ')}` : 'credentials present but the client is not implemented'}.
            </p>
            {canManage ? (
              <div style={{ border: '1px solid var(--ops-border, #d8dde6)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <FieldGrid>
                  <Field label="Custodian / counterparty">
                    <select className="ops-input" value={cp} onChange={(e) => setCp(e.target.value)}>
                      <option value="">Select…</option>
                      {(cps.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.ref})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Statement file" hint="CSV, .sta/.txt MT940-like, or JSON; up to 900 KB">
                    <input className="ops-input" type="file" accept=".csv,.txt,.sta,.mt940,.json" onChange={pick} />
                  </Field>
                </FieldGrid>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="ops-btn primary" type="button" disabled={!file || !cp || upload.busy} onClick={send}>
                    {upload.busy ? 'Importing…' : 'Import statement'}
                  </button>
                  {s.formats.map((f) => (
                    <button
                      key={f}
                      className="ops-btn small"
                      type="button"
                      onClick={async () => {
                        const t = await api.get<{ filename: string; content: string }>(v1(`/custodian-feed/templates/${f}`));
                        download(t.filename, t.content);
                      }}
                    >
                      {f} template
                    </button>
                  ))}
                </div>
                {s.mode === 'fake' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <input className="ops-input" placeholder="Account ref for a generated sample" value={sampleAccount} onChange={(e) => setSampleAccount(e.target.value)} style={{ maxWidth: 260 }} />
                    <ActionButton
                      label="Generate fake statement"
                      disabled={!cp || !sampleAccount}
                      onRun={async () => setResult(await api.post<IngestResult>(v1('/custodian-feed/sample'), { counterpartyId: cp, accountRef: sampleAccount, format: 'CSV' }))}
                      onDone={() => status.reload()}
                    />
                  </div>
                )}
                <Alert>{upload.error}</Alert>
              </div>
            ) : (
              <Alert kind="info">Uploading needs the recon.manage permission.</Alert>
            )}
            {result && (
              <Alert kind="ok">
                Imported.{' '}
                {result.statements.map((x) => `${x.accountRef} ${x.statementDate}: ${x.tradesImported} trade(s) loaded, ${x.tradesSkipped} already known, ${x.holdings} holding line(s)${x.dayEndRef ? `, day-end ${x.dayEndRef}` : ''}`).join('; ')}
                {[...result.warnings, ...result.statements.flatMap((x) => x.warnings)].map((w, i) => (
                  <span key={i} className="ops-sub">
                    {w}
                  </span>
                ))}
              </Alert>
            )}
            <h4 style={{ margin: '12px 0 6px' }}>Feed status by counterparty</h4>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Counterparty</th>
                    <th>Last statement</th>
                    <th>Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {s.counterparties.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                        <span className="ops-sub">{c.ref}</span>
                      </td>
                      <td>{c.lastFile ? `${c.lastFile.filename} (${c.lastFile.statementDate ?? 'no date'})` : 'none yet'}</td>
                      <td>{c.lastFile ? <DateText value={c.lastFile.at} time /> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h4 style={{ margin: '16px 0 6px' }}>Recent files</h4>
            {s.files.length === 0 ? (
              <Empty>No statement has been imported.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Imported</th>
                      <th>File</th>
                      <th>Account</th>
                      <th>Statement date</th>
                      <th className="r">Trades</th>
                      <th className="r">Holdings</th>
                      <th>Day-end</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.files.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <DateText value={f.createdAt} time />
                        </td>
                        <td>
                          {f.filename}
                          <span className="ops-sub">{f.format} via {f.adapter}</span>
                        </td>
                        <td>{f.accountRef ?? '—'}</td>
                        <td>{f.statementDate ? <DateText value={f.statementDate} /> : '—'}</td>
                        <td className="r">
                          {f.tradesImported}
                          {f.tradesSkipped ? ` (+${f.tradesSkipped} known)` : ''}
                        </td>
                        <td className="r">{f.holdingsCount}</td>
                        <td>{f.dayEndRef ?? '—'}</td>
                        <td>
                          <StatusBadge status={f.status === 'Imported' ? 'completed' : f.status === 'Failed' ? 'rejected' : f.status} />
                          {f.error && <span className="ops-error-text">{f.error}</span>}
                          {f.warnings.slice(0, 2).map((w, i) => (
                            <span key={i} className="ops-sub">
                              {w}
                            </span>
                          ))}
                        </td>
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
