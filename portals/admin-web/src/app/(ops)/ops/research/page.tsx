'use client';

import { useEffect, useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { AccessDenied, DataTable, label, PortfolioSelect, ReasonModal, Tag, Tile, useSecurities, usePortfolios } from '@/ops/rp';
import { useCan, useSession } from '@/ops/session';
import { ActionButton, Alert, Card, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

const R = (p: string) => v1(`/research${p}`);
const RATINGS = ['BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL'];

interface CaseRow {
  id: string;
  ref: string;
  securityId: string;
  ticker: string | null;
  securityName: string | null;
  title: string;
  thesis: string;
  risks: string | null;
  rating: string;
  targetPrice: string;
  currency: string;
  latestPrice: string | null;
  upsidePct: string | null;
  horizonMonths: number;
  conviction: number;
  status: string;
  analystId: string;
  analystName: string | null;
  reviewerName: string | null;
  returnReason: string | null;
  publishedAt: string | null;
  version: number;
  history?: { rating: string; targetPrice: string; conviction: number; priceAtChange: string | null; note: string | null; changedByName: string | null; approvedByName: string | null; createdAt: string }[];
  decisions?: DecisionRow[];
}
interface DecisionRow {
  id: string;
  ref: string;
  caseId: string;
  caseRef: string | null;
  caseTitle: string | null;
  meetingId: string | null;
  meetingRef: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  ticker: string | null;
  action: string;
  quantity: string | null;
  rationale: string;
  status: string;
  proposerId: string;
  proposerName: string | null;
  quorum: number;
  tally: { for: number; against: number; abstain: number; total: number };
  projected: { outcome: string; reason: string } | null;
  votes: { voterName: string | null; vote: string; comment: string | null; castAt: string }[];
  myVote: string | null;
  warning: string | null;
  ratifiedByName: string | null;
  outcomeNote: string | null;
  orders: { orderId: string; orderRef: string }[];
}
interface MeetingRow {
  id: string;
  ref: string;
  title: string;
  scheduledAt: string;
  agenda: string | null;
  quorum: number;
  status: string;
  chairName: string | null;
  minutes: string | null;
  decisions: number;
  openDecisions: number;
  decisionList?: DecisionRow[];
}
interface Summary {
  cases: { draft: number; inReview: number; published: number; archived: number };
  openDecisions: number;
  awaitingMyVote: number;
  awaitingRatification: number;
  myOpenCases: number;
  upcomingMeetings: MeetingRow[];
}

type Tab = 'cases' | 'decisions' | 'meetings';

export default function ResearchPage() {
  const canView = useCan('research.view');
  const [tab, setTab] = useState<Tab>('cases');
  const [open, setOpen] = useState<{ kind: 'case' | 'decision' | 'meeting'; id: string } | null>(null);
  const summary = useResource<Summary>(() => api.get<Summary>(R('/summary')), []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('case')) setOpen({ kind: 'case', id: sp.get('case')! });
    else if (sp.get('decision')) {
      setTab('decisions');
      setOpen({ kind: 'decision', id: sp.get('decision')! });
    }
  }, []);

  if (!canView) return <AccessDenied kicker="Research" title="Research & IC" perm="research.view" />;
  return (
    <>
      <PageHeader kicker="Research" title="Research & IC" subtitle="Research cases with a thesis, rating and target price; investment committee meetings; proposals voted on and ratified by a second person; approved decisions create draft orders." />
      <Loaded res={summary} what="research summary">
        {(s) => (
          <div className="ops-tiles">
            <Tile label="Published cases" value={String(s.cases.published)} hint={`${s.cases.inReview} in review · ${s.cases.draft} draft`} onClick={() => setTab('cases')} />
            <Tile label="Open IC decisions" value={String(s.openDecisions)} hint={`${s.awaitingMyVote} await your vote`} onClick={() => setTab('decisions')} />
            <Tile label="Awaiting ratification" value={String(s.awaitingRatification)} hint="Voting open; a second person ratifies" onClick={() => setTab('decisions')} />
            <Tile label="Next meeting" value={s.upcomingMeetings[0] ? formatDate(s.upcomingMeetings[0].scheduledAt) : '—'} hint={s.upcomingMeetings[0]?.title ?? 'None scheduled'} onClick={() => setTab('meetings')} />
          </div>
        )}
      </Loaded>
      <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['cases', 'decisions', 'meetings'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`ops-btn${tab === t ? ' primary' : ''}`} type="button" onClick={() => setTab(t)}>
            {t === 'cases' ? 'Research cases' : t === 'decisions' ? 'IC decisions' : 'IC meetings'}
          </button>
        ))}
      </div>
      {tab === 'cases' && <CasesTab onOpen={(id) => setOpen({ kind: 'case', id })} onChanged={summary.reload} />}
      {tab === 'decisions' && <DecisionsTab onOpen={(id) => setOpen({ kind: 'decision', id })} onChanged={summary.reload} />}
      {tab === 'meetings' && <MeetingsTab onOpen={(id) => setOpen({ kind: 'meeting', id })} onChanged={summary.reload} />}
      {open?.kind === 'case' && <CaseModal id={open.id} onClose={() => setOpen(null)} onChanged={summary.reload} />}
      {open?.kind === 'decision' && <DecisionModal id={open.id} onClose={() => setOpen(null)} onChanged={summary.reload} />}
      {open?.kind === 'meeting' && <MeetingModal id={open.id} onClose={() => setOpen(null)} onChanged={summary.reload} onOpenDecision={(id) => setOpen({ kind: 'decision', id })} />}
    </>
  );
}

// ================================================================ cases

function CasesTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const res = useResource<CaseRow[]>(() => api.get<CaseRow[]>(R(`/cases${qs({ status, q, mine: mine ? '1' : '' })}`)), [status, q, mine]);
  const securities = useSecurities();
  return (
    <Card title="Research cases" actions={canEdit && <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>New case</button>}>
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'].map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input className="ops-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, ref or thesis" />
        </Field>
        <Field label="Mine only">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        </Field>
      </div>
      <Loaded res={res} what="research cases">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No research cases match. Start one with New case.</Empty>
          ) : (
            <DataTable head={['Case', 'Security', 'Rating', 'Target', 'Upside', 'Conviction', 'Status', 'Analyst']}>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                  <td><strong>{c.ref}</strong><div className="ops-muted">{c.title}</div></td>
                  <td>{c.ticker}</td>
                  <td><Tag value={c.rating} /></td>
                  <td className="r">{c.currency} {c.targetPrice}</td>
                  <td className="r">{c.upsidePct === null ? '—' : `${c.upsidePct}%`}</td>
                  <td className="r">{c.conviction}/5</td>
                  <td><Tag value={c.status} /></td>
                  <td>{c.analystName}</td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && (
        <FormModal
          title="New research case"
          submitLabel="Create draft"
          wide
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post(R('/cases'), { securityId: str(fd, 'securityId'), title: str(fd, 'title'), thesis: str(fd, 'thesis'), risks: optStr(fd, 'risks'), rating: str(fd, 'rating'), targetPrice: str(fd, 'targetPrice'), horizonMonths: Number(str(fd, 'horizon') || 12), conviction: Number(str(fd, 'conviction') || 3) }, { idempotencyKey: key })
          }
          onDone={() => {
            res.reload();
            onChanged();
          }}
        >
          <FieldGrid>
            <Field label="Security">
              <select className="ops-input" name="securityId" required>
                <option value="">Choose a security</option>
                {securities.map((s) => (
                  <option key={s.id} value={s.id}>{s.ticker} · {s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Title"><input className="ops-input" name="title" required minLength={3} maxLength={200} /></Field>
            <Field label="Rating">
              <select className="ops-input" name="rating" defaultValue="HOLD">{RATINGS.map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            <Field label="Target price" hint="In the security's currency"><input className="ops-input" name="targetPrice" inputMode="decimal" required /></Field>
            <Field label="Horizon (months)"><input className="ops-input" name="horizon" type="number" min={1} max={120} defaultValue={12} /></Field>
            <Field label="Conviction (1-5)"><input className="ops-input" name="conviction" type="number" min={1} max={5} defaultValue={3} /></Field>
            <Field label="Thesis" span={2}><textarea className="ops-input" name="thesis" rows={5} minLength={20} required /></Field>
            <Field label="Risks" span={2}><textarea className="ops-input" name="risks" rows={3} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function CaseModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const canEdit = useCan('research.edit');
  const canDecide = useCan('research.ic.decide');
  const res = useResource<CaseRow>(() => api.get<CaseRow>(R(`/cases/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'edit' | 'return' | 'revise' | 'archive' | 'propose'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="Research case" kicker="Research & IC" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this case">
          {(c) => {
            const author = c.analystId === user.id;
            return (
              <>
                <h3 style={{ marginTop: 0 }}>{c.ref} · {c.title} <Tag value={c.status} /></h3>
                <p className="ops-muted">{c.ticker} · {c.securityName} · analyst {c.analystName}{c.reviewerName ? ` · reviewed by ${c.reviewerName}` : ''}</p>
                {c.returnReason && <Alert kind="warn">Returned: {c.returnReason}</Alert>}
                <dl className="ops-dl">
                  <div><dt>Rating</dt><dd><Tag value={c.rating} /></dd></div>
                  <div><dt>Target price</dt><dd>{c.currency} {c.targetPrice}</dd></div>
                  <div><dt>Latest price</dt><dd>{c.latestPrice ? `${c.currency} ${c.latestPrice}` : '—'}</dd></div>
                  <div><dt>Upside</dt><dd>{c.upsidePct === null ? '—' : `${c.upsidePct}%`}</dd></div>
                  <div><dt>Horizon</dt><dd>{c.horizonMonths} months</dd></div>
                  <div><dt>Conviction</dt><dd>{c.conviction}/5</dd></div>
                </dl>
                <h4>Thesis</h4>
                <p style={{ whiteSpace: 'pre-wrap' }}>{c.thesis}</p>
                {c.risks && (
                  <>
                    <h4>Risks</h4>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{c.risks}</p>
                  </>
                )}
                <h4>Rating history</h4>
                {c.history && c.history.length ? (
                  <DataTable head={['When', 'Rating', 'Target', 'Price then', 'Conviction', 'Author', 'Approved by']}>
                    {c.history.map((h) => (
                      <tr key={h.createdAt}>
                        <td>{formatDateTime(h.createdAt)}</td>
                        <td><Tag value={h.rating} /></td>
                        <td className="r">{h.targetPrice}</td>
                        <td className="r">{h.priceAtChange ?? '—'}</td>
                        <td className="r">{h.conviction}/5</td>
                        <td>{h.changedByName}</td>
                        <td>{h.approvedByName}</td>
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <p className="ops-muted">Nothing published yet.</p>
                )}
                <h4>IC decisions</h4>
                {c.decisions && c.decisions.length ? (
                  <DataTable head={['Decision', 'Action', 'Status', 'Votes']}>
                    {c.decisions.map((d) => (
                      <tr key={d.id}>
                        <td>{d.ref}</td>
                        <td>{d.action} {d.quantity ?? ''}</td>
                        <td><Tag value={d.status} /></td>
                        <td>{d.tally.for}-{d.tally.against}-{d.tally.abstain}</td>
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <p className="ops-muted">No proposals yet.</p>
                )}
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  {c.status === 'DRAFT' && author && canEdit && (
                    <>
                      <button className="ops-btn" type="button" onClick={() => setSub('edit')}>Edit</button>
                      <ActionButton primary label="Submit for review" onRun={(k) => api.post(R(`/cases/${c.id}/submit`), {}, { idempotencyKey: k })} onDone={done} />
                    </>
                  )}
                  {c.status === 'IN_REVIEW' && canDecide && !author && (
                    <>
                      <ActionButton primary label="Publish" confirm="Publish this rating and target?" onRun={(k) => api.post(R(`/cases/${c.id}/publish`), {}, { idempotencyKey: k })} onDone={done} />
                      <button className="ops-btn" type="button" onClick={() => setSub('return')}>Return to author</button>
                    </>
                  )}
                  {c.status === 'IN_REVIEW' && author && <span className="ops-muted">Waiting for a second person to review (you cannot publish your own case).</span>}
                  {c.status === 'PUBLISHED' && canEdit && (
                    <>
                      <button className="ops-btn primary" type="button" onClick={() => setSub('propose')}>Take to committee</button>
                      <button className="ops-btn" type="button" onClick={() => setSub('revise')}>Revise</button>
                    </>
                  )}
                  {c.status !== 'ARCHIVED' && canEdit && <button className="ops-btn" type="button" onClick={() => setSub('archive')}>Archive</button>}
                </div>
                {sub === 'edit' && (
                  <FormModal title="Edit draft" submitLabel="Save" wide onClose={() => setSub(null)} onSubmit={(fd) => api.patch(R(`/cases/${c.id}`), { title: str(fd, 'title'), thesis: str(fd, 'thesis'), risks: optStr(fd, 'risks'), rating: str(fd, 'rating'), targetPrice: str(fd, 'targetPrice'), conviction: Number(str(fd, 'conviction')), version: c.version })} onDone={done}>
                    <FieldGrid>
                      <Field label="Title"><input className="ops-input" name="title" defaultValue={c.title} required /></Field>
                      <Field label="Rating"><select className="ops-input" name="rating" defaultValue={c.rating}>{RATINGS.map((r) => <option key={r}>{r}</option>)}</select></Field>
                      <Field label="Target price"><input className="ops-input" name="targetPrice" defaultValue={c.targetPrice} required /></Field>
                      <Field label="Conviction"><input className="ops-input" name="conviction" type="number" min={1} max={5} defaultValue={c.conviction} /></Field>
                      <Field label="Thesis" span={2}><textarea className="ops-input" name="thesis" rows={5} defaultValue={c.thesis} required /></Field>
                      <Field label="Risks" span={2}><textarea className="ops-input" name="risks" rows={3} defaultValue={c.risks ?? ''} /></Field>
                    </FieldGrid>
                  </FormModal>
                )}
                {sub === 'return' && <ReasonModal title="Return to author" submitLabel="Return" onClose={() => setSub(null)} onSubmit={(reason) => api.post(R(`/cases/${c.id}/return`), { reason })} onDone={done} />}
                {sub === 'revise' && <ReasonModal title="Revise a published case" hint="It goes back to draft and must be published again" submitLabel="Revise" onClose={() => setSub(null)} onSubmit={(reason) => api.post(R(`/cases/${c.id}/revise`), { reason })} onDone={done} />}
                {sub === 'archive' && <ReasonModal title="Archive case" submitLabel="Archive" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(R(`/cases/${c.id}/archive`), { reason })} onDone={done} />}
                {sub === 'propose' && <ProposeModal caseId={c.id} onClose={() => setSub(null)} onDone={done} />}
              </>
            );
          }}
        </Loaded>
      </div>
    </Modal>
  );
}

// ================================================================ decisions

function ProposeModal({ caseId, onClose, onDone }: { caseId?: string; onClose: () => void; onDone: () => void }) {
  const portfolios = usePortfolios();
  const cases = useResource<CaseRow[]>(() => api.get<CaseRow[]>(R('/cases?status=PUBLISHED')), []);
  const meetings = useResource<MeetingRow[]>(() => api.get<MeetingRow[]>(R('/meetings?status=SCHEDULED')), []);
  const [action, setAction] = useState('BUY');
  return (
    <FormModal
      title="Propose to the investment committee"
      submitLabel="Create proposal"
      wide
      onClose={onClose}
      onSubmit={(fd, key) =>
        api.post(R('/decisions'), { caseId: str(fd, 'caseId'), meetingId: optStr(fd, 'meetingId'), portfolioId: optStr(fd, 'portfolioId'), action: str(fd, 'action'), quantity: action === 'HOLD' ? undefined : str(fd, 'quantity'), rationale: str(fd, 'rationale') }, { idempotencyKey: key })
      }
      onDone={onDone}
    >
      <FieldGrid>
        <Field label="Research case">
          <select className="ops-input" name="caseId" defaultValue={caseId ?? ''} required>
            <option value="">Choose a published case</option>
            {cases.state === 'ok' && cases.data.map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.ticker} · {c.rating}</option>)}
          </select>
        </Field>
        <Field label="Meeting">
          <select className="ops-input" name="meetingId" defaultValue="">
            <option value="">No meeting (ad hoc)</option>
            {meetings.state === 'ok' && meetings.data.map((m) => <option key={m.id} value={m.id}>{m.ref} · {formatDate(m.scheduledAt)}</option>)}
          </select>
        </Field>
        <Field label="Action">
          <select className="ops-input" name="action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option>BUY</option>
            <option>SELL</option>
            <option>HOLD</option>
          </select>
        </Field>
        <Field label="Quantity (units)"><input className="ops-input" name="quantity" inputMode="decimal" disabled={action === 'HOLD'} required={action !== 'HOLD'} /></Field>
        <Field label="Portfolio" hint="Default portfolio for the order"><PortfolioSelect name="portfolioId" list={portfolios} all="Not set" /></Field>
        <Field label="Rationale" span={2}><textarea className="ops-input" name="rationale" rows={4} minLength={10} required /></Field>
      </FieldGrid>
    </FormModal>
  );
}

function DecisionsTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const res = useResource<DecisionRow[]>(() => api.get<DecisionRow[]>(R(`/decisions${qs({ status })}`)), [status]);
  return (
    <Card title="IC decisions" actions={canEdit && <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>New proposal</button>}>
      <div className="ops-filters">
        <Field label="Status">
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {['PROPOSED', 'VOTING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </Field>
      </div>
      <Loaded res={res} what="IC decisions">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No decisions yet. Publish a case, then take it to committee.</Empty>
          ) : (
            <DataTable head={['Decision', 'Case', 'Proposal', 'Meeting', 'Votes', 'Status', 'Orders']}>
              {rows.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => onOpen(d.id)}>
                  <td><strong>{d.ref}</strong><div className="ops-muted">{d.proposerName}</div></td>
                  <td>{d.caseRef} · {d.ticker}</td>
                  <td><Tag value={d.action} /> {d.quantity ?? ''}</td>
                  <td>{d.meetingRef ?? '—'}</td>
                  <td>{d.tally.for}-{d.tally.against}-{d.tally.abstain} <span className="ops-muted">/ quorum {d.quorum}</span></td>
                  <td><Tag value={d.status} /></td>
                  <td>{d.orders.map((o) => o.orderRef).join(', ') || '—'}</td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && <ProposeModal onClose={() => setCreating(false)} onDone={() => { res.reload(); onChanged(); }} />}
    </Card>
  );
}

function DecisionModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useSession();
  const canEdit = useCan('research.edit');
  const canDecide = useCan('research.ic.decide');
  const canOrder = useCan('orders.create');
  const portfolios = usePortfolios();
  const res = useResource<DecisionRow>(() => api.get<DecisionRow>(R(`/decisions/${encodeURIComponent(id)}`)), [id]);
  const [sub, setSub] = useState<null | 'withdraw' | 'order' | 'ratify'>(null);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="IC decision" kicker="Research & IC" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this decision">
          {(d) => {
            const proposer = d.proposerId === user.id;
            return (
              <>
                <h3 style={{ marginTop: 0 }}>{d.ref} · <Tag value={d.action} /> {d.quantity ?? ''} {d.ticker} <Tag value={d.status} /></h3>
                <p className="ops-muted">{d.caseRef} · {d.caseTitle} · proposed by {d.proposerName}{d.meetingRef ? ` · ${d.meetingRef}` : ''}{d.portfolioName ? ` · ${d.portfolioName}` : ''}</p>
                {d.warning && <Alert kind="warn">{d.warning}</Alert>}
                <p style={{ whiteSpace: 'pre-wrap' }}>{d.rationale}</p>
                <dl className="ops-dl">
                  <div><dt>For</dt><dd>{d.tally.for}</dd></div>
                  <div><dt>Against</dt><dd>{d.tally.against}</dd></div>
                  <div><dt>Abstain</dt><dd>{d.tally.abstain}</dd></div>
                  <div><dt>Quorum</dt><dd>{d.tally.total} of {d.quorum}</dd></div>
                  {d.projected && <div><dt>If ratified now</dt><dd>{label(d.projected.outcome)}</dd></div>}
                  {d.ratifiedByName && <div><dt>Ratified by</dt><dd>{d.ratifiedByName}</dd></div>}
                </dl>
                {d.outcomeNote && <p className="ops-muted">{d.outcomeNote}</p>}
                <h4>Votes</h4>
                {d.votes.length ? (
                  <DataTable head={['Voter', 'Vote', 'Comment', 'When']}>
                    {d.votes.map((v) => (
                      <tr key={v.castAt + v.voterName}>
                        <td>{v.voterName}</td>
                        <td><Tag value={v.vote} tone={v.vote === 'FOR' ? 'green' : v.vote === 'AGAINST' ? 'red' : 'grey'} /></td>
                        <td>{v.comment ?? ''}</td>
                        <td>{formatDateTime(v.castAt)}</td>
                      </tr>
                    ))}
                  </DataTable>
                ) : (
                  <p className="ops-muted">No votes yet.</p>
                )}
                {d.orders.length > 0 && <p>Draft orders created: <strong>{d.orders.map((o) => o.orderRef).join(', ')}</strong>. Approve and route them in Orders.</p>}
                <div className="ops-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  {d.status === 'PROPOSED' && proposer && <ActionButton primary label="Open voting" onRun={(k) => api.post(R(`/decisions/${d.id}/open-voting`), {}, { idempotencyKey: k })} onDone={done} />}
                  {d.status === 'VOTING' && canEdit && (
                    <>
                      {(['FOR', 'AGAINST', 'ABSTAIN'] as const).map((v) => (
                        <ActionButton key={v} label={`Vote ${v.toLowerCase()}${d.myVote === v ? ' ✓' : ''}`} primary={d.myVote === v} onRun={() => api.post(R(`/decisions/${d.id}/vote`), { vote: v })} onDone={done} />
                      ))}
                    </>
                  )}
                  {d.status === 'VOTING' && canDecide && !proposer && <button className="ops-btn primary" type="button" onClick={() => setSub('ratify')}>Ratify result</button>}
                  {d.status === 'VOTING' && proposer && <span className="ops-muted">A different person with research.ic.decide ratifies the result.</span>}
                  {['PROPOSED', 'VOTING'].includes(d.status) && proposer && <button className="ops-btn" type="button" onClick={() => setSub('withdraw')}>Withdraw</button>}
                  {d.status === 'APPROVED' && d.action !== 'HOLD' && canOrder && <button className="ops-btn primary" type="button" onClick={() => setSub('order')}>Create draft order</button>}
                </div>
                {sub === 'withdraw' && <ReasonModal title="Withdraw proposal" submitLabel="Withdraw" danger onClose={() => setSub(null)} onSubmit={(reason) => api.post(R(`/decisions/${d.id}/withdraw`), { reason })} onDone={done} />}
                {sub === 'ratify' && (
                  <FormModal title="Ratify the committee result" subtitle="The outcome is the vote tally; ratification needs quorum and confirms it." submitLabel="Ratify" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(R(`/decisions/${d.id}/ratify`), { note: optStr(fd, 'note') }, { idempotencyKey: k })} onDone={done}>
                    <Field label="Note"><input className="ops-input" name="note" maxLength={500} /></Field>
                  </FormModal>
                )}
                {sub === 'order' && (
                  <FormModal title="Create draft order" subtitle="A DRAFT order linked to this decision. It still needs Orders approval and routing." submitLabel="Create order" onClose={() => setSub(null)} onSubmit={(fd, k) => api.post(R(`/decisions/${d.id}/orders`), { portfolioId: optStr(fd, 'portfolioId') ?? d.portfolioId ?? undefined, quantity: optStr(fd, 'quantity'), orderType: str(fd, 'orderType'), limitPrice: optStr(fd, 'limitPrice') }, { idempotencyKey: k })} onDone={done}>
                    <FieldGrid>
                      <Field label="Portfolio"><PortfolioSelect name="portfolioId" list={portfolios} value={undefined} all={d.portfolioName ?? 'Choose a portfolio'} /></Field>
                      <Field label="Quantity" hint={d.quantity ? `Approved: ${d.quantity}` : undefined}><input className="ops-input" name="quantity" inputMode="decimal" placeholder={d.quantity ?? ''} /></Field>
                      <Field label="Order type"><select className="ops-input" name="orderType"><option>MARKET</option><option>LIMIT</option></select></Field>
                      <Field label="Limit price"><input className="ops-input" name="limitPrice" inputMode="decimal" /></Field>
                    </FieldGrid>
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

// ================================================================ meetings

function MeetingsTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const canEdit = useCan('research.edit');
  const [creating, setCreating] = useState(false);
  const res = useResource<MeetingRow[]>(() => api.get<MeetingRow[]>(R('/meetings')), []);
  return (
    <Card title="IC meetings" actions={canEdit && <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>Schedule meeting</button>}>
      <Loaded res={res} what="meetings">
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No meetings scheduled.</Empty>
          ) : (
            <DataTable head={['Meeting', 'When', 'Chair', 'Quorum', 'Decisions', 'Status']}>
              {rows.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => onOpen(m.id)}>
                  <td><strong>{m.ref}</strong><div className="ops-muted">{m.title}</div></td>
                  <td>{formatDateTime(m.scheduledAt)}</td>
                  <td>{m.chairName}</td>
                  <td className="r">{m.quorum}</td>
                  <td className="r">{m.decisions} ({m.openDecisions} open)</td>
                  <td><Tag value={m.status} /></td>
                </tr>
              ))}
            </DataTable>
          )
        }
      </Loaded>
      {creating && (
        <FormModal title="Schedule IC meeting" submitLabel="Schedule" onClose={() => setCreating(false)} onSubmit={(fd, k) => api.post(R('/meetings'), { title: str(fd, 'title'), scheduledAt: new Date(str(fd, 'when')).toISOString(), agenda: optStr(fd, 'agenda'), quorum: Number(str(fd, 'quorum') || 3) }, { idempotencyKey: k })} onDone={() => { res.reload(); onChanged(); }}>
          <FieldGrid>
            <Field label="Title"><input className="ops-input" name="title" required minLength={3} /></Field>
            <Field label="Date and time"><input className="ops-input" name="when" type="datetime-local" required /></Field>
            <Field label="Quorum (votes)"><input className="ops-input" name="quorum" type="number" min={1} max={20} defaultValue={3} /></Field>
            <Field label="Agenda" span={2}><textarea className="ops-input" name="agenda" rows={3} /></Field>
          </FieldGrid>
        </FormModal>
      )}
    </Card>
  );
}

function MeetingModal({ id, onClose, onChanged, onOpenDecision }: { id: string; onClose: () => void; onChanged: () => void; onOpenDecision: (id: string) => void }) {
  const canEdit = useCan('research.edit');
  const res = useResource<MeetingRow>(() => api.get<MeetingRow>(R(`/meetings/${encodeURIComponent(id)}`)), [id]);
  const [held, setHeld] = useState(false);
  const done = () => {
    res.reload();
    onChanged();
  };
  return (
    <Modal title="IC meeting" kicker="Research & IC" onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={res} what="this meeting">
          {(m) => (
            <>
              <h3 style={{ marginTop: 0 }}>{m.ref} · {m.title} <Tag value={m.status} /></h3>
              <p className="ops-muted">{formatDateTime(m.scheduledAt)} · chair {m.chairName} · quorum {m.quorum}</p>
              {m.agenda && <p style={{ whiteSpace: 'pre-wrap' }}>{m.agenda}</p>}
              {m.minutes && (
                <>
                  <h4>Minutes</h4>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{m.minutes}</p>
                </>
              )}
              <h4>Decisions</h4>
              {m.decisionList && m.decisionList.length ? (
                <DataTable head={['Decision', 'Proposal', 'Votes', 'Status']}>
                  {m.decisionList.map((d) => (
                    <tr key={d.id} className="clickable" onClick={() => onOpenDecision(d.id)}>
                      <td>{d.ref}</td>
                      <td>{d.action} {d.quantity ?? ''} {d.ticker}</td>
                      <td>{d.tally.for}-{d.tally.against}-{d.tally.abstain}</td>
                      <td><Tag value={d.status} /></td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <p className="ops-muted">Nothing is on the agenda.</p>
              )}
              {m.status === 'SCHEDULED' && canEdit && (
                <div className="ops-actions" style={{ marginTop: 14 }}>
                  <button className="ops-btn primary" type="button" onClick={() => setHeld(true)}>Mark as held</button>
                  <ActionButton label="Cancel meeting" danger confirm="Cancel this meeting?" onRun={() => api.patch(R(`/meetings/${m.id}`), { status: 'CANCELLED' })} onDone={done} />
                </div>
              )}
              {held && (
                <FormModal title="Close the meeting" submitLabel="Mark as held" onClose={() => setHeld(false)} onSubmit={(fd) => api.patch(R(`/meetings/${m.id}`), { status: 'HELD', minutes: optStr(fd, 'minutes') })} onDone={done}>
                  <Field label="Minutes" hint="Every decision must have a ratified outcome first"><textarea className="ops-input" name="minutes" rows={5} /></Field>
                </FormModal>
              )}
            </>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}
