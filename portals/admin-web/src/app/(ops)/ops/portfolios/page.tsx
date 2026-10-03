'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { PortfolioSnapshot, PortfolioSummary } from '@/ops/types';
import { Card, Empty, Field, FieldGrid, FormModal, Loaded, Money, optStr, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

export default function PortfoliosPage() {
  const router = useRouter();
  const canManage = useCan('portfolio.manage');
  const [q, setQ] = useState('');
  const [currency, setCurrency] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const rows = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1(`/portfolios${qs({ q, currency, status })}`)), [q, currency, status]);

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title="Portfolios"
        subtitle="Managed portfolios and mandates, valued at the latest prices in each portfolio's base currency."
        actions={
          canManage && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New portfolio
            </button>
          )
        }
      />
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="ops-input" placeholder="Search name, ref or benchmark" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
          <select className="ops-input" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">All currencies</option>
            <option value="USD">USD</option>
            <option value="ZWG">ZWG</option>
            <option value="ZAR">ZAR</option>
          </select>
          <select className="ops-input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All statuses</option>
            {['Setup', 'Active', 'Suspended', 'Closed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Loaded res={rows} what="portfolios">
          {(list) =>
            list.length === 0 ? (
              <Empty>No portfolios match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Portfolio</th>
                      <th>Type</th>
                      <th>Ccy</th>
                      <th className="r">Market value</th>
                      <th className="r">Cash %</th>
                      <th className="r">Positions</th>
                      <th>Largest position</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => {
                      const limit = p.mandate.maxSingleNamePct;
                      const over = limit !== undefined && Number(p.largestPositionPct) > limit;
                      return (
                        <tr key={p.id} className="clickable" onClick={() => router.push(`/ops/portfolios/${encodeURIComponent(p.id)}`)}>
                          <td>
                            <strong>{p.name}</strong>
                            <span className="ops-sub">{p.ref}</span>
                          </td>
                          <td>{p.type}</td>
                          <td>{p.baseCurrency}</td>
                          <td className="r">
                            <Money value={p.marketValueBase} currency={p.baseCurrency} />
                            {p.warnings > 0 && <span className="ops-sub">{p.warnings} unvalued</span>}
                            {((p as { stalePrices?: number }).stalePrices ?? 0) > 0 && <span className="ops-sub">{(p as { stalePrices?: number }).stalePrices} stale price{(p as { stalePrices?: number }).stalePrices === 1 ? '' : 's'}</span>}
                          </td>
                          <td className="r">{formatDecimal(p.cashPct, 1)}%</td>
                          <td className="r">{p.positionCount}</td>
                          <td>
                            {p.largestPositionTicker ?? '—'}
                            {p.largestPositionTicker && (
                              <span className="ops-sub">
                                {formatDecimal(p.largestPositionPct, 1)}%{limit !== undefined ? ` of ${limit}% mandate limit${over ? ' (over)' : ''}` : ''}
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={p.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {creating && (
        <FormModal
          kicker="Portfolio"
          title="New portfolio"
          submitLabel="Create portfolio"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => {
            const num = (n: string) => (str(fd, n) ? Number(str(fd, n)) : undefined);
            const mandate = { maxSingleNamePct: num('maxSingleNamePct'), maxSectorPct: num('maxSectorPct'), cashFloorPct: num('cashFloorPct'), maxCashPct: num('maxCashPct') };
            return api.post<PortfolioSnapshot>(
              v1('/portfolios'),
              { name: str(fd, 'name'), type: str(fd, 'type'), baseCurrency: str(fd, 'baseCurrency').toUpperCase(), benchmark: optStr(fd, 'benchmark'), mandate: JSON.parse(JSON.stringify(mandate)) },
              { idempotencyKey: key },
            );
          }}
          onDone={(r) => {
            const id = (r as PortfolioSnapshot | undefined)?.portfolio?.id;
            if (id) router.push(`/ops/portfolios/${encodeURIComponent(id)}`);
            else rows.reload();
          }}
        >
          <FieldGrid>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={2} maxLength={160} />
            </Field>
            <Field label="Type">
              <input className="ops-input" name="type" required maxLength={64} defaultValue="Balanced Fund" />
            </Field>
            <Field label="Base currency">
              <input className="ops-input" name="baseCurrency" required minLength={3} maxLength={3} defaultValue="USD" style={{ textTransform: 'uppercase' }} />
            </Field>
            <Field label="Benchmark" span={2}>
              <input className="ops-input" name="benchmark" maxLength={160} />
            </Field>
            <Field label="Max single name %">
              <input className="ops-input" name="maxSingleNamePct" type="number" step="0.01" min={0.01} max={100} />
            </Field>
            <Field label="Max sector %">
              <input className="ops-input" name="maxSectorPct" type="number" step="0.01" min={0.01} max={100} />
            </Field>
            <Field label="Cash floor %">
              <input className="ops-input" name="cashFloorPct" type="number" step="0.01" min={0} max={100} />
            </Field>
            <Field label="Max cash %">
              <input className="ops-input" name="maxCashPct" type="number" step="0.01" min={0} max={100} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
