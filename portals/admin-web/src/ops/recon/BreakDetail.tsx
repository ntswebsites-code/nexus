'use client';

import { useState } from 'react';
import { formatDecimal } from '../money';
import { Alert, DateText, DefinitionList, Field, FormModal, Loaded, Modal, optStr, str, useResource } from '../ui';
import { BreakExtras } from './BreakExtras';
import { ageText, reconFull, Tone, useStaffUsers, ValueBox } from './common';
import { CAUSES, type BreakDetail as Detail } from './types';

const ACTION_LABEL: Record<string, string> = {
  detected: 'Detected by matching run',
  assigned: 'Assigned',
  investigating: 'Investigation started',
  resolved: 'Resolved by maker (pending checker)',
  approved: 'Approved by checker and closed',
  rejected: 'Returned to maker',
  auto_cleared: 'Cleared: items agree on re-run',
  reopened: 'Reopened by a later run',
  updated: 'Values changed in a later run',
  reopened_by_user: 'Reopened by a checker',
  evidence_attached: 'Evidence file attached',
  queried: 'Query raised with the source',
  query_answered: 'Query answered',
  escalated: 'Escalated',
  action_closed: 'Query or escalation closed',
};

type Dialog = null | 'assign' | 'investigate' | 'resolve' | 'approve' | 'reject';

/**
 * Break detail: internal vs external, difference, timeline and the actions this user may take
 * (the server decides in `allowed`). Approve needs a different person from the maker and step-up
 * MFA; the console's TOTP prompt appears automatically.
 */
export function BreakDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const res = useResource<Detail>(() => reconFull<Detail>('GET', `/breaks/${id}`), [id]);
  const users = useStaffUsers();
  const [dialog, setDialog] = useState<Dialog>(null);

  const done = () => {
    res.reload();
    onChanged();
  };

  return (
    <Modal wide kicker="Reconciliation break" title={res.state === 'ok' ? `${res.data.data.ref} · ${res.data.data.familyLabel}` : 'Break'} onClose={onClose}>
      <div className="ops-modal-body">
        <Loaded res={res} what="break">
          {({ data: b, allowed, events }) => {
            const act = (d: Dialog) => () => setDialog(d);
            const version = b.version;
            const post = (action: string, body: object) => reconFull('POST', `/breaks/${b.id}/${action}`, { ...body, version });
            return (
              <>
                <p style={{ marginTop: 0 }}>{b.label}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                  <Tone value={b.severity} />
                  <Tone value={b.status} />
                  {b.overdue && <span className="ops-badge red">overdue</span>}
                  <span className="ops-badge grey">age {ageText(b.ageDays, b.ageHours)}</span>
                  <span className="ops-badge grey">{b.kind.replace(/_/g, ' ').toLowerCase()}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  <div>
                    <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Internal (our book)</h3>
                    <ValueBox value={b.internalValue} empty="Nothing in the internal book for this item." />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>External (counterparty)</h3>
                    <ValueBox value={b.externalValue} empty="Nothing received from the counterparty for this item." />
                  </div>
                </div>

                <DefinitionList
                  items={[
                    ['Difference', b.difference === null ? 'Item missing on one side' : `${formatDecimal(b.difference, 2)}${b.currency ? ` ${b.currency}` : ''}${b.differencePct ? ` (${formatDecimal(b.differencePct, 2)}%)` : ''}`],
                    ['Counterparty', b.counterparty ? `${b.counterparty.name} (${b.counterparty.ref})` : '—'],
                    ['Portfolio', b.portfolio ? `${b.portfolio.name} (${b.portfolio.ref})` : '—'],
                    ['Run', b.runRef ? `${b.runRef}${b.asOfDate ? ` · ${b.asOfDate}` : ''}` : '—'],
                    ['Owner', b.ownerName ?? 'Unassigned'],
                    ['Maker', b.makerName ?? '—'],
                    ['Checker', b.checkerName ?? '—'],
                    ['Cause', b.cause ? (CAUSES.find((c) => c.key === b.cause)?.label ?? b.cause) : '—'],
                    ['Resolution', b.resolutionNote ?? '—'],
                    ['Evidence reference', b.evidenceRef ?? '—'],
                  ]}
                />

                {allowed.approveBlockedReason && <Alert kind="warn">{allowed.approveBlockedReason}</Alert>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
                  <button className="ops-btn" type="button" disabled={!allowed.assign} onClick={act('assign')}>Assign</button>
                  <button className="ops-btn" type="button" disabled={!allowed.investigate} onClick={act('investigate')}>Investigate</button>
                  <button className="ops-btn primary" type="button" disabled={!allowed.resolve} onClick={act('resolve')} title="Maker: needs a cause, rationale and evidence reference">Resolve</button>
                  <button className="ops-btn primary" type="button" disabled={!allowed.approve} onClick={act('approve')} title="Checker: a different person from the maker; asks for your authentication code">Approve</button>
                  <button className="ops-btn danger" type="button" disabled={!allowed.reject} onClick={act('reject')}>Return to maker</button>
                </div>

                <BreakExtras b={b} allowed={allowed} onChanged={done} />

                <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Timeline</h3>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {events.map((e) => (
                    <li key={e.id} style={{ marginBottom: 6 }}>
                      <strong>{ACTION_LABEL[e.action] ?? e.action}</strong>
                      {e.toStatus && e.fromStatus !== e.toStatus ? ` (${e.fromStatus?.toLowerCase().replace(/_/g, ' ') ?? 'new'} → ${e.toStatus.toLowerCase().replace(/_/g, ' ')})` : ''}
                      <span className="ops-sub">
                        {e.actorName ?? 'System'} · <DateText value={e.at} time />
                        {e.note ? ` · ${e.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>

                {dialog === 'assign' && (
                  <FormModal kicker={b.ref} title="Assign owner" submitLabel="Assign" onClose={() => setDialog(null)} onDone={done} onSubmit={(fd) => post('assign', { ownerUserId: str(fd, 'ownerUserId'), note: optStr(fd, 'note') })}>
                    <Field label="Owner">
                      <select className="ops-input" name="ownerUserId" required defaultValue={b.ownerUserId ?? ''}>
                        <option value="">Choose a person</option>
                        {(users.state === 'ok' ? users.data : []).map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Note (optional)">
                      <input className="ops-input" name="note" maxLength={500} />
                    </Field>
                  </FormModal>
                )}
                {dialog === 'investigate' && (
                  <FormModal kicker={b.ref} title="Start or note an investigation" submitLabel="Save" onClose={() => setDialog(null)} onDone={done} onSubmit={(fd) => post('investigate', { note: str(fd, 'note') })}>
                    <Field label="Note" hint="What you are checking, or who you have asked.">
                      <textarea className="ops-input" name="note" required minLength={3} maxLength={2000} rows={3} />
                    </Field>
                  </FormModal>
                )}
                {dialog === 'resolve' && (
                  <FormModal
                    kicker={b.ref}
                    title="Resolve break"
                    subtitle="This sends the break to a checker. You cannot approve your own resolution."
                    submitLabel="Send to checker"
                    onClose={() => setDialog(null)}
                    onDone={done}
                    onSubmit={(fd) => post('resolve', { cause: str(fd, 'cause'), rationale: str(fd, 'rationale'), evidenceRef: optStr(fd, 'evidenceRef') })}
                  >
                    <Field label="Cause">
                      <select className="ops-input" name="cause" required defaultValue="">
                        <option value="">Choose a cause</option>
                        {CAUSES.map((c) => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Rationale" hint="At least 10 characters.">
                      <textarea className="ops-input" name="rationale" required minLength={10} maxLength={2000} rows={3} />
                    </Field>
                    <Field label="Evidence reference" hint="Contract note, email, statement page or document reference. Leave blank if you attached evidence files to the break.">
                      <input className="ops-input" name="evidenceRef" minLength={3} maxLength={255} />
                    </Field>
                  </FormModal>
                )}
                {dialog === 'approve' && (
                  <FormModal
                    kicker={b.ref}
                    title="Approve and close"
                    subtitle={`Maker: ${b.makerName ?? 'unknown'}. Cause: ${b.cause ?? '—'}. Evidence: ${b.evidenceRef ?? '—'}. You will be asked for your authentication code.`}
                    submitLabel="Approve and close"
                    onClose={() => setDialog(null)}
                    onDone={done}
                    onSubmit={(fd) => post('approve', { note: optStr(fd, 'note') })}
                  >
                    <Field label="Note (optional)">
                      <input className="ops-input" name="note" maxLength={500} />
                    </Field>
                  </FormModal>
                )}
                {dialog === 'reject' && (
                  <FormModal kicker={b.ref} title="Return to maker" submitLabel="Return" danger onClose={() => setDialog(null)} onDone={done} onSubmit={(fd) => post('reject', { reason: str(fd, 'reason') })}>
                    <Field label="Reason">
                      <textarea className="ops-input" name="reason" required minLength={3} maxLength={2000} rows={3} />
                    </Field>
                  </FormModal>
                )}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}
