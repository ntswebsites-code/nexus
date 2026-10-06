'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { VaultVersions, WorkspaceDocument } from '@/lib/investee/types';
import { useNative } from './NativeShell';
import { Section, Table, btn, ghost, input, muted, row } from './ui';

const PREVIEWABLE = /\.(pdf|png|jpe?g|txt|csv)$/i;

const size = (bytes: number | null) => (bytes === null ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

/**
 * Company vault (CMP-038, INO-021): upload, download, preview, version history, new version and withdraw.
 * Withdraw takes a document out of the workspace without erasing it (D-15).
 */
export function DataRoomScreen() {
  const { api, run } = useNative();
  const [docs, setDocs] = useState<WorkspaceDocument[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<VaultVersions | null>(null);
  const [withdrawing, setWithdrawing] = useState<{ id: string; name: string; reason: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const canUpload = api.isLive('vault.upload');

  const load = useCallback(async () => {
    const out = await run('', () => api.getVault());
    if (out) setDocs(out.documents ?? []);
  }, [api, run]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (await run('Document stored', () => api.uploadVaultFile(file, name.trim() || undefined))) {
      setFile(null);
      setName('');
      if (fileInput.current) fileInput.current.value = '';
      await load();
    }
  }

  async function download(documentId: string, opts: { version?: number; inline?: boolean } = {}) {
    const out = await run('', () => api.getVaultDownloadUrl(documentId, opts));
    if (!out) return;
    if (opts.inline && out.inline) window.open(out.url, '_blank', 'noopener');
    else {
      const a = document.createElement('a');
      a.href = out.url;
      a.download = out.name;
      a.rel = 'noopener';
      a.click();
    }
  }

  async function showVersions(documentId: string) {
    const out = await run('', () => api.getVaultVersions(documentId));
    if (out) setOpen(out);
  }

  async function newVersion(f: File | undefined) {
    if (!f || !open) return;
    const out = await run('New version stored', () => api.addVaultVersion(open.id, f));
    if (versionInput.current) versionInput.current.value = '';
    if (out) {
      setOpen(out);
      await load();
    }
  }

  async function withdraw(e: FormEvent) {
    e.preventDefault();
    if (!withdrawing) return;
    if (await run(`${withdrawing.name} withdrawn from the workspace`, () => api.withdrawVaultDocument(withdrawing.id, withdrawing.reason.trim()))) {
      if (open?.id === withdrawing.id) setOpen(null);
      setWithdrawing(null);
      await load();
    }
  }

  return (
    <>
      {canUpload && (
        <Section title="Upload a document">
          <form onSubmit={upload} style={row}>
            <input ref={fileInput} aria-label="File" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
            <input aria-label="Document name" style={{ ...input, flex: '1 1 200px' }} placeholder="Name (optional, defaults to the file name)" value={name} onChange={(e) => setName(e.target.value)} />
            <button style={btn} disabled={!file}>Upload</button>
          </form>
          <p style={muted}>The file content must match its type; programs are refused.</p>
        </Section>
      )}

      {withdrawing && (
        <Section title={`Withdraw ${withdrawing.name}`}>
          <form onSubmit={withdraw}>
            <input aria-label="Reason for withdrawing" style={{ ...input, width: '100%', boxSizing: 'border-box' }} placeholder="Why is this document being withdrawn?" value={withdrawing.reason} onChange={(e) => setWithdrawing({ ...withdrawing, reason: e.target.value })} />
            <div style={row}>
              <button style={btn} disabled={withdrawing.reason.trim().length < 3}>Withdraw</button>
              <button type="button" style={ghost} onClick={() => setWithdrawing(null)}>Cancel</button>
            </div>
            <p style={muted}>The document leaves your workspace but is kept by Matanho for the retention period. A document on legal hold or in a published board pack cannot be withdrawn.</p>
          </form>
        </Section>
      )}

      <Section title="Documents">
        <Table
          head={['Ref', 'Name', 'Type', 'Version', 'Updated', '']}
          empty="No documents yet."
          rows={
            docs
              ? docs.map((d) => {
                  const label = d.name ?? d.fileName ?? d.id;
                  return [
                    d.ref ?? '',
                    label,
                    d.documentType ?? d.type ?? '',
                    d.version ? `v${d.version}` : '',
                    (d.updatedAt ?? d.uploadedAt ?? '').slice(0, 10),
                    <span key="a" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button style={ghost} onClick={() => void download(d.id)} aria-label={`Download ${label}`}>Download</button>
                      {PREVIEWABLE.test(d.fileName ?? label) && <button style={ghost} onClick={() => void download(d.id, { inline: true })} aria-label={`Preview ${label}`}>Preview</button>}
                      <button style={ghost} onClick={() => void showVersions(d.id)} aria-label={`Versions of ${label}`}>Versions</button>
                      {canUpload && <button style={ghost} onClick={() => setWithdrawing({ id: d.id, name: label, reason: '' })} aria-label={`Withdraw ${label}`}>Withdraw</button>}
                    </span>,
                  ];
                })
              : null
          }
        />
      </Section>

      {open && (
        <Section title={`Versions of ${open.name}`} actions={<button type="button" style={ghost} onClick={() => setOpen(null)}>Close</button>}>
          <Table
            head={['Version', 'File', 'Size', 'Uploaded', 'Fingerprint', '']}
            rows={open.versions.map((v) => [
              `v${v.version}${v.version === open.version ? ' (current)' : ''}`,
              v.fileName,
              size(v.size),
              v.uploadedAt.slice(0, 16).replace('T', ' '),
              <code key="h" title={v.sha256}>{v.sha256.slice(0, 12)}</code>,
              <button key="d" style={ghost} onClick={() => void download(open.id, { version: v.version })} aria-label={`Download version ${v.version}`}>Download</button>,
            ])}
          />
          {canUpload && (
            <div style={row}>
              <label style={{ fontSize: 13 }}>
                Upload a new version{' '}
                <input ref={versionInput} aria-label="New version file" type="file" onChange={(e) => void newVersion(e.target.files?.[0])} style={{ fontSize: 13 }} />
              </label>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
