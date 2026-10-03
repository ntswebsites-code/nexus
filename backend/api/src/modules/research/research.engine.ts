import { Prisma } from '@prisma/client';

/** Pure rules for Research & IC (SRD 5.A.6). No database access. */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const RATINGS = ['BUY', 'ACCUMULATE', 'HOLD', 'REDUCE', 'SELL'] as const;
export const IC_ACTIONS = ['BUY', 'SELL', 'HOLD'] as const;
export const VOTES = ['FOR', 'AGAINST', 'ABSTAIN'] as const;
export const DEFAULT_QUORUM = 3;
export const OPEN_DECISION = ['PROPOSED', 'VOTING'];

/** Target price against the reference price, percent (1 dp). Null when there is no price. */
export function upsidePct(target: Dec, price: Dec | null | undefined): Dec | null {
  if (!price || price.lte(0)) return null;
  return target.sub(price).div(price).mul(100).toDecimalPlaces(1, D.ROUND_HALF_UP);
}

export interface Tally {
  for: number;
  against: number;
  abstain: number;
  total: number;
}

export function tally(votes: { vote: string }[]): Tally {
  const t = { for: 0, against: 0, abstain: 0, total: 0 };
  for (const v of votes) {
    if (v.vote === 'FOR') t.for++;
    else if (v.vote === 'AGAINST') t.against++;
    else t.abstain++;
    t.total++;
  }
  return t;
}

export type IcOutcome = 'APPROVED' | 'REJECTED' | 'NO_QUORUM';

/** Quorum counts every vote cast. Approved when quorum is met and FOR strictly exceeds AGAINST; a tie is rejected. */
export function icOutcome(t: Tally, quorum: number): { outcome: IcOutcome; quorumMet: boolean; reason: string } {
  if (t.total < quorum) return { outcome: 'NO_QUORUM', quorumMet: false, reason: `Quorum is ${quorum} votes; ${t.total} cast` };
  if (t.for > t.against) return { outcome: 'APPROVED', quorumMet: true, reason: `${t.for} for, ${t.against} against, ${t.abstain} abstained` };
  return { outcome: 'REJECTED', quorumMet: true, reason: `${t.for} for, ${t.against} against, ${t.abstain} abstained (a tie is not carried)` };
}

/** Soft consistency warning between a published rating and the proposed action. */
export function ratingConflict(action: string, rating: string): string | null {
  if (action === 'BUY' && (rating === 'SELL' || rating === 'REDUCE')) return `The published rating is ${rating}; a BUY proposal contradicts it`;
  if (action === 'SELL' && (rating === 'BUY' || rating === 'ACCUMULATE')) return `The published rating is ${rating}; a SELL proposal contradicts it`;
  return null;
}
