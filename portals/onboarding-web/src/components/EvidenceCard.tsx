'use client';

import { useRef, useState } from 'react';
import { api, OnboardingApiError, type EvidenceRow } from '@/lib/api';
import { fmtSize } from './ui';

/** One document slot: upload / replace, with the server-side malware scan result reported back. */
export function EvidenceCard({
  slot,
  label,
  required,
  row,
  session,
  maxMb,
  accept,
  onUploaded,
}: {
  slot: string;
  label: string;
  required: boolean;
  row?: EvidenceRow;
  session: { id: string; token: string };
  maxMb: number;
  accept: string[];
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const have = !!row?.name;

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > maxMb * 1048576) {
      setError(`File is larger than ${maxMb} MB.`);
      return;
    }
    setBusy(true);
    try {
      await api.upload(session.id, session.token, slot, file);
      onUploaded();
    } catch (e) {
      setError(e instanceof OnboardingApiError ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className={`doc${have ? ' has' : ''}${error ? ' bad' : ''}`}>
      <div className="doc-head">
        <strong>{label}</strong>
        <span className={`chip ${have ? 'good' : required ? 'warn' : ''}`}>{have ? 'Received' : required ? 'Required' : 'Optional'}</span>
      </div>
      {have ? (
        <p className="muted">
          {row!.name} · {fmtSize(row!.size)}
          {row!.scanStatus === 'clean' ? ' · malware scan clean' : ''}
        </p>
      ) : (
        <p className="muted">PDF or image, up to {maxMb} MB.</p>
      )}
      {error ? <p className="err" role="alert">{error}</p> : null}
      <input ref={input} type="file" hidden accept={accept.join(',')} onChange={(e) => pick(e.target.files?.[0])} aria-label={`Upload ${label}`} />
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Scanning and uploading...' : have ? 'Replace file' : 'Choose file'}
      </button>
    </div>
  );
}
