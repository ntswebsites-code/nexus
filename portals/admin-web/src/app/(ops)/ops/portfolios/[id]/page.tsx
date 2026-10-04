'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, describeError, v1 } from '@/ops/api';
import { EvidenceCard } from '@/ops/portfolio-evidence';
import { formatDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { PortfolioMandate, PortfolioSnapshot } from '@/ops/types';
import { Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

const pct = (v: string | null | undefined, dp = 2) => (v == null ? '—' : `${formatDecimal(v, dp)}%`);

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const canManage = useCan('portfolio.manage');
  const canViewRisk = useCan('risk.view');
  const [editing, setEditing] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
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
                  {canManage && p.status === 'Setup' && (
                    <button
                      className="ops-btn primary"
                      type="button"
                      disabled={activating}
                      title="Makes the portfolio tradable once the activation steps in Operations are done"
                      onClick={async () => {
                        setActivating(true);
                        setActivateError(null);
                        try {
                          await api.patch(v1(`/portfolios/${encodeURIComponent(p.id)}`), { status: 'Active', version: p.version });
                          snap.reload();
                        } catch (e) {
                          setActivateError(describeError(e));
                        } finally {
                          setActivating(false);
                        }
                      }}
                    >
                      {activating ? 'Activating…' : 'Activate portfolio'}
                    </button>
                  )}
                  {canManage && (
                    <button className="ops-btn" type="button" onClick={() => setEditing(true)}>
                      Edit mandate limits
                    </button>
                  )}
                </>
              }
            />
            <Alert>{activateError}</Alert>
            {s.warnings.length > 0 && <Alert kind="warn">{s.warnings.join(' · ')}</Alert>}
            {((s as { staleWarnings?: string[] }).staleWarnings ?? []).length > 0 && <Alert kind="warn">Stale prices (still valued): {((s as { staleWarnings?: string[] }).staleWarnings ?? []).join(' · ')}</Alert>}
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
            {canViewRisk && <RiskLimitsCard portfolioId={p.id} />}
            <EvidenceCard portfolioId={p.id} canManage={canManage} />
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

interface LimitEvaluation {
  limitId: string;
  ref: string;
  metric: string;
  scopeType: string;
  threshold: string;
  value: string;
  state: 'OK' | 'WARNING' | 'BREACH' | string;
  detail?: string;
}

/** Firm and portfolio-scoped risk limits, evaluated by the API with the same engine the Risk monitor and Today dashboard use. */
function RiskLimitsCard({ portfolioId }: { portfolioId: string }) {
  const res = useResource<{ evaluations: LimitEvaluation[] }>(() => api.get<{ evaluations: LimitEvaluation[] }>(v1(`/risk/portfolios/${encodeURIComponent(portfolioId)}/limits`)), [portfolioId]);
  if (res.state !== 'ok') return null;
  const limits = res.data.evaluations;
  if (!limits?.length) return null;
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
            {limits.map((l) => (
              <tr key={l.limitId}>
                <td>
                  {l.ref}
                  <span className="ops-sub">{l.scopeType === 'FIRM' ? 'Firm-wide' : 'This portfolio'}</span>
                </td>
                <td>{l.metric.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="r">{pct(l.threshold)}</td>
                <td className="r">{pct(l.value)}</td>
                <td>
                  <span className={`ops-badge ${l.state === 'BREACH' ? 'red' : l.state === 'WARNING' ? 'amber' : 'green'}`} title={l.detail}>
                    {l.state === 'BREACH' ? 'breach' : l.state === 'WARNING' ? 'warning' : 'within'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
