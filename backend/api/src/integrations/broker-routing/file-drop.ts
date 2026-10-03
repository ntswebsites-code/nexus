import { parseContractNoteText, parseFixMessage } from './parse';
import { recordRoutedOrder } from './fake';
import type { BrokerAck, BrokerRoutingAdapter, RoutedOrder } from './types';

/**
 * File-drop broker routing: orders reach the broker by the e-mailed instruction the Orders module already sends;
 * this adapter acknowledges the routing locally and the fills come back as uploaded contract notes (CSV or JSON) or as
 * FIX ExecutionReports posted by a gateway. Nothing external is called.
 */
export class FileDropBrokerRouting implements BrokerRoutingAdapter {
  routeOrder(o: RoutedOrder): Promise<BrokerAck> {
    return recordRoutedOrder(o);
  }
  async fetchFills() {
    return { status: 'WORKING' as const, fills: [] };
  }
  async parseContractNote(i: { brokerCode: string; filename: string; content: string; format?: 'CSV' | 'JSON' }) {
    return parseContractNoteText(i.content, i.format);
  }
  async parseExecutionReport({ raw }: { raw: string }) {
    return parseFixMessage(raw);
  }
  async pollExecutionReports() {
    return { messages: [] as string[] };
  }
  async health() {
    return { ok: true, detail: 'File drop: fills arrive as uploaded contract notes or posted FIX reports' };
  }
}
