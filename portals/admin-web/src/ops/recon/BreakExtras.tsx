'use client';

import { useState, type FormEvent } from 'react';
import { apiDownload, apiRequest, apiUpload, OpsError } from '../api';
import { Alert, DateText, Field, FormModal, Loaded, optStr, str, useAction, useResource } from '../ui';
import { recon, useCounterparties, useStaffUsers } from './common';
import { CAUSES, type Allowed, type BreakCandidate, type BreakExtras, type ReconBreak } from './types';

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
type Dialog = null | 'query' | 'escalate' | 'reopen' | 'candidate';

/**
 * Evidence files, queries to the source, escalations and reopen for one break. The server decides what the user may
 * do (`allowed`); reopening a break covered by a sign-off asks for confirmation because it voids that sign-off.
 */
export function BreakExtras({ b, allowed, onChanged }: { b: ReconBreak; allowed: Allowed; onChanged: () => void }) {
  const res = useResource<BreakExtras>(() => apiRequest<{ data: BreakExtras }>('GET', recon(`/breaks/${b.id}/extras`)).then((r) => r.data), [b.id, b.version]);
  const users = useStaffUsers();
  const cps = useCounterparties();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [signedOff, setSignedOff] = useState(false);
  const upload = useAction();
  const done = () => {
    res.reload();
    onChanged();
  };

  async function attach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) return;
    const out = new FormData();
    out.append('file', file, file.name);
    const note = optStr(fd, 'note');
    if (note) out.append('note', note);
    const r = await upload.run((key) => apiUpload('POST', recon(`/breaks/${b.id}/evidence`), out, { idempotencyKey: key }));
    if (r) {
      form.reset();
      done();
    }
  }

  const post = (path: string, body: object) => apiRequest('POST', recon(`/breaks/${b.id}${path}`), body);

  return (
    <>
      <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Evidence files</h3>
      <Loaded res={res} what="evidence">
        {(x) => (
          <>
            {x.evidence.length === 0 ? (
              <p className="ops-muted" style={{ margin: 0 }}>No files attached. A maker can resolve with a reference or with attached files.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {x.evidence.map((e) => (
                  <li key={e.id} style={{ marginBottom: 4 }}>
                    <button className="ops-btn small" type="button" onClick={() => apiDownload(`/api/v1/recon/evidence/${e.id}/download`, e.name).catch(() => undefined)}>
                      {e.name}
                    </button>{' '}
                    <span className="ops-sub" style={{ display: 'inline' }}>
                      {size(e.size)} · {e.uploadedByName ?? 'unknown'} · <DateText value={e.createdAt} time /> · SHA-256 <code title={e.sha256}>{e.sha256.slice(0, 10)}…</code>
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {allowed.attachEvidence && (
              <form onSubmit={attach} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
                <input className="ops-input" type="file" name="file" required style={{ maxWidth: 260 }} aria-label="Evidence file" />
                <input className="ops-input" name="note" placeholder="Note (optional)" maxLength={500} style={{ maxWidth: 220 }} />
                <button className="ops-btn" type="submit" disabled={upload.busy}>{upload.busy ? 'Uploading…' : 'Attach file'}</button>
              </form>
            )}
            <Alert>{upload.error}</Alert>

            <h3 style={{ fontSize: 13, margin: '14px 0 6px' }}>Queries and escalations</h3>
            {x.actions.length === 0 ? (
              <p className="ops-muted" style={{ margin: 0 }}>None raised.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {x.actions.map((a) => (
                  <li key={a.id} style={{ marginBottom: 8 }}>
                    <strong>{a.ref}</strong> <span className={`ops-badge ${a.status === 'OPEN' ? 'amber' : a.status === 'ANSWERED' ? 'blue' : 'grey'}`}>{a.status.toLowerCase()}</span>{' '}
                    {a.kind === 'QUERY' ? `Query to ${a.counterparty?.name ?? 'the source'}: ${a.subject}` : `Escalated to ${a.toUserName ?? 'a senior user'} (level ${a.level})`}
                    <span className="ops-sub">
                      {a.raisedByName ?? 'Unknown'} · <DateText value={a.raisedAt} time /> · {a.body}
                    </span>
                    {a.response && <span className="ops-sub">Response{a.respondedByName ? ` (${a.respondedByName})` : ''}: {a.response}</span>}
                    {allowed.query && a.kind === 'QUERY' && a.status === 'OPEN' && (
                      <button
                        className="ops-btn small"
                        type="button"
                        onClick={async () => {
                          const response = window.prompt('Answer received from the source', '');
                          if (!response) return;
                          await post(`/actions/${a.id}/respond`, { response }).catch((e) => window.alert(e instanceof OpsError ? e.message : 'Could not save the answer'));
                          done();
                        }}
                      >
                        Record answer
                      </button>
                    )}
                    {allowed.query && ((a.kind === 'QUERY' && a.status === 'ANSWERED') || (a.kind === 'ESCALATION' && a.status === 'OPEN')) && (
                      <button
                        className="ops-btn small"
                        type="button"
                        onClick={async () => {
                          await post(`/actions/${a.id}/close`, {}).catch((e) => window.alert(e instanceof OpsError ? e.message : 'Could not close'));
                          done();
                        }}
                      >
                        Close
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Loaded>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button className="ops-btn" type="button" disabled={!allowed.query} onClick={() => setDialog('query')} title="Ask the counterparty about this item; the custodian execution is flagged Queried">Query source</button>
        <button className="ops-btn" type="button" disabled={!allowed.escalate} onClick={() => setDialog('escalate')} title="Hand the break to a senior colleague">Escalate</button>
        {allowed.acceptCandidate && (
          <button className="ops-btn" type="button" onClick={() => setDialog('candidate')} title="Pair this break with the break on the other side that is the same trade">Accept candidate match</button>
        )}
        <button className="ops-btn danger" type="button" disabled={!allowed.reopen} onClick={() => { setSignedOff(false); setDialog('reopen'); }} title="Checker only; asks for your authentication code">Reopen</button>
      </div>

      {dialog === 'query' && (
        <FormModal kicker={b.ref} title="Query the source" subtitle="Records the question, moves the break into investigation and flags the custodian trade as queried." submitLabel="Send query" onClose={() => setDialog(null)} onDone={done} onSubmit={(fd) => post('/query', { subject: str(fd, 'subject'), body: str(fd, 'body'), counterpartyId: optStr(fd, 'counterpartyId') ?? b.counterparty?.id ?? null })}>
          {!b.counterparty && (
            <Field label="Counterparty">
              <select className="ops-input" name="counterpartyId" required defaultValue="">
                <option value="">Choose</option>
                {(cps.state === 'ok' ? cps.data : []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Subject">
            <input className="ops-input" name="subject" required minLength={3} maxLength={200} defaultValue={`${b.ref}: ${b.kind.replace(/_/g, ' ').toLowerCase()}`} />
          </Field>
          <Field label="Question">
            <textarea className="ops-input" name="body" required minLength={5} maxLength={2000} rows={4} />
          </Field>
        </FormModal>
      )}
      {dialog === 'escalate' && (
        <FormModal kicker={b.ref} title="Escalate break" subtitle="The person you choose becomes the owner and is notified." submitLabel="Escalate" onClose={() => setDialog(null)} onDone={done} onSubmit={(fd) => post('/escalate', { toUserId: str(fd, 'toUserId'), level: Number(str(fd, 'level')), reason: str(fd, 'reason') })}>
          <Field label="Escalate to">
            <select className="ops-input" name="toUserId" required defaultValue="">
              <option value="">Choose a person</option>
              {(users.state === 'ok' ? users.data : []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Level">
            <select className="ops-input" name="level" defaultValue="1">
              <option value="1">1: team lead</option>
              <option value="2">2: head of operations</option>
              <option value="3">3: executive</option>
            </select>
          </Field>
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required minLength={5} maxLength={2000} rows={3} />
          </Field>
        </FormModal>
      )}
      {dialog === 'candidate' && <CandidateDialog b={b} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'reopen' && (
        <FormModal
          kicker={b.ref}
          title="Reopen break"
          subtitle="Returns a matched or closed break to new. If the day is signed off for this family, reopening voids that sign-off. You will be asked for your authentication code."
          submitLabel="Reopen"
          danger
          onClose={() => setDialog(null)}
          onDone={done}
          onSubmit={async (fd) => {
            try {
              return await post('/reopen', { reason: str(fd, 'reason'), revokeSignoff: fd.get('revoke') === 'on', version: b.version });
            } catch (e) {
              if (e instanceof OpsError && e.code === 'signed_off') setSignedOff(true);
              throw e;
            }
          }}
        >
          <Field label="Reason" hint="At least 10 characters; kept in the audit trail.">
            <textarea className="ops-input" name="reason" required minLength={10} maxLength={1000} rows={3} />
          </Field>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" name="revoke" key={String(signedOff)} defaultChecked={signedOff} /> Void the daily sign-off if one covers this break
          </label>
          {signedOff && <Alert kind="warn">This family and date is signed off. Tick the box to void the sign-off and reopen.</Alert>}
        </FormModal>
      )}
    </>
  );
}


/** Lists the open breaks on the other side that look like the same trade; the maker accepts one with a cause and rationale. */
function CandidateDialog({ b, onClose, onDone }: { b: ReconBreak; onClose: () => void; onDone: () => void }) {
  const res = useResource<BreakCandidate[]>(() => apiRequest<{ data: BreakCandidate[] }>('GET', recon(`/breaks/${b.id}/candidates`)).then((r) => r.data), [b.id]);
  const [pick, setPick] = useState('');
  return (
    <FormModal
      kicker={b.ref}
      title="Accept candidate match"
      subtitle="Pairs this break with the break on the other side that is the same trade. Both go to an independent checker; you cannot approve them."
      submitLabel="Send to checker"
      disabled={!pick}
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) => apiRequest('POST', recon(`/breaks/${b.id}/accept-candidate`), { candidateBreakId: pick, cause: str(fd, 'cause'), rationale: str(fd, 'rationale'), version: b.version })}
    >
      <Loaded res={res} what="candidate matches">
        {(rows) =>
          rows.length === 0 ? (
            <p className="ops-muted" style={{ margin: 0 }}>No open break on the other side looks like this trade, so there is nothing to accept.</p>
          ) : (
            <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
              <legend className="ops-sub">Candidates, best match first</legend>
              {rows.map((r) => (
                <label key={r.id} style={{ display: 'block', marginBottom: 6 }}>
                  <input type="radio" name="candidate" value={r.id} checked={pick === r.id} onChange={() => setPick(r.id)} /> <strong>{r.ref}</strong> score {r.score}: {r.label}
                  <span className="ops-sub">{r.reasons.join(', ')}</span>
                </label>
              ))}
            </fieldset>
          )
        }
      </Loaded>
      <Field label="Cause">
        <select className="ops-input" name="cause" required defaultValue="">
          <option value="">Choose a cause</option>
          {CAUSES.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Rationale" hint="At least 10 characters: why these two are the same trade.">
        <textarea className="ops-input" name="rationale" required minLength={10} maxLength={2000} rows={3} />
      </Field>
    </FormModal>
  );
}
