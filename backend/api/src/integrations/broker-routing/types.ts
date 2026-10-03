import type { AdapterBase, AdapterMeta } from '../core/types';

export interface RoutedOrder {
  orderRef: string;
  brokerCode: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  limitPrice?: string;
  /** Latest known price; the fake broker fills market orders at it. */
  referencePrice?: string;
}
export interface BrokerAck {
  brokerOrderRef: string;
  status: 'ACKNOWLEDGED' | 'REJECTED';
}
export interface BrokerFill {
  fillRef: string;
  quantity: string;
  price: string;
  at: string;
  source: 'FIX' | 'CONTRACT_NOTE';
}

/** One trade row of a broker contract note, validated and normalised (decimal strings, YYYY-MM-DD). */
export interface ContractNoteLine {
  tradeRef: string;
  orderRef?: string;
  brokerOrderRef?: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  fees: string;
  tradeDate: string;
  executedAt: string;
}
export interface ParsedContractNote {
  format: 'CSV' | 'JSON';
  lines: ContractNoteLine[];
}
/** A FIX ExecutionReport (35=8). execType OTHER = acknowledgement, cancel or reject: nothing to fill. */
export interface FixExecutionReport {
  execId: string;
  clOrdId?: string;
  orderId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  lastQty: string;
  lastPx: string;
  transactTime: string;
  commission: string;
  execType: 'TRADE' | 'OTHER';
  raw: string;
}

export interface BrokerRoutingAdapter extends AdapterBase {
  routeOrder(order: RoutedOrder): Promise<BrokerAck>;
  fetchFills(input: { brokerOrderRef: string }): Promise<{ status: 'WORKING' | 'FILLED'; fills: BrokerFill[] }>;
  /** Parses a broker contract note (CSV or JSON text). Throws FeedParseError when the file is malformed. */
  parseContractNote(input: { brokerCode: string; filename: string; content: string; format?: 'CSV' | 'JSON' }): Promise<ParsedContractNote>;
  /** Parses one raw FIX ExecutionReport. Throws FeedParseError when it is malformed or its checksum fails. */
  parseExecutionReport(input: { raw: string }): Promise<FixExecutionReport>;
  /** Raw FIX ExecutionReports waiting at the broker session (the fake sender generates them for routed orders; file-drop has none). */
  pollExecutionReports(input?: { limit?: number }): Promise<{ messages: string[] }>;
}

export const meta: AdapterMeta = {
  name: 'broker-routing',
  label: 'Broker routing (FIX)',
  gap: 'GAP-A13',
  description: 'Routing approved orders to brokers and ingesting fills and contract notes. `file-drop` parses uploaded contract notes and posted FIX reports; `fake` also generates FIX fills for routed orders.',
  requiredEnv: ['BROKER_FIX_HOST', 'BROKER_FIX_SENDER_ID', 'BROKER_FIX_TARGET_ID'],
  vendorCalls: {
    routeOrder: 'FIX 4.4 NewOrderSingle (35=D) to BROKER_FIX_HOST; await ExecutionReport (35=8) acknowledgement',
    fetchFills: 'Collect ExecutionReports (fills) or parse the contract-note file for the broker order',
    parseContractNote: 'Parse the broker contract-note file (CSV/JSON/PDF-to-data) delivered by SFTP or e-mail',
    parseExecutionReport: 'Decode a FIX 4.4 ExecutionReport (35=8) and verify its checksum',
    pollExecutionReports: 'Drain the ExecutionReports queued on the FIX session since the last poll',
  },
};
