'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, Loaded, PageHeader, StatusBadge, useResource } from '@/ops/ui';
import { DocumentModal } from '@/ops/shell/DocumentModal';
import { RecordBody, loadRecord } from '@/ops/shell/Drawer';

/**
 * Generic record detail page (SRD 5A.29). Any module or the command palette can deep link to
 * `/ops/record/<kind>/<id>`; the API returns only kinds the signed-in role may view, with the audit history when the
 * role holds audit.view. Documents get the shared preview modal.
 */
export default function RecordPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = decodeURIComponent(params.kind);
  const id = decodeURIComponent(params.id);
  const res = useResource(() => loadRecord(kind, id), [kind, id]);
  const [preview, setPreview] = useState(false);

  return (
    <Loaded res={res} what="the record">
      {(d) => (
        <>
          <PageHeader
            kicker={d.record.kindLabel}
            title={
              <>
                {d.record.title} {d.record.status && <StatusBadge status={d.record.status} />}
              </>
            }
            subtitle={d.record.ref ?? undefined}
            actions={
              <>
                {d.record.kind === 'document' && (
                  <button className="ops-btn" type="button" onClick={() => setPreview(true)}>
                    Preview file
                  </button>
                )}{' '}
                <Link className="ops-btn primary" href={d.record.route}>
                  Open in module
                </Link>
              </>
            }
          />
          <Card>
                    <RecordBody data={d} full />
          </Card>
          {preview && <DocumentModal documentId={d.record.id} name={d.record.title} onClose={() => setPreview(false)} />}
        </>
      )}
    </Loaded>
  );
}
