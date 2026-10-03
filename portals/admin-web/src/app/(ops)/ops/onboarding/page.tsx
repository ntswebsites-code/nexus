'use client';

import { useState } from 'react';
import { asList, coGet, coPost, coPut, NoAccess, rawPost, StaffSelect, Tile, Tone, type StaffUser } from '@/ops/clientops';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

interface QueueRow {
  id: string;
  ref: string;
  applicationRef: string;
  name: string;
  type: string;
  country: string | null;
  stage: string;
  risk: string;
  owner: string;
  ownerId: string | null;
  slaDueAt: string | null;
  sla: string;
  checks: { done: number; total: number; failed: number; referred: number };
  riskAssessment: { id: string; status: string; rating: string; score: number } | null;
}
interface Queue {
  data: QueueRow[];
  total: number;
  summary: { byStage: Record<string, number>; byRisk: Record<string, number>; bySla: Record<string, number>; awaitingRiskApproval: number };
}
interface Factor { key: string; label: string; points: number }
interface Workup {
  case: { id: string; ref: string; name: string; stage: string; risk: string; version: number; blockers: string[]; email: string };
  app: { country: string | null; pep: string | null; sourceOfFunds: string | null; expectedInvestment: number | null; owners: number };
  checks: { kind: string; outcome: string | null; provider: string | null; notes: string | null; by: string | null; at: string | null; history: number }[];
  riskPreview: { score: number; rating: string; factors: Factor[]; provisional?: boolean; checksRun?: number; checksTotal?: number };
  assessments: { id: string; score: number; rating: string; factors: Factor[]; rationale: string | null; status: string; maker: string | null; makerId: string; checker: string | null; decisionNote: string | null; at: string }[];
  gates: { blockers: string[]; riskApproved: boolean; checksComplete: boolean; openReferrals: string[] };
  timeline: { at: string; title: string; detail: string | null }[];
}

const STAGES = ['Submitted', 'Screening', 'ComplianceReview', 'ClientAction', 'EnhancedReview', 'Approved', 'Rejected', 'Activation', 'Active'];
const KINDS = ['SANCTIONS', 'PEP', 'ADVERSE_MEDIA', 'ID_VERIFICATION', 'ADDRESS', 'SOURCE_OF_FUNDS', 'SOURCE_OF_WEALTH', 'UBO'];
const NEXT: Record<string, string[]> = { Submitted: ['Screening'], Screening: ['ComplianceReview'], ComplianceReview: ['ClientAction'], ClientAction: ['ComplianceReview'], EnhancedReview: ['ComplianceReview'] };
const pretty = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export default function OnboardingPage() {
  const canView = useCan('onboarding.view');
  const [stage, setStage] = useState('');
  const [risk, setRisk] = useState('');
  const [sla, setSla] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const queue = useResource<Queue>(() => coGet<Queue>('/onboarding/queue', { stage, risk, sla, q, open: stage ? undefined : 'true' }), [stage, risk, sla, q]);
  if (!canView) return <NoAccess kicker="Clients" title="Onboarding & KYC" perm="onboarding.view" />;
  return (
    <>
      <PageHeader kicker="Clients" title="Onboarding & KYC" subtitle="Review queue over onboarding-portal submissions: KYC/AML checks, risk rating with checker approval, information requests and decisions." />
      <Loaded res={queue} what="the onboarding queue">
        {(d) => (
          <>
            <div className="ops-tiles">
              <Tile label="In the queue" value={d.total} />
              <Tile label="SLA breached" value={d.summary.bySla.Breached ?? 0} warn={(d.summary.bySla.Breached ?? 0) > 0} hint={`${d.summary.bySla['At risk'] ?? 0} at risk`} />
              <Tile label="High risk" value={d.summary.byRisk.High ?? 0} />
              <Tile label="Risk ratings to approve" value={d.summary.awaitingRiskApproval} warn={d.summary.awaitingRiskApproval > 0} />
              <Tile label="Waiting on applicant" value={d.summary.byStage.ClientAction ?? 0} />
            </div>
            <Card title="Cases">
              <div className="ops-filters">
                <Field label="Search"><input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or reference" /></Field>
                <Field label="Stage">
                  <select className="ops-input" value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">All open</option>
                    {STAGES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Risk"><select className="ops-input" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">All</option>{['Pending', 'Low', 'Medium', 'High'].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="SLA"><select className="ops-input" value={sla} onChange={(e) => setSla(e.target.value)}><option value="">All</option>{['Breached', 'At risk', 'On track'].map((s) => <option key={s}>{s}</option>)}</select></Field>
              </div>
              {d.data.length === 0 ? <Empty>No cases match.</Empty> : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Applicant</th><th>Stage</th><th>Risk</th><th>Checks</th><th>Risk assessment</th><th>Owner</th><th>Due</th><th>SLA</th></tr></thead>
                    <tbody>
                      {d.data.map((c) => (
                        <tr key={c.id} className="clickable" onClick={() => setOpen(c.id)}>
                          <td><strong>{c.name}</strong><span className="ops-sub">{c.ref} · {c.type}{c.country ? ` · ${c.country}` : ''}</span></td>
                          <td><Tone value={c.stage} /></td>
                          <td><Tone value={c.risk} /></td>
                          <td>{c.checks.done}/{c.checks.total}{c.checks.failed ? <> <Tone value="Fail" /></> : c.checks.referred ? <> <Tone value="Refer" /></> : null}</td>
                          <td>{c.riskAssessment ? <><Tone value={c.riskAssessment.status} /> <span className="ops-sub">{c.riskAssessment.rating} · {c.riskAssessment.score}</span></> : '-'}</td>
                          <td>{c.owner}</td>
                          <td>{formatDateTime(c.slaDueAt)}</td>
                          <td><Tone value={c.sla} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Loaded>
      <RiskFactorsCard />
      {open && <CaseModal id={open} onClose={() => setOpen(null)} onChanged={queue.reload} />}
    </>
  );
}

type Dlg = 'check' | 'risk' | 'info' | 'advance' | 'decide' | 'assign' | { decideRisk: string; approve: boolean } | null;

interface Triage {
  id: string;
  riskBand: string;
  summary: string;
  flags: string[];
  nextSteps: string[];
  model: string;
  by: string | null;
  at: string;
}

/** R4-8: advisory AI triage of the case facts. It never changes the case, a check or the rating. */
function TriagePanel({ id, manage }: { id: string; manage: boolean }) {
  const res = useResource<Triage[]>(() => coGet<{ data: Triage[] }>(`/onboarding/cases/${encodeURIComponent(id)}/triage`).then(asList), [id]);
  return (
    <>
      <h3>AI triage <span className="ops-sub">advisory only</span></h3>
      <Loaded res={res} what="the triage">
        {(rows) => {
          const t = rows[0];
          return (
            <>
              {manage && <p><ActionButton label={t ? 'Re-run triage' : 'Run triage'} onRun={(k) => coPost(`/onboarding/cases/${encodeURIComponent(id)}/triage`, {}, k)} onDone={res.reload} /></p>}
              {!t ? (
                <Empty>No triage has been run for this case.</Empty>
              ) : (
                <>
                  <p><Tone value={t.riskBand === 'HIGH' ? 'High' : t.riskBand === 'MEDIUM' ? 'Medium' : 'Low'} /> {t.summary}</p>
                  {t.flags.length > 0 && <><strong>Flags</strong><ul>{t.flags.map((f) => <li key={f}>{f}</li>)}</ul></>}
                  <strong>Suggested next steps</strong>
                  <ul>{t.nextSteps.map((f) => <li key={f}>{f}</li>)}</ul>
                  <p className="ops-muted">Generated {formatDateTime(t.at)}{t.by ? ` by ${t.by}` : ''} with {t.model}. The analyst and a different approver still decide.</p>
                </>
              )}
            </>
          );
        }}
      </Loaded>
    </>
  );
}

function CaseModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const manage = useCan('onboarding.manage');
  const approve = useCan('onboarding.approve');
  const { user } = useSession();
  const res = useResource<Workup>(() => coGet<Workup>(`/onboarding/cases/${encodeURIComponent(id)}/workup`), [id]);
  const staff = useResource<StaffUser[]>(() => coGet<{ data: StaffUser[] }>('/staff').then(asList), []);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [kind, setKind] = useState('SANCTIONS');
  const done = () => { res.reload(); onChanged(); };
  const isCompliance = user.roles.some((r) => r.portal === 'admin' && r.key === 'compliance');
  return (
    <Modal title="Case review" kicker="Onboarding & KYC" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="the case">
          {(w) => {
            const c = w.case;
            const closed = ['Rejected', 'Active'].includes(c.stage);
            const proposed = w.assessments.find((a) => a.status === 'PROPOSED');
            return (
              <>
                <h2 style={{ margin: 0 }}>{c.name} <Tone value={c.stage} /> <Tone value={c.risk} /></h2>
                <p className="ops-muted">{c.ref} · {c.email} · country {w.app.country ?? '-'} · PEP {w.app.pep ?? '-'} · {w.app.owners} beneficial owner(s)</p>
                {w.gates.blockers.length > 0 && <Alert kind="warn">Open gates: {w.gates.blockers.join('; ')}</Alert>}
                <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {manage && !closed && <button className="ops-btn" type="button" onClick={() => { setKind('SANCTIONS'); setDlg('check'); }}>Record check</button>}
                  {manage && !closed && <button className="ops-btn" type="button" onClick={() => setDlg('risk')}>Propose risk rating</button>}
                  {manage && !closed && <button className="ops-btn" type="button" onClick={() => setDlg('info')}>Request more information</button>}
                  {manage && NEXT[c.stage] && <button className="ops-btn" type="button" onClick={() => setDlg('advance')}>Move stage</button>}
                  {manage && !closed && <button className="ops-btn" type="button" onClick={() => setDlg('assign')}>Assign</button>}
                  {manage && isCompliance && ['ComplianceReview', 'EnhancedReview', 'ClientAction', 'Screening'].includes(c.stage) && <button className="ops-btn primary" type="button" onClick={() => setDlg('decide')}>Record decision</button>}
                  {manage && c.stage === 'Approved' && <ActionButton label="Activate client" primary onRun={(k) => rawPost(`/api/v1/kyc/cases/${c.id}/activate`, {}, k)} onDone={done} />}
                </p>
                <h3>KYC / AML checks</h3>
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead><tr><th>Check</th><th>Outcome</th><th>By</th><th>When</th><th>Notes</th></tr></thead>
                    <tbody>
                      {w.checks.map((k) => (
                        <tr key={k.kind}>
                          <td>{pretty(k.kind)}{k.history > 1 && <span className="ops-sub">{k.history} entries</span>}</td>
                          <td>{k.outcome ? <Tone value={k.outcome} /> : <span className="ops-muted">Not done</span>}</td>
                          <td>{k.by ?? '-'}</td>
                          <td>{formatDateTime(k.at)}</td>
                          <td>{k.notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <TriagePanel id={c.id} manage={manage} />
                <h3>Risk rating</h3>
                {w.riskPreview.provisional && <Alert kind="warn">Provisional: {w.riskPreview.checksRun ?? 0} of {w.riskPreview.checksTotal ?? 0} provider checks have been recorded. Checks not yet run add no risk points, so this rating is not a clearance.</Alert>}
                <p>
                  Computed now: <Tone value={w.riskPreview.rating} /> (score {w.riskPreview.score}). Case rating: <Tone value={c.risk} />.
                  {' '}{w.gates.riskApproved ? 'Approved assessment matches.' : 'No approved assessment matches the case rating.'}
                </p>
                {w.riskPreview.factors.length > 0 && <ul>{w.riskPreview.factors.map((f) => <li key={f.key}>{f.label} (+{f.points})</li>)}</ul>}
                {w.assessments.length > 0 && (
                  <div className="ops-table-wrap">
                    <table className="ops-table">
                      <thead><tr><th>Proposed</th><th>Status</th><th>Maker</th><th>Checker</th><th>Basis</th><th /></tr></thead>
                      <tbody>
                        {w.assessments.map((a) => (
                          <tr key={a.id}>
                            <td><Tone value={a.rating} /> <span className="ops-sub">score {a.score} · {formatDateTime(a.at)}</span></td>
                            <td><Tone value={a.status} /></td>
                            <td>{a.maker}</td>
                            <td>{a.checker ?? '-'}</td>
                            <td>{a.decisionNote ?? a.rationale ?? ''}</td>
                            <td>
                              {approve && a.status === 'PROPOSED' && a.makerId !== user.id && (
                                <>
                                  <button className="ops-btn small primary" type="button" onClick={() => setDlg({ decideRisk: a.id, approve: true })}>Approve</button>{' '}
                                  <button className="ops-btn small" type="button" onClick={() => setDlg({ decideRisk: a.id, approve: false })}>Reject</button>
                                </>
                              )}
                              {a.status === 'PROPOSED' && a.makerId === user.id && <span className="ops-sub">Awaiting a different approver</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {proposed === undefined && w.assessments.length === 0 && <Empty>No risk assessment yet.</Empty>}
                <h3>Timeline</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {w.timeline.slice(0, 25).map((e, i) => (
                    <li key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--ops-line-2)' }}>
                      <strong>{e.title}</strong> <span className="ops-sub">{formatDateTime(e.at)}</span>
                      {e.detail && <div className="ops-muted">{e.detail}</div>}
                    </li>
                  ))}
                </ul>

                {dlg === 'check' && (
                  <FormModal title="Record KYC / AML check" kicker={c.ref} submitLabel="Record" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd, key) => coPost(`/onboarding/cases/${c.id}/checks`, { kind: str(fd, 'kind'), outcome: str(fd, 'outcome'), provider: optStr(fd, 'provider'), notes: optStr(fd, 'notes') }, key)}>
                    <FieldGrid>
                      <Field label="Check"><select className="ops-input" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{pretty(k)}</option>)}</select></Field>
                      <Field label="Outcome"><select className="ops-input" name="outcome"><option value="PASS">Pass</option><option value="REFER">Refer</option><option value="FAIL">Fail</option></select></Field>
                      <Field label="Provider"><input className="ops-input" name="provider" placeholder="Manual review" /></Field>
                      <Field label="Notes" hint="Required for refer or fail" span={2}><textarea className="ops-input" name="notes" /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {dlg === 'risk' && (
                  <FormModal title="Propose risk rating" kicker={c.ref} subtitle={`The computed rating is ${w.riskPreview.rating} (score ${w.riskPreview.score}). A different approver confirms it.`} submitLabel="Propose" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd, key) => coPost(`/onboarding/cases/${c.id}/risk`, { rating: optStr(fd, 'rating'), rationale: optStr(fd, 'rationale') }, key)}>
                    <FieldGrid>
                      <Field label="Rating"><select className="ops-input" name="rating" defaultValue={w.riskPreview.rating}>{['Low', 'Medium', 'High'].map((r) => <option key={r}>{r}</option>)}</select></Field>
                      <Field label="Rationale" hint="Required when overriding the computed rating" span={2}><textarea className="ops-input" name="rationale" /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {dlg === 'info' && (
                  <FormModal title="Request more information" kicker={c.ref} subtitle="Emails the applicant a secure link back to the onboarding portal and moves the case to Client action." submitLabel="Send request" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => rawPost(`/api/v1/kyc/cases/${c.id}/request-evidence`, { slots: [], message: str(fd, 'message') })}>
                    <Field label="What do you need from the applicant?"><textarea className="ops-input" name="message" required /></Field>
                  </FormModal>
                )}
                {dlg === 'advance' && (
                  <FormModal title="Move case stage" kicker={c.ref} submitLabel="Move" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => rawPost(`/api/v1/kyc/cases/${c.id}/advance`, { toStage: str(fd, 'toStage'), reason: optStr(fd, 'reason'), version: c.version })}>
                    <FieldGrid>
                      <Field label="To stage"><select className="ops-input" name="toStage">{(NEXT[c.stage] ?? []).map((s) => <option key={s}>{s}</option>)}</select></Field>
                      <Field label="Reason"><input className="ops-input" name="reason" /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {dlg === 'decide' && (
                  <FormModal title="Record decision" kicker={c.ref} subtitle="Compliance only. The person who prepared the case cannot decide it. Needs a fresh authentication code." submitLabel="Record decision" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd, key) => rawPost(`/api/v1/kyc/cases/${c.id}/decision`, { decision: str(fd, 'decision'), reason: str(fd, 'reason'), version: c.version }, key)}>
                    <FieldGrid>
                      <Field label="Decision"><select className="ops-input" name="decision"><option value="approve">Approve</option><option value="enhanced_review">Open enhanced review</option><option value="reject">Reject</option></select></Field>
                      <Field label="Basis for the decision" span={2}><textarea className="ops-input" name="reason" required minLength={5} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {dlg === 'assign' && (
                  <FormModal title="Assign case" kicker={c.ref} submitLabel="Assign" onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => coPost(`/onboarding/cases/${c.id}/assign`, { userId: optStr(fd, 'userId') ?? null })}>
                    <Field label="Reviewer"><StaffSelect staff={staff.state === 'ok' ? staff.data : []} name="userId" /></Field>
                  </FormModal>
                )}
                {typeof dlg === 'object' && dlg !== null && 'decideRisk' in dlg && (
                  <FormModal title={dlg.approve ? 'Approve risk rating' : 'Reject risk rating'} kicker={c.ref} subtitle={dlg.approve ? 'Sets the case risk rating. Needs a fresh authentication code.' : 'Returns it to the preparer.'} submitLabel={dlg.approve ? 'Approve' : 'Reject'} danger={!dlg.approve} onClose={() => setDlg(null)} onDone={done}
                    onSubmit={(fd) => coPost(`/onboarding/risk/${dlg.decideRisk}/${dlg.approve ? 'approve' : 'reject'}`, { note: str(fd, 'note') })}>
                    <Field label="Note"><textarea className="ops-input" name="note" required minLength={5} /></Field>
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

interface RiskFactorRow {
  key: string;
  label: string;
  points: number;
  defaultPoints: number | null;
  enabled: boolean;
  params: Record<string, unknown> | null;
  updatedBy: string | null;
}
interface RiskFactorsResp {
  factors: RiskFactorRow[];
  thresholds: { medium: number; high: number };
}

/** The scoring configuration that drives every proposed risk rating. Changing it needs the approver permission and step-up. */
function RiskFactorsCard() {
  const canEdit = useCan('onboarding.approve');
  const res = useResource<RiskFactorsResp>(() => coGet<RiskFactorsResp>('/onboarding/risk-factors'), []);
  const [edit, setEdit] = useState<{ key: string; label: string; points: number; enabled: boolean; threshold: number | null; isThreshold: boolean } | null>(null);
  return (
    <Card title="Risk scoring configuration">
      <p className="ops-muted">Points added to a case score for each factor that applies. A score at or above the High threshold rates the case High, at or above Medium rates it Medium. Changes apply to ratings proposed from now on.</p>
      <Loaded res={res} what="risk factors">
        {(r) => (
          <>
            <div className="ops-tiles">
              <Tile label="Medium from score" value={r.thresholds.medium} />
              <Tile label="High from score" value={r.thresholds.high} />
            </div>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead><tr><th>Factor</th><th className="r">Points</th><th>Default</th><th>Enabled</th><th>Last changed by</th><th /></tr></thead>
                <tbody>
                  {canEdit && (
                    <>
                      {(['rating_medium', 'rating_high'] as const).map((k) => (
                        <tr key={k}>
                          <td>{k === 'rating_medium' ? 'Threshold: Medium rating' : 'Threshold: High rating'}</td>
                          <td className="r">{k === 'rating_medium' ? r.thresholds.medium : r.thresholds.high}</td>
                          <td>{k === 'rating_medium' ? 30 : 60}</td>
                          <td>-</td>
                          <td>-</td>
                          <td><button className="ops-btn small" type="button" onClick={() => setEdit({ key: k, label: k === 'rating_medium' ? 'Medium rating threshold' : 'High rating threshold', points: k === 'rating_medium' ? r.thresholds.medium : r.thresholds.high, enabled: true, threshold: null, isThreshold: true })}>Edit</button></td>
                        </tr>
                      ))}
                    </>
                  )}
                  {r.factors.map((f) => {
                    const t = (f.params as { threshold?: number } | null)?.threshold ?? null;
                    return (
                      <tr key={f.key} style={f.enabled ? undefined : { opacity: 0.55 }}>
                        <td>{f.label}{t !== null && <span className="ops-sub">Threshold {Number(t).toLocaleString('en-US')}</span>}</td>
                        <td className="r">{f.points}</td>
                        <td>{f.defaultPoints ?? '-'}</td>
                        <td>{f.enabled ? 'Yes' : 'No'}</td>
                        <td>{f.updatedBy ?? '-'}</td>
                        <td>{canEdit && <button className="ops-btn small" type="button" onClick={() => setEdit({ key: f.key, label: f.label, points: f.points, enabled: f.enabled, threshold: t === null ? null : Number(t), isThreshold: false })}>Edit</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loaded>
      {edit && (
        <FormModal
          title={`Edit: ${edit.label}`}
          subtitle="Needs a fresh authentication code and is recorded in the audit trail."
          submitLabel="Save"
          onClose={() => setEdit(null)}
          onDone={res.reload}
          onSubmit={(fd) =>
            coPut(`/onboarding/risk-factors/${edit.key}`, {
              points: Number(str(fd, 'points')),
              ...(edit.isThreshold ? {} : { enabled: fd.get('enabled') === 'on' }),
              ...(edit.threshold !== null && str(fd, 'threshold') ? { params: { threshold: Number(str(fd, 'threshold')) } } : {}),
              reason: str(fd, 'reason'),
            })
          }
        >
          <FieldGrid>
            <Field label="Points"><input className="ops-input" name="points" type="number" min={0} max={100} required defaultValue={edit.points} /></Field>
            {!edit.isThreshold && <Field label="Enabled"><input type="checkbox" name="enabled" defaultChecked={edit.enabled} /></Field>}
            {edit.threshold !== null && <Field label="Amount threshold"><input className="ops-input" name="threshold" type="number" min={0} step="any" defaultValue={edit.threshold} /></Field>}
            <Field label="Reason" span={2}><textarea className="ops-input" name="reason" required minLength={5} maxLength={500} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}
