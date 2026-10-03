'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createInvesteeApi, InvesteeApiError, loadPlatformFlags, setStepUpHandler, type InvesteeApi } from '@/lib/investee/api';
import { StepUpDialog } from '@/components/StepUpDialog';

type Tab = 'cap' | 'board' | 'signatures' | 'sharing' | 'kpis' | 'access';
const TABS: { id: Tab; label: string }[] = [
  { id: 'cap', label: 'Cap table' },
  { id: 'board', label: 'Board and forecast' },
  { id: 'signatures', label: 'Signature requests' },
  { id: 'sharing', label: 'Share links' },
  { id: 'kpis', label: 'KPIs and export' },
  { id: 'access', label: 'Access and MFA' },
];

interface CapView {
  derived: boolean;
  shareholders: { id: string; name: string; type: string; shares: number; pct: number }[];
  classes: { id?: string; name: string; outstanding: number; preference: string }[];
  pendingTransactions: number;
}
interface CapTx { id: string; kind: string; status: string; holder: string; fromHolder: string | null; className: string; shares: number; consideration: number; currency: string; effectiveDate: string; maker: string; glStatus: string; glRef: string | null; glNote: string | null }
interface Cert { id: string; holder: string; className: string; shares: number; issuedOn: string; sha256: string }
interface WaterfallOut { distributed: number; classes: { name: string; shares: number; preferencePaid: number; residual: number; total: number; perShare: number; converted: boolean }[]; holders: { holder: string; className: string; shares: number; payout: number }[] }
interface Meeting { id: string; ref: string; title: string; meetingAt: string; status: string; packStatus: string; packSha256: string | null; pack: { id: string; documentId: string; name: string }[] }
interface Action { id: string; title: string; owner: string; due: string; status: string }
interface Forecast { months: { key: string; label: string; stage: string; locked: boolean }[]; lockedPeriods: string[] }
interface SignReq { id: string; ref: string; title: string; status: string; expiresAt: string; reminderCount: number; signers: { id: string; name: string; email: string; status: string }[] }
interface ShareLink { id: string; documentName: string; recipient: string; status: string; expiresAt: string; accessCount: number }
interface Doc { id: string; name: string }
interface KpiRow { period: string; status: string; values: Record<string, number | null> }
interface Access { members: { userId: string; name: string | null; email: string; profile: string; status: string; mfa: boolean; lastLoginAt: string | null }[]; coverage: { active: number; mfa: number; pct: number }; reviewDue: boolean; lastReview: { reviewedAt: string } | null }
interface Hit { type: string; id: string; title: string; subtitle: string; page: string }

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#6b7280', padding: '6px 8px', borderBottom: '1px solid #e5e7eb' };
const td: React.CSSProperties = { fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };
const input: React.CSSProperties = { border: '1px solid #d1d5db', borderRadius: 8, padding: '7px 9px', fontSize: 13, minWidth: 0 };
const btn: React.CSSProperties = { border: 0, borderRadius: 8, padding: '7px 12px', fontSize: 13, background: '#4f46e5', color: '#fff', cursor: 'pointer' };
const ghost: React.CSSProperties = { ...btn, background: '#fff', color: '#111827', border: '1px solid #d1d5db' };
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 };
const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={{ margin: '0 0 8px', fontSize: 15 }}>{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Nothing recorded yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={td}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkspaceTools() {
  const [api, setApi] = useState<InvesteeApi | null>(null);
  const [blocked, setBlocked] = useState('');
  const [tab, setTab] = useState<Tab>('cap');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [stepUp, setStepUp] = useState<{ reason: string; mode: 'verify' | 'enroll'; resolve: (ok: boolean) => void } | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);

  useEffect(() => {
    setStepUpHandler((err) => new Promise<boolean>((resolve) => setStepUp({ reason: err.message, mode: err.code === 'mfa_enrolment_required' ? 'enroll' : 'verify', resolve })));
    loadPlatformFlags()
      .then((flags) => {
        const live = Array.isArray(flags?.investee?.liveActions) ? flags.investee.liveActions : [];
        const next = createInvesteeApi(live);
        if (!next.isLive('workspace')) setBlocked('Workspace tools are not enabled for this environment. Ask Matanho support to add "workspace" to the live actions.');
        else {
          setApi(next);
          next.workspace<{ documents: Doc[] }>('GET', '/vault').then((v) => setDocs(v.documents ?? [])).catch(() => undefined);
        }
      })
      .catch(() => setBlocked('Live settings could not be loaded. Reload the page.'));
    return () => setStepUpHandler(null);
  }, []);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const out = await fn();
      setMsg({ kind: 'ok', text: label });
      return out;
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof InvesteeApiError ? e.message : 'Something went wrong' });
      return undefined;
    }
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!api) return;
    const out = await run('Search done', () => api.workspace<{ hits: Hit[] }>('GET', `/search?q=${encodeURIComponent(query)}`));
    if (out) setHits(out.hits);
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <a href="/" style={{ fontSize: 13, color: '#4f46e5' }}>Back to the portal</a>
          <h1 style={{ margin: '4px 0 0', fontSize: 22 }}>Workspace tools</h1>
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
          <input aria-label="Search the workspace" style={{ ...input, width: 240 }} placeholder="Search documents, requests, meetings" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button style={btn} disabled={!api || query.trim().length < 2}>Search</button>
        </form>
      </header>

      {blocked && <p role="alert" style={{ ...card, color: '#92400e', background: '#fffbeb' }}>{blocked}</p>}
      {msg && <p role="status" style={{ ...card, padding: 10, fontSize: 13, color: msg.kind === 'ok' ? '#065f46' : '#991b1b', background: msg.kind === 'ok' ? '#ecfdf5' : '#fef2f2' }}>{msg.text}</p>}

      {hits && (
        <Section title={`Search results (${hits.length})`}>
          <Table head={['Type', 'Title', 'Detail', '']} rows={hits.map((h) => [h.type.replace('_', ' '), h.title, h.subtitle, <a key={h.id} href={h.page}>Open</a>])} />
          <div style={row}><button style={ghost} onClick={() => setHits(null)}>Clear</button></div>
        </Section>
      )}

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }} aria-label="Workspace sections">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id} style={tab === t.id ? btn : ghost}>{t.label}</button>
        ))}
      </nav>

      {api && tab === 'cap' && <CapTab api={api} run={run} />}
      {api && tab === 'board' && <BoardTab api={api} run={run} docs={docs} />}
      {api && tab === 'signatures' && <SignaturesTab api={api} run={run} docs={docs} />}
      {api && tab === 'sharing' && <SharingTab api={api} run={run} docs={docs} />}
      {api && tab === 'kpis' && <KpiTab api={api} run={run} />}
      {api && tab === 'access' && <AccessTab api={api} run={run} />}

      {stepUp && <StepUpDialog reason={stepUp.reason} mode={stepUp.mode} onDone={(ok) => { stepUp.resolve(ok); setStepUp(null); }} />}
    </div>
  );
}

type Run = <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
interface TabProps { api: InvesteeApi; run: Run }

function useLoad<T>(api: InvesteeApi, run: Run, path: string) {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    const out = await run('Loaded', () => api.workspace<T>('GET', path));
    if (out) setData(out);
  }, [api, run, path]);
  useEffect(() => {
    void load();
  }, [load]);
  return [data, load] as const;
}

function CapTab({ api, run }: TabProps) {
  const [cap, loadCap] = useLoad<CapView>(api, run, '/cap-table');
  const [txs, loadTxs] = useLoad<{ transactions: CapTx[] }>(api, run, '/cap-table/transactions');
  const [certs] = useLoad<{ certificates: Cert[] }>(api, run, '/cap-table/certificates');
  const [wf, setWf] = useState<WaterfallOut | null>(null);
  const [f, setF] = useState({ kind: 'ISSUANCE', holder: '', fromHolder: '', className: 'Ordinary', shares: '', price: '', note: '' });
  const [exit, setExit] = useState('');
  const reload = () => {
    void loadCap();
    void loadTxs();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = { kind: f.kind, holder: f.holder, className: f.className, shares: Number(f.shares), ...(f.fromHolder ? { fromHolder: f.fromHolder } : {}), ...(f.price ? { pricePerShare: Number(f.price) } : {}), ...(f.note ? { note: f.note } : {}) };
    if (await run('Transaction submitted for a second person to approve', () => api.workspace('POST', '/cap-table/transactions', body))) {
      setF({ ...f, holder: '', fromHolder: '', shares: '', price: '', note: '' });
      reload();
    }
  }
  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    if (await run(decision === 'APPROVE' ? 'Approved' : 'Rejected', () => api.workspace('POST', `/cap-table/transactions/${id}/decide`, { decision }))) reload();
  };
  async function download(id: string) {
    const out = await run('Link ready', () => api.workspace<{ url: string }>('GET', `/cap-table/certificates/${id}/download-url`));
    if (out) window.open(out.url, '_blank', 'noopener');
  }
  async function model(e: FormEvent) {
    e.preventDefault();
    const out = await run('Waterfall calculated', () => api.workspace<WaterfallOut>('POST', '/cap-table/waterfall', { exitValue: Number(exit) }));
    if (out) setWf(out);
  }

  return (
    <>
      <Section title={`Register${cap?.derived ? ' (estimated from the term sheet)' : ''}`}>
        <Table head={['Holder', 'Class', 'Shares', '%']} rows={(cap?.shareholders ?? []).map((s) => [s.name, s.type, n(s.shares), `${s.pct}%`])} />
        {cap && cap.pendingTransactions > 0 && <p style={{ fontSize: 13 }}>{cap.pendingTransactions} transaction(s) wait for approval.</p>}
      </Section>
      <Section title="New transaction">
        <form onSubmit={submit} style={row}>
          <select style={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="Kind">
            <option value="ISSUANCE">Issue shares</option>
            <option value="TRANSFER">Transfer</option>
            <option value="CANCELLATION">Cancel or buy back</option>
          </select>
          <input style={input} placeholder={f.kind === 'TRANSFER' ? 'To holder' : 'Holder'} value={f.holder} onChange={(e) => setF({ ...f, holder: e.target.value })} required />
          {f.kind === 'TRANSFER' && <input style={input} placeholder="From holder" value={f.fromHolder} onChange={(e) => setF({ ...f, fromHolder: e.target.value })} required />}
          <input style={input} placeholder="Share class" value={f.className} onChange={(e) => setF({ ...f, className: e.target.value })} required />
          <input style={{ ...input, width: 110 }} type="number" min="1" placeholder="Shares" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} required />
          <input style={{ ...input, width: 110 }} type="number" min="0" step="any" placeholder="Price / share" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <input style={{ ...input, flex: 1 }} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button style={btn}>Submit</button>
        </form>
        <p style={{ fontSize: 12, color: '#6b7280' }}>The person who enters a transaction cannot approve it. Approval needs an administrator or approver and an authentication code.</p>
      </Section>
      <Section title="Transactions">
        <Table
          head={['Ref', 'Kind', 'Holder', 'Class', 'Shares', 'Amount', 'Status', 'Ledger', '']}
          rows={(txs?.transactions ?? []).map((t) => [
            t.id,
            t.kind,
            t.fromHolder ? `${t.fromHolder} to ${t.holder}` : t.holder,
            t.className,
            n(t.shares),
            t.consideration ? `${t.currency} ${n(t.consideration)}` : '',
            t.status.replace('_', ' ').toLowerCase(),
            t.glStatus === 'NONE' ? '' : t.glRef ? `${t.glRef} (awaiting accounting)` : (t.glNote ?? t.glStatus),
            t.status === 'PENDING_APPROVAL' ? (
              <span key={t.id} style={{ display: 'flex', gap: 6 }}>
                <button style={btn} onClick={() => void decide(t.id, 'APPROVE')}>Approve</button>
                <button style={ghost} onClick={() => void decide(t.id, 'REJECT')}>Reject</button>
              </span>
            ) : (
              ''
            ),
          ])}
        />
      </Section>
      <Section title="Share certificates">
        <Table head={['Certificate', 'Holder', 'Class', 'Shares', 'Issued', 'SHA-256', '']} rows={(certs?.certificates ?? []).map((c) => [c.id, c.holder, c.className, n(c.shares), c.issuedOn, <code key={c.id} title={c.sha256}>{c.sha256.slice(0, 12)}</code>, <button key={`d${c.id}`} style={ghost} onClick={() => void download(c.id)}>Download</button>])} />
      </Section>
      <Section title="Exit waterfall">
        <form onSubmit={model} style={row}>
          <input style={input} type="number" min="1" placeholder="Exit value" value={exit} onChange={(e) => setExit(e.target.value)} required />
          <button style={btn}>Calculate</button>
        </form>
        {wf && (
          <>
            <Table head={['Class', 'Shares', 'Preference paid', 'Share of the rest', 'Total', 'Per share', 'Converts']} rows={wf.classes.map((c) => [c.name, n(c.shares), n(c.preferencePaid), n(c.residual), n(c.total), String(c.perShare), c.converted ? 'Yes' : 'No'])} />
            <p style={{ fontSize: 13 }}>Distributed {n(wf.distributed)}.</p>
            <Table head={['Holder', 'Class', 'Shares', 'Proceeds']} rows={wf.holders.map((h) => [h.holder, h.className, n(h.shares), n(h.payout)])} />
          </>
        )}
      </Section>
    </>
  );
}

function BoardTab({ api, run, docs }: TabProps & { docs: Doc[] }) {
  const [meets, loadMeets] = useLoad<{ meetings: Meeting[] }>(api, run, '/governance/meetings');
  const [gov, loadGov] = useLoad<{ actions: Action[] }>(api, run, '/governance');
  const [fc, loadFc] = useLoad<Forecast>(api, run, '/forecast');
  const [m, setM] = useState({ title: '', meetingAt: '', location: '' });
  const [a, setA] = useState({ title: '', owner: '' });
  const [pick, setPick] = useState<Record<string, string>>({});
  const reload = () => {
    void loadMeets();
    void loadGov();
  };
  async function create(e: FormEvent) {
    e.preventDefault();
    if (await run('Meeting scheduled', () => api.workspace('POST', '/governance/meetings', { title: m.title, meetingAt: m.meetingAt, ...(m.location ? { location: m.location } : {}) }))) {
      setM({ title: '', meetingAt: '', location: '' });
      reload();
    }
  }
  async function action(e: FormEvent) {
    e.preventDefault();
    if (await run('Action recorded', () => api.workspace('POST', '/governance/actions', a))) {
      setA({ title: '', owner: '' });
      reload();
    }
  }
  const toggleLock = async (period: string, locked: boolean) => {
    if (await run(locked ? 'Month unlocked' : 'Month locked', () => api.workspace('POST', locked ? '/forecast/unlock' : '/forecast/lock', { periods: [period] }))) void loadFc();
  };
  return (
    <>
      <Section title="Board calendar and packs">
        <form onSubmit={create} style={row}>
          <input style={{ ...input, flex: 1 }} placeholder="Meeting title" value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} required />
          <input style={input} type="date" value={m.meetingAt} onChange={(e) => setM({ ...m, meetingAt: e.target.value })} required aria-label="Date" />
          <input style={input} placeholder="Location" value={m.location} onChange={(e) => setM({ ...m, location: e.target.value })} />
          <button style={btn}>Schedule</button>
        </form>
        {(meets?.meetings ?? []).map((mt) => (
          <div key={mt.id} style={{ borderTop: '1px solid #f3f4f6', marginTop: 12, paddingTop: 10 }}>
            <strong>{mt.title}</strong> <span style={{ fontSize: 12, color: '#6b7280' }}>{mt.ref} - {mt.meetingAt.slice(0, 10)} - {mt.status.toLowerCase()}</span>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Pack: {mt.packStatus === 'PUBLISHED' ? <>published, hash <code>{mt.packSha256?.slice(0, 12)}</code></> : 'draft'}
              {mt.pack.length > 0 && <ul style={{ margin: '4px 0' }}>{mt.pack.map((p) => <li key={p.id}>{p.name}{mt.packStatus === 'DRAFT' && <button style={{ ...ghost, marginLeft: 8, padding: '2px 8px' }} onClick={() => void run('Removed', () => api.workspace('DELETE', `/governance/meetings/${mt.id}/pack/${p.id}`)).then(reload)}>Remove</button>}</li>)}</ul>}
            </div>
            {mt.packStatus === 'DRAFT' && (
              <div style={row}>
                <select style={input} aria-label="Document for the pack" value={pick[mt.id] ?? ''} onChange={(e) => setPick({ ...pick, [mt.id]: e.target.value })}>
                  <option value="">Choose a document</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button style={ghost} disabled={!pick[mt.id]} onClick={() => void run('Added to the pack', () => api.workspace('POST', `/governance/meetings/${mt.id}/pack`, { documentId: pick[mt.id] })).then(reload)}>Add</button>
                <button style={btn} disabled={mt.pack.length === 0} onClick={() => void run('Pack published', () => api.workspace('POST', `/governance/meetings/${mt.id}/publish`, {})).then(reload)}>Publish pack</button>
              </div>
            )}
          </div>
        ))}
      </Section>
      <Section title="Board actions">
        <Table
          head={['Action', 'Owner', 'Due', 'Status', '']}
          rows={(gov?.actions ?? []).map((x) => [x.title, x.owner, x.due, x.status, x.status === 'Complete' ? '' : <button key={x.id} style={ghost} onClick={() => void run('Marked complete', () => api.workspace('PATCH', `/governance/actions/${x.id}`, { status: 'COMPLETE' })).then(reload)}>Complete</button>])}
        />
        <form onSubmit={action} style={row}>
          <input style={{ ...input, flex: 1 }} placeholder="New action" value={a.title} onChange={(e) => setA({ ...a, title: e.target.value })} required />
          <input style={input} placeholder="Owner" value={a.owner} onChange={(e) => setA({ ...a, owner: e.target.value })} required />
          <button style={btn}>Add</button>
        </form>
      </Section>
      <Section title="Forecast months">
        <p style={{ fontSize: 13, margin: '0 0 8px' }}>A locked month rejects forecast edits. Approvers lock; only an administrator unlocks.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(fc?.months ?? []).map((mo) => (
            <button key={mo.key} style={mo.locked ? btn : ghost} onClick={() => void toggleLock(mo.key, mo.locked)} title={mo.stage}>{mo.label} {mo.locked ? '(locked)' : ''}</button>
          ))}
        </div>
      </Section>
    </>
  );
}

function SignaturesTab({ api, run, docs }: TabProps & { docs: Doc[] }) {
  const [data, load] = useLoad<{ requests: SignReq[] }>(api, run, '/signature-requests');
  const [f, setF] = useState({ documentId: '', title: '', signers: '' });
  async function create(e: FormEvent) {
    e.preventDefault();
    const signers = f.signers.split(/\n|;/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name, email] = s.includes(',') ? s.split(',').map((x) => x.trim()) : [s.split('@')[0] ?? s, s];
      return { name: name ?? '', email: email ?? '' };
    });
    if (await run('Request sent', () => api.workspace('POST', '/signature-requests', { documentId: f.documentId, ...(f.title ? { title: f.title } : {}), signers }))) {
      setF({ documentId: '', title: '', signers: '' });
      void load();
    }
  }
  return (
    <>
      <Section title="Ask people to sign a document">
        <form onSubmit={create}>
          <div style={row}>
            <select style={input} value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })} required aria-label="Document">
              <option value="">Choose a document</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input style={{ ...input, flex: 1 }} placeholder="Title (optional)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <textarea style={{ ...input, width: '100%', marginTop: 10, minHeight: 70 }} placeholder={'One signer per line: Name, email\nAda Moyo, ada@example.com'} value={f.signers} onChange={(e) => setF({ ...f, signers: e.target.value })} required />
          <div style={row}><button style={btn}>Send for signature</button></div>
        </form>
      </Section>
      <Section title="Requests">
        <Table
          head={['Ref', 'Document', 'Signers', 'Status', 'Expires', '']}
          rows={(data?.requests ?? []).map((r) => [
            r.ref,
            r.title,
            r.signers.map((s) => `${s.name}: ${s.status.toLowerCase()}`).join(', '),
            r.status.toLowerCase(),
            r.expiresAt.slice(0, 10),
            r.status === 'PENDING' ? (
              <span key={r.id} style={{ display: 'flex', gap: 6 }}>
                <button style={ghost} onClick={() => void run('Reminder sent', () => api.workspace('POST', `/signature-requests/${r.id}/remind`, {})).then(() => load())}>Remind</button>
                <button style={ghost} onClick={() => { const reason = window.prompt('Why is this request being voided?'); if (reason) void run('Voided', () => api.workspace('POST', `/signature-requests/${r.id}/void`, { reason })).then(() => load()); }}>Void</button>
              </span>
            ) : '',
          ])}
        />
      </Section>
    </>
  );
}

function SharingTab({ api, run, docs }: TabProps & { docs: Doc[] }) {
  const [data, load] = useLoad<{ links: ShareLink[] }>(api, run, '/share-links');
  const [f, setF] = useState({ documentId: '', recipient: '', days: '7' });
  const [fresh, setFresh] = useState('');
  async function create(e: FormEvent) {
    e.preventDefault();
    const out = await run('Link created. Copy it now; it is not shown again.', () => api.workspace<{ url: string }>('POST', '/share-links', { documentId: f.documentId, recipient: f.recipient, expiresInDays: Number(f.days) }));
    if (out) {
      setFresh(out.url);
      void load();
    }
  }
  return (
    <>
      <Section title="Share a document">
        <form onSubmit={create} style={row}>
          <select style={input} value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })} required aria-label="Document">
            <option value="">Choose a document</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input style={{ ...input, flex: 1 }} placeholder="Recipient (person or firm)" value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} required />
          <select style={input} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} aria-label="Expires after">
            {[1, 3, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
          </select>
          <button style={btn}>Create link</button>
        </form>
        {fresh && <p style={{ fontSize: 13, wordBreak: 'break-all' }}><code>{fresh}</code></p>}
        <p style={{ fontSize: 12, color: '#6b7280' }}>Links last at most 7 days. Text files show a watermark with the recipient name. Each open is counted.</p>
      </Section>
      <Section title="Links">
        <Table
          head={['Document', 'Recipient', 'Status', 'Expires', 'Opened', '']}
          rows={(data?.links ?? []).map((l) => [l.documentName, l.recipient, l.status.toLowerCase(), l.expiresAt.slice(0, 10), String(l.accessCount), l.status === 'ACTIVE' ? <button key={l.id} style={ghost} onClick={() => void run('Link revoked', () => api.workspace('DELETE', `/share-links/${l.id}`)).then(() => load())}>Revoke</button> : ''])}
        />
      </Section>
    </>
  );
}

const KPI_COLS: [string, string][] = [['revenue', 'Revenue'], ['revenueGrowthPct', 'Growth %'], ['grossMarginPct', 'Gross margin %'], ['netMarginPct', 'Net margin %'], ['cashFlowNet', 'Net cash flow'], ['runwayMonths', 'Runway (months)']];

function KpiTab({ api, run }: TabProps) {
  const [data] = useLoad<{ rows: KpiRow[] }>(api, run, '/kpis/history');
  async function exportAs(format: 'csv' | 'xlsx') {
    const blob = await run('Export ready', () => api.workspaceFile(`/kpis/export?format=${format}`));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kpi-history.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Section title="KPI history (derived from submitted reports)">
      <div style={row}>
        <button style={btn} onClick={() => void exportAs('csv')}>Export CSV</button>
        <button style={ghost} onClick={() => void exportAs('xlsx')}>Export Excel</button>
      </div>
      <Table head={['Period', 'Status', ...KPI_COLS.map((c) => c[1])]} rows={(data?.rows ?? []).map((r) => [r.period, r.status, ...KPI_COLS.map(([k]) => (r.values[k] === null || r.values[k] === undefined ? '' : n(r.values[k]!)))])} />
    </Section>
  );
}

function AccessTab({ api, run }: TabProps) {
  const [data, load] = useLoad<Access>(api, run, '/access');
  const [revoke, setRevoke] = useState<Set<string>>(new Set());
  const active = useMemo(() => (data?.members ?? []).filter((m) => m.status === 'active'), [data]);
  async function record() {
    const decisions = active.map((m) => ({ userId: m.userId, decision: revoke.has(m.userId) ? 'REVOKED' : 'CERTIFIED' }));
    if (await run('Access review recorded', () => api.workspace('POST', '/access/reviews', { decisions }))) {
      setRevoke(new Set());
      void load();
    }
  }
  return (
    <>
      <Section title="MFA coverage">
        <p style={{ margin: 0, fontSize: 14 }}>{data ? `${data.coverage.mfa} of ${data.coverage.active} active members have two-factor sign-in (${data.coverage.pct}%).` : 'Loading'}</p>
        <p style={{ fontSize: 13, color: data?.reviewDue ? '#b45309' : '#6b7280' }}>{data?.lastReview ? `Last access review: ${data.lastReview.reviewedAt.slice(0, 10)}${data.reviewDue ? ' (more than 90 days ago)' : ''}` : 'No access review has been recorded.'}</p>
      </Section>
      <Section title="Access review">
        <Table
          head={['Member', 'Profile', 'Status', 'MFA', 'Last sign-in', 'Revoke']}
          rows={(data?.members ?? []).map((m) => [
            `${m.name ?? ''} ${m.email}`.trim(),
            m.profile.replace(/_/g, ' '),
            m.status,
            m.mfa ? 'Yes' : 'No',
            m.lastLoginAt?.slice(0, 10) ?? 'never',
            m.status === 'active' ? <input key={m.userId} type="checkbox" aria-label={`Revoke ${m.email}`} checked={revoke.has(m.userId)} onChange={(e) => setRevoke((s) => { const next = new Set(s); if (e.target.checked) next.add(m.userId); else next.delete(m.userId); return next; })} /> : '',
          ])}
        />
        <div style={row}>
          <button style={btn} onClick={() => void record()} disabled={active.length === 0}>Record review</button>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Everyone who is not ticked is certified. Revoked members lose access. Needs an administrator and an authentication code.</span>
        </div>
      </Section>
    </>
  );
}
