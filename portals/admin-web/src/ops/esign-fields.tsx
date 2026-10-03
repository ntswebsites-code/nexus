'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, apiBase, describeError, qs, v1 } from './api';
import { Alert, Field } from './ui';

/**
 * Signature field editor. Pages are drawn as page-shaped sheets (true aspect ratio from the PDF); the page
 * itself is shown behind the boxes by the browser's own PDF viewer (one single-page PDF per page, fetched
 * with the session cookie, so no PDF library or CDN is needed). Boxes are stored as fractions of the page
 * (origin top-left). "Preview on the PDF" stamps the boxes on the real file for an exact check.
 */

export type FieldKind = 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME';
export interface FieldBox {
  key: string;
  signerEmail: string;
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PdfSource {
  documentId?: string;
  fileId?: string;
  requestId?: string;
}
export interface EditorSigner {
  email: string;
  name: string;
}

const PALETTE = ['#1f4fa3', '#b45309', '#0f766e', '#9333ea', '#be123c', '#4d7c0f', '#0369a1', '#a16207'];
const DEFAULT_SIZE: Record<FieldKind, [number, number]> = { SIGNATURE: [0.3, 0.06], INITIALS: [0.1, 0.04], DATE: [0.16, 0.03], NAME: [0.26, 0.03] };
const KIND_LABEL: Record<FieldKind, string> = { SIGNATURE: 'Signature', INITIALS: 'Initials', DATE: 'Date', NAME: 'Printed name' };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const newKey = () => `f${Math.random().toString(36).slice(2, 9)}`;

export function sourceQuery(src: PdfSource): string {
  return qs({ documentId: src.documentId, fileId: src.fileId, requestId: src.requestId });
}

async function fetchPdfBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(`${apiBase}${path}`, { credentials: 'include', cache: 'no-store', ...init });
  if (!res.ok) {
    let msg = `Could not load the PDF (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** Lays out one signature + date pair per signer at the foot of the last page (a sensible default). */
export function defaultLayout(signers: EditorSigner[], pageCount: number): FieldBox[] {
  const out: FieldBox[] = [];
  signers.forEach((s, i) => {
    const row = i % 4;
    const col = Math.floor(i / 4) % 2;
    const y = 0.62 + row * 0.085;
    const x = 0.08 + col * 0.46;
    out.push({ key: newKey(), signerEmail: s.email, kind: 'SIGNATURE', page: pageCount, x, y, width: 0.26, height: 0.05 });
    out.push({ key: newKey(), signerEmail: s.email, kind: 'DATE', page: pageCount, x: x + 0.28, y: y + 0.02, width: 0.12, height: 0.03 });
  });
  return out;
}

export function FieldEditor({
  source,
  signers,
  value,
  onChange,
  readOnly,
}: {
  source: PdfSource;
  signers: EditorSigner[];
  value: FieldBox[];
  onChange: (next: FieldBox[]) => void;
  readOnly?: boolean;
}) {
  const [pages, setPages] = useState<{ page: number; width: number; height: number }[] | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [signerEmail, setSignerEmail] = useState(signers[0]?.email ?? '');
  const [kind, setKind] = useState<FieldKind>('SIGNATURE');
  const [selected, setSelected] = useState<string | null>(null);
  const [backdrop, setBackdrop] = useState(true);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const srcKey = sourceQuery(source);

  useEffect(() => {
    let alive = true;
    setPages(null);
    setError('');
    api
      .get<{ pages: { page: number; width: number; height: number }[] }>(v1(`/esign/source/pages${srcKey}`))
      .then((r) => alive && setPages(r.pages))
      .catch((e) => alive && setError(describeError(e)));
    return () => {
      alive = false;
    };
  }, [srcKey]);

  useEffect(() => {
    if (!signers.some((s) => s.email === signerEmail)) setSignerEmail(signers[0]?.email ?? '');
  }, [signers, signerEmail]);

  // One single-page PDF per visited page, kept for the life of the editor.
  useEffect(() => {
    if (!backdrop || !pages || urls[page]) return;
    let alive = true;
    fetchPdfBlob(v1(`/esign/source/pages/${page}${srcKey}`))
      .then((b) => alive && setUrls((u) => ({ ...u, [page]: URL.createObjectURL(b) })))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [backdrop, pages, page, srcKey, urls]);
  useEffect(
    () => () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const colour = useCallback((email: string) => PALETTE[Math.max(0, signers.findIndex((s) => s.email === email)) % PALETTE.length]!, [signers]);
  const sheet = pages?.find((p) => p.page === page);
  const mine = value.filter((f) => f.page === page);
  const update = (key: string, patch: Partial<FieldBox>) => onChange(value.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const place = (e: React.MouseEvent) => {
    if (readOnly || !canvas.current || !signerEmail) return;
    if (e.target !== e.currentTarget) return;
    const r = canvas.current.getBoundingClientRect();
    const [w, h] = DEFAULT_SIZE[kind];
    const x = clamp((e.clientX - r.left) / r.width - w / 2, 0, 1 - w);
    const y = clamp((e.clientY - r.top) / r.height - h / 2, 0, 1 - h);
    const f: FieldBox = { key: newKey(), signerEmail, kind, page, x, y, width: w, height: h };
    onChange([...value, f]);
    setSelected(f.key);
  };

  const drag = (e: ReactPointerEvent, f: FieldBox, mode: 'move' | 'resize') => {
    if (readOnly || !canvas.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(f.key);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = canvas.current.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, f };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / r.width;
      const dy = (ev.clientY - start.py) / r.height;
      if (mode === 'move') update(f.key, { x: clamp(start.f.x + dx, 0, 1 - start.f.width), y: clamp(start.f.y + dy, 0, 1 - start.f.height) });
      else update(f.key, { width: clamp(start.f.width + dx, 0.04, 1 - start.f.x), height: clamp(start.f.height + dy, 0.015, 1 - start.f.y) });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (readOnly || !selected) return;
    const f = value.find((x) => x.key === selected);
    if (!f) return;
    const step = e.shiftKey ? 0.02 : 0.005;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onChange(value.filter((x) => x.key !== selected));
      setSelected(null);
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      update(f.key, {
        x: clamp(f.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), 0, 1 - f.width),
        y: clamp(f.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0), 0, 1 - f.height),
      });
    }
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({ ...source, fields: value.map(({ key: _k, ...f }) => ({ ...f, label: signers.find((s) => s.email === f.signerEmail)?.name })) });
      const blob = await fetchPdfBlob(v1('/esign/source/preview'), { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' } });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !pages) return <Alert>{error}</Alert>;
  if (!pages) return <p className="ops-muted">Loading the document pages…</p>;
  const aspect = sheet ? (sheet.height / sheet.width) * 100 : 141;

  return (
    <div onKeyDown={onKey}>
      {!readOnly && (
        <div className="ops-filters" style={{ alignItems: 'flex-end' }}>
          <Field label="Place for">
            <select className="ops-input" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)}>
              {signers.map((s) => (
                <option key={s.email} value={s.email}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Field">
            <select className="ops-input" value={kind} onChange={(e) => setKind(e.target.value as FieldKind)}>
              {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <button className="ops-btn" type="button" disabled={!value.length || busy} onClick={preview}>
            {busy ? 'Building…' : 'Preview on the PDF'}
          </button>
          <button className="ops-btn" type="button" disabled={!selected} onClick={() => { onChange(value.filter((f) => f.key !== selected)); setSelected(null); }}>
            Delete selected
          </button>
          <button className="ops-btn" type="button" onClick={() => { onChange(defaultLayout(signers, pages.length)); setSelected(null); }}>
            Reset to default
          </button>
        </div>
      )}
      <p className="ops-muted" style={{ margin: '4px 0 8px' }}>
        {readOnly ? 'Placed fields (locked once the request is sent).' : 'Click the page to place the chosen field, drag to move, drag the corner to resize, arrow keys nudge, Delete removes.'}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <button className="ops-btn small" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <strong>
          Page {page} of {pages.length}
        </strong>
        <button className="ops-btn small" type="button" disabled={page >= pages.length} onClick={() => setPage(page + 1)}>
          Next
        </button>
        <label style={{ marginLeft: 8 }}>
          <input type="checkbox" checked={backdrop} onChange={(e) => setBackdrop(e.target.checked)} /> Show the document behind the boxes
        </label>
        {signers.map((s) => (
          <span key={s.email} className="ops-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <i style={{ width: 10, height: 10, background: colour(s.email), display: 'inline-block', borderRadius: 2 }} />
            {s.name} ({value.filter((f) => f.signerEmail === s.email).length})
          </span>
        ))}
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div ref={canvas} onClick={place} tabIndex={0} aria-label={`Page ${page} of the document`} style={{ position: 'relative', width: '100%', paddingTop: `${aspect}%`, background: '#fff', border: '1px solid #cbd5e1', boxShadow: '0 1px 6px rgba(0,0,0,.12)', cursor: readOnly ? 'default' : 'crosshair', overflow: 'hidden', outline: 'none' }}>
          {backdrop && urls[page] && (
            <iframe title={`Page ${page}`} src={`${urls[page]}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none' }} />
          )}
          {mine.map((f) => {
            const c = colour(f.signerEmail);
            const sel = f.key === selected;
            return (
              <div
                key={f.key}
                onPointerDown={(e) => drag(e, f, 'move')}
                onClick={(e) => e.stopPropagation()}
                title={`${KIND_LABEL[f.kind]} - ${signers.find((s) => s.email === f.signerEmail)?.name ?? f.signerEmail}`}
                style={{ position: 'absolute', left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, border: `2px ${sel ? 'solid' : 'dashed'} ${c}`, background: `${c}22`, color: c, fontSize: 10, fontWeight: 700, overflow: 'hidden', cursor: readOnly ? 'default' : 'move', touchAction: 'none', boxSizing: 'border-box' }}
              >
                <span style={{ padding: '0 3px', whiteSpace: 'nowrap' }}>
                  {KIND_LABEL[f.kind]}: {signers.find((s) => s.email === f.signerEmail)?.name}
                </span>
                {!readOnly && <span onPointerDown={(e) => drag(e, f, 'resize')} style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, background: c, cursor: 'nwse-resize', touchAction: 'none' }} />}
              </div>
            );
          })}
        </div>
      </div>
      <p className="ops-muted" style={{ textAlign: 'center' }}>
        The browser's PDF viewer draws the page behind the boxes and may add a thin margin; use &quot;Preview on the PDF&quot; for the exact result.
      </p>
      <Alert>{error}</Alert>
    </div>
  );
}

/** Read-only summary of a layout for a request (used in the detail view). */
export function layoutSummary(fields: { page: number; kind: string }[]): string {
  if (!fields.length) return 'None - signatures go on the appended signature page';
  const pages = [...new Set(fields.map((f) => f.page))].sort((a, b) => a - b);
  return `${fields.length} on page${pages.length === 1 ? '' : 's'} ${pages.join(', ')}`;
}
