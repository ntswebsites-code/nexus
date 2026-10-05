'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, apiDownload, apiRequest, qs, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { bp, OrderStatusBadge, price6, shares, SideTag, STATUS_LABEL, type OrdersList } from '@/ops/orders';
import { useCan } from '@/ops/session';
import type { PortfolioSummary, SecurityRow } from '@/ops/types';
import { Alert, Card, Empty, Field, formatDateTime, Loaded, PageHeader, useResource } from '@/ops/ui';

const PAGE = 25;
const STATUS_OPTIONS = ['Working', 'AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled', 'Filled', 'Rejected', 'Cancelled', 'Draft', 'Validated'];

function Tile({ label, value, hint, onClick, active }: { label: string; value: string; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderColor: active ? 'var(--ops-blue)' : undefined }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}

export default function OrdersBlotterPage() {
  const router = useRouter();
  const canCreate = useCan('orders.create');
  const [status, setStatus] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [securityId, setSecurityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  // The file carries the same filters as the table (FR-OMS-012/020), not just the visible page.
  const exportFile = (format: 'csv' | 'xlsx') =>
    void apiDownload(v1(`/orders/export${qs({ status, portfolioId, securityId, from, to, format })}`), `order-blotter.${format}`).then(() => setExportError(null), (e: Error) => setExportError(e.message));

  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const securities = useResource<SecurityRow[]>(() => api.get<SecurityRow[]>(v1('/securities?limit=200')), []);
  const orders = useResource<OrdersList>(
    () => apiRequest<OrdersList>('GET', v1(`/orders${qs({ status, portfolioId, securityId, from, to, limit: String(PAGE), offset: String(offset) })}`)),
    [status, portfolioId, securityId, from, to, offset],
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    setOffset(0);
    set(v);
  };

  return (
    <>
      <PageHeader
        kicker="Trading"
        title="Orders"
        subtitle="Order blotter: pre-trade checked, approved by a second person, routed to the broker and filled."
        actions={
          <>
            <button className="ops-btn" type="button" onClick={() => exportFile('csv')}>Export CSV</button>
            <button className="ops-btn" type="button" onClick={() => exportFile('xlsx')}>Export XLSX</button>
            {canCreate && (
              <Link className="ops-btn" href="/ops-native/imports">
                Import orders
              </Link>
            )}
            {canCreate && (
              <Link className="ops-btn primary" href="/ops-native/orders/new">
                New order
              </Link>
            )}
          </>
        }
      />
      <Alert>{exportError}</Alert>

      <Loaded res={orders} what="orders">
        {(list) => (
          <>
            <div className="ops-tiles">
              <Tile label="Working" value={String(list.summary.working)} hint="Approved, routing or partly filled" onClick={() => filter(setStatus)('Working')} active={status === 'Working'} />
              <Tile label="Awaiting approval" value={String(list.summary.awaitingApproval)} hint="Need a second person" onClick={() => filter(setStatus)('AwaitingApproval')} active={status === 'AwaitingApproval'} />
              <Tile label="Filled" value={String(list.summary.filled)} hint="Completely filled" onClick={() => filter(setStatus)('Filled')} active={status === 'Filled'} />
              <Tile
                label="Slippage"
                value={list.summary.slippageBp === null ? '—' : bp(list.summary.slippageBp)}
                hint="Fill-weighted, vs decision price; positive is worse"
              />
            </div>

            <Card>
              <div className="ops-filters">
                <Field label="Status">
                  <select className="ops-input" value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s === 'Working' ? 'Working (approved, routing, partly filled)' : STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Portfolio">
                  <select className="ops-input" value={portfolioId} onChange={(e) => filter(setPortfolioId)(e.target.value)}>
                    <option value="">All portfolios</option>
                    {portfolios.state === 'ok' &&
                      portfolios.data.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.ref})
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Security">
                  <select className="ops-input" value={securityId} onChange={(e) => filter(setSecurityId)(e.target.value)}>
                    <option value="">All securities</option>
                    {securities.state === 'ok' &&
                      securities.data.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.ticker}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Created from">
                  <input className="ops-input" type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
                </Field>
                <Field label="Created to">
                  <input className="ops-input" type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
                </Field>
              </div>
              {list.data.length === 0 ? (
                <Empty>No orders match these filters.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Portfolio</th>
                        <th>Security</th>
                        <th>Side</th>
                        <th className="r">Quantity</th>
                        <th className="r">Filled</th>
                        <th>Type</th>
                        <th className="r">Avg price</th>
                        <th className="r">Slippage</th>
                        <th>Status</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.map((o) => (
                        <tr key={o.id} className="clickable" onClick={() => router.push(`/ops-native/orders/${encodeURIComponent(o.id)}`)}>
                          <td>
                            <strong>{o.ref}</strong>
                            <span className="ops-sub">{o.maker?.name}</span>
                          </td>
                          <td>
                            {o.portfolio.name}
                            <span className="ops-sub">{o.portfolio.ref}</span>
                          </td>
                          <td>
                            <strong>{o.security.ticker}</strong>
                            <span className="ops-sub">{o.security.name}</span>
                          </td>
                          <td>
                            <SideTag side={o.side} />
                          </td>
                          <td className="r">{shares(o.quantity)}</td>
                          <td className="r">
                            {shares(o.filledQty)}
                            {Number(o.filledQty) > 0 && <span className="ops-sub">{formatDecimal((Number(o.filledQty) / Number(o.quantity)) * 100, 0)}%</span>}
                          </td>
                          <td>
                            {o.orderType === 'LIMIT' ? `Limit ${price6(o.limitPrice)}` : 'Market'}
                            <span className="ops-sub">
                              {o.tif} · {o.currency}
                            </span>
                          </td>
                          <td className="r">{price6(o.avgPrice)}</td>
                          <td className="r">{bp(o.slippageBp)}</td>
                          <td>
                            <OrderStatusBadge status={o.status} />
                          </td>
                          <td>{formatDateTime(o.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                <span className="ops-muted">
                  {list.total === 0 ? 'No orders' : `${list.offset + 1}-${Math.min(list.offset + list.data.length, list.total)} of ${list.total}`}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Previous
                  </button>
                  <button className="ops-btn small" type="button" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)}>
                    Next
                  </button>
                </span>
              </div>
            </Card>
          </>
        )}
      </Loaded>
    </>
  );
}
