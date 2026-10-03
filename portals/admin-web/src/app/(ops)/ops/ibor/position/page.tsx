'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { EVENT_LABEL, money2, qty, qtyFine, signed, StateBadge, Tile, type PositionDetail } from '@/ops/ibor';
import { TabBar, Tone } from '@/ops/recon/common';
import { Alert, Card, DefinitionList, Empty, formatDate, formatDateTime, Loaded, PageHeader, useResource } from '@/ops/ui';

type Tab = 'ledger' | 'lots' | 'recon' | 'history';

export default function PositionPage() {
  const [params, setParams] = useState<{ portfolioId: string; securityId: string; asOf: string } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({ portfolioId: sp.get('portfolioId') ?? '', securityId: sp.get('securityId') ?? '', asOf: sp.get('asOf') ?? '' });
  }, []);
  if (!params) return null;
  if (!params.portfolioId || !params.securityId) {
    return (
      <>
        <p>
          <Link href="/ops/ibor">← IBOR &amp; Positions</Link>
        </p>
        <Alert>Open a position from the IBOR position ledger.</Alert>
      </>
    );
  }
  return <Detail {...params} />;
}

function Detail({ portfolioId, securityId, asOf }: { portfolioId: string; securityId: string; asOf: string }) {
  const [tab, setTab] = useState<Tab>('ledger');
  const res = useResource<PositionDetail>(() => api.get<PositionDetail>(v1(`/ibor/position${qs({ portfolioId, securityId, asOf })}`)), [portfolioId, securityId, asOf]);
  return (
    <>
      <p>
        <Link href={`/ops/ibor${qs({ portfolioId })}`}>← IBOR &amp; Positions</Link>
      </p>
      <Loaded res={res} what="this position">
        {(d) => {
          const p = d.position;
          return (
            <>
              <PageHeader
                kicker={`Position · ${p.portfolioName}`}
                title={
                  <>
                    {p.ticker} <StateBadge state={p.state} reasons={p.reasons} />
                  </>
                }
                subtitle={`${p.name} · ${p.assetClass}${p.sector ? ` · ${p.sector}` : ''} · ${p.market}`}
                actions={
                  <>
                    <Link className="ops-btn" href={`/ops/orders?q=${encodeURIComponent(p.ticker)}`}>
                      Trade security
                    </Link>
                    <Link className="ops-btn" href="/ops/cash">
                      Open cash
                    </Link>
                  </>
                }
              />
              {p.reasons.length > 0 && <Alert kind="warn">{p.reasons.join('. ')}.</Alert>}
              <div className="ops-tiles">
                <Tile label="IBOR quantity" value={qty(p.quantity)} hint={`Settled ${qty(p.settled)} · unsettled ${signed(p.unsettled)}`} />
                <Tile label="Available to sell" value={p.restricted ? 'Restricted' : qty(p.available)} hint="Settled less pending sales" />
                <Tile label="Market value" value={p.marketValueBase ? `${p.baseCurrency} ${money2(p.marketValueBase)}` : '—'} hint={p.price ? `${p.currency} ${p.price} · ${p.priceSource ?? ''}` : 'No price'} />
                <Tile label="Tax lots" value={String(p.lotCount)} hint={`${qtyFine(p.lotQuantity)} in open lots`} tone={Number(p.drift) !== 0 ? 'warn' : undefined} />
              </div>
              <TabBar
                tabs={[
                  { key: 'ledger', label: 'Position ledger' },
                  { key: 'lots', label: 'Lots & settlement' },
                  { key: 'recon', label: 'Reconciliation' },
                  { key: 'history', label: 'History' },
                ]}
                value={tab}
                onChange={setTab}
              />
              {tab === 'ledger' && (
                <Card title="Position record">
                  <DefinitionList
                    items={[
                      ['Quantity', qtyFine(p.quantity)],
                      ['Settled', qtyFine(p.settled)],
                      ['Unsettled buys', qtyFine(p.unsettledBuys)],
                      ['Unsettled sells', qtyFine(p.unsettledSells)],
                      ['Open sell orders (remaining)', qtyFine(p.openSellRemaining)],
                      ['Average cost (security currency)', p.avgCost],
                      ['Cost (base)', p.costBase ? money2(p.costBase) : '—'],
                      ['Local market value', p.marketValueLocal ? `${p.currency} ${money2(p.marketValueLocal)}` : '—'],
                      ['Accrued (confirmed dividends)', p.accrued ? money2(p.accrued) : '—'],
                      ['Price source', p.priceSource ?? '—'],
                    ]}
                  />
                </Card>
              )}
              {tab === 'lots' && (
                <>
                  <Card title="Tax lots (first in, first out)">
                    {d.lots.length === 0 ? (
                      <Empty>No lots yet. Refresh IBOR from the positions page.</Empty>
                    ) : (
                      <div className="ops-table-wrap">
                        <table className="ops-table">
                          <thead>
                            <tr>
                              <th>Opened</th>
                              <th>Source</th>
                              <th className="r">Original</th>
                              <th className="r">Remaining</th>
                              <th className="r">Unit cost</th>
                              <th className="r">Cost remaining</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.lots.map((l) => (
                              <tr key={l.id}>
                                <td>{formatDate(l.openedOn)}</td>
                                <td>{l.sourceType.toLowerCase()}</td>
                                <td className="r">{qtyFine(l.originalQty)}</td>
                                <td className="r">{qtyFine(l.remainingQty)}</td>
                                <td className="r">
                                  {l.unitCost}
                                  <span className="ops-sub">{l.currency}</span>
                                </td>
                                <td className="r">{money2(l.costRemaining)}</td>
                                <td>
                                  <span className={`ops-badge ${l.status === 'OPEN' ? 'green' : 'grey'}`}>{l.status.toLowerCase()}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {d.lotSummary.averageCost && <p className="ops-muted">Weighted average cost of open lots: {d.lotSummary.averageCost}</p>}
                  </Card>
                  <Card title="Unsettled fills and orders">
                    {d.unsettledFills.length === 0 ? (
                      <Empty>No unsettled fills.</Empty>
                    ) : (
                      <div className="ops-table-wrap">
                        <table className="ops-table">
                          <thead>
                            <tr>
                              <th>Order</th>
                              <th>Side</th>
                              <th className="r">Quantity</th>
                              <th className="r">Price</th>
                              <th>Executed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.unsettledFills.map((f) => (
                              <tr key={f.id}>
                                <td>{f.orderRef}</td>
                                <td>{f.side}</td>
                                <td className="r">{qty(f.quantity)}</td>
                                <td className="r">{f.price}</td>
                                <td>{formatDateTime(f.executedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <h3 style={{ marginTop: 16 }}>Recent orders</h3>
                    {d.orders.length === 0 ? (
                      <Empty>No orders for this security in this portfolio.</Empty>
                    ) : (
                      <ul>
                        {d.orders.map((o) => (
                          <li key={o.id}>
                            <Link href={`/ops/orders/${encodeURIComponent(o.id)}`}>{o.ref}</Link> · {o.side} {qty(o.quantity)} (filled {qty(o.filledQty)}) · {o.status}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </>
              )}
              {tab === 'recon' && (
                <Card title="Holdings reconciliation" actions={<Link href="/ops/reconciliation">Open reconciliations →</Link>}>
                  {d.reconciliation.length === 0 ? (
                    <Empty>No holdings breaks for this portfolio. Run Reconcile positions on the IBOR page to compare with the custodian.</Empty>
                  ) : (
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>Break</th>
                            <th>Detail</th>
                            <th>Severity</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.reconciliation.map((b) => (
                            <tr key={b.id}>
                              <td>{b.ref}</td>
                              <td>{b.label}</td>
                              <td>
                                <Tone value={b.severity} />
                              </td>
                              <td>
                                <Tone value={b.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              )}
              {tab === 'history' && (
                <>
                  <Card title="Book events">
                    {d.events.length === 0 ? (
                      <Empty>No events for this position yet.</Empty>
                    ) : (
                      <div className="ops-table-wrap">
                        <table className="ops-table">
                          <thead>
                            <tr>
                              <th>Event</th>
                              <th>Type</th>
                              <th className="r">Quantity</th>
                              <th>Summary</th>
                              <th>Recorded</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.events.map((e) => (
                              <tr key={e.id}>
                                <td>{e.ref}</td>
                                <td>{EVENT_LABEL[e.type] ?? e.type}</td>
                                <td className="r">{signed(e.quantityDelta)}</td>
                                <td>{e.summary}</td>
                                <td>{formatDateTime(e.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                  <Card title="Position record by date">
                    <div className="ops-table-wrap">
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>As of</th>
                            <th className="r">Quantity</th>
                            <th className="r">Average cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.history.map((h) => (
                            <tr key={h.asOf}>
                              <td>{formatDate(h.asOf)}</td>
                              <td className="r">{qtyFine(h.quantity)}</td>
                              <td className="r">{h.avgCost}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </>
          );
        }}
      </Loaded>
    </>
  );
}
