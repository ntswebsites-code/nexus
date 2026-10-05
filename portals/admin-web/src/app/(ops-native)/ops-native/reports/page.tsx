'use client';

import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import { dayOf, full, label, openLink, Pager, Tone, when } from '@/ops/suite';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, PageHeader, optStr, str, useResource } from '@/ops/ui';

interface ParamSpec {
  name: string;
  label: string;
  type: 'portfolio' | 'fund' | 'date';
  required: boolean;
}
interface Def {
  key: string;
  name: string;
  description: string;
  category: string;
  paramSpec: ParamSpec[];
  runs: number;
  lastRunAt: string | null;
}
interface Run {
  id: string;
  ref: string;
  report: string;
  reportName: string;
  title: string;
  format: string;
  status: string;
  params: Record<string, string>;
  rowCount: number;
  sha256: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  hasFile: boolean;
  distributedAt: string | null;
  distributedBy: string | null;
  scheduleId: string | null;
  deliveredAt: string | null;
  deliveryNote: string | null;
}
interface Schedule {
  id: string;
  name: string;
  report: string;
  reportName: string;
  format: string;
  frequency: string;
  nextRunOn: string | null;
  lastRunAt: string | null;
  active: boolean;
  rolling: string | null;
  recipients: string[];
  emailAttach?: boolean;
  lpDeliver?: boolean;
  lpDeliverApprovedBy?: string | null;
  createdBy: string | null;
}
interface Lookups {
  funds: { id: string; ref: string; name: string }[];
  portfolios: { id: string; ref: string; name: string }[];
  formats: string[];
  frequencies: string[];
  rollingWindows?: string[];
}

type Tab = 'catalogue' | 'runs' | 'schedules';
const PAGE = 25;
const R = (p: string) => v1(`/reports${p}`);

export default function ReportsPage() {
  const canView = useCan('reports.view');
  const [tab, setTab] = useState<Tab>('catalogue');
  const lookups = useResource<Lookups>(() => api.get<Lookups>(R('/lookups')), []);
  if (!canView) {
    return (
      <>
        <PageHeader kicker="Reports" title="Reports & BI" />
        <Alert>You do not have permission to view reports.</Alert>
      </>
    );
  }
  const lk = lookups.state === 'ok' ? lookups.data : { funds: [], portfolios: [], formats: ['CSV', 'JSON', 'HTML', 'PDF'], frequencies: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'], rollingWindows: ['PREVIOUS_DAY', 'TRAILING_30D', 'MONTH_TO_DATE', 'PREVIOUS_MONTH', 'QUARTER_TO_DATE', 'PREVIOUS_QUARTER', 'YEAR_TO_DATE'] };
  return (
    <>
      <PageHeader
        kicker="Reports"
        title="Reports & BI"
        subtitle="Reports are generated from live data, stored with a hash and downloadable as CSV, JSON, print-ready HTML or PDF. Fund reports can be sent to the LP portal by an approver."
      />
      <TabBar
        tabs={[
          { key: 'catalogue', label: 'Catalogue' },
          { key: 'runs', label: 'Generated reports' },
          { key: 'schedules', label: 'Schedules' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'catalogue' && <CatalogueTab lk={lk} onRan={() => setTab('runs')} />}
      {tab === 'runs' && <RunsTab />}
      {tab === 'schedules' && <SchedulesTab lk={lk} />}
    </>
  );
}

function ParamFields({ spec, lk }: { spec: ParamSpec[]; lk: Lookups }) {
  return (
    <>
      {spec.map((p) => (
        <Field key={p.name} label={p.label + (p.required ? '' : ' (optional)')}>
          {p.type === 'date' ? (
            <input className="ops-input" type="date" name={p.name} required={p.required} />
          ) : (
            <select className="ops-input" name={p.name} required={p.required} defaultValue="">
              <option value="">{p.required ? 'Choose...' : 'All'}</option>
              {(p.type === 'fund' ? lk.funds : lk.portfolios).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.ref})
                </option>
              ))}
            </select>
          )}
        </Field>
      ))}
    </>
  );
}
const paramsFrom = (fd: FormData, spec: ParamSpec[]) => Object.fromEntries(spec.map((p) => [p.name, str(fd, p.name)]).filter(([, v]) => v));

function CatalogueTab({ lk, onRan }: { lk: Lookups; onRan: () => void }) {
  const canCreate = useCan('reports.create');
  const defs = useResource<Def[]>(() => api.get<Def[]>(R('/catalogue')), []);
  const [running, setRunning] = useState<Def | null>(null);
  return (
    <Loaded res={defs}>
      {(rows) => (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {rows.map((d) => (
              <Card key={d.key} title={d.name}>
                <p className="ops-muted">{d.description}</p>
                <p className="ops-sub">
                  {d.category} - {d.runs} run{d.runs === 1 ? '' : 's'}
                  {d.lastRunAt ? `, last ${when(d.lastRunAt)}` : ''}
                </p>
                <button className="ops-btn primary" type="button" disabled={!canCreate} title={canCreate ? undefined : 'Needs reports.create'} onClick={() => setRunning(d)}>
                  Generate
                </button>
              </Card>
            ))}
          </div>
          {running && (
            <FormModal
              title={`Generate: ${running.name}`}
              submitLabel="Generate"
              onClose={() => setRunning(null)}
              onSubmit={(fd, key) => api.post(R('/runs'), { key: running.key, format: str(fd, 'format'), params: paramsFrom(fd, running.paramSpec) }, { idempotencyKey: key })}
              onDone={() => {
                defs.reload();
                onRan();
              }}
            >
              <FieldGrid>
                <ParamFields spec={running.paramSpec} lk={lk} />
                <Field label="Format">
                  <select className="ops-input" name="format" defaultValue="CSV">
                    {lk.formats.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </Field>
              </FieldGrid>
            </FormModal>
          )}
        </>
      )}
    </Loaded>
  );
}

function RunsTab() {
  const canDistribute = useCan('reports.approve');
  const canCreate = useCan('reports.create');
  const [emailing, setEmailing] = useState<Run | null>(null);
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState('');
  const res = useResource(() => full<{ data: Run[]; total: number }>(R(`/runs${qs({ report, limit: String(PAGE), offset: String(offset) })}`)), [report, offset]);
  return (
    <Card>
      <div className="ops-filters">
        <Field label="Report">
          <select className="ops-input" value={report} onChange={(e) => (setReport(e.target.value), setOffset(0))}>
            <option value="">All</option>
            {['FACT_SHEET', 'HOLDINGS', 'TRANSACTIONS', 'NAV_PACK', 'CASH'].map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Loaded res={res}>
        {(r) =>
          r.data.length === 0 ? (
            <Empty>No reports generated yet. Use the catalogue to generate one.</Empty>
          ) : (
            <>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Report</th>
                      <th>Generated</th>
                      <th>Rows</th>
                      <th>Status</th>
                      <th>LP portal</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((x) => (
                      <tr key={x.id}>
                        <td>
                          {x.ref}
                          <span className="ops-sub">{x.format}{x.scheduleId ? ', scheduled' : ''}</span>
                        </td>
                        <td>
                          {x.title}
                          <span className="ops-sub">{Object.entries(x.params).map(([k, v]) => `${k}: ${v.length > 12 ? v.slice(0, 8) : v}`).join(', ')}</span>
                        </td>
                        <td>
                          {when(x.createdAt)}
                          <span className="ops-sub">{x.requestedBy}</span>
                        </td>
                        <td>{x.rowCount}</td>
                        <td>
                          <Tone value={x.status} />
                          {x.error && <span className="ops-sub">{x.error}</span>}
                        </td>
                        <td>
                          {x.distributedAt ? <>Sent {dayOf(x.distributedAt)}<span className="ops-sub">{x.distributedBy}</span></> : '-'}
                          {x.deliveryNote && <span className="ops-sub">Email: {x.deliveryNote}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="ops-btn small" type="button" disabled={!x.hasFile} onClick={() => openLink(R(`/runs/${x.id}/link`))}>
                            Download
                          </button>{' '}
                          {canCreate && x.status === 'COMPLETED' && (
                            <>
                              <button className="ops-btn small" type="button" onClick={() => setEmailing(x)}>
                                Email
                              </button>{' '}
                            </>
                          )}
                          {canDistribute && ['FACT_SHEET', 'NAV_PACK'].includes(x.report) && x.status === 'COMPLETED' && !x.distributedAt && (
                            <ActionButton label="Send to LP portal" confirm={`Publish ${x.ref} to every investor with an active commitment in the fund?`} onRun={(key) => api.post(R(`/runs/${x.id}/distribute`), {}, { idempotencyKey: key })} onDone={res.reload} />
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
      {emailing && (
        <FormModal
          title={`Email ${emailing.ref}`}
          subtitle="Recipients receive a link to this screen; they still need to sign in with reports.view to download the file."
          submitLabel="Send"
          onClose={() => setEmailing(null)}
          onSubmit={(fd, k) =>
            api.post(R(`/runs/${emailing.id}/email`), { recipients: str(fd, 'recipients').split(/[\s,;]+/).filter(Boolean), attach: fd.get('attach') === 'on' }, { idempotencyKey: k })
          }
          onDone={res.reload}
        >
          <Field label="Email addresses" hint="Separate with commas (up to 10)">
            <input className="ops-input" name="recipients" required placeholder="name@company.com, other@company.com" />
          </Field>
          <label><input type="checkbox" name="attach" /> Attach the report file (up to 8 MB; otherwise a link only)</label>
        </FormModal>
      )}
    </Card>
  );
}

function SchedulesTab({ lk }: { lk: Lookups }) {
  const canCreate = useCan('reports.create');
  const canDistribute = useCan('reports.approve');
  const defs = useResource<Def[]>(() => api.get<Def[]>(R('/catalogue')), []);
  const res = useResource<Schedule[]>(() => api.get<Schedule[]>(R('/schedules')), []);
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState('HOLDINGS');
  const spec = defs.state === 'ok' ? defs.data.find((d) => d.key === key)?.paramSpec ?? [] : [];
  return (
    <Card
      actions={
        canCreate && (
          <span style={{ display: 'flex', gap: 8 }}>
            <ActionButton label="Run due schedules now" onRun={() => api.post(R('/schedules/run-due'), {})} onDone={res.reload} />
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New schedule
            </button>
          </span>
        )
      }
    >
      <p className="ops-muted">The worker runs due schedules hourly, as the person who created the schedule. Each run is stored under Generated reports.</p>
      <Loaded res={res}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No schedules yet.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Schedule</th>
                    <th>Report</th>
                    <th>Frequency</th>
                    <th>Dates</th>
                    <th>Next run</th>
                    <th>Last run</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.name}
                        <span className="ops-sub">{s.createdBy}</span>
                      </td>
                      <td>
                        {s.reportName}
                        <span className="ops-sub">{s.format}</span>
                      </td>
                      <td>
                        {label(s.frequency)}
                        {s.recipients.length > 0 && <span className="ops-sub">Mails {s.recipients.length}{s.emailAttach ? ' with file' : ''}</span>}
                        {s.lpDeliver && <span className="ops-sub">To LP portal (approved by {s.lpDeliverApprovedBy ?? 'n/a'})</span>}
                      </td>
                      <td>{s.rolling ? label(s.rolling) : 'Fixed dates'}</td>
                      <td title="Schedules run by calendar day. Run now does not move this date.">{s.nextRunOn ? new Date(s.nextRunOn).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-'}</td>
                      <td>{when(s.lastRunAt)}</td>
                      <td>
                        <Tone value={s.active ? 'ACTIVE' : 'PAUSED'} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canCreate && (
                          <>
                            <ActionButton label="Run now" onRun={(k) => api.post(R(`/schedules/${s.id}/run-now`), {}, { idempotencyKey: k })} onDone={res.reload} />{' '}
                            <ActionButton label={s.active ? 'Pause' : 'Resume'} onRun={() => api.patch(R(`/schedules/${s.id}`), { active: !s.active })} onDone={res.reload} />
                          </>
                        )}
                        {canDistribute && ['FACT_SHEET', 'NAV_PACK'].includes(s.report) && (
                          <>
                            {' '}
                            <ActionButton
                              label={s.lpDeliver ? 'Stop LP delivery' : 'Deliver to LP portal'}
                              confirm={s.lpDeliver ? undefined : `Publish every run of "${s.name}" to the investors of the fund automatically? You cannot approve a schedule you created.`}
                              onRun={(k) => api.post(R(`/schedules/${s.id}/lp-delivery`), { enabled: !s.lpDeliver }, { idempotencyKey: k })}
                              onDone={res.reload}
                            />
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
      {creating && (
        <FormModal
          title="New report schedule"
          submitLabel="Create schedule"
          onClose={() => setCreating(false)}
          onSubmit={(fd, k) => api.post(R('/schedules'), { key, name: str(fd, 'name'), format: str(fd, 'format'), frequency: str(fd, 'frequency'), firstRunOn: optStr(fd, 'firstRunOn'), rolling: optStr(fd, 'rolling') ?? null, recipients: str(fd, 'recipients').split(/[\s,;]+/).filter(Boolean), emailAttach: fd.get('emailAttach') === 'on', params: paramsFrom(fd, spec) }, { idempotencyKey: k })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={3} maxLength={160} />
            </Field>
            <Field label="Report">
              <select className="ops-input" value={key} onChange={(e) => setKey(e.target.value)}>
                {(defs.state === 'ok' ? defs.data : []).map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <ParamFields key={key} spec={spec} lk={lk} />
            <Field label="Frequency">
              <select className="ops-input" name="frequency" defaultValue="MONTHLY">
                {lk.frequencies.map((f) => (
                  <option key={f} value={f}>
                    {label(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <select className="ops-input" name="format" defaultValue="CSV">
                {lk.formats.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="First run on (optional)" hint="Defaults to tomorrow">
              <input className="ops-input" type="date" name="firstRunOn" />
            </Field>
            <Field label="Dates for each run" hint="Rolling windows are re-dated at every run">
              <select className="ops-input" name="rolling" defaultValue="PREVIOUS_MONTH">
                <option value="">Fixed dates (as entered above)</option>
                {(lk.rollingWindows ?? []).map((w) => (
                  <option key={w} value={w}>
                    {label(w)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Email each run to (optional)" hint="Comma-separated addresses" span={2}>
              <input className="ops-input" name="recipients" placeholder="name@company.com" />
            </Field>
            <Field label="Attachment" hint="Send the generated file with each email" span={2}>
              <label><input type="checkbox" name="emailAttach" /> Attach the file</label>
            </Field>
          </FieldGrid>
          <p className="ops-muted">With a rolling window the From / To (or As of) dates above are only used for validation; every run recalculates them, so a monthly schedule never repeats last month.</p>
        </FormModal>
      )}
    </Card>
  );
}
