'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, describeError, newIdempotencyKey, qs, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { CheckList, ORDER_TYPE_LABEL, PRICE_TOLERANCE_PCT, price6, priceDeviationPct, shares, type BrokerOption, type OrderDetail, type OrderRow, type PreTradeResult } from '@/ops/orders';
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
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopPrice, setStopPrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
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
  // FR-OMS-019: the maker's saved drafts (Draft and Validated) are offered for resuming when the ticket opens.
  const drafts = useResource<OrderRow[]>(() => api.get<OrderRow[]>(v1('/orders?status=Draft,Validated&mine=1&limit=5')), []);
  const [dismissedDrafts, setDismissedDrafts] = useState(false);
  const found = useResource<SecurityRow[]>(() => (debounced.length >= 1 ? api.get<SecurityRow[]>(v1(`/securities${qs({ q: debounced, limit: '8' })}`)) : Promise.resolve([])), [debounced]);

  // Any change to the ticket makes the last check stale.
  useEffect(() => setResult(null), [portfolioId, security?.id, side, quantity, orderType, limitPrice, stopPrice, overrideReason]);

  const lot = security?.boardLot ?? 1;
  const qtyOk = /^\d+$/.test(quantity) && Number(quantity) > 0;
  const qtyErr = quantity && !qtyOk ? 'Enter a whole number of shares' : quantity && Number(quantity) % lot !== 0 ? `Must be a multiple of the board lot (${lot})` : null;
  const priced = orderType !== 'MARKET';
  const priceFmtOk = (v: string) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0;
  const limitFmtErr = priced && limitPrice && !priceFmtOk(limitPrice) ? 'Enter a positive price (up to 6 decimals)' : null;
  // FR-OMS-018: more than 10% from the last price needs an override reason; both messages show inline before the server is asked.
  const lastPrice = security?.latestPrice?.price ?? null;
  const dev = priced && limitPrice && !limitFmtErr ? priceDeviationPct(limitPrice, lastPrice) : null;
  const far = dev !== null && Math.abs(dev) > PRICE_TOLERANCE_PCT;
  const reasonErr = far && overrideReason.trim().length < 5 ? `Give a reason (at least 5 characters) for a price more than ${PRICE_TOLERANCE_PCT}% from the last price` : null;
  const limitErr = limitFmtErr ?? (far ? `Price is ${dev!.toFixed(2)}% from the last price ${price6(lastPrice)}; more than ${PRICE_TOLERANCE_PCT}% needs an override reason` : null);
  const stopFmtErr = orderType === 'STOP_LIMIT' && stopPrice && !priceFmtOk(stopPrice) ? 'Enter a positive price (up to 6 decimals)' : null;
  const stopDirErr =
    orderType === 'STOP_LIMIT' && stopPrice && limitPrice && !stopFmtErr && !limitFmtErr
      ? side === 'BUY' && Number(stopPrice) > Number(limitPrice)
        ? 'For a buy stop-limit the stop price must not be above the limit price'
        : side === 'SELL' && Number(stopPrice) < Number(limitPrice)
          ? 'For a sell stop-limit the stop price must not be below the limit price'
          : null
      : null;
  const stopErr = stopFmtErr ?? stopDirErr;
  const tradable = security?.status === 'Active';
  const ready =
    !!portfolioId && !!security && tradable && qtyOk && !qtyErr && (!priced || (!!limitPrice && !limitFmtErr && !reasonErr)) && (orderType !== 'STOP_LIMIT' || (!!stopPrice && !stopErr));

  const ticket = () => ({
    portfolioId,
    securityId: security!.id,
    side,
    quantity,
    orderType,
    limitPrice: priced ? limitPrice : undefined,
    stopPrice: orderType === 'STOP_LIMIT' ? stopPrice : undefined,
    priceOverrideReason: priced && far ? overrideReason.trim() : undefined,
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
      {!dismissedDrafts && drafts.state === 'ok' && drafts.data.length > 0 && (
        <Alert kind="info">
          <strong>You have {drafts.data.length === 1 ? 'a saved draft' : `${drafts.data.length} saved drafts`}.</strong>{' '}
          {drafts.data.map((d) => (
            <span key={d.id} style={{ marginRight: 12 }}>
              <Link href={`/ops/orders/${encodeURIComponent(d.id)}`}>
                Resume draft {d.ref}
              </Link>{' '}
              <span className="ops-muted">
                ({d.side === 'BUY' ? 'Buy' : 'Sell'} {shares(d.quantity)} {d.security.ticker}, {ORDER_TYPE_LABEL[d.orderType] ?? d.orderType.toLowerCase()})
              </span>
            </span>
          ))}
          <button className="ops-btn small" type="button" onClick={() => setDismissedDrafts(true)}>
            Start a new order instead
          </button>
        </Alert>
      )}
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
              <select className="ops-input" value={orderType} onChange={(e) => setOrderType(e.target.value as 'MARKET' | 'LIMIT' | 'STOP_LIMIT')}>
                <option value="MARKET">{ORDER_TYPE_LABEL.MARKET}</option>
                <option value="LIMIT">{ORDER_TYPE_LABEL.LIMIT}</option>
                <option value="STOP_LIMIT">{ORDER_TYPE_LABEL.STOP_LIMIT}</option>
              </select>
            </Field>
            <Field label="Limit price" hint={limitErr ?? (priced ? undefined : 'Only for limit and stop-limit orders')}>
              <input className="ops-input" inputMode="decimal" value={limitPrice} disabled={!priced} onChange={(e) => setLimitPrice(e.target.value.replace(/,/g, ''))} placeholder={security?.latestPrice ? price6(security.latestPrice.price) : '0.00'} />
            </Field>
            {orderType === 'STOP_LIMIT' && (
              <Field label="Stop price" hint={stopErr ?? 'The order becomes a limit order when the market trades at this price'}>
                <input className="ops-input" inputMode="decimal" value={stopPrice} onChange={(e) => setStopPrice(e.target.value.replace(/,/g, ''))} placeholder={security?.latestPrice ? price6(security.latestPrice.price) : '0.00'} />
              </Field>
            )}
            {far && (
              <Field label="Price override reason" span={2} hint={reasonErr ?? 'Recorded on the order and shown to the approver'}>
                <input className="ops-input" value={overrideReason} maxLength={255} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why is this price more than 10% from the last price?" />
              </Field>
            )}
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
