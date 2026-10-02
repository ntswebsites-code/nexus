'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, describeError, newIdempotencyKey, qs, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { CheckList, price6, type BrokerOption, type OrderDetail, type PreTradeResult } from '@/ops/orders';
import { useCan } from '@/ops/session';
import type { PortfolioSummary, SecurityRow } from '@/ops/types';
import { Alert, Card, Field, FieldGrid, PageHeader, useAction, useResource } from '@/ops/ui';

export default function NewOrderPage() {
  const router = useRouter();
  const canCreate = useCan('orders.create');
  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios?status=Active')), []);
  const brokers = useResource<BrokerOption[]>(() => api.get<BrokerOption[]>(v1('/brokers')), []);

  const [portfolioId, setPortfolioId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [security, setSecurity] = useState<SecurityRow | null>(null);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState('');
  const [tif, setTif] = useState('DAY');
  const [urgency, setUrgency] = useState('Normal');
  const [brokerId, setBrokerId] = useState('');
  const [rationale, setRationale] = useState('');
  const [result, setResult] = useState<PreTradeResult | null>(null);
  const [partial, setPartial] = useState<{ id: string; ref: string; message: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const found = useResource<SecurityRow[]>(() => (debounced.length >= 1 ? api.get<SecurityRow[]>(v1(`/securities${qs({ q: debounced, limit: '8' })}`)) : Promise.resolve([])), [debounced]);

  // Any change to the ticket makes the last check stale.
  useEffect(() => setResult(null), [portfolioId, security?.id, side, quantity, orderType, limitPrice]);

  const lot = security?.boardLot ?? 1;
  const qtyOk = /^\d+$/.test(quantity) && Number(quantity) > 0;
  const qtyErr = quantity && !qtyOk ? 'Enter a whole number of shares' : quantity && Number(quantity) % lot !== 0 ? `Must be a multiple of the board lot (${lot})` : null;
  const limitErr = orderType === 'LIMIT' && limitPrice && !(/^\d+(\.\d{1,6})?$/.test(limitPrice) && Number(limitPrice) > 0) ? 'Enter a positive price (up to 6 decimals)' : null;
  const tradable = security?.status === 'Active';
  const ready = !!portfolioId && !!security && tradable && qtyOk && !qtyErr && (orderType === 'MARKET' || (!!limitPrice && !limitErr));

  const ticket = () => ({
    portfolioId,
    securityId: security!.id,
    side,
    quantity,
    orderType,
    limitPrice: orderType === 'LIMIT' ? limitPrice : undefined,
    tif,
    urgency,
    brokerId: brokerId || undefined,
    rationale: rationale.trim() || undefined,
  });

  const check = useAction();
  const create = useAction();

  async function runCheck() {
    const r = await check.run(() => api.post<PreTradeResult>(v1('/orders/precheck'), ticket()));
    if (r) setResult(r);
  }

  async function createOrder(andSubmit: boolean) {
    setPartial(null);
    await create.run(async (key) => {
      const order = await api.post<OrderDetail>(v1('/orders'), ticket(), { idempotencyKey: key });
      if (!andSubmit) {
        router.push(`/ops/orders/${encodeURIComponent(order.id)}`);
        return;
      }
      try {
        const v = await api.post<OrderDetail>(v1(`/orders/${order.id}/validate`));
        if (v.status !== 'Validated') {
          setResult(v.precheck);
          throw new Error('The pre-trade check blocked this order, so it was not submitted.');
        }
        await api.post(v1(`/orders/${order.id}/submit`), { rationale: rationale.trim() }, { idempotencyKey: newIdempotencyKey() });
        router.push(`/ops/orders/${encodeURIComponent(order.id)}`);
      } catch (e) {
        setPartial({ id: order.id, ref: order.ref, message: describeError(e) });
      }
    });
  }

  if (!canCreate) {
    return (
      <>
        <PageHeader kicker="Trading" title="New order" />
        <Alert>Your role does not include creating orders (orders.create).</Alert>
      </>
    );
  }

  return (
    <>
      <p>
        <Link href="/ops/orders">← Orders</Link>
      </p>
      <PageHeader kicker="Trading" title="New order" subtitle="Fill in the ticket, run the pre-trade check, then save a draft or submit for approval." />
      <div className="ops-split">
        <Card title="Order ticket">
          <FieldGrid>
            <Field label="Portfolio" span={2}>
              <select className="ops-input" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} required>
                <option value="">{portfolios.state === 'loading' ? 'Loading portfolios…' : 'Select a portfolio'}</option>
                {portfolios.state === 'ok' &&
                  portfolios.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.ref}, {p.baseCurrency})
                    </option>
                  ))}
              </select>
            </Field>

            <Field label="Security" span={2} hint={security ? undefined : 'Search by ticker, name, ISIN or sector'}>
              {security ? (
                <div className="ops-input" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 'auto', padding: '8px 10px' }}>
                  <span>
                    <strong>{security.ticker}</strong> · {security.name}
                    <span className="ops-sub">
                      {security.market} · {security.currency} · board lot {security.boardLot} · last {security.latestPrice ? `${price6(security.latestPrice.price)} (${security.latestPrice.priceDate})` : 'no price'}
                    </span>
                  </span>
                  <button className="ops-btn small" type="button" onClick={() => setSecurity(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input className="ops-input" placeholder="e.g. DLTA or Delta" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {debounced && found.state === 'ok' && (
                    <div className="ops-table-wrap" style={{ marginTop: 6, border: '1px solid var(--ops-line)', borderRadius: 8 }}>
                      {found.data.length === 0 ? (
                        <div className="ops-empty">No securities match.</div>
                      ) : (
                        <table className="ops-table">
                          <tbody>
                            {found.data.map((s) => (
                              <tr key={s.id} className="clickable" onClick={() => setSecurity(s)}>
                                <td>
                                  <strong>{s.ticker}</strong>
                                  <span className="ops-sub">{s.name}</span>
                                </td>
                                <td>{s.market}</td>
                                <td className="r">
                                  {s.latestPrice ? price6(s.latestPrice.price) : '—'} {s.currency}
                                </td>
                                <td>{s.status !== 'Active' ? <span className="ops-badge red">{s.status}</span> : null}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              )}
            </Field>
            {security && !tradable && <Alert kind="warn">{security.ticker} is {security.status} and cannot be ordered.</Alert>}

            <Field label="Side">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['BUY', 'SELL'] as const).map((s) => (
                  <button key={s} type="button" className={`ops-btn${side === s ? ' primary' : ''}`} onClick={() => setSide(s)} aria-pressed={side === s}>
                    {s === 'BUY' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Quantity (shares)" hint={qtyErr ?? (security ? `Multiple of ${lot}` : undefined)}>
              <input className="ops-input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[,\s]/g, ''))} placeholder="0" />
            </Field>
            <Field label="Order type">
              <select className="ops-input" value={orderType} onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT')}>
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </Field>
            <Field label="Limit price" hint={limitErr ?? (orderType === 'LIMIT' ? undefined : 'Only for limit orders')}>
              <input className="ops-input" inputMode="decimal" value={limitPrice} disabled={orderType !== 'LIMIT'} onChange={(e) => setLimitPrice(e.target.value.replace(/,/g, ''))} placeholder={security?.latestPrice ? price6(security.latestPrice.price) : '0.00'} />
            </Field>
            <Field label="Time in force">
              <select className="ops-input" value={tif} onChange={(e) => setTif(e.target.value)}>
                <option value="DAY">Day</option>
                <option value="GTC">Good till cancelled</option>
                <option value="IOC">Immediate or cancel</option>
              </select>
            </Field>
            <Field label="Urgency">
              <select className="ops-input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
                <option>Low</option>
                <option>Normal</option>
                <option>High</option>
              </select>
            </Field>
            <Field label="Executing broker" span={2}>
              <select className="ops-input" value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                <option value="">Choose when routing</option>
                {brokers.state === 'ok' &&
                  brokers.data.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Rationale" span={2} hint="Required to submit. Document why, especially when a check is on Review.">
              <textarea className="ops-input" value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={2000} />
            </Field>
          </FieldGrid>
          <Alert>{create.error}</Alert>
          {partial && (
            <Alert kind="warn">
              Draft {partial.ref} was saved but not submitted: {partial.message}{' '}
              <Link href={`/ops/orders/${encodeURIComponent(partial.id)}`}>Open the draft</Link>
            </Alert>
          )}
          <div className="ops-actions" style={{ marginTop: 14 }}>
            <button className="ops-btn" type="button" disabled={!ready || check.busy} onClick={runCheck}>
              {check.busy ? 'Checking…' : 'Run pre-trade check'}
            </button>
            <button className="ops-btn" type="button" disabled={!ready || create.busy} onClick={() => createOrder(false)}>
              Save as draft
            </button>
            <button
              className="ops-btn primary"
              type="button"
              disabled={!ready || create.busy || rationale.trim().length < 3}
              title={rationale.trim().length < 3 ? 'Add a rationale to submit' : 'Creates the order, runs the check and submits it for approval'}
              onClick={() => createOrder(true)}
            >
              {create.busy ? 'Working…' : 'Submit for approval'}
            </button>
          </div>
        </Card>

        <Card title="Pre-trade check">
          <Alert>{check.error}</Alert>
          {result ? (
            <>
              <CheckList result={result} />
              {result.overall === 'Blocked' && <Alert kind="error">Blocked: this order cannot be submitted until the failing controls are fixed.</Alert>}
              {result.overall === 'Review' && <Alert kind="warn">Review: it can be submitted with a documented rationale.</Alert>}
              {result.decisionPrice && (
                <p className="ops-muted" style={{ marginTop: 8 }}>
                  Decision price {formatDecimal(result.decisionPrice, 4)} {result.currency}. Estimated fee rate is indicative.
                </p>
              )}
            </>
          ) : (
            <p className="ops-muted">
              Run the check to test the order against the portfolio mandate, available cash (net of other open buys), the position held, concentration, liquidity and price.
              Nothing is saved by the check.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
