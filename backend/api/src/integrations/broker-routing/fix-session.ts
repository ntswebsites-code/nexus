import { fixChecksum } from './parse';

/** FIX 4.4 session codec: message building, stream framing and tag access. Pure; the TCP client lives in fix-live.ts. */
export const SOH = '\u0001';

export const fixStamp = (d = new Date()) => d.toISOString().replace(/-/g, '').replace('T', '-').replace('Z', '');

export function buildFix(type: string, fields: [number, string | number | undefined][], o: { sender: string; target: string; seq: number; time?: Date }): string {
  const body: [number, string | number][] = [[35, type], [49, o.sender], [56, o.target], [34, o.seq], [52, fixStamp(o.time)]];
  for (const [t, v] of fields) if (v !== undefined && v !== '') body.push([t, v]);
  const inner = body.map(([t, v]) => `${t}=${v}${SOH}`).join('');
  const pre = `8=FIX.4.4${SOH}9=${inner.length}${SOH}${inner}`;
  return `${pre}10=${fixChecksum(pre)}${SOH}`;
}

export class FixFrameError extends Error {}

/** Splits a TCP byte stream into whole FIX messages and verifies BodyLength and CheckSum on each. */
export class FixFramer {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    for (;;) {
      const m = /(?:^|\u0001)10=(\d{3})\u0001/.exec(this.buf);
      if (!m) break;
      const end = m.index + m[0].length;
      const msg = this.buf.slice(0, end);
      this.buf = this.buf.slice(end);
      out.push(checked(msg));
    }
    if (this.buf.length > 65536) {
      this.buf = '';
      throw new FixFrameError('FIX frame too large');
    }
    return out;
  }
}

function checked(msg: string): string {
  const at = msg.lastIndexOf(`${SOH}10=`);
  const pre = msg.slice(0, at + 1);
  const given = msg.slice(at + 4, at + 7);
  if (fixChecksum(pre) !== given) throw new FixFrameError('FIX checksum (tag 10) does not match');
  const lenM = /^8=[^\u0001]+\u00019=(\d+)\u0001/.exec(pre);
  if (!lenM) throw new FixFrameError('FIX header is missing BeginString or BodyLength');
  if (pre.length - lenM[0].length !== Number(lenM[1])) throw new FixFrameError('FIX BodyLength (tag 9) does not match');
  return msg;
}

/** Tag map of a framed message (first occurrence wins). */
export function fixTags(msg: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const p of msg.split(SOH)) {
    const i = p.indexOf('=');
    if (i > 0 && !tags.has(p.slice(0, i))) tags.set(p.slice(0, i), p.slice(i + 1));
  }
  return tags;
}

export interface NewOrder {
  clOrdId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  limitPrice?: string;
}

/** NewOrderSingle (35=D): market (40=1) without a limit price, limit (40=2) with one. */
export const newOrderSingleFields = (o: NewOrder): [number, string | undefined][] => [
  [11, o.clOrdId], [21, '1'], [55, o.symbol], [54, o.side === 'BUY' ? '1' : '2'], [60, fixStamp()], [38, o.quantity],
  [40, o.limitPrice ? '2' : '1'], [44, o.limitPrice], [59, '0'],
];
