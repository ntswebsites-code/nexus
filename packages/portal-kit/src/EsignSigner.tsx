'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Signer-side UI for the native e-signature API (`/api/v1/esign`), shared by the LP portal, the
 * investee portal and the public token page. Self-contained: inline styles, no CSS framework.
 *   <EsignInbox />            signed-in signers (list, review PDF, sign or decline)
 *   <EsignPublicSigner />     external signer opening a one-time e-mail link (e-mail OTP)
 *   <EsignVerifier />         anyone: upload a PDF or paste its SHA-256
 */

const base = () => `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100').replace(/\/+$/, '')}/api/v1`;

class EsignApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, o: { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; blob?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: o.method ?? (o.body || o.form ? 'POST' : 'GET'),
      headers: { Accept: 'application/json', ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...o.headers },
      body: o.form ?? (o.body ? JSON.stringify(o.body) : undefined),
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    throw new EsignApiError(0, 'network_error', 'The server could not be reached. Check your connection and try again.');
  }
  if (res.ok) return (o.blob ? await res.blob() : await res.json()) as T;
  const j = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  throw new EsignApiError(res.status, j.error?.code ?? 'http_error', j.error?.message ?? `Request failed (${res.status})`);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '-');

// ------------------------------------------------------------------ styles

const C = { ink: '#142033', muted: '#5b6778', line: '#d9e0ea', blue: '#1f4fa3', red: '#b42318', green: '#157347', paper: '#fff', soft: '#f5f8fc' };
const S: Record<string, CSSProperties> = {
  wrap: { maxWidth: 980, margin: '0 auto', padding: '24px 16px', color: C.ink, fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', fontSize: 14 },
  card: { background: C.paper, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, marginBottom: 16 },
  h1: { fontSize: 22, margin: '0 0 4px' },
  muted: { color: C.muted, fontSize: 13 },
  btn: { height: 36, padding: '0 16px', borderRadius: 8, border: `1px solid ${C.line}`, background: C.paper, color: C.ink, cursor: 'pointer', fontWeight: 600 },
  primary: { height: 36, padding: '0 16px', borderRadius: 8, border: `1px solid ${C.blue}`, background: C.blue, color: '#fff', cursor: 'pointer', fontWeight: 600 },
  danger: { height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid #f0b8c3', background: C.paper, color: C.red, cursor: 'pointer', fontWeight: 600 },
  input: { height: 38, border: `1px solid ${C.line}`, borderRadius: 8, padding: '0 10px', fontSize: 14, width: '100%', boxSizing: 'border-box' },
  row: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  err: { background: '#fdecea', color: C.red, borderRadius: 8, padding: '8px 12px', margin: '10px 0' },
  ok: { background: '#e7f6ee', color: C.green, borderRadius: 8, padding: '8px 12px', margin: '10px 0' },
  pill: { display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#eef1f5', color: '#4c5868', textTransform: 'capitalize' },
};
const pillTone = (s: string): CSSProperties =>
  s === 'COMPLETED' || s === 'SIGNED' ? { background: '#e7f6ee', color: C.green } : s === 'PENDING' ? { background: '#fff3e0', color: '#b54708' } : s === 'DECLINED' || s === 'EXPIRED' ? { background: '#fdecea', color: C.red } : {};
const Pill = ({ s }: { s: string }) => <span style={{ ...S.pill, ...pillTone(s) }}>{s.toLowerCase()}</span>;
const Err = ({ children }: { children?: ReactNode }) => (children ? <div role="alert" style={S.err}>{children}</div> : null);

// ------------------------------------------------------------------ signature pad

function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0b1f5c';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current && ref.current) onChange(ref.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };
  return (
    <div>
      <canvas ref={ref} width={600} height={180} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} style={{ width: '100%', maxWidth: 600, height: 'auto', aspectRatio: '10 / 3', border: `1px dashed ${C.muted}`, borderRadius: 8, background: C.soft, touchAction: 'none' }} aria-label="Draw your signature" />
      <div style={S.row}>
        <button type="button" style={S.btn} onClick={clear}>
          Clear
        </button>
        <span style={S.muted}>Draw with your mouse, finger or stylus.</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sign panel

export interface SignPanelProps {
  title: string;
  signerName: string;
  consentText: string;
  loadPdf: () => Promise<Blob>;
  onSign: (p: { mode: 'TYPED' | 'DRAWN'; typedName?: string; drawnPng?: string; consent: boolean }) => Promise<void>;
  onDecline: (reason: string) => Promise<void>;
  onDone: (outcome: 'signed' | 'declined') => void;
}

function SignPanel(p: SignPanelProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'TYPED' | 'DRAWN'>('TYPED');
  const [typed, setTyped] = useState(p.signerName);
  const [png, setPng] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    p.loadPdf()
      .then((b) => {
        if (!alive) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = consent && (mode === 'TYPED' ? typed.trim().length >= 2 : !!png);
  const run = async (fn: () => Promise<void>, outcome: 'signed' | 'declined') => {
    setBusy(true);
    setError('');
    try {
      await fn();
      p.onDone(outcome);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        {url ? <iframe title={p.title} src={url} style={{ width: '100%', height: 520, border: 0 }} /> : <div style={{ padding: 18 }} className="muted">Loading document…</div>}
        {url && (
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.line}` }}>
            <a href={url} download={`${p.title}.pdf`} style={{ color: C.blue }}>
              Download a copy
            </a>
          </div>
        )}
      </div>
      <div style={S.card}>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Your signature</h2>
        <div style={{ ...S.row, marginBottom: 10 }}>
          <button type="button" style={mode === 'TYPED' ? S.primary : S.btn} onClick={() => setMode('TYPED')}>
            Type
          </button>
          <button type="button" style={mode === 'DRAWN' ? S.primary : S.btn} onClick={() => setMode('DRAWN')}>
            Draw
          </button>
        </div>
        {mode === 'TYPED' ? (
          <>
            <input style={S.input} value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={160} aria-label="Type your full name" />
            <div style={{ fontFamily: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive', fontSize: 34, margin: '10px 0', color: '#0b1f5c' }}>{typed || ' '}</div>
          </>
        ) : (
          <SignaturePad onChange={setPng} />
        )}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span style={S.muted}>{p.consentText}</span>
        </label>
        <Err>{error}</Err>
        <div style={S.row}>
          <button type="button" style={{ ...S.primary, opacity: ready && !busy ? 1 : 0.5 }} disabled={!ready || busy} onClick={() => run(() => p.onSign({ mode, typedName: mode === 'TYPED' ? typed.trim() : undefined, drawnPng: mode === 'DRAWN' ? (png ?? undefined) : undefined, consent }), 'signed')}>
            {busy ? 'Signing…' : 'Sign document'}
          </button>
          <button type="button" style={S.danger} disabled={busy} onClick={() => setDeclining(true)}>
            Decline to sign
          </button>
        </div>
        {declining && (
          <div style={{ marginTop: 14 }}>
            <input style={S.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell the sender why you are declining" maxLength={500} />
            <div style={{ ...S.row, marginTop: 8 }}>
              <button type="button" style={S.danger} disabled={busy || reason.trim().length < 3} onClick={() => run(() => p.onDecline(reason.trim()), 'declined')}>
                Confirm decline
              </button>
              <button type="button" style={S.btn} onClick={() => setDeclining(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ signed-in inbox

interface MyRequest {
  id: string;
  ref: string;
  title: string;
  message: string | null;
  status: string;
  expiresAt: string | null;
  completedAt: string | null;
  hasSealed: boolean;
  actionable: boolean;
  me: { id: string; status: string; name: string; roleLabel: string | null; signedAt: string | null };
  signers: { name: string; roleLabel: string | null; status: string; signedAt: string | null }[];
}
interface MyDetail {
  request: MyRequest & { consent: { text: string } };
  actionable: boolean;
}

export function EsignInbox({ heading = 'Documents to sign' }: { heading?: string }) {
  const [rows, setRows] = useState<MyRequest[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<MyDetail | null>(null);
  const [stepUp, setStepUp] = useState<null | { resolve: (ok: boolean) => void }>(null);
  const [code, setCode] = useState('');
  const [stepErr, setStepErr] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    call<{ data: MyRequest[] }>('/esign/me/requests')
      .then((r) => setRows(r.data))
      .catch((e) => {
        if (e instanceof EsignApiError && e.status === 401) window.location.assign('/login');
        else setError(msg(e));
      });
  }, []);
  useEffect(load, [load]);

  const askStepUp = () => new Promise<boolean>((resolve) => setStepUp({ resolve }));
  /** Runs a call; on `step_up_required` asks for the authenticator code once and retries. */
  const withStepUp = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof EsignApiError && e.code === 'step_up_required') {
        if (!(await askStepUp())) throw new Error('Confirmation cancelled. Nothing was signed.');
        await fn();
      } else if (e instanceof EsignApiError && e.code === 'mfa_enrolment_required') {
        throw new Error('Set up two-factor authentication in your account settings before signing.');
      } else throw e;
    }
  };

  const openRequest = async (id: string) => {
    setError('');
    try {
      setOpen(await call<MyDetail>(`/esign/me/requests/${id}`));
    } catch (e) {
      setError(msg(e));
    }
  };

  if (open) {
    const r = open.request;
    return (
      <div style={S.wrap}>
        <button type="button" style={S.btn} onClick={() => setOpen(null)}>
          Back to list
        </button>
        <h1 style={{ ...S.h1, marginTop: 14 }}>{r.title}</h1>
        <p style={S.muted}>
          {r.ref} · <Pill s={r.status} /> · signing as {r.me.name}
          {r.me.roleLabel ? `, ${r.me.roleLabel}` : ''}
        </p>
        {r.message && <p>{r.message}</p>}
        <div style={S.card}>
          <strong>Signers</strong>
          {r.signers.map((s, i) => (
            <div key={i} style={{ ...S.row, justifyContent: 'space-between', padding: '6px 0' }}>
              <span>
                {s.name} <span style={S.muted}>{s.roleLabel}</span>
              </span>
              <span>
                <Pill s={s.status} /> <span style={S.muted}>{s.signedAt ? when(s.signedAt) : ''}</span>
              </span>
            </div>
          ))}
        </div>
        {open.actionable ? (
          <SignPanel
            title={r.title}
            signerName={r.me.name}
            consentText={r.consent.text}
            loadPdf={() => call<Blob>(`/esign/me/requests/${r.id}/document`, { blob: true })}
            onSign={(p) => withStepUp(async () => void (await call(`/esign/me/requests/${r.id}/sign`, { body: p })))}
            onDecline={async (reason) => void (await call(`/esign/me/requests/${r.id}/decline`, { body: { reason } }))}
            onDone={(o) => {
              setNotice(o === 'signed' ? `Signed ${r.ref}.` : `You declined ${r.ref}.`);
              setOpen(null);
              load();
            }}
          />
        ) : (
          <div style={S.card}>
            <p style={{ marginTop: 0 }}>{r.status === 'COMPLETED' ? 'Everyone has signed. The sealed copy and certificate are final.' : r.me.status === 'SIGNED' ? 'You have signed. Waiting for the other signers.' : `This request is ${r.status.toLowerCase()}.`}</p>
            {r.hasSealed && (
              <PdfButtons id={r.id} />
            )}
          </div>
        )}
        {stepUp && <StepUpDialog code={code} setCode={setCode} error={stepErr} onCancel={() => { stepUp.resolve(false); setStepUp(null); setCode(''); setStepErr(''); }} onSubmit={async () => { try { await call('/auth/mfa/step-up', { body: { code } }); stepUp.resolve(true); setStepUp(null); setCode(''); setStepErr(''); } catch (e) { setStepErr(msg(e)); } }} />}
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>{heading}</h1>
      <p style={S.muted}>Signature requests addressed to you. Signing is recorded with your identity, time and IP address, and sealed with a tamper-evident certificate.</p>
      {notice && <div style={S.ok}>{notice}</div>}
      <Err>{error}</Err>
      {!rows && !error && <p style={S.muted}>Loading…</p>}
      {rows && rows.length === 0 && <div style={S.card}>Nothing needs your signature right now.</div>}
      {rows?.map((r) => (
        <div key={r.id} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <strong>{r.title}</strong>
            <div style={S.muted}>
              {r.ref} · <Pill s={r.status} />
              {r.actionable && r.expiresAt ? ` · sign by ${new Date(r.expiresAt).toLocaleDateString()}` : ''}
              {r.status === 'COMPLETED' ? ` · completed ${when(r.completedAt)}` : ''}
            </div>
          </div>
          <button type="button" style={r.actionable ? S.primary : S.btn} onClick={() => openRequest(r.id)}>
            {r.actionable ? 'Review and sign' : 'View'}
          </button>
        </div>
      ))}
    </div>
  );
}

function PdfButtons({ id }: { id: string }) {
  const [error, setError] = useState('');
  const dl = async (variant: 'document' | 'certificate') => {
    try {
      const b = await call<Blob>(`/esign/me/requests/${id}/document?variant=${variant}&download=1`, { blob: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = variant === 'certificate' ? 'certificate-of-completion.pdf' : 'signed-document.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(msg(e));
    }
  };
  return (
    <>
      <div style={S.row}>
        <button type="button" style={S.btn} onClick={() => dl('document')}>
          Download signed PDF
        </button>
        <button type="button" style={S.btn} onClick={() => dl('certificate')}>
          Download certificate
        </button>
      </div>
      <Err>{error}</Err>
    </>
  );
}

function StepUpDialog(p: { code: string; setCode: (v: string) => void; error: string; onCancel: () => void; onSubmit: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,38,.45)', display: 'grid', placeItems: 'center', zIndex: 50 }} role="dialog" aria-modal="true">
      <div style={{ ...S.card, width: 'min(380px, 92vw)', margin: 0 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Confirm it is you</h2>
        <p style={S.muted}>Enter the 6-digit code from your authenticator app to sign.</p>
        <input style={S.input} inputMode="numeric" autoFocus value={p.code} onChange={(e) => p.setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Authentication code" />
        <Err>{p.error}</Err>
        <div style={{ ...S.row, marginTop: 12 }}>
          <button type="button" style={S.primary} disabled={p.code.length !== 6} onClick={p.onSubmit}>
            Confirm
          </button>
          <button type="button" style={S.btn} onClick={p.onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ external (token) signer

interface PublicSummary {
  request: { ref: string; title: string; message: string | null; status: string; expiresAt: string | null };
  signer: { name: string; email: string; roleLabel: string | null; status: string };
  canSign: boolean;
}

export function EsignPublicSigner({ token }: { token: string }) {
  const [sum, setSum] = useState<PublicSummary | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'intro' | 'code' | 'sign' | 'done'>('intro');
  const [code, setCode] = useState('');
  const [proof, setProof] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('');
  const t = encodeURIComponent(token);

  useEffect(() => {
    call<PublicSummary>(`/esign/public/${t}`)
      .then(setSum)
      .catch((e) => setError(msg(e)));
  }, [t]);

  const sendCode = async () => {
    setBusy(true);
    setError('');
    try {
      await call(`/esign/public/${t}/otp`, { method: 'POST', body: {} });
      setStage('code');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await call<{ proof: string }>(`/esign/public/${t}/verify-otp`, { body: { code } });
      setProof(r.proof);
      setStage('sign');
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Sign a document</h1>
      <p style={S.muted}>Matanho Nexus electronic signature</p>
      {error && stage !== 'sign' && <Err>{error}</Err>}
      {!sum && !error && <p style={S.muted}>Loading…</p>}
      {sum && stage !== 'done' && (
        <div style={S.card}>
          <strong>{sum.request.title}</strong>
          <div style={S.muted}>
            {sum.request.ref} · for {sum.signer.name}
            {sum.signer.roleLabel ? `, ${sum.signer.roleLabel}` : ''}
          </div>
          {sum.request.message && <p>{sum.request.message}</p>}
          {sum.request.expiresAt && sum.canSign && <p style={S.muted}>Please sign before {new Date(sum.request.expiresAt).toLocaleDateString()}.</p>}
          {!sum.canSign && <div style={S.err}>This request is {sum.signer.status === 'SIGNED' ? 'already signed by you' : sum.request.status.toLowerCase()} and can no longer be signed here.</div>}
          {sum.canSign && stage === 'intro' && (
            <>
              <p>To protect the document we first confirm it is you. We will e-mail a 6-digit code to {sum.signer.email}.</p>
              <button type="button" style={S.primary} disabled={busy} onClick={sendCode}>
                {busy ? 'Sending…' : 'E-mail me a code'}
              </button>
            </>
          )}
          {sum.canSign && stage === 'code' && (
            <>
              <p>Enter the code we sent to {sum.signer.email}. It expires in 10 minutes.</p>
              <input style={{ ...S.input, maxWidth: 200 }} inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Verification code" />
              <div style={{ ...S.row, marginTop: 10 }}>
                <button type="button" style={S.primary} disabled={busy || code.length !== 6} onClick={verify}>
                  {busy ? 'Checking…' : 'Verify and open document'}
                </button>
                <button type="button" style={S.btn} disabled={busy} onClick={sendCode}>
                  Send a new code
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {sum && stage === 'sign' && (
        <SignPanel
          title={sum.request.title}
          signerName={sum.signer.name}
          consentText={`I, ${sum.signer.name}, agree to sign document ${sum.request.ref} electronically. I understand that my typed or drawn signature has the same legal effect as a handwritten signature, that my name, e-mail address, IP address and the time of signing are recorded in a tamper-evident audit trail, and that I may decline to sign instead.`}
          loadPdf={() => call<Blob>(`/esign/public/${t}/document`, { blob: true, headers: { 'x-esign-proof': proof } })}
          onSign={async (p) => void (await call(`/esign/public/${t}/sign`, { body: { ...p, proof } }))}
          onDecline={async (reason) => void (await call(`/esign/public/${t}/decline`, { body: { reason, proof } }))}
          onDone={(o) => {
            setOutcome(o === 'signed' ? 'Thank you. Your signature has been recorded. When everyone has signed you will receive an e-mail confirmation.' : 'You declined to sign. The sender has been told.');
            setStage('done');
          }}
        />
      )}
      {stage === 'done' && <div style={S.ok}>{outcome}</div>}
      <p style={S.muted}>
        Want to check a signed document? <a href="/sign/verify" style={{ color: C.blue }}>Verify a document</a>
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ verifier

interface VerifyResult {
  match: 'SEALED' | 'ORIGINAL' | 'NONE';
  sha256: string;
  ref?: string;
  status?: string;
  completedAt?: string | null;
  signers?: { name: string; roleLabel: string | null; signedAt: string | null }[];
  chainIntact?: boolean | null;
  note?: string;
}

export function EsignVerifier() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState('');
  const go = async (o: { form?: FormData; body?: unknown }) => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await call<VerifyResult>('/esign/public/verify', { method: 'POST', ...o }));
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Verify a signed document</h1>
      <p style={S.muted}>Upload the PDF or paste its SHA-256. The file never leaves your browser if you paste the hash; uploads are only hashed, not stored.</p>
      <div style={S.card}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={S.muted}>PDF file</div>
          <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fd = new FormData(); fd.append('file', f); void go({ form: fd }); } }} />
        </label>
        <div style={S.row}>
          <input style={{ ...S.input, flex: 1, minWidth: 240 }} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="SHA-256 (64 hex characters)" aria-label="SHA-256" />
          <button type="button" style={S.primary} disabled={busy || hash.trim().length !== 64} onClick={() => go({ body: { sha256: hash.trim() } })}>
            Check
          </button>
        </div>
      </div>
      <Err>{error}</Err>
      {result &&
        (result.match === 'NONE' ? (
          <div style={S.err}>No sealed or original document with this hash is on record. It was changed after signing or did not come from Matanho Nexus.</div>
        ) : (
          <div style={result.match === 'SEALED' && result.chainIntact !== false ? S.ok : S.err}>
            <strong>{result.ref}</strong> · {result.status?.toLowerCase()} · {result.note}
            {result.chainIntact === false && ' The recorded signature chain no longer verifies.'}
            {result.signers && (
              <ul>
                {result.signers.map((s, i) => (
                  <li key={i}>
                    {s.name}
                    {s.roleLabel ? `, ${s.roleLabel}` : ''} - {when(s.signedAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
    </div>
  );
}
