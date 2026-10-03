'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { PortfolioMandate, PortfolioSnapshot } from '@/ops/types';
import type { RiskLimit } from '@/ops/risk/types';
import { Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

const pct = (v: string | null | undefined, dp = 2) => (v == null ? '—' : `${formatDecimal(v, dp)}%`);

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useCan('portfolio.manage');
  const canViewRisk = useCan('risk.view');
  const [editing, setEditing] = useState(false);
  const snap = useResource<PortfolioSnapshot>(() => api.get<PortfolioSnapshot>(v1(`/portfolios/${encodeURIComponent(id)}`)), [id]);

  return (
    <Loaded res={snap} what="portfolio">
      {(s) => {
        const p = s.portfolio;
        const m = p.mandate;
        const topSector = s.concentration.bySector[0];
        const limitRows: [string, number | undefined, string | null, boolean][] = [
          ['Max single name', m.maxSingleNamePct, s.concentration.largestPositionTicker ? `${pct(s.concentration.largestPositionPct)} (${s.concentration.largestPositionTicker})` : null, m.maxSingleNamePct !== undefined && Number(s.concentration.largestPositionPct) > m.maxSingleNamePct],
          ['Max sector', m.maxSectorPct, topSector ? `${pct(topSector.weightPct)} (${topSector.key})` : null, m.maxSectorPct !== undefined && Number(topSector?.weightPct ?? 0) > m.maxSectorPct],
          ['Cash floor', m.cashFloorPct, pct(s.totals.cashPct), m.cashFloorPct !== undefined && Number(s.totals.cashPct) < m.cashFloorPct],
          ['Max cash', m.maxCashPct, pct(s.totals.cashPct), m.maxCashPct !== undefined && Number(s.totals.cashPct) > m.maxCashPct],
        ];
        return (
          <>
            <PageHeader
              kicker="Portfolio"
              title={p.name}
              subtitle={`${p.ref} · ${p.type} · base ${p.baseCurrency} · valued ${s.asOf}`}
              actions={
                <>
                  <Link className="ops-btn" href="/ops/portfolios">
                    All portfolios
                  </Link>
                  {canManage && (
                    <button className="ops-btn" type="button" onClick={() => setEditing(true)}>
                      Edit mandate limits
                    </button>
                  )}
                </>
              }
            />
            {s.warnings.length > 0 && <Alert kind="warn">{s.warnings.join(' · ')}</Alert>}
            <Card title="Overview">
              <DefinitionList
                items={[
                  ['Status', <StatusBadge key="s" status={p.status} />],
                  ['Market value', <Money key="mv" value={s.totals.totalValueBase} currency={s.baseCurrency} />],
                  ['Securities', <Money key="sv" value={s.totals.securitiesValueBase} currency={s.baseCurrency} />],
                  ['Cash', `${formatDecimal(s.totals.cashBase)} ${s.baseCurrency} (${pct(s.totals.cashPct)})`],
                  ['Positions', String(s.totals.positionCount)],
                  ['Top 5 concentration', pct(s.concentration.top5Pct)],
                  ['Benchmark', p.benchmark],
                ]}
              />
            </Card>
            <Card title="Mandate limits">
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Limit</th>
                      <th className="r">Threshold</th>
                      <th className="r">Current</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {limitRows.map(([k, limit, cur, breach]) => (
                      <tr key={k}>
                        <td>{k}</td>
                        <td className="r">{limit !== undefined ? `${limit}%` : '—'}</td>
                        <td className="r">{cur ?? '—'}</td>
                        <td>{limit === undefined ? '—' : <span className={`ops-badge ${breach ? 'red' : 'green'}`}>{breach ? 'breach' : 'within'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {m.restrictedTickers?.length ? <p className="ops-hint">Restricted: {m.restrictedTickers.join(', ')}</p> : null}
            </Card>
            {canViewRisk && <RiskLimitsCard portfolioId={p.id} snap={s} />}
            <Card title="Positions">
              {s.lines.length === 0 && s.cash.length === 0 ? (
                <Empty>No positions.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Security</th>
                        <th>Market</th>
                        <th className="r">Quantity</th>
                        <th className="r">Avg cost</th>
                        <th className="r">Price</th>
                        <th className="r">Value ({s.baseCurrency})</th>
                        <th className="r">P&amp;L ({s.baseCurrency})</th>
                        <th className="r">Weight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l) => (
                        <tr key={l.positionId}>
                          <td>
                            <strong>{l.ticker}</strong>
                            <span className="ops-sub">{l.name}</span>
                          </td>
                          <td>
                            {l.market}
                            <span className="ops-sub">{l.sector ?? l.assetClass}</span>
                          </td>
                          <td className="r">{formatDecimal(l.quantity, 0)}</td>
                          <td className="r">{formatDecimal(l.avgCost, 4)}</td>
                          <td className="r">
                            {l.price ? `${formatDecimal(l.price, 4)} ${l.currency}` : '—'}
                            <span className="ops-sub">{l.priceDate ?? 'no price'}</span>
                          </td>
                          <td className="r">{l.marketValueBase ? formatDecimal(l.marketValueBase) : '—'}</td>
                          <td className="r">{l.unrealisedPnlBase ? formatDecimal(l.unrealisedPnlBase) : '—'}</td>
                          <td className="r">{pct(l.weightPct)}</td>
                        </tr>
                      ))}
                      {s.cash.map((c) => (
                        <tr key={c.currency}>
                          <td>
                            <strong>{c.currency} cash</strong>
                            <span className="ops-sub">available</span>
                          </td>
                          <td>—</td>
                          <td className="r">{formatDecimal(c.available)}</td>
                          <td className="r">—</td>
                          <td className="r">—</td>
                          <td className="r">{c.availableBase ? formatDecimal(c.availableBase) : '—'}</td>
                          <td className="r">—</td>
                          <td className="r">{c.availableBase && Number(s.totals.totalValueBase) ? pct(String((Number(c.availableBase) / Number(s.totals.totalValueBase)) * 100)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {editing && <MandateModal snap={s} onClose={() => setEditing(false)} onDone={snap.reload} />}
          </>
        );
      }}
    </Loaded>
  );
}

function MandateModal({ snap, onClose, onDone }: { snap: PortfolioSnapshot; onClose: () => void; onDone: () => void }) {
  const m = snap.portfolio.mandate;
  const field = (name: keyof PortfolioMandate, label: string, min = 0) => (
    <Field label={label} hint="Blank removes the limit">
      <input className="ops-input" name={name} type="number" step="0.01" min={min} max={100} defaultValue={(m[name] as number | undefined) ?? ''} />
    </Field>
  );
  return (
    <FormModal
      kicker={snap.portfolio.ref}
      title="Edit mandate limits"
      submitLabel="Save limits"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) => {
        const n = (k: string) => (str(fd, k) ? Number(str(fd, k)) : null);
        const restricted = str(fd, 'restrictedTickers');
        return api.patch(v1(`/portfolios/${snap.portfolio.id}`), {
          version: snap.portfolio.version,
          mandate: {
            maxSingleNamePct: n('maxSingleNamePct'),
            maxSectorPct: n('maxSectorPct'),
            cashFloorPct: n('cashFloorPct'),
            maxCashPct: n('maxCashPct'),
            restrictedTickers: restricted ? restricted.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean) : null,
          },
        });
      }}
    >
      <FieldGrid>
        {field('maxSingleNamePct', 'Max single name %', 0.01)}
        {field('maxSectorPct', 'Max sector %', 0.01)}
        {field('cashFloorPct', 'Cash floor %')}
        {field('maxCashPct', 'Max cash %')}
        <Field label="Restricted tickers" hint="Comma separated, e.g. DLTA.ZW, ECO.ZW" span={2}>
          <input className="ops-input" name="restrictedTickers" defaultValue={m.restrictedTickers?.join(', ') ?? ''} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}

/** Firm and portfolio-scoped risk limits (the ones the Risk monitor and Today dashboard use), judged on the same snapshot. */
function RiskLimitsCard({ portfolioId, snap }: { portfolioId: string; snap: PortfolioSnapshot }) {
  const res = useResource<{ data: RiskLimit[] } | RiskLimit[]>(() => api.get(v1(`/risk/limits?status=ACTIVE&portfolioId=${encodeURIComponent(portfolioId)}`)), [portfolioId]);
  if (res.state !== 'ok') return null;
  const limits = Array.isArray(res.data) ? res.data : res.data.data;
  if (!limits?.length) return null;
  const topSector = snap.concentration.bySector[0];
  const current = (metric: string): { value: number | null; floor: boolean } => {
    if (metric === 'SINGLE_NAME_PCT') return { value: Number(snap.concentration.largestPositionPct), floor: false };
    if (metric === 'SECTOR_PCT') return { value: topSector ? Number(topSector.weightPct) : null, floor: false };
    if (metric === 'CASH_FLOOR_PCT') return { value: Number(snap.totals.cashPct), floor: true };
    if (metric === 'TOP5_PCT') return { value: Number(snap.concentration.top5Pct), floor: false };
    return { value: null, floor: false };
  };
  return (
    <Card title="Risk limits (firm and portfolio)">
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Limit</th>
              <th>Metric</th>
              <th className="r">Threshold</th>
              <th className="r">Current</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {limits.map((l) => {
              const c = current(l.metric);
              const breach = c.value !== null && (c.floor ? c.value < Number(l.threshold) : c.value > Number(l.threshold));
              return (
                <tr key={l.id}>
                  <td>
                    {l.ref}
                    <span className="ops-sub">{l.scopeType === 'FIRM' ? 'Firm-wide' : 'This portfolio'}</span>
                  </td>
                  <td>{l.metric.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="r">{pct(l.threshold)}</td>
                  <td className="r">{c.value === null ? '—' : pct(String(c.value))}</td>
                  <td>{c.value === null ? '—' : <span className={`ops-badge ${breach ? 'red' : 'green'}`}>{breach ? 'breach' : 'within'}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
