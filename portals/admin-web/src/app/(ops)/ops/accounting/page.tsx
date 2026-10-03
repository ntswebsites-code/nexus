'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import {
  ACCOUNT_TYPES,
  JournalStatusBadge,
  JOURNAL_STATUS_LABEL,
  money2,
  PeriodStatusBadge,
  side,
  TYPE_LABEL,
  type AccountRow,
  type JournalList,
  type Ledger,
  type PeriodDetail,
  type PeriodRow,
  type TrialBalance,
} from '@/ops/accounting';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import type { PortfolioSummary } from '@/ops/types';
import { JournalForm } from '@/ops/JournalForm';
import { Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, PageHeader, str, optStr, useAction, useResource } from '@/ops/ui';

type Tab = 'journals' | 'trial' | 'ledger' | 'periods' | 'accounts';
const PAGE = 25;
const today = () => new Date().toISOString().slice(0, 10);
const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'DISCARDED'];

export default function AccountingPage() {
  const router = useRouter();
  const canView = useCan('valuation.view');
  const [tab, setTab] = useState<Tab>('journals');

  // Notification links arrive as /ops/accounting?journal=<id> or ?period=<id>.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('journal')) router.replace(`/ops/accounting/journals/${encodeURIComponent(sp.get('journal')!)}`);
    else if (sp.get('period')) router.replace(`/ops/accounting/periods/${encodeURIComponent(sp.get('period')!)}`);
  }, [router]);
  const [entity, setEntity] = useState('');
  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const list = portfolios.state === 'ok' ? portfolios.data : [];

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Accounting" title="Accounting & Close" />
        <Alert>Your role does not include valuation. Ask an administrator for the valuation.view permission.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Accounting"
        title="Accounting & Close"
        subtitle="The books of record (ABOR): double-entry journals with a separate poster, trial balance and ledger, and a month-end close that lists every blocker before it locks the period."
      />
      <Card>
        <div className="ops-filters">
          <Field label="Entity (portfolio / fund)">
            <select className="ops-input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">{tab === 'trial' || tab === 'ledger' ? 'Choose an entity' : 'All entities'}</option>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.ref})
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>
      <TabBar
        tabs={[
          { key: 'journals', label: 'Journals' },
          { key: 'trial', label: 'Trial balance' },
          { key: 'ledger', label: 'Account ledger' },
          { key: 'periods', label: 'Periods & close' },
          { key: 'accounts', label: 'Chart of accounts' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'journals' && <JournalsTab entity={entity} portfolios={list} />}
      {tab === 'trial' && <TrialTab entity={entity} />}
      {tab === 'ledger' && <LedgerTab entity={entity} />}
      {tab === 'periods' && <PeriodsTab entity={entity} portfolios={list} />}
      {tab === 'accounts' && <AccountsTab entity={entity} portfolios={list} />}
    </>
  );
}

function PickEntity() {
  return <Empty>Choose an entity above.</Empty>;
}

// ================================================================ journals

function JournalsTab({ entity, portfolios }: { entity: string; portfolios: PortfolioSummary[] }) {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const res = useResource<JournalList>(
    () => apiRequest<JournalList>('GET', v1(`/accounting/journals${qs({ portfolioId: entity, status, from, to, limit: String(PAGE), offset: String(offset) })}`)),
    [entity, status, from, to, offset],
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    setOffset(0);
    set(v);
  };
  return (
    <>
      <Card
        actions={
          <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
            New journal
          </button>
        }
      >
        <div className="ops-filters">
          <Field label="Status">
            <select className="ops-input" value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {JOURNAL_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry date from">
            <input className="ops-input" type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
          </Field>
          <Field label="Entry date to">
            <input className="ops-input" type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
          </Field>
        </div>
        <Loaded res={res} what="journals">
          {(list) => (
            <>
              <p className="ops-muted">
                {list.summary.drafts} draft · {list.summary.pendingApproval} awaiting posting · {list.summary.posted} posted
              </p>
              {list.data.length === 0 ? (
                <Empty>No journals match. Use New journal to book an entry.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Journal</th>
                        <th>Entity</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="r">Amount</th>
                        <th>Status</th>
                        <th>Created by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.map((j) => (
                        <tr key={j.id} className="clickable" onClick={() => router.push(`/ops/accounting/journals/${encodeURIComponent(j.id)}`)}>
                          <td>
                            <strong>{j.ref}</strong>
                            {j.reversalOfRef && <span className="ops-sub">reverses {j.reversalOfRef}</span>}
                          </td>
                          <td>{j.portfolioName}</td>
                          <td>{formatDate(j.entryDate)}</td>
                          <td>{j.description}</td>
                          <td className="r">
                            {money2(j.totalDebit)}
                            <span className="ops-sub">{j.currency}</span>
                          </td>
                          <td>
                            <JournalStatusBadge status={j.status} />
                          </td>
                          <td>{j.makerName ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                <span className="ops-muted">{list.total === 0 ? '0 journals' : `${offset + 1}–${Math.min(offset + PAGE, list.total)} of ${list.total}`}</span>
                <span>
                  <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Previous
                  </button>{' '}
                  <button className="ops-btn small" type="button" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)}>
                    Next
                  </button>
                </span>
              </div>
            </>
          )}
        </Loaded>
      </Card>
      {creating && <JournalForm entity={entity} portfolios={portfolios} onClose={() => setCreating(false)} onDone={(id) => router.push(`/ops/accounting/journals/${encodeURIComponent(id)}`)} />}
    </>
  );
}

// ================================================================ trial balance and ledger

function TrialTab({ entity }: { entity: string }) {
  const [asOf, setAsOf] = useState(today());
  const res = useResource<TrialBalance | null>(() => (entity ? api.get<TrialBalance>(v1(`/accounting/trial-balance${qs({ portfolioId: entity, asOf })}`)) : Promise.resolve(null)), [entity, asOf]);
  return (
    <Card title="Trial balance">
      <div className="ops-filters">
        <Field label="As of">
          <input className="ops-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
      </div>
      {!entity ? (
        <PickEntity />
      ) : (
        <Loaded res={res} what="the trial balance">
          {(tb) =>
            !tb || tb.rows.length === 0 ? (
              <Empty>No accounts or postings for this entity yet.</Empty>
            ) : (
              <>
                {!tb.balanced && <Alert kind="error">The trial balance is out by {money2(tb.difference)}. The period cannot be closed.</Alert>}
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Type</th>
                        <th className="r">Debit</th>
                        <th className="r">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tb.rows.map((r) => (
                        <tr key={r.accountId}>
                          <td>
                            <strong>{r.code}</strong> {r.name}
                          </td>
                          <td>{TYPE_LABEL[r.type] ?? r.type}</td>
                          <td className="r">{side(r.debit)}</td>
                          <td className="r">{side(r.credit)}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 800 }}>
                        <td colSpan={2}>
                          Total {tb.balanced ? <span className="ops-badge green">Balanced</span> : <span className="ops-badge red">Unbalanced</span>}
                        </td>
                        <td className="r">{money2(tb.totalDebit)}</td>
                        <td className="r">{money2(tb.totalCredit)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        </Loaded>
      )}
    </Card>
  );
}

function LedgerTab({ entity }: { entity: string }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const accounts = useResource<AccountRow[]>(() => (entity ? api.get<AccountRow[]>(v1(`/accounting/accounts${qs({ portfolioId: entity })}`)) : Promise.resolve([])), [entity]);
  const res = useResource<Ledger | null>(() => (accountId ? api.get<Ledger>(v1(`/accounting/ledger${qs({ accountId, from, to })}`)) : Promise.resolve(null)), [accountId, from, to]);
  return (
    <Card title="Account ledger">
      <div className="ops-filters">
        <Field label="Account">
          <select className="ops-input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {accounts.state === 'ok' &&
              accounts.data.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="From">
          <input className="ops-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input className="ops-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {!entity ? (
        <PickEntity />
      ) : !accountId ? (
        <Empty>Choose an account to see its postings and running balance.</Empty>
      ) : (
        <Loaded res={res} what="the ledger">
          {(lg) =>
            !lg ? null : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Journal</th>
                      <th>Description</th>
                      <th className="r">Debit</th>
                      <th className="r">Credit</th>
                      <th className="r">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan={5}>Opening balance</td>
                      <td className="r">{money2(lg.openingBalance)}</td>
                    </tr>
                    {lg.lines.map((l, i) => (
                      <tr key={i} className="clickable" onClick={() => router.push(`/ops/accounting/journals/${encodeURIComponent(l.journalId)}`)}>
                        <td>{formatDate(l.entryDate)}</td>
                        <td>{l.ref}</td>
                        <td>
                          {l.description}
                          {l.memo && <span className="ops-sub">{l.memo}</span>}
                        </td>
                        <td className="r">{side(l.debit)}</td>
                        <td className="r">{side(l.credit)}</td>
                        <td className="r">{money2(l.balance)}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 800 }}>
                      <td colSpan={5}>Closing balance</td>
                      <td className="r">{money2(lg.closingBalance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      )}
    </Card>
  );
}

// ================================================================ periods

function PeriodsTab({ entity, portfolios }: { entity: string; portfolios: PortfolioSummary[] }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const res = useResource<PeriodRow[]>(() => api.get<PeriodRow[]>(v1(`/accounting/periods${qs({ portfolioId: entity })}`)), [entity]);
  const month = new Date().toISOString().slice(0, 7);
  return (
    <>
      <Card
        title="Accounting periods"
        actions={
          <button className="ops-btn primary" type="button" onClick={() => setOpening(true)}>
            Open a period
          </button>
        }
      >
        <Loaded res={res} what="periods">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No periods yet. Open a month for an entity to start its close.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Entity</th>
                      <th>Status</th>
                      <th className="r">Unposted journals</th>
                      <th>Closed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className="clickable" onClick={() => router.push(`/ops/accounting/periods/${encodeURIComponent(p.id)}`)}>
                        <td>
                          <strong>{p.month}</strong>
                          <span className="ops-sub">
                            {formatDate(p.periodStart)} to {formatDate(p.periodEnd)}
                          </span>
                        </td>
                        <td>{p.portfolioName}</td>
                        <td>
                          <PeriodStatusBadge status={p.status} />
                        </td>
                        <td className="r">{p.unpostedJournals}</td>
                        <td>{p.closedByName ? `${p.closedByName} ${formatDate(p.closedAt)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {opening && (
        <FormModal
          title="Open an accounting period"
          kicker="Accounting"
          subtitle="Calendar month for one entity. Once a period is closed, no journal can be dated in it."
          submitLabel="Open period"
          onClose={() => setOpening(false)}
          onSubmit={(fd, key) => api.post<PeriodDetail>(v1('/accounting/periods'), { portfolioId: str(fd, 'portfolioId'), month: str(fd, 'month') }, { idempotencyKey: key })}
          onDone={(p) => router.push(`/ops/accounting/periods/${encodeURIComponent((p as PeriodDetail).id)}`)}
        >
          <FieldGrid>
            <Field label="Entity" span={2}>
              <select className="ops-input" name="portfolioId" required defaultValue={entity}>
                <option value="" disabled>
                  Choose an entity
                </option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ref})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Month">
              <input className="ops-input" type="month" name="month" required defaultValue={month} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

// ================================================================ chart of accounts

function AccountsTab({ entity, portfolios }: { entity: string; portfolios: PortfolioSummary[] }) {
  const canPost = useCan('accounting.post');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const res = useResource<AccountRow[]>(() => (entity ? api.get<AccountRow[]>(v1(`/accounting/accounts${qs({ portfolioId: entity })}`)) : Promise.resolve([])), [entity]);
  const action = useAction();
  return (
    <>
      <Card
        title="Chart of accounts"
        actions={
          canPost && entity ? (
            <>
              <button className="ops-btn" type="button" disabled={action.busy} onClick={async () => (await action.run(() => api.post(v1('/accounting/accounts/default-chart'), { portfolioId: entity }))) && res.reload()}>
                Add standard chart
              </button>{' '}
              <button className="ops-btn primary" type="button" onClick={() => setAdding(true)}>
                New account
              </button>
            </>
          ) : undefined
        }
      >
        <Alert>{action.error}</Alert>
        {!entity ? (
          <PickEntity />
        ) : (
          <Loaded res={res} what="accounts">
            {(rows) =>
              rows.length === 0 ? (
                <Empty>No accounts for this entity. {canPost ? 'Add the standard chart or create accounts one by one.' : 'Ask an accountant with posting authority to set up the chart.'}</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.code}</strong>
                          </td>
                          <td>
                            {a.name}
                            {a.description && <span className="ops-sub">{a.description}</span>}
                          </td>
                          <td>{TYPE_LABEL[a.type]}</td>
                          <td>
                            <span className={`ops-badge ${a.isActive ? 'green' : 'grey'}`}>{a.isActive ? 'Active' : 'Inactive'}</span>
                          </td>
                          <td className="r">
                            {canPost && (
                              <button className="ops-btn small" type="button" onClick={() => setEditing(a)}>
                                Edit
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
        )}
      </Card>
      {adding && (
        <FormModal
          title="New account"
          kicker="Chart of accounts"
          submitLabel="Create account"
          onClose={() => setAdding(false)}
          onSubmit={(fd, key) => api.post(v1('/accounting/accounts'), { portfolioId: entity, code: str(fd, 'code'), name: str(fd, 'name'), type: str(fd, 'type'), ...(optStr(fd, 'description') ? { description: optStr(fd, 'description') } : {}) }, { idempotencyKey: key })}
          onDone={res.reload}
        >
          <p className="ops-muted">Entity: {portfolios.find((p) => p.id === entity)?.name}</p>
          <FieldGrid>
            <Field label="Code" hint="Unique within the entity, e.g. 1000">
              <input className="ops-input" name="code" required maxLength={20} />
            </Field>
            <Field label="Type">
              <select className="ops-input" name="type" required defaultValue="ASSET">
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={2} maxLength={160} />
            </Field>
            <Field label="Description" span={2}>
              <input className="ops-input" name="description" maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {editing && (
        <FormModal
          title={`Edit ${editing.code}`}
          kicker="Chart of accounts"
          submitLabel="Save"
          onClose={() => setEditing(null)}
          onSubmit={(fd) => api.patch(v1(`/accounting/accounts/${editing.id}`), { name: str(fd, 'name'), isActive: fd.get('isActive') === 'on' })}
          onDone={res.reload}
        >
          <FieldGrid>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={2} maxLength={160} defaultValue={editing.name} />
            </Field>
            <Field label="Active" hint="Inactive accounts cannot be used in new journals">
              <input type="checkbox" name="isActive" defaultChecked={editing.isActive} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
