import { D, ZERO, round2, type Dec } from './ops.common';

export interface Weighted<K> {
  key: K;
  weight: Dec;
}

/**
 * Splits `total` pro rata over positive weights: each share is rounded half-up to 2 dp and the
 * rounding remainder goes to the largest weight, so the shares always add up to `total` exactly.
 */
export function proRata<K>(total: Dec, parts: Weighted<K>[]): { key: K; amount: Dec }[] {
  const eligible = parts.filter((p) => p.weight.gt(0));
  const sum = eligible.reduce((s, p) => s.add(p.weight), ZERO);
  if (sum.lte(0)) return [];
  const out = eligible.map((p) => ({ key: p.key, weight: p.weight, amount: round2(total.mul(p.weight).div(sum)) }));
  const allocated = out.reduce((s, p) => s.add(p.amount), ZERO);
  const remainder = total.sub(allocated);
  if (!remainder.isZero()) {
    let largest = out[0]!;
    for (const p of out) if (p.weight.gt(largest.weight)) largest = p;
    largest.amount = largest.amount.add(remainder);
  }
  return out.map(({ key, amount }) => ({ key, amount }));
}

export const sumDec = (values: Dec[]) => values.reduce((s, v) => s.add(v), new D(0));
