'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ops } from '@/ops/api';
import { FundFields, fundPayload } from '@/ops/FundForm';
import { useCan } from '@/ops/session';
import type { Fund } from '@/ops/types';
import { Card, DateText, Empty, FormModal, Loaded, Money, PageHeader, StatusBadge, useResource } from '@/ops/ui';

export default function FundsPage() {
  const router = useRouter();
  const canManage = useCan('funds.manage');
  const [creating, setCreating] = useState(false);
  const funds = useResource<Fund[]>(() => api.get<Fund[]>(ops('/funds')), []);

  return (
    <>
      <PageHeader
        kicker="Fund operations"
        title="Funds & commitments"
        subtitle="Fund master data and the LP commitments capital calls and distributions are allocated against."
        actions={
          canManage && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New fund
            </button>
          )
        }
      />
      <Card>
        <Loaded res={funds} what="funds">
          {(rows) =>
            rows.length === 0 ? (
              <Empty>No funds yet.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Fund</th>
                      <th>Model</th>
                      <th>Ccy</th>
                      <th>Vintage</th>
                      <th className="r">Committed</th>
                      <th className="r">NAV / unit</th>
                      <th>As of</th>
                      <th>Portal</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.id} className="clickable" onClick={() => router.push(`/ops-native/funds/${encodeURIComponent(f.id)}`)}>
                        <td>
                          <strong>{f.name}</strong>
                          <span className="ops-sub">
                            {f.shortName}
                            {f.ref ? ` · ${f.ref}` : ''}
                          </span>
                        </td>
                        <td>{f.operatingModel === 'OPEN_ENDED' ? 'Open-ended' : 'Private capital'}</td>
                        <td>{f.currency}</td>
                        <td>{f.vintage ?? '—'}</td>
                        <td className="r">
                          {f.totalCommitted != null ? <Money value={f.totalCommitted} currency={f.currency} /> : '—'}
                          {f.commitmentCount != null && <span className="ops-sub">{f.commitmentCount} LPs</span>}
                        </td>
                        <td className="r">{f.navPerUnit ?? '—'}</td>
                        <td>
                          <DateText value={f.asOfDate} />
                        </td>
                        <td>{f.portalVisible === false ? 'Hidden' : 'Visible'}</td>
                        <td>
                          <StatusBadge status={f.status ?? 'Active'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {creating && (
        <FormModal
          kicker="Fund master"
          title="New fund"
          submitLabel="Create fund"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => api.post<Fund>(ops('/funds'), fundPayload(fd), { idempotencyKey: key })}
          onDone={(r) => {
            const f = r as Fund | undefined;
            if (f?.id) router.push(`/ops-native/funds/${encodeURIComponent(f.id)}`);
            else funds.reload();
          }}
        >
          <FundFields />
        </FormModal>
      )}
    </>
  );
}
