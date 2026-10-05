'use client';

import { useRef, useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { TabBar } from '@/ops/recon/common';
import { AutomationTab } from '@/ops/enforcement';
import { useCan } from '@/ops/session';
import { full, label, Pager, SimpleTable, Tiles, Tone, upload, when } from '@/ops/suite';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, Modal, PageHeader, optStr, str, useResource } from '@/ops/ui';

interface Dataset {
  key: string;
  label: string;
  table: string;
  columns: Record<string, 'text' | 'num' | 'date'>;
  relations: string[];
  rows: number;
  latest: string | null;
}
interface FeedColumn {
  name: string;
  type: 'text' | 'num' | 'date';
  required: boolean;
  unique?: boolean;
}
interface FeedSchema {
  keyColumn: string;
  columns: FeedColumn[];
}
interface DatasetsResp {
  feeds?: { dataset: string; label: string; sourceKey: string; columns: Record<string, 'text' | 'num' | 'date'> }[];
  data: Dataset[];
  checkTypes: string[];
  severities: string[];
  kinds: string[];
  cadences: string[];
}
interface Source {
  id: string;
  key: string;
  name: string;
  kind: string;
  dataset: string | null;
  system: string;
  owner: string;
  cadence: string;
  status: string;
  lastSyncAt: string | null;
  lastRowCount: number | null;
  schemaSpec: FeedSchema | null;
  rules: number;
  lastJob: { ref: string; status: string; at: string } | null;
}
interface Job {
  id: string;
  ref: string;
  source: string;
  status: string;
  rowsRead: number;
  rowsRejected: number;
  latestRecordAt: string | null;
  note: string | null;
  error: string | null;
  triggeredBy: string | null;
  startedAt: string;
  fileName: string | null;
  fileSha256: string | null;
}
interface Rule {
  id: string;
  key: string;
  name: string;
  dataset: string;
  checkType: string;
  col: string;
  params: Record<string, unknown> | null;
  severity: string;
  active: boolean;
  openExceptions: number;
  lastRun: { ref: string; status: string; failures: number; rowsChecked: number; at: string } | null;
}
interface Exc {
  id: string;
  ruleKey: string;
  ruleName: string;
  dataset: string;
  severity: string;
  recordKey: string;
  detail: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
}
interface Summary {
  sources: Record<string, number>;
  jobsLast24h: number;
  failedJobsLast24h: number;
  activeRules: number;
  rulesNeverRun: number;
  rulesPassing: number;
  rulesFailing: number;
  rulesErroring: number;
  openExceptions: number;
  openBySeverity: Record<string, number>;
}

type Tab = 'overview' | 'sources' | 'jobs' | 'rules' | 'exceptions' | 'automation';
const PAGE = 25;
const D = (p: string) => v1(`/data${p}`);

export default function DataPage() {
  const canView = useCan('operations.view');
  const [tab, setTab] = useState<Tab>('overview');
  const ds = useResource(() => full<DatasetsResp>(D('/datasets')), []);
  if (!canView) {
    return (
      <>
        <PageHeader kicker="Operations" title="Data Fabric & Studio" />
        <Alert>You do not have permission to view this page.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Operations"
        title="Data Fabric & Studio"
        subtitle="Registered data sources, ingestion jobs and data-quality rules that run over the live tables. Failing records go to the exceptions list until someone resolves or waives them."
      />
      <TabBar
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'sources', label: 'Sources' },
          { key: 'jobs', label: 'Ingestion jobs' },
          { key: 'rules', label: 'Quality rules' },
          { key: 'exceptions', label: 'Exceptions' },
          { key: 'automation', label: 'Schedules & lineage' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {ds.state !== 'ok' ? (
        <Loaded res={ds}>{() => null}</Loaded>
      ) : (
        <>
          {tab === 'overview' && <Overview ds={ds.data} />}
          {tab === 'sources' && <SourcesTab ds={ds.data} />}
          {tab === 'jobs' && <JobsTab />}
          {tab === 'rules' && <RulesTab ds={ds.data} />}
          {tab === 'exceptions' && <ExceptionsTab />}
          {tab === 'automation' && <AutomationTab />}
        </>
      )}
    </>
  );
}

function Overview({ ds }: { ds: DatasetsResp }) {
  const s = useResource<Summary>(() => api.get<Summary>(D('/summary')), []);
  return (
    <>
      <Loaded res={s}>
        {(x) => (
          <Tiles
            items={[
              { label: 'Sources active', value: x.sources.ACTIVE ?? 0 },
              { label: 'Sources in error', value: x.sources.ERROR ?? 0, tone: x.sources.ERROR ? 'red' : undefined },
              { label: 'Jobs, last 24h', value: x.jobsLast24h },
              { label: 'Failed jobs, 24h', value: x.failedJobsLast24h, tone: x.failedJobsLast24h ? 'red' : undefined },
              { label: 'Rules passing', value: `${x.rulesPassing} / ${x.activeRules}` },
              { label: 'Rules failing', value: x.rulesFailing + x.rulesErroring, tone: x.rulesFailing + x.rulesErroring ? 'red' : undefined },
              { label: 'Never run', value: x.rulesNeverRun, tone: x.rulesNeverRun ? 'amber' : undefined },
              { label: 'Open exceptions', value: x.openExceptions, tone: x.openBySeverity.HIGH ? 'red' : x.openExceptions ? 'amber' : undefined },
            ]}
          />
        )}
      </Loaded>
      <Card title="Datasets under governance">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Table</th>
                <th>Rows</th>
                <th>Newest record</th>
                <th>Columns</th>
              </tr>
            </thead>
            <tbody>
              {ds.data.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>
                    <code>{d.table}</code>
                  </td>
                  <td>{d.rows.toLocaleString()}</td>
                  <td>{when(d.latest)}</td>
                  <td className="ops-muted">{Object.keys(d.columns).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function SourcesTab({ ds }: { ds: DatasetsResp }) {
  const canManage = useCan('data.manage');
  const res = useResource<Source[]>(() => api.get<Source[]>(D('/sources')), []);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('TABLE');
  const [ingest, setIngest] = useState<Source | null>(null);
  const [contract, setContract] = useState<Source | null>(null);
  const [uploading, setUploading] = useState<Source | null>(null);
  const [staged, setStaged] = useState<Source | null>(null);
  return (
    <Card actions={canManage && <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>Register source</button>}>
      <Loaded res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No sources registered.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Kind</th>
                    <th>Owner</th>
                    <th>Cadence</th>
                    <th>Last sync</th>
                    <th>Rules</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.name}
                        <span className="ops-sub">{s.system}{s.dataset ? `, ${s.dataset}` : ''}</span>
                      </td>
                      <td>{label(s.kind)}</td>
                      <td>{s.owner}</td>
                      <td>{label(s.cadence)}</td>
                      <td>
                        {when(s.lastSyncAt)}
                        <span className="ops-sub">{s.lastRowCount === null ? '' : `${s.lastRowCount.toLocaleString()} rows`}</span>
                      </td>
                      <td>{s.rules}</td>
                      <td>
                        <Tone value={s.status} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canManage && (
                          <>
                            {s.kind === 'TABLE' ? (
                              <ActionButton label="Profile now" disabled={s.status === 'PAUSED'} onRun={(k) => api.post(D(`/sources/${s.id}/ingest`), {}, { idempotencyKey: k })} onDone={res.reload} />
                            ) : s.kind === 'FILE_FEED' ? (
                              <>
                                <button className="ops-btn small" type="button" onClick={() => setContract(s)}>
                                  Contract
                                </button>{' '}
                                <button className="ops-btn small" type="button" disabled={s.status === 'PAUSED' || !s.schemaSpec} title={s.schemaSpec ? undefined : 'Define the column contract first'} onClick={() => setUploading(s)}>
                                  Upload CSV
                                </button>{' '}
                                {s.schemaSpec && (
                                  <button className="ops-btn small" type="button" onClick={() => setStaged(s)}>
                                    Staged rows
                                  </button>
                                )}
                              </>
                            ) : (
                              <button className="ops-btn small" type="button" disabled={s.status === 'PAUSED'} onClick={() => setIngest(s)}>
                                Record feed run
                              </button>
                            )}{' '}
                            <ActionButton label={s.status === 'PAUSED' ? 'Resume' : 'Pause'} onRun={() => api.patch(D(`/sources/${s.id}`), { status: s.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' })} onDone={res.reload} />
                          </>
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
      {adding && (
        <FormModal
          title="Register data source"
          submitLabel="Register"
          onClose={() => setAdding(false)}
          onSubmit={(fd, k) => api.post(D('/sources'), { key: str(fd, 'key'), name: str(fd, 'name'), kind, dataset: kind === 'TABLE' ? str(fd, 'dataset') : undefined, system: str(fd, 'system'), owner: str(fd, 'owner'), cadence: str(fd, 'cadence'), description: optStr(fd, 'description') }, { idempotencyKey: k })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Key" hint="lower case, e.g. zse-announcements">
              <input className="ops-input" name="key" required pattern="[a-z0-9][a-z0-9_.\-]{2,39}" />
            </Field>
            <Field label="Name">
              <input className="ops-input" name="name" required minLength={3} maxLength={160} />
            </Field>
            <Field label="Kind">
              <select className="ops-input" value={kind} onChange={(e) => setKind(e.target.value)}>
                {ds.kinds.map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </select>
            </Field>
            {kind === 'TABLE' && (
              <Field label="Dataset">
                <select className="ops-input" name="dataset" required>
                  {ds.data.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="System">
              <input className="ops-input" name="system" required maxLength={80} />
            </Field>
            <Field label="Owner">
              <input className="ops-input" name="owner" required maxLength={120} />
            </Field>
            <Field label="Cadence">
              <select className="ops-input" name="cadence" defaultValue="DAILY">
                {ds.cadences.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)" span={2}>
              <input className="ops-input" name="description" maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {contract && (
        <FormModal
          title={`Column contract: ${contract.name}`}
          subtitle="One column per line: name, type (text, num or date), then required and/or unique. Uploaded CSVs are typed and validated against this."
          submitLabel="Save contract"
          wide
          onClose={() => setContract(null)}
          onSubmit={(fd) => {
            const columns = str(fd, 'columns')
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [name, type, ...flags] = l.split(',').map((x) => x.trim().toLowerCase());
                return { name: name ?? '', type: (type || 'text') as FeedColumn['type'], required: flags.includes('required'), unique: flags.includes('unique') || undefined };
              });
            return api.put(D(`/sources/${contract.id}/schema`), { keyColumn: str(fd, 'keyColumn').toLowerCase(), columns });
          }}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Key column" hint="Identifies a row; duplicates in a file are rejected">
              <input className="ops-input" name="keyColumn" required defaultValue={contract.schemaSpec?.keyColumn ?? ''} />
            </Field>
            <Field label="Columns" span={2}>
              <textarea
                className="ops-input"
                name="columns"
                rows={8}
                required
                defaultValue={(contract.schemaSpec?.columns ?? [{ name: 'ticker', type: 'text', required: true }, { name: 'price_date', type: 'date', required: true }, { name: 'close_price', type: 'num', required: true }]).map((c) => [c.name, c.type, c.required ? 'required' : '', c.unique ? 'unique' : ''].filter(Boolean).join(',')).join('\n')}
              />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {uploading && <UploadModal source={uploading} onClose={() => setUploading(null)} onDone={res.reload} />}
      {staged && <StagedModal source={staged} onClose={() => setStaged(null)} />}
      {ingest && (
        <FormModal
          title={`Record feed run: ${ingest.name}`}
          submitLabel="Record"
          onClose={() => setIngest(null)}
          onSubmit={(fd, k) => {
            const failed = str(fd, 'outcome') === 'FAILED';
            return api.post(D(`/sources/${ingest.id}/ingest`), failed ? { status: 'FAILED', error: str(fd, 'error') || 'Feed run failed' } : { rowsRead: Number(str(fd, 'rowsRead')), rowsRejected: Number(str(fd, 'rowsRejected') || 0), note: optStr(fd, 'note') }, { idempotencyKey: k });
          }}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Outcome">
              <select className="ops-input" name="outcome" defaultValue="SUCCEEDED">
                <option value="SUCCEEDED">Succeeded</option>
                <option value="FAILED">Failed</option>
              </select>
            </Field>
            <Field label="Rows delivered">
              <input className="ops-input" name="rowsRead" type="number" min={0} />
            </Field>
            <Field label="Rows rejected">
              <input className="ops-input" name="rowsRejected" type="number" min={0} defaultValue={0} />
            </Field>
            <Field label="Error or note (optional)" span={2}>
              <input className="ops-input" name="error" maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function JobsTab() {
  const [offset, setOffset] = useState(0);
  const [rejected, setRejected] = useState<Job | null>(null);
  const [status, setStatus] = useState('');
  const res = useResource(() => full<{ data: Job[]; total: number }>(D(`/jobs${qs({ status, limit: String(PAGE), offset: String(offset) })}`)), [status, offset]);
  return (
    <Card>
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => (setStatus(e.target.value), setOffset(0))}>
            <option value="">All</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
          </select>
        </Field>
      </div>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No ingestion jobs yet. Profile a table source or record a feed run from Sources.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Source</th>
                      <th>Started</th>
                      <th>Rows read</th>
                      <th>Rejected</th>
                      <th>Newest record</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((j) => (
                      <tr key={j.id}>
                        <td>
                          {j.ref}
                          <span className="ops-sub">{j.triggeredBy}</span>
                        </td>
                        <td>
                          {j.source}
                          <span className="ops-sub">{j.note}</span>
                        </td>
                        <td>{when(j.startedAt)}</td>
                        <td>{j.rowsRead.toLocaleString()}</td>
                        <td>
                          {j.rowsRejected}
                          {j.rowsRejected > 0 && j.fileName && (
                            <button className="ops-btn small" type="button" style={{ marginLeft: 6 }} onClick={() => setRejected(j)}>
                              View
                            </button>
                          )}
                        </td>
                        <td>{when(j.latestRecordAt)}</td>
                        <td>
                          <Tone value={j.status} />
                          {j.error && <span className="ops-sub">{j.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={r.total} onChange={setOffset} />
            </>
          )
        }
      </Loaded>
      {rejected && <RejectedModal job={rejected} onClose={() => setRejected(null)} />}
    </Card>
  );
}

function RulesTab({ ds }: { ds: DatasetsResp }) {
  const canManage = useCan('data.manage');
  const res = useResource<Rule[]>(() => api.get<Rule[]>(D('/rules')), []);
  const [adding, setAdding] = useState(false);
  const [dataset, setDataset] = useState(ds.data[0]?.key ?? '');
  const [type, setType] = useState('NOT_NULL');
  const [refDataset, setRefDataset] = useState(ds.data[0]?.key ?? '');
  const feed = ds.feeds?.find((f) => f.dataset === dataset);
  const cur = ds.data.find((d) => d.key === dataset);
  const colMap: Record<string, 'text' | 'num' | 'date'> = feed?.columns ?? cur?.columns ?? {};
  const cols = Object.entries(colMap).filter(([, t]) => (type === 'RANGE' ? t === 'num' : type === 'FRESHNESS' ? t === 'date' : true));
  const refCur = ds.data.find((d) => d.key === refDataset);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  return (
    <Card
      actions={
        canManage && (
          <span style={{ display: 'flex', gap: 8 }}>
            <ActionButton
              label="Run all rules"
              onRun={async () => {
                const out = await api.post<{ status: string }[]>(D('/runs/run-all'), {});
                setRunMsg(`Ran ${out.length} rules: ${out.filter((o) => o.status === 'PASS').length} passed, ${out.filter((o) => o.status === 'FAIL').length} failed, ${out.filter((o) => o.status === 'ERROR').length} errored.`);
              }}
              onDone={res.reload}
            />
            <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>
              New rule
            </button>
          </span>
        )
      }
    >
      <Alert kind="ok">{runMsg}</Alert>
      <Loaded res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No rules defined.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Check</th>
                    <th>Severity</th>
                    <th>Last run</th>
                    <th>Open exceptions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                      <td>
                        {r.name}
                        <span className="ops-sub">{r.key}</span>
                      </td>
                      <td>
                        {label(r.checkType)} on {r.dataset}.{r.col}
                        <span className="ops-sub">{describeParams(r.params)}</span>
                      </td>
                      <td>
                        <Tone value={r.severity} />
                      </td>
                      <td>
                        {r.lastRun ? (
                          <>
                            <Tone value={r.lastRun.status} />
                            <span className="ops-sub">
                              {r.lastRun.ref}, {r.lastRun.failures} of {r.lastRun.rowsChecked}, {when(r.lastRun.at)}
                            </span>
                          </>
                        ) : (
                          'never'
                        )}
                      </td>
                      <td>{r.openExceptions}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canManage && (
                          <>
                            <ActionButton label="Run" disabled={!r.active} onRun={(k) => api.post(D(`/rules/${r.id}/run`), {}, { idempotencyKey: k })} onDone={res.reload} />{' '}
                            <ActionButton label={r.active ? 'Disable' : 'Enable'} onRun={() => api.patch(D(`/rules/${r.id}`), { active: !r.active })} onDone={res.reload} />
                          </>
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
      {adding && (
        <FormModal
          title="New data-quality rule"
          submitLabel="Create rule"
          onClose={() => setAdding(false)}
          onSubmit={(fd, k) => {
            const params: Record<string, unknown> = {};
            if (type === 'RANGE') {
              if (str(fd, 'min')) params.min = Number(str(fd, 'min'));
              if (str(fd, 'max')) params.max = Number(str(fd, 'max'));
            }
            if (type === 'FRESHNESS') params.maxAgeDays = Number(str(fd, 'maxAgeDays'));
            if (type === 'ORPHAN') params.relation = str(fd, 'relation');
            if (type === 'CROSS_TABLE') {
              params.refDataset = refDataset;
              params.refCol = str(fd, 'refCol');
            }
            if (type === 'COL_COMPARE') {
              params.op = str(fd, 'op');
              params.other = str(fd, 'other');
            }
            const col = type === 'ORPHAN' ? undefined : type === 'COMPOSITE_UQ' ? str(fd, 'cols').replace(/\s+/g, '') : str(fd, 'col');
            return api.post(D('/rules'), { key: str(fd, 'key'), name: str(fd, 'name'), dataset, checkType: type, col: col ?? colForRelation(cur, str(fd, 'relation')), params: Object.keys(params).length ? params : undefined, severity: str(fd, 'severity') }, { idempotencyKey: k });
          }}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Key">
              <input className="ops-input" name="key" required pattern="[a-z0-9][a-z0-9_.\-]{2,59}" />
            </Field>
            <Field label="Name">
              <input className="ops-input" name="name" required minLength={3} maxLength={200} />
            </Field>
            <Field label="Dataset">
              <select className="ops-input" value={dataset} onChange={(e) => setDataset(e.target.value)}>
                {ds.data.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
                {(ds.feeds ?? []).map((f) => (
                  <option key={f.dataset} value={f.dataset}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Check">
              <select className="ops-input" value={type} onChange={(e) => setType(e.target.value)}>
                {ds.checkTypes.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </Field>
            {type === 'COMPOSITE_UQ' ? (
              <Field label="Columns" hint={`Comma-separated, 2 to 4 of: ${Object.keys(colMap).join(', ')}`} span={2}>
                <input className="ops-input" name="cols" required placeholder="security_id,price_date" />
              </Field>
            ) : type !== 'ORPHAN' ? (
              <Field label="Column">
                <select className="ops-input" name="col" key={`${dataset}${type}`} required>
                  {cols.map(([c]) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Relation" hint="Fails when the referenced row is missing">
                <select className="ops-input" name="relation" key={dataset} required>
                  {(cur?.relations ?? []).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
            )}
            {type === 'CROSS_TABLE' && (
              <>
                <Field label="Must exist in dataset">
                  <select className="ops-input" value={refDataset} onChange={(e) => setRefDataset(e.target.value)}>
                    {ds.data.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference column">
                  <select className="ops-input" name="refCol" key={refDataset} required>
                    {[...Object.keys(refCur?.columns ?? {}), 'id', 'ref', 'ticker'].filter((c, i, a) => a.indexOf(c) === i).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {type === 'COL_COMPARE' && (
              <>
                <Field label="Must be" hint="column compared with the other column">
                  <select className="ops-input" name="op" defaultValue="lte">
                    <option value="lt">less than</option>
                    <option value="lte">less than or equal to</option>
                    <option value="eq">equal to</option>
                    <option value="ne">different from</option>
                    <option value="gte">greater than or equal to</option>
                    <option value="gt">greater than</option>
                  </select>
                </Field>
                <Field label="Other column">
                  <select className="ops-input" name="other" key={`${dataset}o`} required>
                    {Object.keys(colMap).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {type === 'RANGE' && (
              <>
                <Field label="Minimum">
                  <input className="ops-input" name="min" type="number" step="any" />
                </Field>
                <Field label="Maximum">
                  <input className="ops-input" name="max" type="number" step="any" />
                </Field>
              </>
            )}
            {type === 'FRESHNESS' && (
              <Field label="Maximum age (days)">
                <input className="ops-input" name="maxAgeDays" type="number" min={0} max={3650} required />
              </Field>
            )}
            <Field label="Severity">
              <select className="ops-input" name="severity" defaultValue="MEDIUM">
                {ds.severities.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

/** The foreign-key column an ORPHAN relation checks is `<relation>_id` in every registry dataset. */
const OPS: Record<string, string> = { lt: 'less than', lte: 'at most', gt: 'greater than', gte: 'at least', eq: 'equal to', ne: 'different from' };

/** Plain-language form of a rule's stored parameters (never the raw JSON). */
function describeParams(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  const p = params as Record<string, unknown>;
  const parts: string[] = [];
  if (p.op !== undefined || p.other !== undefined) parts.push(`must be ${OPS[String(p.op)] ?? String(p.op)} ${String(p.other ?? '')}`.trim());
  if (p.min !== undefined && p.min !== null && p.min !== '') parts.push(`min ${String(p.min)}`);
  if (p.max !== undefined && p.max !== null && p.max !== '') parts.push(`max ${String(p.max)}`);
  if (p.maxAgeDays !== undefined) parts.push(`no older than ${String(p.maxAgeDays)} days`);
  if (p.relation !== undefined) parts.push(`relation ${String(p.relation)}`);
  if (p.refDataset !== undefined) parts.push(`must exist in ${String(p.refDataset)}.${String(p.refCol ?? '')}`);
  const known = new Set(['op', 'other', 'min', 'max', 'maxAgeDays', 'relation', 'refDataset', 'refCol']);
  for (const [k, v] of Object.entries(p)) if (!known.has(k)) parts.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.join(', ');
}

const colForRelation = (_d: Dataset | undefined, relation: string) => `${relation}_id`;

function ExceptionsTab() {
  const canManage = useCan('data.manage');
  const [status, setStatus] = useState('OPEN,ACKNOWLEDGED');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const [act, setAct] = useState<{ e: Exc; kind: 'resolve' | 'waive' } | null>(null);
  const res = useResource(() => full<{ data: Exc[]; total: number }>(D(`/exceptions${qs({ status, severity, limit: String(PAGE), offset: String(offset) })}`)), [status, severity, offset]);
  return (
    <Card>
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => (setStatus(e.target.value), setOffset(0))}>
            <option value="OPEN,ACKNOWLEDGED">Open</option>
            <option value="OPEN">New</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
            <option value="WAIVED">Waived</option>
            <option value="">All</option>
          </select>
        </Field>
        <Field label="Severity">
          <select className="ops-input" value={severity} onChange={(e) => (setSeverity(e.target.value), setOffset(0))}>
            <option value="">All</option>
            {['HIGH', 'MEDIUM', 'LOW'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No exceptions match.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>Rule</th>
                      <th>Detail</th>
                      <th>Severity</th>
                      <th>Raised</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.recordKey}
                          <span className="ops-sub">{e.dataset}</span>
                        </td>
                        <td>{e.ruleName}</td>
                        <td>{e.detail}</td>
                        <td>
                          <Tone value={e.severity} />
                        </td>
                        <td>{when(e.createdAt)}</td>
                        <td>
                          <Tone value={e.status} />
                          {e.resolution && <span className="ops-sub">{e.resolution}{e.resolvedBy ? ` (${e.resolvedBy})` : ''}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {canManage && ['OPEN', 'ACKNOWLEDGED'].includes(e.status) && (
                            <>
                              {e.status === 'OPEN' && <ActionButton label="Acknowledge" onRun={() => api.post(D(`/exceptions/${e.id}/acknowledge`), {})} onDone={res.reload} />}{' '}
                              <button className="ops-btn small" type="button" onClick={() => setAct({ e, kind: 'resolve' })}>
                                Resolve
                              </button>{' '}
                              <button className="ops-btn small" type="button" onClick={() => setAct({ e, kind: 'waive' })}>
                                Waive
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager offset={offset} limit={PAGE} total={r.total} onChange={setOffset} />
            </>
          )
        }
      </Loaded>
      {act && (
        <FormModal title={`${label(act.kind)} exception`} submitLabel={label(act.kind)} onClose={() => setAct(null)} onSubmit={(fd) => api.post(D(`/exceptions/${act.e.id}/${act.kind}`), { reason: str(fd, 'reason') })} onDone={res.reload}>
          <p className="ops-muted">
            {act.e.ruleName}: {act.e.recordKey}. {act.e.detail}
          </p>
          <Field label={act.kind === 'resolve' ? 'What was done' : 'Why this can be accepted'}>
            <textarea className="ops-input" name="reason" required minLength={5} maxLength={500} rows={3} />
          </Field>
        </FormModal>
      )}
    </Card>
  );
}

type UploadResult = { ref: string; status: string; accepted: number; rowsRead: number; rowsRejected: number; error: string | null };
function UploadModal({ source, onClose, onDone }: { source: Source; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const done = useRef(false);
  if (result) {
    return (
      <Modal title={`Upload result: ${source.name}`} onClose={() => (onDone(), onClose())}>
        <div className="ops-modal-body">
          <Alert kind={result.status === 'FAILED' ? 'error' : 'ok'}>
            {result.ref} {result.status === 'FAILED' ? 'failed' : 'loaded'}: {result.accepted} accepted of {result.rowsRead} rows, {result.rowsRejected} rejected.{result.error ? ` ${result.error}` : ''}
          </Alert>
          {result.rowsRejected > 0 && <p className="ops-muted">Open Ingestion jobs and use View beside the rejected count to see each refused row and its reason.</p>}
        </div>
        <footer className="ops-modal-foot">
          <button className="ops-btn primary" type="button" onClick={() => (onDone(), onClose())}>
            Close
          </button>
        </footer>
      </Modal>
    );
  }
  return (
    <FormModal
      title={`Upload CSV: ${source.name}`}
      subtitle={`Header row must contain: ${(source.schemaSpec?.columns ?? []).map((c) => c.name).join(', ')}. A successful load replaces the previously staged rows.`}
      submitLabel="Upload and validate"
      onClose={() => (done.current ? undefined : onClose())}
      onSubmit={async (fd) => {
        const f = fd.get('file');
        if (!(f instanceof File) || !f.size) throw new Error('Choose a CSV file');
        const r = await upload<UploadResult>(D(`/sources/${source.id}/upload`), f);
        done.current = true;
        setResult(r);
        return r;
      }}
    >
      <Field label="CSV file">
        <input className="ops-input" type="file" name="file" accept=".csv,text/csv" required />
      </Field>
    </FormModal>
  );
}

function StagedModal({ source, onClose }: { source: Source; onClose: () => void }) {
  const res = useResource(() => full<{ data: { rowNo: number; key: string; values: Record<string, string | number | null> }[]; total: number; columns: FeedColumn[] }>(D(`/sources/${source.id}/staged?limit=100`)), []);
  return (
    <Modal title={`Staged rows: ${source.name}`} onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res}>
          {(r) => (
            <>
              <p className="ops-muted">{r.total.toLocaleString()} accepted rows from the latest load (first 100 shown).</p>
              <SimpleTable columns={['Row', ...r.columns.map((c) => c.name)]} rows={r.data.map((x) => [x.rowNo, ...r.columns.map((c) => x.values[c.name] ?? null)])} />
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

function RejectedModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const res = useResource(() => full<{ data: { rowNo: number; reason: string; raw: string }[] }>(D(`/jobs/${job.ref}/rejected`)), []);
  return (
    <Modal title={`Rejected rows: ${job.ref}`} onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res}>{(r) => <SimpleTable columns={['Row', 'Reason', 'Content']} rows={r.data.map((x) => [x.rowNo, x.reason, x.raw])} />}</Loaded>
      </div>
    </Modal>
  );
}
