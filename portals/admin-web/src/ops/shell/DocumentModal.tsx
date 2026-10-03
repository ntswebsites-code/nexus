'use client';

import { useEffect, useState } from 'react';
import { api, apiBase, describeError, v1 } from '../api';
import { Alert, Modal } from '../ui';

/**
 * Shared document preview (SRD 5A.0.4). Asks the documents API for a short-lived signed URL (which is audited as a
 * download), fetches it as a blob and shows PDFs and images inline; every other type offers the download only.
 * Pass the document id; optional `version` previews an older version.
 */
export function DocumentModal({ documentId, name, version, onClose }: { documentId: string; name?: string; version?: number; onClose: () => void }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; url: string; mime: string; objectUrl: string | null }>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    (async () => {
      try {
        const r = await api.get<{ url: string }>(v1(`/documents/${documentId}/download-url${version ? `?version=${version}` : ''}`));
        const absolute = r.url.startsWith('http') ? r.url : `${apiBase}${r.url}`;
        let objectUrl: string | null = null;
        let mime = '';
        try {
          const res = await fetch(absolute, { credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            mime = blob.type;
            if (/^(application\/pdf|image\/)/.test(mime)) {
              objectUrl = URL.createObjectURL(blob);
              created = objectUrl;
            }
          }
        } catch {
          /* preview is best effort; the download link still works */
        }
        if (alive) setState({ kind: 'ready', url: absolute, mime, objectUrl });
      } catch (e) {
        if (alive) setState({ kind: 'error', message: describeError(e) });
      }
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [documentId, version]);

  return (
    <Modal wide title={name ?? 'Document'} kicker="Document preview" onClose={onClose}>
      <div className="ops-modal-body">
        {state.kind === 'loading' && <div className="ops-loading">Preparing the document…</div>}
        {state.kind === 'error' && <Alert>{state.message}</Alert>}
        {state.kind === 'ready' && (
          <>
            {state.objectUrl && state.mime.startsWith('image/') && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="ops-doc-preview" src={state.objectUrl} alt={name ?? 'Document'} />
            )}
            {state.objectUrl && state.mime === 'application/pdf' && <iframe className="ops-doc-frame" src={state.objectUrl} title={name ?? 'Document'} />}
            {!state.objectUrl && <p className="ops-muted">This file type has no inline preview. Download it to open it.</p>}
            <p>
              <a className="ops-btn primary" href={state.url}>
                Download
              </a>
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
