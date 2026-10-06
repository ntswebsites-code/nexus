import net from 'node:net';
import { NotConfiguredError } from '../core/types';
import { buildFix, FixFramer, fixTags, newOrderSingleFields } from './fix-session';
import { parseContractNoteText, parseFixMessage } from './parse';
import type { BrokerAck, BrokerFill, BrokerRoutingAdapter, RoutedOrder } from './types';

/**
 * Live FIX 4.4 broker routing over TCP (initiator). Env: BROKER_FIX_HOST, BROKER_FIX_PORT (default 9878),
 * BROKER_FIX_SENDER_ID, BROKER_FIX_TARGET_ID, optional BROKER_FIX_HEARTBEAT (seconds, default 30),
 * BROKER_FIX_PASSWORD (tag 554), BROKER_FIX_TIMEOUT_MS (default 10000).
 * One session is kept: logon on first use, heartbeats, TestRequest replies, sequence numbers, and a bounded inbox
 * of ExecutionReports that fetchFills and pollExecutionReports read.
 */
export interface FixConfig {
  host: string;
  port: number;
  sender: string;
  target: string;
  heartbeat: number;
  password?: string;
  timeoutMs: number;
}

export function fixConfig(env: NodeJS.ProcessEnv = process.env): FixConfig {
  const missing = ['BROKER_FIX_HOST', 'BROKER_FIX_SENDER_ID', 'BROKER_FIX_TARGET_ID'].filter((k) => !env[k]);
  if (missing.length) throw new NotConfiguredError('broker-routing', missing);
  return {
    host: env.BROKER_FIX_HOST!,
    port: Number(env.BROKER_FIX_PORT) || 9878,
    sender: env.BROKER_FIX_SENDER_ID!,
    target: env.BROKER_FIX_TARGET_ID!,
    heartbeat: Number(env.BROKER_FIX_HEARTBEAT) || 30,
    password: env.BROKER_FIX_PASSWORD || undefined,
    timeoutMs: Number(env.BROKER_FIX_TIMEOUT_MS) || 10000,
  };
}

const INBOX_MAX = 5000;

export class FixSession {
  private sock: net.Socket | null = null;
  private ready: Promise<void> | null = null;
  private seq = 1;
  private timer: NodeJS.Timeout | null = null;
  readonly inbox: string[] = [];
  private waiters: ((tags: Map<string, string>) => void)[] = [];
  constructor(private cfg: FixConfig) {}

  private send(type: string, fields: [number, string | number | undefined][] = []) {
    if (!this.sock) throw new Error('FIX session is not connected');
    this.sock.write(buildFix(type, fields, { sender: this.cfg.sender, target: this.cfg.target, seq: this.seq++ }), 'latin1');
  }

  private handle(msg: string) {
    const tags = fixTags(msg);
    const type = tags.get('35');
    if (type === '1') this.send('0', [[112, tags.get('112')]]);
    else if (type === '2') this.send('2', [[7, tags.get('7')], [16, '0']]);
    else if (type === '5') this.close();
    else if (type === '8') {
      this.inbox.push(msg.split('\u0001').join('|'));
      if (this.inbox.length > INBOX_MAX) this.inbox.shift();
    }
    for (const w of this.waiters.splice(0)) w(tags);
  }

  /** Connects and logs on once; later calls reuse the session. */
  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host: this.cfg.host, port: this.cfg.port });
      this.sock = sock;
      const framer = new FixFramer();
      const fail = (e: Error) => {
        this.close();
        reject(e);
      };
      const t = setTimeout(() => fail(new Error('FIX logon timed out')), this.cfg.timeoutMs);
      sock.setEncoding('latin1');
      sock.on('error', fail);
      sock.on('close', () => this.close());
      sock.on('data', (d: string) => {
        try {
          for (const m of framer.push(d)) this.handle(m);
        } catch (e) {
          fail(e as Error);
        }
      });
      sock.on('connect', () => {
        this.send('A', [[98, '0'], [108, this.cfg.heartbeat], [554, this.cfg.password]]);
        const onLogon = (tags: Map<string, string>) => {
          if (tags.get('35') === 'A') {
            clearTimeout(t);
            this.timer = setInterval(() => this.sock && this.send('0'), this.cfg.heartbeat * 1000);
            this.timer.unref();
            resolve();
          } else if (tags.get('35') === '5') fail(new Error(`FIX logon refused: ${tags.get('58') ?? 'logout'}`));
          else this.waiters.push(onLogon);
        };
        this.waiters.push(onLogon);
      });
    });
    this.ready.catch(() => undefined);
    return this.ready;
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sock?.destroy();
    this.sock = null;
    this.ready = null;
    this.seq = 1;
  }

  /** Sends a NewOrderSingle and waits for its first ExecutionReport (new, or rejected). */
  async route(o: RoutedOrder): Promise<BrokerAck> {
    await this.connect();
    const wait = new Promise<Map<string, string>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`No FIX acknowledgement for ${o.orderRef}`)), this.cfg.timeoutMs);
      const on = (tags: Map<string, string>) => {
        if (tags.get('35') === '8' && tags.get('11') === o.orderRef && ['0', '8'].includes(tags.get('150') ?? '')) {
          clearTimeout(t);
          resolve(tags);
        } else this.waiters.push(on);
      };
      this.waiters.push(on);
    });
    this.send('D', newOrderSingleFields({ clOrdId: o.orderRef, symbol: o.ticker, side: o.side, quantity: o.quantity, limitPrice: o.limitPrice }));
    const ack = await wait;
    return ack.get('150') === '8' ? { brokerOrderRef: ack.get('37') ?? o.orderRef, status: 'REJECTED' } : { brokerOrderRef: ack.get('37') ?? o.orderRef, status: 'ACKNOWLEDGED' };
  }
}

export class LiveBrokerRouting implements BrokerRoutingAdapter {
  private session: FixSession | null = null;
  private quantities = new Map<string, number>();
  private get s() {
    return (this.session ??= new FixSession(fixConfig()));
  }
  async routeOrder(o: RoutedOrder) {
    const ack = await this.s.route(o);
    if (ack.status === 'ACKNOWLEDGED') this.quantities.set(ack.brokerOrderRef, Number(o.quantity));
    return ack;
  }
  async fetchFills({ brokerOrderRef }: { brokerOrderRef: string }) {
    const fills: BrokerFill[] = [];
    for (const raw of this.s.inbox) {
      try {
        const r = parseFixMessage(raw);
        if (r.execType === 'TRADE' && r.orderId === brokerOrderRef) fills.push({ fillRef: r.execId, quantity: r.lastQty, price: r.lastPx, at: r.transactTime, source: 'FIX' });
      } catch {
        /* a malformed report is left to the ingest path, which rejects it with a reason */
      }
    }
    const filled = fills.reduce((a, f) => a + Number(f.quantity), 0);
    const wanted = this.quantities.get(brokerOrderRef);
    return { status: wanted !== undefined && filled >= wanted ? ('FILLED' as const) : ('WORKING' as const), fills };
  }
  async parseContractNote(i: { brokerCode: string; filename: string; content: string; format?: 'CSV' | 'JSON' | 'TEXT' }) {
    return parseContractNoteText(i.content, i.format);
  }
  async parseExecutionReport({ raw }: { raw: string }) {
    return parseFixMessage(raw);
  }
  async pollExecutionReports({ limit = 500 }: { limit?: number } = {}) {
    return { messages: this.s.inbox.splice(0, limit) };
  }
  async health() {
    try {
      const c = fixConfig();
      await this.s.connect();
      return { ok: true, detail: `FIX session logged on to ${c.host}:${c.port} as ${c.sender}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

export const live: BrokerRoutingAdapter = new LiveBrokerRouting();
