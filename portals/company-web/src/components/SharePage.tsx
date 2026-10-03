'use client';

import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/investee/api';

interface Info {
  documentName: string;
  company: string;
  recipient: string;
  expiresAt: string;
}

/** Public landing page for a document share link. The link token is the only credential. */
export function SharePage({ token }: { token: string }) {
  const base = `${apiBaseUrl()}/api/v1/investee-public/share/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(base, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error?.message ?? body?.message ?? 'This link is not valid');
        setInfo(body.data as Info);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'This link is not valid'));
  }, [base]);

  return (
    <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 22 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Shared document</h1>
        {!info && !error && <p role="status">Loading...</p>}
        {error && <p role="alert" style={{ color: '#991b1b' }}>{error}</p>}
        {info && (
          <>
            <p style={{ margin: '0 0 4px' }}><strong>{info.documentName}</strong></p>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#4b5563' }}>
              Shared by {info.company} with {info.recipient}. This link works until {info.expiresAt.slice(0, 10)}.
            </p>
            <p style={{ fontSize: 13, color: '#4b5563' }}>The copy you download is watermarked with your name. Please do not forward it.</p>
            <a
              href={`${base}/file`}
              style={{ display: 'inline-block', marginTop: 8, borderRadius: 8, padding: '9px 16px', background: '#4f46e5', color: '#fff', textDecoration: 'none' }}
            >
              Download the document
            </a>
          </>
        )}
      </div>
    </main>
  );
}
