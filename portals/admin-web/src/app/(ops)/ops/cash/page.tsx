'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import {
  CashBadge,
  EXPECTATION_KINDS,
  JOURNAL_STATUSES,
  label,
  money2,
  RESERVATION_PURPOSES,
  type Balances,
  type CashJournalList,
  type CloseDetail,
  type CloseRow,
  type ExpectationRow,
  type Explain,
  type ImportDetail,
  type ImportRow,
  type LedgerRow,
  type ReservationRow,
} from '@/ops/cash';
import { CashJournalForm } from '@/ops/CashJournalForm';
import { TabBar } from '@/ops/recon/common';
import { useCan } from '@/ops/session';
import type { PortfolioSummary } from '@/ops/types';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, Modal, PageHeader, str, optStr, useAction, useResource } from '@/ops/ui';

type Tab = 'balances' | 'journals' | 'reservations' | 'expected' | 'imports' | 'close';
const PAGE = 25;
const today = () => new Date().toISOString().slice(0, 10);

export default function CashPage() {
  const router = useRouter();
  const canView = useCan('cash.view');
  const [tab, setTab] = useState<Tab>('balances');
  const [entity, setEntity] = useState('');
  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const list = portfolios.state === 'ok' ? portfolios.data : [];

  // Notification links arrive as /ops/cash?journal=<id>, ?import=<id> or ?close=<id>.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('journal')) router.replace(`/ops/cash/journals/${encodeURIComponent(sp.get('journal')!)}`);
    else if (sp.get('import')) router.replace(`/ops/cash/imports/${encodeURIComponent(sp.get('import')!)}`);
    else if (sp.get('close')) router.replace(`/ops/cash/closes/${encodeURIComponent(sp.get('close')!)}`);
    else if (sp.get('tab') === 'reservations') setTab('reservations'); // order ticket -> its cash hold
  }, [router]);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Cash" title="Cash & Ledgers" />
        <Alert>Your role does not include cash. Ask an administrator for the cash.view permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader
        kicker="Cash"
        title="Cash & Ledgers"
        subtitle="Cash ownership, reservations and forecasts. Balances are derived from posted journals, never edited; statements are evidence, committed by a checker."
      />
      <Card>
        <div className="ops-filters">
          <Field label="Portfolio">
            <select className="ops-input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">{tab === 'close' ? 'All portfolios' : 'All portfolios'}</option>
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
          { key: 'balances', label: 'Balances' },
          { key: 'journals', label: 'Cash ledger' },
          { key: 'reservations', label: 'Reservations' },
          { key: 'expected', label: 'Expected cash' },
          { key: 'imports', label: 'Statement imports' },
          { key: 'close', label: 'Period close' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'balances' && <BalancesTab entity={entity} />}
      {tab === 'journals' && <JournalsTab entity={entity} portfolios={list} />}
      {tab === 'reservations' && <ReservationsTab entity={entity} />}
      {tab === 'expected' && <ExpectedTab entity={entity} />}
      {tab === 'imports' && <ImportsTab entity={entity} />}
      {tab === 'close' && <CloseTab entity={entity} portfolios={list} />}
    </>
  );
}

const useLedgers = (entity: string, kind?: string) =>
  useResource<{ data: LedgerRow[] }>(() => api.get<{ data: LedgerRow[] }>(v1(`/cash/ledgers${qs({ portfolioId: entity, kind, status: 'ACTIVE' })}`)), [entity, kind]);

// ================================================================ balances

function BalancesTab({ entity }: { entity: string }) {
  const canSetUp = useCan('cash.journal.approve');
  const [asOf, setAsOf] = useState(today());
  const [explain, setExplain] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const res = useResource<Balances>(() => api.get<Balances>(v1(`/cash/balances${qs({ portfolioId: entity, asOf })}`)), [entity, asOf]);
  return (
    <>
      <Card
        title="Cash by state"
        actions={
          canSetUp && entity ? (
            <button className="ops-btn" type="button" onClick={() => setSetup(true)}>
              Add standard ledgers
            </button>
          ) : undefined
        }
      >
        <div className="ops-filters">
          <Field label="As of" hint="Posted cash is rebuilt to this date; reservations and expectations are current">
            <input className="ops-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        <Loaded res={res} what="balances">
          {(b) =>
            b.ledgers.length === 0 ? (
              <Empty>No bank ledgers yet. Pick a portfolio and add the standard ledgers.</Empty>
            ) : (
              <>
                <p className="ops-muted">
                  Available = posted − reserved − minimum buffer ({b.calculation}). {b.note}
                </p>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Ledger</th>
                        <th>Portfolio</th>
                        <th className="r">Posted</th>
                        <th className="r">Reserved</th>
                        <th className="r">Buffer</th>
                        <th className="r">Available</th>
                        <th className="r">Expected net</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {b.ledgers.map((l) => (
                        <tr key={l.ledgerId}>
                          <td>
                            <strong>{l.name}</strong>
                            <span className="ops-sub">
                              {l.ref} · {l.currency} {l.status !== 'ACTIVE' && <CashBadge status={l.status} />}
                            </span>
                          </td>
                          <td>{l.portfolioName}</td>
                          <td className="r">{money2(l.posted)}</td>
                          <td className="r">{money2(l.reserved)}</td>
                          <td className="r">{money2(l.minBuffer)}</td>
                          <td className="r">
                            <strong>{money2(l.available)}</strong>
                          </td>
                          <td className="r">{money2(l.expectedNet)}</td>
                          <td>
                            <button className="ops-btn small" type="button" onClick={() => setExplain(l.ledgerId)}>
                              Explain
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {b.totals.length > 1 && (
                  <p className="ops-muted">
                    {b.totals.map((t) => `${t.portfolioName ?? ''} ${t.currency}: posted ${money2(t.posted)}, available ${money2(t.available)}`).join(' · ')}
                  </p>
                )}
              </>
            )
          }
        </Loaded>
      </Card>
      {explain && <ExplainModal ledgerId={explain} asOf={asOf} onClose={() => setExplain(null)} />}
      {setup && (
        <FormModal
          title="Add standard cash ledgers"
          kicker="Cash & Ledgers"
          subtitle="Bank account, client cash control, settlement clearing, suspense and fees, in the portfolio base currency unless you choose another. Existing names are left alone."
          submitLabel="Add ledgers"
          onClose={() => setSetup(false)}
          onSubmit={() => api.post(v1('/cash/ledgers/default-set'), { portfolioId: entity })}
          onDone={() => res.reload()}
        />
      )}
    </>
  );
}

function ExplainModal({ ledgerId, asOf, onClose }: { ledgerId: string; asOf: string; onClose: () => void }) {
  const res = useResource<Explain>(() => api.get<Explain>(v1(`/cash/balances/explain${qs({ ledgerId, asOf })}`)), [ledgerId, asOf]);
  return (
    <Modal title="Cash balance explanation" kicker="Cash & Ledgers" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="the explanation">
          {(x) => (
            <>
              <p>
                <strong>{x.name}</strong> ({x.ref}, {x.currency}) as of {formatDate(asOf)}. {x.formula}.
              </p>
              <p>
                Posted {money2(x.posted)} − reserved {money2(x.reserved)} − buffer {money2(x.minBuffer)} = <strong>available {money2(x.available)}</strong>
              </p>
              <h3>Posted journal lines</h3>
              {x.journalLines.length === 0 ? (
                <Empty>No posted lines.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Journal</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="r">Cash effect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {x.journalLines.map((l, i) => (
                        <tr key={i}>
                          <td>{l.ref}</td>
                          <td>{formatDate(l.entryDate)}</td>
                          <td>{l.description}</td>
                          <td className="r">{money2(l.signed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h3>Live reservations</h3>
              {x.reservations.length === 0 ? (
                <Empty>No live reservations.</Empty>
              ) : (
                <ul>
                  {x.reservations.map((r) => (
                    <li key={r.id}>
                      {r.ref} · {r.source} · {label(r.purpose)}: {money2(r.remaining)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ journals

function JournalsTab({ entity, portfolios }: { entity: string; portfolios: PortfolioSummary[] }) {
  const router = useRouter();
  const canCreate = useCan('cash.journal.create');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const res = useResource<CashJournalList>(() => apiRequest<CashJournalList>('GET', v1(`/cash/journals${qs({ portfolioId: entity, status, limit: String(PAGE), offset: String(offset) })}`)), [entity, status, offset]);
  return (
    <>
      <Card
        actions={
          canCreate ? (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New controlled journal
            </button>
          ) : undefined
        }
      >
        <div className="ops-filters">
          <Field label="Status">
            <select
              className="ops-input"
              value={status}
              onChange={(e) => {
                setOffset(0);
                setStatus(e.target.value);
              }}
            >
              <option value="">All statuses</option>
              {JOURNAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Loaded res={res} what="journals">
          {(l) => (
            <>
              <p className="ops-muted">
                {l.summary.drafts} draft · {l.summary.pendingApproval} awaiting approval · {l.summary.posted} posted
              </p>
              {l.data.length === 0 ? (
                <Empty>No journals match.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Journal</th>
                        <th>Source / purpose</th>
                        <th>Portfolio</th>
                        <th>Value date</th>
                        <th className="r">Amount</th>
                        <th>Status</th>
                        <th>Maker / checker</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.data.map((j) => (
                        <tr key={j.id} className="clickable" onClick={() => router.push(`/ops/cash/journals/${encodeURIComponent(j.id)}`)}>
                          <td>
                            <strong>{j.ref}</strong>
                            {j.reversalOfRef && <span className="ops-sub">reverses {j.reversalOfRef}</span>}
                          </td>
                          <td>
                            {j.sourceRef ?? '—'}
                            <span className="ops-sub">{label(j.purpose)}</span>
                          </td>
                          <td>{j.portfolioName}</td>
                          <td>{formatDate(j.entryDate)}</td>
                          <td className="r">
                            {money2(j.totalDebit)}
                            <span className="ops-sub">{j.currency}</span>
                          </td>
                          <td>
                            <CashBadge status={j.status} />
                          </td>
                          <td>
                            {j.makerName ?? '—'} / {j.postedByName ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                <span className="ops-muted">{l.total === 0 ? '0 journals' : `${offset + 1}–${Math.min(offset + PAGE, l.total)} of ${l.total}`}</span>
                <span>
                  <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Previous
                  </button>{' '}
                  <button className="ops-btn small" type="button" disabled={offset + PAGE >= l.total} onClick={() => setOffset(offset + PAGE)}>
                    Next
                  </button>
                </span>
              </div>
            </>
          )}
        </Loaded>
      </Card>
      {creating && <CashJournalForm entity={entity} portfolios={portfolios} onClose={() => setCreating(false)} onDone={(id) => router.push(`/ops/cash/journals/${encodeURIComponent(id)}`)} />}
    </>
  );
}

// ================================================================ reservations

function ReservationsTab({ entity }: { entity: string }) {
  const canHold = useCan('cash.reservation', 'cash.journal.create');
  const canApprove = useCan('cash.journal.approve');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState<ReservationRow | null>(null);
  const [consuming, setConsuming] = useState<ReservationRow | null>(null);
  const ledgers = useLedgers(entity, 'BANK');
  const res = useResource<{ data: ReservationRow[]; summary: { active: number; remaining: string } }>(() => api.get(v1(`/cash/reservations${qs({ portfolioId: entity, status })}`)), [entity, status]);
  const canConsume = useCan('cash.journal.create');
  return (
    <>
      <Card
        title="Cash reservations"
        actions={
          <>
            {canApprove && (
              <ActionButton label="Sweep expired" onRun={() => api.post(v1('/cash/reservations/expire-sweep'), {})} onDone={res.reload} />
            )}{' '}
            {canHold && (
              <button className="ops-btn primary" type="button" onClick={() => setCreating(true)} disabled={!entity}>
                New reservation
              </button>
            )}
          </>
        }
      >
        <p className="ops-muted">Commitments reduce availability without changing posted cash. Release never deletes a reservation.{!entity && ' Pick a portfolio to create one.'}</p>
        <div className="ops-filters">
          <Field label="Status">
            <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['ACTIVE', 'PARTIALLY_CONSUMED', 'CONSUMED', 'RELEASED', 'EXPIRED'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Loaded res={res} what="reservations">
          {(r) =>
            r.data.length === 0 ? (
              <Empty>No reservations.</Empty>
            ) : (
              <>
                <p className="ops-muted">
                  {r.summary.active} live · {money2(r.summary.remaining)} held
                </p>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Reservation</th>
                        <th>Source / purpose</th>
                        <th>Ledger</th>
                        <th className="r">Original</th>
                        <th className="r">Consumed</th>
                        <th className="r">Remaining</th>
                        <th>Required / expiry</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.data.map((x) => (
                        <tr key={x.id}>
                          <td>
                            <strong>{x.ref}</strong>
                            <span className="ops-sub">{x.createdByName}</span>
                          </td>
                          <td>
                            {x.source}
                            <span className="ops-sub">{label(x.purpose)}</span>
                          </td>
                          <td>{x.ledgerName}</td>
                          <td className="r">{money2(x.amount)}</td>
                          <td className="r">{money2(x.consumed)}</td>
                          <td className="r">
                            <strong>{money2(x.remaining)}</strong>
                          </td>
                          <td>
                            {formatDate(x.requiredDate)}
                            <span className="ops-sub">{x.expiresOn ? `expires ${formatDate(x.expiresOn)}${x.lapsed ? ' (lapsed)' : ''}` : 'no expiry'}</span>
                          </td>
                          <td>
                            <CashBadge status={x.status} />
                          </td>
                          <td>
                            {(x.status === 'ACTIVE' || x.status === 'PARTIALLY_CONSUMED') && (
                              <>
                                {canConsume && (
                                  <button className="ops-btn small" type="button" onClick={() => setConsuming(x)}>
                                    Consume
                                  </button>
                                )}{' '}
                                {canHold && (
                                  <button className="ops-btn small danger" type="button" onClick={() => setReleasing(x)}>
                                    Release
                                  </button>
                                )}
                              </>
                            )}
                            {x.releaseReason && <span className="ops-sub">{x.releaseReason}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        </Loaded>
      </Card>
      {creating && (
        <FormModal
          title="New cash reservation"
          kicker="Cash & Ledgers"
          subtitle="The amount is checked against live available cash under a lock, so two holds cannot overspend the same account."
          submitLabel="Reserve cash"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post(
              v1('/cash/reservations'),
              {
                ledgerId: str(fd, 'ledgerId'),
                source: str(fd, 'source'),
                purpose: str(fd, 'purpose'),
                amount: str(fd, 'amount').replace(/,/g, ''),
                requiredDate: optStr(fd, 'requiredDate'),
                expiresOn: optStr(fd, 'expiresOn') ?? null,
                orderId: optStr(fd, 'orderId') ?? null,
              },
              { idempotencyKey: key },
            )
          }
          onDone={() => res.reload()}
        >
          <FieldGrid>
            <Field label="Bank ledger" span={2}>
              <select className="ops-input" name="ledgerId" required>
                <option value="">Choose</option>
                {ledgers.state === 'ok' &&
                  ledgers.data.data.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.ref} {l.name} ({l.currency})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Source event" hint="e.g. ORDER-784">
              <input className="ops-input" name="source" required minLength={2} maxLength={80} />
            </Field>
            <Field label="Purpose">
              <select className="ops-input" name="purpose">
                {RESERVATION_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <input className="ops-input" name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Order id (optional)">
              <input className="ops-input" name="orderId" maxLength={36} />
            </Field>
            <Field label="Required date">
              <input className="ops-input" type="date" name="requiredDate" defaultValue={today()} />
            </Field>
            <Field label="Expires on">
              <input className="ops-input" type="date" name="expiresOn" />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {releasing && (
        <FormModal
          title={`Release ${releasing.ref}`}
          kicker="Cash & Ledgers"
          subtitle="Frees the remaining hold. Releasing someone else's reservation needs the approve permission."
          submitLabel="Release"
          danger
          onClose={() => setReleasing(null)}
          onSubmit={(fd, key) => api.post(v1(`/cash/reservations/${releasing.id}/release`), { reason: str(fd, 'reason') }, { idempotencyKey: key })}
          onDone={() => res.reload()}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
      {consuming && (
        <FormModal
          title={`Consume ${consuming.ref}`}
          kicker="Cash & Ledgers"
          subtitle={`Remaining ${money2(consuming.remaining)} ${consuming.currency}. Settlement consumes the hold; a settlement journal linked to it does this on posting.`}
          submitLabel="Consume"
          onClose={() => setConsuming(null)}
          onSubmit={(fd, key) => api.post(v1(`/cash/reservations/${consuming.id}/consume`), { amount: str(fd, 'amount').replace(/,/g, '') }, { idempotencyKey: key })}
          onDone={() => res.reload()}
        >
          <Field label="Amount">
            <input className="ops-input" name="amount" inputMode="decimal" required defaultValue={consuming.remaining} />
          </Field>
        </FormModal>
      )}
    </>
  );
}

// ================================================================ expected cash

function ExpectedTab({ entity }: { entity: string }) {
  const canCreate = useCan('cash.journal.create');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<ExpectationRow | null>(null);
  const ledgers = useLedgers(entity, 'BANK');
  const res = useResource<{ data: ExpectationRow[]; summary: { open: number; expectedNet: string; due: number } }>(() => api.get(v1(`/cash/expectations${qs({ portfolioId: entity, status })}`)), [entity, status]);
  return (
    <>
      <Card
        title="Expected cash movements"
        actions={
          canCreate ? (
            <button className="ops-btn primary" type="button" disabled={!entity} onClick={() => setCreating(true)}>
              Add expected movement
            </button>
          ) : undefined
        }
      >
        <p className="ops-muted">Forecasts only: they never change available cash. An expectation turns POSTED when the journal linked to it posts.{!entity && ' Pick a portfolio to add one.'}</p>
        <div className="ops-filters">
          <Field label="Status">
            <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {['EXPECTED', 'DUE', 'POSTED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Loaded res={res} what="expectations">
          {(r) =>
            r.data.length === 0 ? (
              <Empty>No expected movements.</Empty>
            ) : (
              <>
                <p className="ops-muted">
                  {r.summary.open} open · expected net {money2(r.summary.expectedNet)} · {r.summary.due} due
                </p>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Expectation</th>
                        <th>Kind / source</th>
                        <th>Ledger</th>
                        <th>Expected</th>
                        <th className="r">Amount</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.data.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.ref}</strong>
                          </td>
                          <td>
                            {label(e.kind)}
                            <span className="ops-sub">{e.source ?? ''}</span>
                          </td>
                          <td>{e.ledgerName}</td>
                          <td>{formatDate(e.expectedDate)}</td>
                          <td className="r">
                            {e.direction === 'IN' ? '+' : '-'}
                            {money2(e.amount)} <span className="ops-sub">{e.currency}</span>
                          </td>
                          <td>
                            <CashBadge status={e.status} />
                          </td>
                          <td>
                            {canCreate && (e.status === 'EXPECTED' || e.status === 'DUE') && (
                              <button className="ops-btn small" type="button" onClick={() => setCancelling(e)}>
                                Cancel
                              </button>
                            )}
                            {e.journalId && (
                              <a className="ops-btn small" href={`/ops/cash/journals/${e.journalId}`}>
                                Journal
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }
        </Loaded>
      </Card>
      {creating && (
        <FormModal
          title="Add expected movement"
          kicker="Cash & Ledgers"
          submitLabel="Add"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post(
              v1('/cash/expectations'),
              { ledgerId: str(fd, 'ledgerId'), direction: str(fd, 'direction'), kind: str(fd, 'kind'), source: optStr(fd, 'source') ?? null, amount: str(fd, 'amount').replace(/,/g, ''), expectedDate: str(fd, 'expectedDate'), note: optStr(fd, 'note') ?? null },
              { idempotencyKey: key },
            )
          }
          onDone={() => res.reload()}
        >
          <FieldGrid>
            <Field label="Bank ledger" span={2}>
              <select className="ops-input" name="ledgerId" required>
                <option value="">Choose</option>
                {ledgers.state === 'ok' &&
                  ledgers.data.data.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.ref} {l.name} ({l.currency})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Direction">
              <select className="ops-input" name="direction">
                <option value="IN">Cash in</option>
                <option value="OUT">Cash out</option>
              </select>
            </Field>
            <Field label="Kind">
              <select className="ops-input" name="kind" defaultValue="OTHER">
                {EXPECTATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {label(k)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount">
              <input className="ops-input" name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Expected date">
              <input className="ops-input" type="date" name="expectedDate" required defaultValue={today()} />
            </Field>
            <Field label="Source" span={2}>
              <input className="ops-input" name="source" maxLength={80} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {cancelling && (
        <FormModal
          title={`Cancel ${cancelling.ref}`}
          kicker="Cash & Ledgers"
          submitLabel="Cancel expectation"
          danger
          onClose={() => setCancelling(null)}
          onSubmit={(fd) => api.post(v1(`/cash/expectations/${cancelling.id}/cancel`), { reason: str(fd, 'reason') })}
          onDone={() => res.reload()}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
          </Field>
        </FormModal>
      )}
    </>
  );
}

// ================================================================ statement imports

function ImportsTab({ entity }: { entity: string }) {
  const router = useRouter();
  const canImport = useCan('cash.import');
  const [uploading, setUploading] = useState(false);
  const res = useResource<{ data: ImportRow[] }>(() => api.get<{ data: ImportRow[] }>(v1(`/cash/statement-imports${qs({ portfolioId: entity })}`)), [entity]);
  return (
    <>
      <Card
        title="Statement imports"
        actions={
          canImport ? (
            <button className="ops-btn primary" type="button" onClick={() => setUploading(true)}>
              Upload external statement
            </button>
          ) : undefined
        }
      >
        <p className="ops-muted">A statement is staged first (it must foot and be new), then a different person commits it. Nothing is written to the ledger.</p>
        <Loaded res={res} what="statement imports">
          {(r) =>
            r.data.length === 0 ? (
              <Empty>No statements uploaded.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Import</th>
                      <th>Ledger</th>
                      <th>Period</th>
                      <th className="r">Opening</th>
                      <th className="r">Closing</th>
                      <th className="r">Lines</th>
                      <th>Status</th>
                      <th>Maker / checker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => router.push(`/ops/cash/imports/${encodeURIComponent(i.id)}`)}>
                        <td>
                          <strong>{i.ref}</strong>
                          <span className="ops-sub">{i.filename}</span>
                        </td>
                        <td>{i.ledgerName}</td>
                        <td>
                          {formatDate(i.statementFrom)} to {formatDate(i.statementTo)}
                        </td>
                        <td className="r">{money2(i.openingBalance)}</td>
                        <td className="r">{money2(i.closingBalance)}</td>
                        <td className="r">
                          {i.lineCount}
                          {i.status === 'COMMITTED' && i.unmatchedLines > 0 && <span className="ops-sub">{i.unmatchedLines} unmatched</span>}
                        </td>
                        <td>
                          <CashBadge status={i.status} />
                        </td>
                        <td>
                          {i.makerName ?? '—'} / {i.checkerName ?? '—'}
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
      {uploading && <UploadModal entity={entity} onClose={() => setUploading(false)} onDone={(id) => router.push(`/ops/cash/imports/${encodeURIComponent(id)}`)} />}
    </>
  );
}

function UploadModal({ entity, onClose, onDone }: { entity: string; onClose: () => void; onDone: (id: string) => void }) {
  const ledgers = useLedgers(entity, 'BANK');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const action = useAction();
  const [ledgerId, setLedgerId] = useState('');
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const isJson = !!file && file.name.toLowerCase().endsWith('.json');
  async function pick(f: File | undefined) {
    setFile(f ? { name: f.name, text: await f.text() } : null);
  }
  async function submit() {
    if (!file) return;
    const out = await action.run((key) =>
      api.post<ImportDetail>(
        v1('/cash/statement-imports'),
        { ledgerId, filename: file.name, format: isJson ? 'JSON' : 'CSV', content: file.text, ...(opening ? { openingBalance: opening.replace(/,/g, '') } : {}), ...(closing ? { closingBalance: closing.replace(/,/g, '') } : {}) },
        { idempotencyKey: key },
      ),
    );
    if (out) {
      onClose();
      onDone(out.id);
    }
  }
  return (
    <Modal title="Upload external statement" kicker="Cash & Ledgers" subtitle="CSV with a header row (date, amount or credit/debit, reference, description) or JSON { openingBalance, closingBalance, lines }. Positive amounts are cash in." onClose={onClose}>
      <div className="ops-modal-body">
        <FieldGrid>
          <Field label="Bank ledger" span={2}>
            <select className="ops-input" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
              <option value="">Choose</option>
              {ledgers.state === 'ok' &&
                ledgers.data.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.ref} {l.name} ({l.currency})
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Statement file" span={2}>
            <input className="ops-input" type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => void pick(e.target.files?.[0])} />
          </Field>
          <Field label="Opening balance" hint={isJson ? 'Optional: read from the file' : 'Required for CSV'}>
            <input className="ops-input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <Field label="Closing balance" hint={isJson ? 'Optional: read from the file' : 'Required for CSV'}>
            <input className="ops-input" inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} />
          </Field>
        </FieldGrid>
        <Alert>{action.error}</Alert>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose} disabled={action.busy}>
          Cancel
        </button>
        <button className="ops-btn primary" type="button" onClick={submit} disabled={action.busy || !file || !ledgerId}>
          {action.busy ? 'Working…' : 'Stage statement'}
        </button>
      </footer>
    </Modal>
  );
}

// ================================================================ period close

function CloseTab({ entity, portfolios }: { entity: string; portfolios: PortfolioSummary[] }) {
  const router = useRouter();
  const canClose = useCan('cash.close');
  const [preparing, setPreparing] = useState(false);
  const res = useResource<{ data: CloseRow[] }>(() => api.get<{ data: CloseRow[] }>(v1(`/cash/period-closes${qs({ portfolioId: entity })}`)), [entity]);
  return (
    <>
      <Card
        title="Cash period close"
        actions={
          canClose ? (
            <button className="ops-btn primary" type="button" onClick={() => setPreparing(true)}>
              Prepare a close
            </button>
          ) : undefined
        }
      >
        <p className="ops-muted">A close needs statement coverage, balances within tolerance, clear suspense, no aged items, all journals posted and an independent checker. Every blocker is listed together.</p>
        <Loaded res={res} what="closes">
          {(r) =>
            r.data.length === 0 ? (
              <Empty>No closes yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Period end</th>
                      <th>Portfolio</th>
                      <th>Status</th>
                      <th>Prepared / approved</th>
                      <th>Closed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => router.push(`/ops/cash/closes/${encodeURIComponent(c.id)}`)}>
                        <td>
                          <strong>{formatDate(c.periodEnd)}</strong>
                        </td>
                        <td>{c.portfolioName}</td>
                        <td>
                          <CashBadge status={c.status} />
                        </td>
                        <td>
                          {c.preparedByName ?? '—'} / {c.approvedByName ?? '—'}
                        </td>
                        <td>{c.closedByName ? `${c.closedByName} ${formatDate(c.closedAt)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {preparing && (
        <FormModal
          title="Prepare a cash close"
          kicker="Cash & Ledgers"
          subtitle="Creates the close for a date. A different person approves it, then it can be closed once the pre-check is clean."
          submitLabel="Prepare close"
          onClose={() => setPreparing(false)}
          onSubmit={(fd, key) => api.post<CloseDetail>(v1('/cash/period-closes'), { portfolioId: str(fd, 'portfolioId'), periodEnd: str(fd, 'periodEnd') }, { idempotencyKey: key })}
          onDone={(c) => router.push(`/ops/cash/closes/${encodeURIComponent((c as CloseDetail).id)}`)}
        >
          <FieldGrid>
            <Field label="Portfolio" span={2}>
              <select className="ops-input" name="portfolioId" required defaultValue={entity}>
                <option value="">Choose</option>
                {portfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ref})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Close up to and including">
              <input className="ops-input" type="date" name="periodEnd" required defaultValue={today()} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
