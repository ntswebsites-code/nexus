'use client';

import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { Badge, type NumberingRow, type SettingChange, type SettingRow } from '@/ops/admin-core';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import { Alert, Card, Empty, Field, FormModal, formatDateTime, Loaded, PageHeader, str, useResource } from '@/ops/ui';

type Tab = 'settings' | 'numbering' | 'history';
const AC = (p: string) => v1(`/admin-core${p}`);
const CATEGORIES = ['Feature flags', 'Security', 'Retention', 'Notifications'];
const show = (v: unknown) => (typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v));

export default function SettingsPage() {
  const can = useCan('admin.settings');
  const [tab, setTab] = useState<Tab>('settings');
  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="Settings" />
        <Alert>Your role does not include platform settings. Ask a System Administrator for the admin.settings permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Administration"
        title="Settings"
        subtitle="Platform controls with a full change history. Every change needs a reason and is written to the audit trail; security settings need a fresh authenticator code."
      />
      <TabBar
        tabs={[
          { key: 'settings', label: 'Platform settings' },
          { key: 'numbering', label: 'Numbering' },
          { key: 'history', label: 'Change history' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'settings' && <SettingsTab />}
      {tab === 'numbering' && <NumberingTab />}
      {tab === 'history' && <HistoryTab />}
    </>
  );
}

function SettingsTab() {
  const res = useResource<SettingRow[]>(() => api.get<SettingRow[]>(AC('/settings')), []);
  const [edit, setEdit] = useState<SettingRow | null>(null);
  const [note, setNote] = useState('');
  return (
    <>
      <Alert kind="ok">{note}</Alert>
      <Loaded res={res} what="settings">
        {(rows) => (
          <>
            {CATEGORIES.map((cat) => {
              const list = rows.filter((r) => r.category === cat);
              if (!list.length) return null;
              return (
                <Card key={cat} title={cat}>
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>Setting</th>
                          <th>Value</th>
                          <th>Last changed</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((s) => (
                          <tr key={s.key}>
                            <td>
                              <strong>{s.label}</strong> {!s.enforced && <Badge tone="grey">recorded</Badge>} {s.stepUp && <Badge tone="amber">step-up</Badge>}
                              <div className="ops-muted">{s.help}</div>
                            </td>
                            <td>
                              {s.type === 'boolean' ? <Badge tone={s.value ? 'green' : 'grey'}>{show(s.value)}</Badge> : <strong>{show(s.value)}</strong>}
                              {!s.isDefault && <div className="ops-muted">default {show(s.default)}</div>}
                            </td>
                            <td>{s.updatedAt ? `${formatDateTime(s.updatedAt)} by ${s.updatedBy ?? ''}` : 'Never'}</td>
                            <td className="r">
                              <button className="ops-btn" type="button" onClick={() => setEdit(s)}>
                                Change
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
            <p className="ops-muted">Settings marked recorded are stored with history and shown to other services; enforcement for them is wired up as each module adopts them.</p>
            {edit && (
              <FormModal
                title={edit.label}
                kicker={edit.category}
                subtitle={edit.help}
                submitLabel="Save change"
                onClose={() => setEdit(null)}
                onDone={() => {
                  setNote(`${edit.label} updated.`);
                  res.reload();
                }}
                onSubmit={(fd, key) => {
                  const raw = str(fd, 'value');
                  const value = edit.type === 'boolean' ? raw === 'true' : edit.type === 'int' ? Number(raw) : raw;
                  return api.put(AC(`/settings/${edit.key}`), { value, reason: str(fd, 'reason'), version: edit.version }, { idempotencyKey: key });
                }}
              >
                <Field label="Value" hint={edit.type === 'int' ? `Whole number${edit.min !== null ? `, ${edit.min} to ${edit.max}` : ''}` : undefined}>
                  {edit.type === 'boolean' ? (
                    <select className="ops-input" name="value" defaultValue={String(edit.value)}>
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                  ) : edit.type === 'enum' ? (
                    <select className="ops-input" name="value" defaultValue={String(edit.value)}>
                      {edit.options?.map((o) => (
                        <option key={o} value={o}>
                          {o.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="ops-input" name="value" type="number" step={1} min={edit.min ?? undefined} max={edit.max ?? undefined} defaultValue={Number(edit.value)} required />
                  )}
                </Field>
                <Field label="Reason (recorded in the audit trail)">
                  <textarea className="ops-input" name="reason" required minLength={3} maxLength={500} />
                </Field>
              </FormModal>
            )}
          </>
        )}
      </Loaded>
    </>
  );
}

function NumberingTab() {
  const res = useResource<NumberingRow[]>(() => api.get<NumberingRow[]>(AC('/settings/numbering')), []);
  return (
    <Card title="Reference numbering">
      <p className="ops-muted">Numbers are issued atomically by the database and never reused. Formats are fixed by the platform; the counters only advance.</p>
      <Loaded res={res} what="numbering">
        {(rows) => (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Series</th>
                  <th>Format</th>
                  <th>First</th>
                  <th>Next number</th>
                  <th className="r">Issued</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.kind}>
                    <td>{r.kind.replace(/([A-Z])/g, ' $1').toLowerCase()}</td>
                    <td>
                      <code>
                        {r.prefix}
                        {'#'.repeat(r.pad)}
                      </code>
                    </td>
                    <td>{r.first}</td>
                    <td>{r.next}</td>
                    <td className="r">{r.issued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function HistoryTab() {
  const [key, setKey] = useState('');
  const settings = useResource<SettingRow[]>(() => api.get<SettingRow[]>(AC('/settings')), []);
  const res = useResource<SettingChange[]>(() => api.get<SettingChange[]>(AC(`/settings/history${key ? `?key=${encodeURIComponent(key)}` : ''}`)), [key]);
  return (
    <Card title="Change history">
      <div className="ops-filters">
        <Field label="Setting">
          <select className="ops-input" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">All settings</option>
            {settings.state === 'ok' && settings.data.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="history">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No changes recorded.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Setting</th>
                    <th>Change</th>
                    <th>By</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.changedAt)}</td>
                      <td>
                        {r.label} <span className="ops-muted">v{r.version}</span>
                      </td>
                      <td>
                        {r.before === null || r.before === undefined ? '—' : show(r.before)} → <strong>{show(r.after)}</strong>
                      </td>
                      <td>{r.changedBy}</td>
                      <td>{r.reason}</td>
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
