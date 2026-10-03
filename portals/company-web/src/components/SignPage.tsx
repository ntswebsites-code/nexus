'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { apiBaseUrl } from '@/lib/investee/api';

interface Info {
  title: string;
  message: string | null;
  company: string;
  documentName: string;
  docSha256: string;
  signerName: string;
  signerStatus: string;
  requestStatus: string;
  expiresAt: string;
  consentText: string;
}

/** Public signer page. The link token is the only credential; no portal session is needed. */
export function SignPage({ token }: { token: string }) {
  const base = `${apiBaseUrl()}/api/v1/investee-public/sign/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(base, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.message ?? 'This link is not valid');
        setInfo(body.data as Info);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'This link is not valid'));
  }, [base]);

  async function respond(action: 'SIGN' | 'DECLINE', e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'SIGN' ? { action, name, consent } : { action }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.message ?? 'Could not record your response');
      setDone(action === 'SIGN' ? 'Thank you. Your signature is recorded.' : 'You declined to sign. The sender has been told.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your response');
    } finally {
      setBusy(false);
    }
  }

  const open = info && info.requestStatus === 'PENDING' && info.signerStatus === 'PENDING';
  return (
    <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 22 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Sign a document</h1>
        {error && <p role="alert" style={{ color: '#991b1b' }}>{error}</p>}
        {done && <p role="status" style={{ color: '#065f46' }}>{done}</p>}
        {info && !done && (
          <>
            <p style={{ margin: '0 0 4px' }}><strong>{info.title}</strong></p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#4b5563' }}>From {info.company}. For {info.signerName}. Valid until {info.expiresAt.slice(0, 10)}.</p>
            {info.message && <p style={{ fontSize: 14 }}>{info.message}</p>}
            {!open && <p style={{ fontSize: 14 }}>This request is {info.requestStatus === 'PENDING' ? info.signerStatus.toLowerCase() : info.requestStatus.toLowerCase()}, so it cannot be signed.</p>}
            {open && (
              <form onSubmit={(e) => void respond('SIGN', e)}>
                <p style={{ fontSize: 14 }}>
                  <a href={`${base}/document`} target="_blank" rel="noopener noreferrer">Read {info.documentName}</a>
                  <br />
                  <span style={{ fontSize: 12, color: '#6b7280' }}>Document fingerprint (SHA-256): <code>{info.docSha256.slice(0, 16)}</code></span>
                </p>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 10 }}>
                  Type your full name
                  <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, border: '1px solid #d1d5db', borderRadius: 8, boxSizing: 'border-box' }} />
                </label>
                <label style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 14 }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{info.consentText}</span>
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy || !consent || name.trim().length < 2} style={{ border: 0, borderRadius: 8, padding: '9px 16px', background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>Sign</button>
                  <button type="button" disabled={busy} onClick={() => void respond('DECLINE')} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 16px', background: '#fff', cursor: 'pointer' }}>Decline</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
