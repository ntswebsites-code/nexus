'use client';

import { useState } from 'react';
import { api, v1 } from './api';
import { formatDecimal } from './money';
import { bp, price6, shares } from './orders';
import { useCan } from './session';
import { Alert, Card, DefinitionList, Empty, Loaded, Money, useAction, useResource } from './ui';

// ------------------------------------------------------------------ types (mirror GET /api/v1/orders/:id/post-trade)

export interface PostTrade {
  orderId: string;
  ref: string;
  status: string;
  currency: string;
  side: string;
  decisionPrice: string;
  allocation: {
    portfolio: { id: string; ref: string; name: string };
    filledQty: string;
    orderQty: string;
    sharePct: string;
    avgPrice: string | null;
    gross: string;
    fees: string;
    net: string;
    positionAfter: { quantity: string; avgCost: string | null; asOf: string } | null;
    fills: { id: string; executedAt: string; source: string; quantity: string; price: string; fees: string; gross: string; net: string; slippageBp: number | null }[];
  };
  slippage: { decisionPrice: string; avgPrice: string | null; bp: number | null; amount: string | null; worstFillBp: number | null };
  contractNote: {
    status: 'NONE' | 'MATCHED' | 'BREAK' | 'PARTIAL';
    lines: {
      ref: string;
      source: string;
      externalRef: string;
      status: string;
      breakReason: string | null;
      detail: string | null;
      quantity: string;
      price: string;
      fees: string;
      tradeDate: string;
      fillId: string | null;
      variance: { quantity: string; price: string; fees: string } | null;
    }[];
  };
  settlement: { settled: boolean; readyToSettle: boolean; fillsTieToOrder: boolean };
}

export type NoteFormat = 'CSV' | 'JSON' | 'TEXT' | 'PDF';

/** Body for POST /trading-feeds/contract-notes: a PDF travels base64 encoded (its text layer is read on the server); anything else as text. */
export function contractNoteBody(brokerId: string, filename: string, data: string | Uint8Array): { brokerId: string; filename: string; content: string; format: NoteFormat } {
  if (typeof data !== 'string') {
    const isPdf = filename.toLowerCase().endsWith('.pdf') || (data.length > 4 && String.fromCharCode(data[0]!, data[1]!, data[2]!, data[3]!) === '%PDF');
    if (isPdf) {
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { brokerId, filename, content: btoa(bin), format: 'PDF' };
    }
    data = new TextDecoder().decode(data);
  }
  const lower = filename.toLowerCase();
  const trimmed = data.trim();
  const head = (trimmed.split(/\r?\n/)[0] ?? '').toLowerCase();
  const csvHeader = head.includes(',') && (head.includes('ticker') || head.includes('symbol')) && head.includes('price');
  const format: NoteFormat = lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[') ? 'JSON' : lower.endsWith('.csv') || csvHeader ? 'CSV' : 'TEXT';
  return { brokerId, filename, content: data, format };
}

const NOTE_TONE: Record<string, string> = { NONE: 'grey', MATCHED: 'green', BREAK: 'red', PARTIAL: 'amber' };

/** FR-OMS-011: allocation of the fills, slippage against the decision price, and the contract-note match with the parsing hook. */
export function PostTradeCard({ orderId, status, brokerId, brokerName, onChanged }: { orderId: string; status: string; brokerId: string | null; brokerName: string | null; onChanged: () => void }) {
  const res = useResource<PostTrade>(() => api.get<PostTrade>(v1(`/orders/${encodeURIComponent(orderId)}/post-trade`)), [orderId, status]);
  const canRoute = useCan('orders.route');
  const working = status === 'Routing' || status === 'PartiallyFilled';
  const upload = useAction();
  const [text, setText] = useState('');
  const [name, setName] = useState('contract-note.txt');
  const [msg, setMsg] = useState<string | null>(null);

  async function send(body: ReturnType<typeof contractNoteBody>) {
    setMsg(null);
    const r = await upload.run((key) => api.post<{ matched: number; breaks: number; duplicates: number; format: string }>(v1('/trading-feeds/contract-notes'), body, { idempotencyKey: key }));
    if (r) {
      setMsg(`Contract note read as ${r.format}: ${r.matched} matched, ${r.breaks} break${r.breaks === 1 ? '' : 's'}${r.duplicates ? `, ${r.duplicates} duplicate` : ''}.`);
      setText('');
      res.reload();
      onChanged();
    }
  }

  return (
    <Card title="Post-trade">
      <Loaded res={res} what="the post-trade view">
        {(p) => (
          <>
            <h3 className="ops-kicker" style={{ margin: '0 0 6px' }}>Allocation</h3>
            {p.allocation.fills.length === 0 ? (
              <Empty>No fills to allocate yet.</Empty>
            ) : (
              <>
                <DefinitionList
                  items={[
                    ['Portfolio', `${p.allocation.portfolio.name} (${p.allocation.portfolio.ref})`],
                    ['Allocated', `${shares(p.allocation.filledQty)} of ${shares(p.allocation.orderQty)} (${p.allocation.sharePct}%)`],
                    ['Average price', p.allocation.avgPrice ? `${price6(p.allocation.avgPrice)} ${p.currency}` : '—'],
                    ['Gross', <Money key="g" value={p.allocation.gross} currency={p.currency} />],
                    ['Fees', <Money key="f" value={p.allocation.fees} currency={p.currency} />],
                    [p.side === 'BUY' ? 'Net to pay' : 'Net proceeds', <Money key="n" value={p.allocation.net} currency={p.currency} />],
                    ['Position after', p.allocation.positionAfter ? `${shares(p.allocation.positionAfter.quantity)} at average cost ${p.allocation.positionAfter.avgCost ? price6(p.allocation.positionAfter.avgCost) : '—'} (${p.allocation.positionAfter.asOf})` : '—'],
                    ['Fills tie to order', p.settlement.fillsTieToOrder ? 'Yes' : 'No: fill total differs from the order filled quantity'],
                  ]}
                />
                <div className="ops-table-wrap" style={{ marginTop: 10 }}>
                  <table className="ops-table">
                    <caption className="ops-sr">Fill allocation</caption>
                    <thead>
                      <tr>
                        <th>Executed</th>
                        <th>Source</th>
                        <th className="r">Quantity</th>
                        <th className="r">Price</th>
                        <th className="r">Fees</th>
                        <th className="r">Net</th>
                        <th className="r">Slippage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.allocation.fills.map((f) => (
                        <tr key={f.id}>
                          <td>{f.executedAt.slice(0, 16).replace('T', ' ')}</td>
                          <td>{f.source.replace('_', ' ').toLowerCase()}</td>
                          <td className="r">{shares(f.quantity)}</td>
                          <td className="r">{price6(f.price)}</td>
                          <td className="r">{formatDecimal(f.fees)}</td>
                          <td className="r">{formatDecimal(f.net)}</td>
                          <td className="r">{bp(f.slippageBp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h3 className="ops-kicker" style={{ margin: '16px 0 6px' }}>Slippage</h3>
            <DefinitionList
              items={[
                ['Decision price', `${price6(p.slippage.decisionPrice)} ${p.currency}`],
                ['Average fill price', p.slippage.avgPrice ? `${price6(p.slippage.avgPrice)} ${p.currency}` : '—'],
                ['Slippage', bp(p.slippage.bp)],
                ['Cost against decision price', p.slippage.amount ? <Money key="c" value={p.slippage.amount} currency={p.currency} /> : '—'],
                ['Worst fill', bp(p.slippage.worstFillBp)],
              ]}
            />
            <p className="ops-muted" style={{ marginTop: 6 }}>Positive means worse than the decision price: paid more on a buy, received less on a sell.</p>

            <h3 className="ops-kicker" style={{ margin: '16px 0 6px' }}>
              Contract note <span className={`ops-badge ${NOTE_TONE[p.contractNote.status] ?? 'grey'}`}>{p.contractNote.status === 'NONE' ? 'No note' : p.contractNote.status.toLowerCase()}</span>
            </h3>
            {p.contractNote.lines.length === 0 ? (
              <Empty>No contract note lines refer to this order.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <caption className="ops-sr">Contract note lines</caption>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Trade ref</th>
                      <th>State</th>
                      <th className="r">Quantity</th>
                      <th className="r">Price</th>
                      <th className="r">Fees</th>
                      <th>Variance to fill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.contractNote.lines.map((l) => (
                      <tr key={l.ref}>
                        <td>{l.ref}</td>
                        <td>{l.externalRef}</td>
                        <td>
                          {l.status.toLowerCase()}
                          {l.breakReason ? <span className="ops-sub">{l.detail ?? l.breakReason}</span> : null}
                        </td>
                        <td className="r">{shares(l.quantity)}</td>
                        <td className="r">{price6(l.price)}</td>
                        <td className="r">{formatDecimal(l.fees)}</td>
                        <td>{l.variance ? `qty ${l.variance.quantity}, price ${l.variance.price}, fees ${l.variance.fees}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canRoute && working && (
              <div style={{ marginTop: 12 }}>
                <h3 className="ops-kicker" style={{ margin: '0 0 6px' }}>Read a contract note</h3>
                {!brokerId ? (
                  <Alert kind="warn">Choose the executing broker on the order before reading a contract note.</Alert>
                ) : (
                  <>
                    <p className="ops-muted">
                      Upload the broker note from {brokerName ?? 'the broker'} (PDF with a text layer, CSV or JSON), or paste its text. Lines such as &quot;Order reference: ORD-001234&quot;, &quot;Quantity: 100&quot; and &quot;Price: 1.25&quot; are read and matched to the order.
                    </p>
                    <label className="ops-field">
                      <span className="ops-label">Contract note file</span>
                      <input
                        className="ops-input"
                        type="file"
                        accept=".pdf,.csv,.json,.txt,application/pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          void f.arrayBuffer().then((buf) => send(contractNoteBody(brokerId, f.name, new Uint8Array(buf))));
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <label className="ops-field" style={{ marginTop: 8 }}>
                      <span className="ops-label">Or paste the note text</span>
                      <textarea className="ops-input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Order reference: ORD-001234\nSecurity: ECO.ZW\nSide: Buy\nQuantity: 100\nPrice: 1.25\nTrade date: 2026-10-02'} />
                    </label>
                    <div className="ops-actions" style={{ marginTop: 8 }}>
                      <button className="ops-btn" type="button" disabled={!text.trim() || upload.busy} onClick={() => void send(contractNoteBody(brokerId, name, text))}>
                        {upload.busy ? 'Reading…' : 'Read and match note text'}
                      </button>
                      <input className="ops-input" aria-label="Note file name" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
                    </div>
                    <Alert>{upload.error}</Alert>
                    {msg && <Alert kind="ok">{msg}</Alert>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Loaded>
    </Card>
  );
}
