'use client';

import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { useCan } from '@/ops/session';
import type { SecurityRow } from '@/ops/types';
import { Card, DateText, Empty, Field, FieldGrid, FormModal, Loaded, Modal, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

export default function SecuritiesPage() {
  const canManage = useCan('portfolio.manage');
  const [q, setQ] = useState('');
  const [market, setMarket] = useState('');
  const [pricing, setPricing] = useState<SecurityRow | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const rows = useResource<SecurityRow[]>(() => api.get<SecurityRow[]>(v1(`/securities${qs({ q, market })}`)), [q, market]);
  const detail = useResource<SecurityRow | null>(() => (viewing ? api.get<SecurityRow>(v1(`/securities/${encodeURIComponent(viewing)}`)) : Promise.resolve(null)), [viewing]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader kicker="Portfolio" title="Securities & prices" subtitle="Instrument master for ZSE, VFEX and OTC with the latest recorded price." />
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="ops-input" placeholder="Search ticker, name, ISIN or sector" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
          <select className="ops-input" value={market} onChange={(e) => setMarket(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All markets</option>
            <option value="ZSE">ZSE</option>
            <option value="VFEX">VFEX</option>
            <option value="OTC">OTC</option>
          </select>
        </div>
        <Loaded res={rows} what="securities">
          {(list) =>
            list.length === 0 ? (
              <Empty>No securities match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Market</th>
                      <th>Sector</th>
                      <th>Ccy</th>
                      <th className="r">Last price</th>
                      <th className="r">Change</th>
                      <th>Price date</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id} className="clickable" onClick={() => setViewing(s.ticker)}>
                        <td>
                          <strong>{s.ticker}</strong>
                          <span className="ops-sub">{s.name}</span>
                        </td>
                        <td>{s.market}</td>
                        <td>{s.sector ?? s.assetClass}</td>
                        <td>{s.currency}</td>
                        <td className="r">{s.latestPrice ? formatDecimal(s.latestPrice.price, 4) : '—'}</td>
                        <td className="r">{s.changePct ? `${formatDecimal(s.changePct, 2)}%` : '—'}</td>
                        <td>{s.latestPrice ? <DateText value={s.latestPrice.priceDate} /> : '—'}</td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {canManage && (
                            <button className="ops-btn small" type="button" onClick={() => setPricing(s)}>
                              Set price
                            </button>
                          )}
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
      {viewing && (
        <Modal title={viewing} kicker="Price history" onClose={() => setViewing(null)}>
          <div className="ops-modal-body">
            <Loaded res={detail} what="prices">
              {(d) =>
                !d?.history?.length ? (
                  <Empty>No prices recorded.</Empty>
                ) : (
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th className="r">Price ({d.currency})</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.history.map((h, i) => (
                        <tr key={i}>
                          <td>
                            <DateText value={h.priceDate} />
                          </td>
                          <td className="r">{formatDecimal(h.price, 4)}</td>
                          <td>{h.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
            </Loaded>
          </div>
        </Modal>
      )}
      {pricing && (
        <FormModal
          kicker={pricing.ticker}
          title="Set price"
          subtitle={`Price per unit in ${pricing.currency}. A price for the same date and source is corrected in place.`}
          submitLabel="Save price"
          onClose={() => setPricing(null)}
          onSubmit={(fd, key) => api.post(v1(`/securities/${pricing.id}/prices`), { priceDate: str(fd, 'priceDate'), price: str(fd, 'price').replace(/,/g, ''), source: 'MANUAL' }, { idempotencyKey: key })}
          onDone={() => rows.reload()}
        >
          <FieldGrid>
            <Field label="Price date">
              <input className="ops-input" type="date" name="priceDate" required max={today} defaultValue={today} />
            </Field>
            <Field label={`Price (${pricing.currency})`}>
              <input className="ops-input" name="price" required inputMode="decimal" defaultValue={pricing.latestPrice?.price ?? ''} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
