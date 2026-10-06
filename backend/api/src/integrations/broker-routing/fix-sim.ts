import net from 'node:net';
import { buildFix, FixFramer, fixTags } from './fix-session';

/**
 * Local FIX 4.4 acceptor that behaves like a broker: answers logon and heartbeats, acknowledges every NewOrderSingle and
 * fills it in full at the limit price (or 100 for market orders). Symbol REJECT is refused. Used by tests and rehearsals;
 * `node` start: BROKER_FIX_SIM_PORT=9878 npx tsx src/integrations/broker-routing/fix-sim.ts
 */
export function startFixSimulator(o: { port?: number; sender?: string; target?: string } = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const sender = o.sender ?? 'BROKER'; // our CompID as acceptor
  const target = o.target ?? 'MATANHO';
  return new Promise((resolve) => {
    let orderNo = 1;
    const server = net.createServer((sock) => {
      let seq = 1;
      const framer = new FixFramer();
      const send = (type: string, f: [number, string | number | undefined][] = []) => sock.write(buildFix(type, f, { sender, target, seq: seq++ }), 'latin1');
      sock.setEncoding('latin1');
      sock.on('error', () => undefined);
      sock.on('data', (d: string) => {
        let msgs: string[];
        try {
          msgs = framer.push(d);
        } catch {
          sock.destroy();
          return;
        }
        for (const m of msgs) {
          const t = fixTags(m);
          const type = t.get('35');
          if (type === 'A') send('A', [[98, '0'], [108, t.get('108') ?? '30']]);
          else if (type === '1') send('0', [[112, t.get('112')]]);
          else if (type === '5') {
            send('5');
            sock.end();
          } else if (type === 'D') {
            const clOrdId = t.get('11')!;
            const symbol = t.get('55')!;
            const side = t.get('54')!;
            const qty = t.get('38')!;
            if (symbol === 'REJECT') {
              send('8', [[37, 'NONE'], [11, clOrdId], [17, `X${orderNo++}`], [150, '8'], [39, '8'], [55, symbol], [54, side], [58, 'Unknown symbol']]);
              continue;
            }
            const orderId = `SIM${String(orderNo).padStart(6, '0')}`;
            const px = t.get('44') ?? '100';
            send('8', [[37, orderId], [11, clOrdId], [17, `A${orderNo}`], [150, '0'], [39, '0'], [55, symbol], [54, side], [38, qty]]);
            send('8', [[37, orderId], [11, clOrdId], [17, `F${orderNo}`], [150, 'F'], [39, '2'], [55, symbol], [54, side], [32, qty], [31, px], [12, '0']]);
            orderNo++;
          }
        }
      });
    });
    server.listen(o.port ?? 0, '127.0.0.1', () =>
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) }),
    );
  });
}

if (process.env.BROKER_FIX_SIM_PORT) {
  startFixSimulator({ port: Number(process.env.BROKER_FIX_SIM_PORT) }).then((s) => console.log(`FIX simulator listening on 127.0.0.1:${s.port}`));
}
