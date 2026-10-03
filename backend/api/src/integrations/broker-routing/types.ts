import type { AdapterBase, AdapterMeta } from '../core/types';

export interface RoutedOrder {
  orderRef: string;
  brokerCode: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  limitPrice?: string;
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

export interface BrokerRoutingAdapter extends AdapterBase {
  routeOrder(order: RoutedOrder): Promise<BrokerAck>;
  fetchFills(input: { brokerOrderRef: string }): Promise<{ status: 'WORKING' | 'FILLED'; fills: BrokerFill[] }>;
}

export const meta: AdapterMeta = {
  name: 'broker-routing',
  label: 'Broker routing (FIX)',
  gap: 'GAP-A13',
  description: 'Routing approved orders to brokers and ingesting fills and contract notes.',
  requiredEnv: ['BROKER_FIX_HOST', 'BROKER_FIX_SENDER_ID', 'BROKER_FIX_TARGET_ID'],
  vendorCalls: {
    routeOrder: 'FIX 4.4 NewOrderSingle (35=D) to BROKER_FIX_HOST; await ExecutionReport (35=8) acknowledgement',
    fetchFills: 'Collect ExecutionReports (fills) or parse the contract-note file for the broker order',
  },
};
