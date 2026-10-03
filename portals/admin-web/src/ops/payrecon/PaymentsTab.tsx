'use client';

import { useState } from 'react';
import { api, apiRequest, qs, v1 } from '../api';
import { formatDecimal } from '../money';
import { ActionButton, Alert, Card, DateText, Empty, Field, FieldGrid, FormModal, Loaded, Modal, optStr, str, useResource } from '../ui';
import { Tone, useStaffUsers } from '../recon/common';
import { KIND_LABEL, RESOLUTION_LABEL, daysAgo, today, type FundOption, type PayBreak, type PayBreakDetail, type PayItem, type PayRun, type PaySummary, type StatementLine } from './types';

export const pay = (path: string) => v1(`/ops-controls/pay-recon${path}`);

const dec = (v: string | null | undefined, cur?: string | null) => (v === null || v === undefined ? '—' : `${formatDecimal(v, 2)}${cur ? ` ${cur}` : ''}`);

// ------------------------------------------------------------------ overview and run

export function PayOverview({ canManage, stamp, onChanged }: { canManage: boolean; stamp: number; onChanged: () => void }) {
  const summary = useResource<PaySummary>(() => api.get<PaySummary>(pay('/summary')), [stamp]);
  const runs = useResource<PayRun[]>(() => api.get<PayRun[]>(pay('/runs?limit=15')), [stamp]);
  const funds = useResource<FundOption[]>(() => api.get<FundOption[]>(pay('/funds')), []);
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [fundId, setFundId] = useState('');
  const [last, setLast] = useState<string | null>(null);

  return (
    <>
      <Loaded res={summary} what="summary">
        {(s) => (
          <div className="ops-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
            <Card title="Expected payments">
              <strong>{Object.values(s.items).reduce((a, b) => a + b, 0)}</strong>
              <div className="ops-muted">{s.items.MATCHED ?? 0} matched, {s.items.BREAK ?? 0} in break, {s.items.NOT_DUE ?? 0} not due</div>
            </Card>
            <Card title="Open breaks">
              <strong>{s.openBreaks}</strong>
              <div className="ops-muted">{s.materialOpen} Critical or High, oldest {s.oldestAgeDays}d</div>
            </Card>
            <Card title="Awaiting a checker">
              <strong>{s.pendingChecker}</strong>
              <div className="ops-muted">resolved, not yet approved</div>
            </Card>
            <Card title="Last run">
              {s.lastRun ? (
                <>
                  <strong>{s.lastRun.ref}</strong> <Tone value={s.lastRun.status} />
                  <div className="ops-muted">{s.lastRun.from} to {s.lastRun.to}</div>
                </>
              ) : (
                <div className="ops-muted">No run yet</div>
              )}
            </Card>
          </div>
        )}
      </Loaded>

      <Card title="Run payments matching">
        <p className="ops-muted" style={{ marginTop: 0 }}>
          Pairs each investor's share of an issued distribution (money out) and capital call (money in) with the committed bank statement lines. A pair is made on the document reference, or on an exact amount near the due date when the line carries no reference. A payment with no line stays "not due" until two days after its due date, and is only a break when a statement covers that date. Running the same window again refreshes the same run.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="ops-muted">From <input className="ops-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 160 }} /></label>
          <label className="ops-muted">To <input className="ops-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 160 }} /></label>
          <select className="ops-input" value={fundId} onChange={(e) => setFundId(e.target.value)} aria-label="Fund" style={{ maxWidth: 240 }}>
            <option value="">All funds</option>
            {(funds.state === 'ok' ? funds.data : []).map((f) => (
              <option key={f.id} value={f.id}>{f.ref} {f.name}</option>
            ))}
          </select>
          <ActionButton
            label="Run matching"
            primary
            disabled={!canManage || !from || !to}
            title={canManage ? undefined : 'Your role does not include recon.manage'}
            onRun={async (key) => {
              const r = await apiRequest<{ data: PayRun; rerun: boolean }>('POST', pay('/runs'), { fundId: fundId || null, from, to }, { idempotencyKey: key });
              setLast(`${r.data.ref} ${r.rerun ? 're-run' : 'created'}: ${r.data.matchedCount} matched, ${r.data.breakCount} open break${r.data.breakCount === 1 ? '' : 's'}, ${r.data.notDueCount} not due.`);
            }}
            onDone={onChanged}
          />
        </div>
        {last && <Alert kind="ok">{last}</Alert>}
      </Card>

      <Card title="Recent runs">
        <Loaded res={runs} what="runs">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No runs yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Run</th><th>Window</th><th>Fund</th><th className="r">Payments</th><th className="r">Matched</th><th className="r">Open breaks</th><th className="r">Not due</th><th>Status</th><th>By</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.ref}<span className="ops-sub">run {r.runCount}x</span></td>
                        <td>{r.from} to {r.to}</td>
                        <td>{r.fund ? r.fund.name : 'All funds'}</td>
                        <td className="r">{r.itemCount}</td>
                        <td className="r">{r.matchedCount}</td>
                        <td className="r">{r.breakCount}</td>
                        <td className="r">{r.notDueCount}</td>
                        <td>
                          <Tone value={r.status} />
                          {r.status === 'NO_STATEMENTS' && <span className="ops-sub">no committed statement lines</span>}
                          {!!r.summary?.awaitingStatement?.length && <span className="ops-sub">{r.summary.awaitingStatement.length} awaiting a statement</span>}
                        </td>
                        <td>{r.runByName ?? '—'}<span className="ops-sub"><DateText value={r.updatedAt} time /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ items

export function PayItems({ stamp }: { stamp: number }) {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const res = useResource<PayItem[]>(() => api.get<PayItem[]>(pay(`/items${qs({ status, kind, q: q.trim() })}`)), [status, kind, q, stamp]);
  return (
    <Card
      title="Expected payments"
      actions={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ maxWidth: 150 }}>
            <option value="">Any status</option>
            {['MATCHED', 'BREAK', 'NOT_DUE', 'ACCEPTED', 'DEFERRED'].map((s) => (<option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>))}
          </select>
          <select className="ops-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ maxWidth: 190 }}>
            <option value="">Payouts and receipts</option>
            <option value="DISTRIBUTION_PAYOUT">Distribution payouts</option>
            <option value="CAPITAL_CALL_RECEIPT">Capital call receipts</option>
          </select>
          <input className="ops-input" placeholder="Reference or investor" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 200 }} />
        </div>
      }
    >
      <Loaded res={res} what="expected payments">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No expected payments. Run the matching for a window that contains issued capital calls or distributions.</Empty>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>Document</th><th>Investor</th><th>Type</th><th>Due</th><th className="r">Expected</th><th className="r">Bank line</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.documentRef}<span className="ops-sub">{r.fund?.name ?? ''}</span></td>
                      <td>{r.payeeName}</td>
                      <td>{KIND_LABEL[r.kind]}<span className="ops-sub">{r.direction === 'IN' ? 'money in' : 'money out'}</span></td>
                      <td><DateText value={r.dueDate} />{r.deferredUntil && <span className="ops-sub">deferred to {r.deferredUntil}</span>}</td>
                      <td className="r">{dec(r.expectedAmount, r.currency)}</td>
                      <td className="r">
                        {r.line ? (
                          <>
                            {dec(r.line.amount)}
                            <span className="ops-sub">{r.line.valueDate} {r.line.reference ?? r.line.description ?? ''} ({(r.matchMethod ?? '').toLowerCase()})</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td><Tone value={r.status} /></td>
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

// ------------------------------------------------------------------ breaks

export function PayBreaks({ canManage, canSign, stamp, onChanged }: { canManage: boolean; canSign: boolean; stamp: number; onChanged: () => void }) {
  const [status, setStatus] = useState('OPEN_ALL');
  const [kind, setKind] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const res = useResource<{ data: PayBreak[]; total: number }>(() => apiRequest<{ data: PayBreak[]; total: number }>('GET', pay(`/breaks${qs({ status, kind })}`)), [status, kind, stamp]);
  return (
    <>
      <Card
        title="Payment breaks"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ maxWidth: 170 }}>
              <option value="OPEN_ALL">Open and pending</option>
              <option value="OPEN,INVESTIGATING">Being worked</option>
              <option value="PENDING_CHECKER">Awaiting checker</option>
              <option value="RESOLVED_ALL">Resolved or cleared</option>
              <option value="">Everything</option>
            </select>
            <select className="ops-input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" style={{ maxWidth: 200 }}>
              <option value="">All kinds</option>
              <option value="MISSING_PAYMENT">Missing payment</option>
              <option value="AMOUNT_DIFF">Amount difference</option>
              <option value="UNPAIRED_LINE">Unpaired statement line</option>
            </select>
          </div>
        }
      >
        <Loaded res={res} what="breaks">
          {(page) =>
            page.data.length === 0 ? (
              <Empty>No breaks in this view.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead><tr><th>Break</th><th>Kind</th><th>Detail</th><th className="r">Difference</th><th>Severity</th><th>Status</th><th>Owner</th><th className="r">Age</th></tr></thead>
                  <tbody>
                    {page.data.map((b) => (
                      <tr key={b.id} onClick={() => setOpenId(b.id)} style={{ cursor: 'pointer' }}>
                        <td><button className="ops-btn small" type="button" onClick={(e) => { e.stopPropagation(); setOpenId(b.id); }}>{b.ref}</button></td>
                        <td>{KIND_LABEL[b.kind]}</td>
                        <td style={{ maxWidth: 420 }}>{b.label}</td>
                        <td className="r">{dec(b.difference, b.currency)}</td>
                        <td><Tone value={b.severity} /></td>
                        <td><Tone value={b.status} />{b.overdue && <span className="ops-sub" style={{ color: 'var(--ops-red)' }}>overdue</span>}</td>
                        <td>{b.owner?.name ?? '—'}</td>
                        <td className="r">{b.ageDays}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {openId && <PayBreakModal id={openId} canManage={canManage} canSign={canSign} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  );
}

function PayBreakModal({ id, canManage, canSign, onClose, onChanged }: { id: string; canManage: boolean; canSign: boolean; onClose: () => void; onChanged: () => void }) {
  const res = useResource<PayBreakDetail>(() => apiRequest<PayBreakDetail>('GET', pay(`/breaks/${id}`)), [id]);
  const users = useStaffUsers();
  const [mode, setMode] = useState<null | 'assign' | 'resolve' | 'reject'>(null);
  const refresh = () => {
    res.reload();
    onChanged();
  };
  const post = (path: string, body: unknown = {}, key?: string) => apiRequest('POST', pay(`/breaks/${id}${path}`), body, key ? { idempotencyKey: key } : undefined);

  return (
    <Modal title={res.state === 'ok' ? res.data.data.ref : 'Payment break'} kicker="Payments reconciliation" onClose={onClose} wide>
      <div className="ops-modal-body">
          <Loaded res={res} what="break">
            {({ data: b, item, events }) => (
              <>
                <p style={{ marginTop: 0 }}>{b.label}</p>
                <p className="ops-muted">
                  {KIND_LABEL[b.kind]} · <Tone value={b.severity} /> <Tone value={b.status} /> · owner {b.owner?.name ?? 'none'} · {b.ageDays} day{b.ageDays === 1 ? '' : 's'} old
                  {b.resolution && <> · proposed: {RESOLUTION_LABEL[b.resolution] ?? b.resolution}{b.maker?.name ? ` by ${b.maker.name}` : ''}</>}
                </p>
                {b.rationale && <Alert kind="info">{b.rationale}{b.evidenceRef ? ` (evidence: ${b.evidenceRef})` : ''}</Alert>}
                <div className="ops-grid" style={{ marginBottom: 10 }}>
                  <div><strong>Expected</strong><pre className="ops-pre">{JSON.stringify(b.expected ?? item, null, 1)}</pre></div>
                  <div><strong>On the statement</strong><pre className="ops-pre">{b.actual ? JSON.stringify(b.actual, null, 1) : 'Nothing found'}</pre></div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <button className="ops-btn" type="button" disabled={!b.allowed.assign || !canManage} onClick={() => setMode('assign')}>Assign</button>
                  <ActionButton label="Start investigating" disabled={!b.allowed.investigate || !canManage} onRun={(k) => post('/investigate', { note: 'Investigation started' }, k)} onDone={refresh} />
                  <button className="ops-btn primary" type="button" disabled={!b.allowed.resolve || !canManage} onClick={() => setMode('resolve')}>Resolve</button>
                  <ActionButton label="Approve" primary disabled={!b.allowed.approve || !canSign} title={b.allowed.approveBlockedReason ?? 'Asks for your authentication code'} onRun={(k) => post('/approve', {}, k)} onDone={refresh} />
                  <button className="ops-btn danger" type="button" disabled={!b.allowed.reject || !canSign} title={b.allowed.approveBlockedReason ?? undefined} onClick={() => setMode('reject')}>Send back</button>
                </div>
                <strong>Timeline</strong>
                <ul className="ops-timeline" style={{ listStyle: 'none', padding: 0 }}>
                  {events.map((e) => (
                    <li key={e.id} className="ops-muted">
                      <DateText value={e.at} time /> {e.action.replace(/_/g, ' ')}{e.toStatus ? ` to ${e.toStatus.toLowerCase().replace(/_/g, ' ')}` : ''}{e.actor ? ` by ${e.actor}` : ''}{e.note ? `: ${e.note}` : ''}
                    </li>
                  ))}
                </ul>
                {mode === 'assign' && (
                  <FormModal kicker={b.ref} title="Assign" submitLabel="Assign" onClose={() => setMode(null)} onDone={refresh} onSubmit={(fd, k) => post('/assign', { ownerUserId: str(fd, 'ownerUserId'), note: optStr(fd, 'note') }, k)}>
                    <Field label="Owner">
                      <select className="ops-input" name="ownerUserId" required defaultValue="">
                        <option value="" disabled>Choose a person</option>
                        {(users.state === 'ok' ? users.data : []).map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                      </select>
                    </Field>
                    <Field label="Note (optional)"><input className="ops-input" name="note" maxLength={500} /></Field>
                  </FormModal>
                )}
                {mode === 'reject' && (
                  <FormModal kicker={b.ref} title="Send back to the maker" submitLabel="Send back" danger onClose={() => setMode(null)} onDone={refresh} onSubmit={(fd, k) => post('/reject', { reason: str(fd, 'reason') }, k)}>
                    <Field label="Reason"><input className="ops-input" name="reason" required minLength={5} maxLength={500} /></Field>
                  </FormModal>
                )}
                {mode === 'resolve' && <ResolveForm b={b} onClose={() => setMode(null)} onDone={refresh} post={post} />}
              </>
            )}
          </Loaded>
      </div>
    </Modal>
  );
}

function ResolveForm({ b, onClose, onDone, post }: { b: PayBreak; onClose: () => void; onDone: () => void; post: (path: string, body?: unknown, key?: string) => Promise<unknown> }) {
  const [resolution, setResolution] = useState<string>(b.kind === 'UNPAIRED_LINE' ? 'ACCEPT_DIFFERENCE' : 'MANUAL_MATCH');
  const lines = useResource<StatementLine[]>(() => api.get<StatementLine[]>(pay('/lines?limit=200')), []);
  const items = useResource<PayItem[]>(() => api.get<PayItem[]>(pay('/items?status=BREAK,NOT_DUE&limit=200')), []);
  const options = b.kind === 'UNPAIRED_LINE' ? ['MANUAL_MATCH', 'ACCEPT_DIFFERENCE', 'RETURNED_PAYMENT'] : ['MANUAL_MATCH', 'ACCEPT_DIFFERENCE', 'TIMING', 'RETURNED_PAYMENT'];
  return (
    <FormModal
      kicker={b.ref}
      title="Resolve the break"
      subtitle="A different person approves this with their authentication code before anything changes."
      submitLabel="Submit for approval"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, k) =>
        post(
          '/resolve',
          { resolution, rationale: str(fd, 'rationale'), evidenceRef: str(fd, 'evidenceRef'), lineId: optStr(fd, 'lineId'), itemId: optStr(fd, 'itemId'), deferredUntil: optStr(fd, 'deferredUntil') },
          k,
        )
      }
    >
      <FieldGrid>
        <Field label="Resolution" span={2}>
          <select className="ops-input" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            {options.map((o) => (<option key={o} value={o}>{RESOLUTION_LABEL[o]}</option>))}
          </select>
        </Field>
        {resolution === 'MANUAL_MATCH' && b.kind !== 'UNPAIRED_LINE' && (
          <Field label="Statement line" span={2}>
            <select className="ops-input" name="lineId" required defaultValue="">
              <option value="" disabled>Choose an unpaired line</option>
              {(lines.state === 'ok' ? lines.data : []).map((l) => (<option key={l.id} value={l.id}>{l.valueDate} {dec(l.amount, l.currency)} {l.reference ?? l.description ?? ''}</option>))}
            </select>
          </Field>
        )}
        {resolution === 'MANUAL_MATCH' && b.kind === 'UNPAIRED_LINE' && (
          <Field label="Expected payment" span={2}>
            <select className="ops-input" name="itemId" required defaultValue="">
              <option value="" disabled>Choose the payment this line settles</option>
              {(items.state === 'ok' ? items.data : []).map((i) => (<option key={i.id} value={i.id}>{i.documentRef} {i.payeeName} {dec(i.expectedAmount, i.currency)} due {i.dueDate}</option>))}
            </select>
          </Field>
        )}
        {resolution === 'TIMING' && (
          <Field label="Now expected on" span={2}><input className="ops-input" type="date" name="deferredUntil" required min={today()} /></Field>
        )}
        <Field label="Explanation" span={2}><input className="ops-input" name="rationale" required minLength={10} maxLength={1000} /></Field>
        <Field label="Evidence reference" span={2} hint="Bank advice, e-mail, ticket or document reference"><input className="ops-input" name="evidenceRef" required maxLength={200} /></Field>
      </FieldGrid>
    </FormModal>
  );
}
