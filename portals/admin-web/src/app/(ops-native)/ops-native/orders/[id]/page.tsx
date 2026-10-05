'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { formatDecimal } from '@/ops/money';
import { PostTradeCard } from '@/ops/order-posttrade';
import {
  ACTION_LABEL,
  bp,
  CheckList,
  ORDER_TYPE_LABEL,
  PRICE_TOLERANCE_PCT,
  OrderStatusBadge,
  price6,
  shares,
  SideTag,
  type BrokerOption,
  type InstructionPreview,
  type OrderDetail,
} from '@/ops/orders';
import { useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, formatDateTime, Loaded, Money, optStr, PageHeader, str, useResource } from '@/ops/ui';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useResource<OrderDetail>(() => api.get<OrderDetail>(v1(`/orders/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops-native/orders">← Orders</Link>
      </p>
      <Loaded res={order} what="this order">
        {(o) => <Detail order={o} reload={order.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'edit' | 'submit' | 'reject' | 'route' | 'fill' | 'cancel' | null;

function Detail({ order: o, reload }: { order: OrderDetail; reload: () => void }) {
  const { user } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const base = v1(`/orders/${encodeURIComponent(o.id)}`);
  const can = (a: string) => o.allowed.includes(a);
  const isMaker = o.maker?.id === user.id;
  const open = ['AwaitingApproval', 'Approved', 'Routing', 'PartiallyFilled'].includes(o.status);
  const close = () => setDialog(null);
  const done = () => {
    close();
    reload();
  };

  return (
    <>
      <PageHeader
        kicker={`Order · ${o.portfolio.name}`}
        title={
          <>
            {o.ref} <OrderStatusBadge status={o.status} />
          </>
        }
        subtitle={
          <>
            <SideTag side={o.side} /> {shares(o.quantity)} {o.security.ticker} · {o.orderType === 'STOP_LIMIT' ? `stop ${price6(o.stopPrice)} limit ${price6(o.limitPrice)}` : o.orderType === 'LIMIT' ? `limit ${price6(o.limitPrice)}` : 'market'} {o.currency} · {o.tif}
          </>
        }
        actions={
          <>
            {can('edit') && (
              <button className="ops-btn" type="button" onClick={() => setDialog('edit')}>
                Edit
              </button>
            )}
            {can('validate') && <ActionButton label="Run pre-trade check" primary={o.status === 'Draft'} onRun={() => api.post(`${base}/validate`, {})} onDone={reload} />}
            {can('submit') && (
              <button className="ops-btn primary" type="button" onClick={() => setDialog('submit')}>
                Submit for approval
              </button>
            )}
            {can('approve') && (
              <ActionButton
                primary
                label="Approve"
                title="Requires a fresh authenticator code"
                confirm={`Approve ${o.ref}: ${o.side} ${shares(o.quantity)} ${o.security.ticker}?`}
                onRun={(key) => api.post(`${base}/approve`, {}, { idempotencyKey: key })}
                onDone={reload}
              />
            )}
            {can('reject') && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('reject')}>
                Reject
              </button>
            )}
            {can('route') && (
              <button className="ops-btn primary" type="button" onClick={() => setDialog('route')}>
                Route to broker
              </button>
            )}
            {can('fill') && (
              <button className="ops-btn primary" type="button" onClick={() => setDialog('fill')}>
                Record fill
              </button>
            )}
            {can('settle') && <ActionButton label="Settle (create trade journals)" primary confirm="Settle this order? Trade journals will be created for approval in Accounting and Cash." onRun={() => api.post(`${base}/settle`, {})} onDone={reload} />}
            {can('cancel') && (
              <button className="ops-btn danger" type="button" onClick={() => setDialog('cancel')}>
                Cancel order
              </button>
            )}
          </>
        }
      />

      {o.status === 'AwaitingApproval' && isMaker && <Alert kind="info">You created this order. A different person with approval rights must approve it.</Alert>}
      {o.status === 'Approved' && o.approver?.id === user.id && <Alert kind="info">You approved this order. A different person must route it to the broker.</Alert>}
      {o.status === 'Draft' && o.precheck?.overall === 'Blocked' && <Alert kind="error">The pre-trade check blocked this order. Fix the failing controls, edit and re-run the check.</Alert>}
      {o.status === 'Validated' && o.precheck?.overall === 'Review' && <Alert kind="warn">A control is on Review. Submitting needs a documented rationale.</Alert>}
      {o.status === 'Rejected' && <Alert kind="warn">Rejected{o.rejectReason ? `: ${o.rejectReason}` : ''}.</Alert>}
      {o.status === 'Cancelled' && <Alert kind="warn">Cancelled{o.cancelReason ? `: ${o.cancelReason}` : ''}.</Alert>}

      <Card title="Order">
        <DefinitionList
          items={[
            ['Portfolio', `${o.portfolio.name} (${o.portfolio.ref})`],
            ['Security', `${o.security.ticker} · ${o.security.name}`],
            ['Market', `${o.security.market}${o.security.sector ? ` · ${o.security.sector}` : ''}`],
            ['Quantity', shares(o.quantity)],
            ['Filled', `${shares(o.filledQty)} (${shares(o.remainingQty)} remaining)`],
            ['Order type', ORDER_TYPE_LABEL[o.orderType] ?? o.orderType],
            ...(o.orderType === 'STOP_LIMIT' ? ([['Stop price', `${price6(o.stopPrice)} ${o.currency}`]] as [string, string][]) : []),
            ...(o.orderType !== 'MARKET' ? ([['Limit price', `${price6(o.limitPrice)} ${o.currency}`]] as [string, string][]) : []),
            ...(o.priceOverrideReason ? ([[`Price override (beyond ${PRICE_TOLERANCE_PCT}%)`, o.priceOverrideReason]] as [string, string][]) : []),
            ['Decision price', `${price6(o.decisionPrice)} ${o.currency}`],
            ['Average fill price', o.avgPrice ? `${price6(o.avgPrice)} ${o.currency}` : '—'],
            ['Slippage', bp(o.slippageBp)],
            ['Notional (order)', <Money key="n" value={o.notional} currency={o.currency} />],
            ['Estimated fee', <Money key="f" value={o.estimatedFee} currency={o.currency} />],
            ['Cash reserved', <Money key="r" value={o.reservedAmount} currency={o.currency} />],
            ['Urgency', o.urgency],
            ['Broker', o.broker?.name ?? '—'],
            ['Created by', o.maker ? (isMaker ? `${o.maker.name} (you)` : o.maker.name) : '—'],
            ['Approved by', o.approver ? `${o.approver.name} · ${formatDateTime(o.approvedAt)}` : '—'],
            ['Routed by', o.router ? `${o.router.name} · ${formatDateTime(o.routedAt)}` : '—'],
          ]}
        />
        {o.rationale && (
          <p style={{ marginTop: 12 }}>
            <span className="ops-kicker">Rationale</span>
            <br />
            {o.rationale}
          </p>
        )}
      </Card>

      {o.decision && (
        <Card title="Originating IC decision">
          <DefinitionList
            items={[
              ['Decision', <Link key="d" href={o.decision.link}>{o.decision.ref}</Link>],
              ['Research case', `${o.decision.caseRef} · ${o.decision.caseTitle}`],
              ['Action', `${o.decision.action}${o.decision.quantity ? ` ${shares(o.decision.quantity)}` : ''} (${o.decision.status.toLowerCase()})`],
              ['Votes', `${o.decision.votes.for} for · ${o.decision.votes.against} against · ${o.decision.votes.abstain} abstain`],
              ['Ratified', o.decision.ratifiedAt ? formatDateTime(o.decision.ratifiedAt) : '—'],
            ]}
          />
          <p style={{ marginTop: 12 }}>
            <span className="ops-kicker">Committee rationale</span>
            <br />
            {o.decision.rationale}
          </p>
        </Card>
      )}

      {(o.cash.holds.length > 0 || o.cash.ledger) && (
        <Card title="Cash (from the cash ledger)">
          {o.cash.ledger && (
            <DefinitionList
              items={[
                ['Bank ledger', o.cash.ledger.ref],
                ['Posted balance', <Money key="p" value={o.cash.ledger.posted} currency={o.currency} />],
                ['Held for other orders', <Money key="h" value={o.cash.ledger.reservedByOthers} currency={o.currency} />],
                ['Minimum buffer', <Money key="b" value={o.cash.ledger.minBuffer} currency={o.currency} />],
                ['Available to this order', <Money key="a" value={o.cash.ledger.available} currency={o.currency} />],
              ]}
            />
          )}
          {o.cash.holds.length > 0 && (
            <div className="ops-table-wrap" style={{ marginTop: 10 }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Hold</th>
                    <th>State</th>
                    <th className="r">Amount</th>
                    <th className="r">Consumed</th>
                    <th className="r">Remaining</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {o.cash.holds.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <Link href={`/ops-native/cash?tab=reservations&q=${h.ref}`}>{h.ref}</Link>
                      </td>
                      <td>{h.status.toLowerCase().replace('_', ' ')}</td>
                      <td className="r">{formatDecimal(h.amount)}</td>
                      <td className="r">{formatDecimal(h.consumed)}</td>
                      <td className="r">{formatDecimal(h.remaining)}</td>
                      <td>{h.releaseReason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {o.realisedGain && (
        <Card title="Realised gain (average cost)">
          <DefinitionList
            items={[
              ['Proceeds', <Money key="pr" value={o.realisedGain.proceeds} currency={o.currency} />],
              ['Cost basis', <Money key="cb" value={o.realisedGain.costBasis} currency={o.currency} />],
              ['Realised gain', <strong key="g" style={{ color: Number(o.realisedGain.gain) >= 0 ? '#0f7a45' : '#b3261e' }}>{formatDecimal(o.realisedGain.gain)} {o.currency}</strong>],
              ['Fees (booked as trade costs)', <Money key="fe" value={o.realisedGain.fees} currency={o.currency} />],
              ['Gain after fees', <Money key="nf" value={o.realisedGain.netOfFees} currency={o.currency} />],
            ]}
          />
          <p className="ops-muted" style={{ marginTop: 8 }}>
            Settlement books investments out at cost and the gain to Realised gains and losses (4300).
          </p>
        </Card>
      )}

      <Card title="Pre-trade check">{o.precheck ? <CheckList result={o.precheck} at={o.precheckAt} /> : <Empty>No check has been run on the current ticket.</Empty>}</Card>

      <Card title={`Fills (${o.fills.length})`}>
        {o.fills.length === 0 ? (
          <Empty>{open ? 'No fills recorded yet.' : 'No fills.'}</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Executed</th>
                  <th className="r">Quantity</th>
                  <th className="r">Price</th>
                  <th className="r">Fees</th>
                  <th className="r">Notional</th>
                  <th>Source</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {o.fills.map((f) => (
                  <tr key={f.id}>
                    <td>{formatDateTime(f.executedAt)}</td>
                    <td className="r">{shares(f.quantity)}</td>
                    <td className="r">{price6(f.price)}</td>
                    <td className="r">{formatDecimal(f.fees)}</td>
                    <td className="r">{formatDecimal(f.notional)}</td>
                    <td>
                      {f.source.replace('_', ' ').toLowerCase()}
                      {f.sourceRef && <span className="ops-sub">{f.sourceRef}</span>}
                    </td>
                    <td>{f.recordedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(o.fills.length > 0 || ['Routing', 'PartiallyFilled', 'Filled', 'Settled'].includes(o.status)) && (
        <PostTradeCard orderId={o.id} status={o.status} brokerId={o.broker?.id ?? null} brokerName={o.broker?.name ?? null} onChanged={reload} />
      )}

      {o.instruction && (
        <Card title="Broker instruction">
          <DefinitionList
            items={[
              ['To', `${o.instruction.payload.brokerName} <${o.instruction.payload.to}>`],
              ['Channel', o.instruction.channel],
              ['Delivery', o.instruction.deliveryStatus.toLowerCase()],
              ['Created', formatDateTime(o.instruction.createdAt)],
            ]}
          />
          <p style={{ marginTop: 12 }}>
            <strong>{o.instruction.payload.subject}</strong>
          </p>
          <pre className="ops-pre">{o.instruction.payload.text}</pre>
        </Card>
      )}

      <Card title="Timeline">
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {o.timeline.map((t, i) => (
            <li key={i} style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 12 }}>
              <span className="ops-muted">{formatDateTime(t.at)}</span>
              <span>
                <strong>{ACTION_LABEL[t.action] ?? t.action}</strong> · {t.actor}
                {t.actorRole ? <span className="ops-muted"> ({t.actorRole})</span> : null}
                {t.from && t.to && t.from !== t.to ? (
                  <span className="ops-muted">
                    {' '}
                    · {t.from} → {t.to}
                  </span>
                ) : null}
                {t.reason && <span className="ops-sub">{t.reason}</span>}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {dialog === 'edit' && <EditModal order={o} base={base} onClose={close} onDone={done} />}
      {dialog === 'submit' && (
        <FormModal
          kicker="Order"
          title={`Submit ${o.ref} for approval`}
          subtitle={o.side === 'BUY' ? 'The cash for this buy (notional plus estimated fee) is reserved while it is open.' : undefined}
          submitLabel="Submit for approval"
          onClose={close}
          onDone={done}
          onSubmit={(fd, key) => api.post(`${base}/submit`, { rationale: str(fd, 'rationale') }, { idempotencyKey: key })}
        >
          {o.precheck?.overall === 'Review' && <Alert kind="warn">A control is on Review: document the reason (at least 10 characters).</Alert>}
          <Field label="Rationale">
            <textarea className="ops-input" name="rationale" required minLength={3} maxLength={2000} defaultValue={o.rationale ?? ''} autoFocus />
          </Field>
        </FormModal>
      )}
      {dialog === 'reject' && (
        <FormModal kicker="Order" title={`Reject ${o.ref}`} submitLabel="Reject order" danger onClose={close} onDone={done} onSubmit={(fd) => api.post(`${base}/reject`, { reason: str(fd, 'reason') })}>
          <Field label="Reason" hint="Shown to the order creator. Requires a fresh authenticator code.">
            <textarea className="ops-input" name="reason" required minLength={3} maxLength={255} autoFocus />
          </Field>
        </FormModal>
      )}
      {dialog === 'cancel' && (
        <FormModal
          kicker="Order"
          title={`Cancel ${o.ref}`}
          subtitle={Number(o.reservedAmount) > 0 ? `The ${o.currency} ${formatDecimal(o.reservedAmount)} reserved for this order is released.` : undefined}
          submitLabel="Cancel order"
          danger
          onClose={close}
          onDone={done}
          onSubmit={(fd) => api.post(`${base}/cancel`, { reason: str(fd, 'reason') })}
        >
          <Field label="Reason">
            <textarea className="ops-input" name="reason" required minLength={3} maxLength={255} autoFocus />
          </Field>
        </FormModal>
      )}
      {dialog === 'fill' && <FillModal order={o} base={base} onClose={close} onDone={done} />}
      {dialog === 'route' && <RouteModal order={o} base={base} onClose={close} onDone={done} />}
    </>
  );
}

function EditModal({ order: o, base, onClose, onDone }: { order: OrderDetail; base: string; onClose: () => void; onDone: () => void }) {
  const brokers = useResource<BrokerOption[]>(() => api.get<BrokerOption[]>(v1('/brokers')), []);
  const [type, setType] = useState<'MARKET' | 'LIMIT' | 'STOP_LIMIT'>(o.orderType);
  const [reason, setReason] = useState(o.priceOverrideReason ?? '');
  const priced = type !== 'MARKET';
  return (
    <FormModal
      kicker="Order"
      title={`Edit ${o.ref}`}
      subtitle="Changing the quantity, type or price clears the pre-trade check; run it again before submitting."
      submitLabel="Save changes"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) =>
        api.patch(
          base,
          {
            quantity: str(fd, 'quantity'),
            orderType: type,
            limitPrice: priced ? str(fd, 'limitPrice') : null,
            stopPrice: type === 'STOP_LIMIT' ? str(fd, 'stopPrice') : null,
            priceOverrideReason: priced && reason.trim() ? reason.trim() : null,
            tif: str(fd, 'tif'),
            urgency: str(fd, 'urgency'),
            brokerId: optStr(fd, 'brokerId') ?? null,
            rationale: optStr(fd, 'rationale') ?? null,
            version: o.version,
          },
        )
      }
    >
      <FieldGrid>
        <Field label={`Quantity (board lot ${o.security.boardLot})`}>
          <input className="ops-input" name="quantity" required inputMode="numeric" pattern="\d+" defaultValue={String(Number(o.quantity))} />
        </Field>
        <Field label="Order type">
          <select className="ops-input" value={type} onChange={(e) => setType(e.target.value as 'MARKET' | 'LIMIT' | 'STOP_LIMIT')}>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
            <option value="STOP_LIMIT">Stop limit</option>
          </select>
        </Field>
        <Field label="Limit price">
          <input className="ops-input" name="limitPrice" inputMode="decimal" disabled={!priced} required={priced} defaultValue={o.limitPrice ? price6(o.limitPrice).replace(/,/g, '') : ''} />
        </Field>
        {type === 'STOP_LIMIT' && (
          <Field label="Stop price">
            <input className="ops-input" name="stopPrice" inputMode="decimal" required defaultValue={o.stopPrice ? price6(o.stopPrice).replace(/,/g, '') : ''} />
          </Field>
        )}
        {priced && (
          <Field label="Price override reason" span={2} hint="Needed when the limit is more than 10% from the last price">
            <input className="ops-input" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        <Field label="Time in force">
          <select className="ops-input" name="tif" defaultValue={o.tif}>
            <option value="DAY">Day</option>
            <option value="GTC">Good till cancelled</option>
            <option value="IOC">Immediate or cancel</option>
          </select>
        </Field>
        <Field label="Urgency">
          <select className="ops-input" name="urgency" defaultValue={o.urgency}>
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
          </select>
        </Field>
        <Field label="Executing broker">
          <select className="ops-input" name="brokerId" defaultValue={o.broker?.id ?? ''}>
            <option value="">Choose when routing</option>
            {brokers.state === 'ok' && brokers.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Rationale" span={2}>
          <textarea className="ops-input" name="rationale" maxLength={2000} defaultValue={o.rationale ?? ''} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}

function FillModal({ order: o, base, onClose, onDone }: { order: OrderDetail; base: string; onClose: () => void; onDone: () => void }) {
  return (
    <FormModal
      kicker="Order"
      title={`Record fill on ${o.ref}`}
      subtitle={`${shares(o.remainingQty)} ${o.security.ticker} remaining. Positions and cash update immediately.`}
      submitLabel="Record fill"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd, key) =>
        api.post(
          `${base}/fills`,
          {
            quantity: str(fd, 'quantity'),
            price: str(fd, 'price').replace(/,/g, ''),
            fees: optStr(fd, 'fees')?.replace(/,/g, ''),
            executedAt: optStr(fd, 'executedAt') ? new Date(str(fd, 'executedAt')).toISOString() : undefined,
            source: str(fd, 'source'),
            sourceRef: optStr(fd, 'sourceRef'),
          },
          { idempotencyKey: key },
        )
      }
    >
      <FieldGrid>
        <Field label="Quantity filled" hint={`Up to ${shares(o.remainingQty)}`}>
          <input className="ops-input" name="quantity" required inputMode="numeric" pattern="\d+" defaultValue={String(Number(o.remainingQty))} autoFocus />
        </Field>
        <Field label={`Price (${o.currency})`}>
          <input className="ops-input" name="price" required inputMode="decimal" defaultValue={o.limitPrice ? price6(o.limitPrice).replace(/,/g, '') : ''} />
        </Field>
        <Field label="Fees and levies" hint="Charged to cash, in the security currency">
          <input className="ops-input" name="fees" inputMode="decimal" defaultValue="0" />
        </Field>
        <Field label="Executed at" hint="Defaults to now">
          <input className="ops-input" name="executedAt" type="datetime-local" max={new Date().toISOString().slice(0, 16)} />
        </Field>
        <Field label="Source">
          <select className="ops-input" name="source" defaultValue="MANUAL">
            <option value="MANUAL">Manual</option>
            <option value="CONTRACT_NOTE">Contract note</option>
            <option value="FIX">Broker feed (FIX)</option>
          </select>
        </Field>
        <Field label="Reference">
          <input className="ops-input" name="sourceRef" maxLength={120} placeholder="Contract note no." />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}

function RouteModal({ order: o, base, onClose, onDone }: { order: OrderDetail; base: string; onClose: () => void; onDone: () => void }) {
  const brokers = useResource<BrokerOption[]>(() => api.get<BrokerOption[]>(v1('/brokers')), []);
  const [brokerId, setBrokerId] = useState(o.broker?.id ?? '');
  const [note, setNote] = useState('');
  const preview = useResource<InstructionPreview | null>(
    () => (brokerId ? api.get<InstructionPreview>(`${base}/broker-instruction/preview?brokerId=${encodeURIComponent(brokerId)}${note ? `&note=${encodeURIComponent(note)}` : ''}`) : Promise.resolve(null)),
    [brokerId, note],
  );
  return (
    <FormModal
      kicker="Order"
      title={`Route ${o.ref} to broker`}
      subtitle="The instruction below is emailed to the broker. Requires a fresh authenticator code, and you must not be the approver."
      submitLabel="Send instruction"
      wide
      disabled={!brokerId || preview.state !== 'ok' || !preview.data}
      onClose={onClose}
      onDone={onDone}
      onSubmit={(_fd, key) => api.post(`${base}/route`, { brokerId, note: note.trim() || undefined }, { idempotencyKey: key })}
    >
      <FieldGrid>
        <Field label="Executing broker">
          <select className="ops-input" value={brokerId} onChange={(e) => setBrokerId(e.target.value)} required>
            <option value="">Select a broker</option>
            {brokers.state === 'ok' &&
              brokers.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.email ? '' : ' (no email)'}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Note to broker (optional)">
          <input className="ops-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </FieldGrid>
      {brokerId && (
        <Loaded res={preview} what="the instruction">
          {(p) =>
            p ? (
              <div style={{ marginTop: 10 }}>
                <div className="ops-kicker">Instruction preview</div>
                <p style={{ margin: '4px 0' }}>
                  To <strong>{p.instruction.brokerName}</strong> &lt;{p.instruction.to}&gt;
                </p>
                <p style={{ margin: '4px 0' }}>
                  <strong>{p.instruction.subject}</strong>
                </p>
                <pre className="ops-pre" style={{ background: '#f7f9fd', padding: 12, borderRadius: 8 }}>
                  {p.instruction.text}
                </pre>
              </div>
            ) : null
          }
        </Loaded>
      )}
    </FormModal>
  );
}
