/**
 * Offline rule tests for Package S7: forecast arithmetic (BR-263, BR-209), the tranche ledger (BR-229, BR-270, BR-272),
 * resubmission fingerprint (BR-273) and compliance health (BR-221). No database and no API:
 *   npx tsx scripts/offline-investee-deals.ts
 */
import { computeForecast } from '../src/modules/investee-portal/workspace/forecast-math';
import { computeTranche, isApprovedForLedger, requisitionFingerprint } from '../src/modules/investee-portal/workspace/drawdown';
import { healthRatio } from '../src/modules/investee-portal/workspace/compliance';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const at = (s: string) => new Date(`${s}T00:00:00.000Z`);

// ---- forecast arithmetic
const f = computeForecast(
  ['2026-10', '2026-11', '2026-12'],
  {
    merchantRevenue: { '2026-10': 600, '2026-11': 700 },
    enterpriseRevenue: { '2026-10': 300, '2026-11': 300 },
    otherRevenue: { '2026-10': 100, '2026-11': 0 },
    revenue: { '2026-12': 500 },
    processingCosts: { '2026-10': 200, '2026-11': 250, '2026-12': 100 },
    supportLosses: { '2026-10': 50 },
    salesMarketing: { '2026-10': 100 },
    productEngineering: { '2026-10': 150 },
    generalAdmin: { '2026-10': 50 },
    capex: { '2026-10': 100 },
    financing: { '2026-11': 400 },
    minimumCash: { '2026-10': 300, '2026-11': 300, '2026-12': 300 },
    openingCash: { '2026-10': 1000 },
  },
  0,
);
const oct = f.rows['2026-10']!;
check('total revenue = merchant + enterprise + other (1,000)', oct.totalRevenue === 1000, oct);
check('gross profit = revenue - processing - support losses (750)', oct.grossProfit === 750, oct);
check('EBITDA = gross profit - S&M - P&E - G&A (450)', oct.ebitda === 450, oct);
check('EBITDA margin = EBITDA / max(revenue, 1) = 45%', oct.ebitdaMargin === 45, oct);
check('operating cash defaults to EBITDA, closing = opening + operating - capex + financing (1,350)', oct.operatingCash === 450 && oct.closingCash === 1350, oct);
check('opening cash of month n+1 equals closing cash of month n (BR-209)', f.rows['2026-11']!.openingCash === 1350 && f.rows['2026-12']!.openingCash === f.rows['2026-11']!.closingCash, f.rows);
check('financing flows into closing cash (Nov: 1,350 + 1,000 - 250 + 0 ... )', f.rows['2026-11']!.closingCash === 1350 + (1000 - 250) + 400, f.rows['2026-11']);
check('a month without components uses the stored revenue total', f.rows['2026-12']!.totalRevenue === 500, f.rows['2026-12']);
check('liquidity headroom = closing cash - minimum cash', oct.liquidityHeadroom === 1050, oct);
check('annual column sums flows and takes first opening and last closing', f.annual.totalRevenue === 2500 && f.annual.openingCash === 1000 && f.annual.closingCash === f.rows['2026-12']!.closingCash, f.annual);
const zero = computeForecast(['2026-10'], { processingCosts: { '2026-10': 10 } });
check('EBITDA margin divides by at least 1 when revenue is zero', zero.rows['2026-10']!.ebitdaMargin === -1000, zero.rows);
const seeded = computeForecast(['2026-10'], {}, 250);
check('opening cash seeds from the last reported closing cash', seeded.rows['2026-10']!.openingCash === 250 && seeded.rows['2026-10']!.closingCash === 250, seeded.rows);

// ---- tranche ledger
const now = at('2026-11-15');
const rows = [
  { id: 'a', status: 'SUBMITTED', amount: 100, approvedAt: null },
  { id: 'b', status: 'APPROVED', amount: 200, approvedAt: at('2026-10-05') },
  { id: 'c', status: 'RFQ_SENT', amount: 50, approvedAt: at('2026-08-01') },
  { id: 'd', status: 'REJECTED', amount: 999, approvedAt: null },
  { id: 'e', status: 'RETURNED', amount: 888, approvedAt: null },
  { id: 'f', status: 'FULFILLED', amount: 70, approvedAt: at('2026-02-01') },
];
const t = computeTranche(1000, rows, { now });
check('reserved = review + approved + RFQ + fulfilled, not rejected or returned (420)', t.reserved === 420, t);
check('available = committed - reserved (580)', t.available === 580, t);
check('available excluding the request being checked', computeTranche(1000, rows, { now, excludeId: 'a' }).reserved === 320);
check('available never goes below zero', computeTranche(100, rows, { now }).available === 0);
check('approved this quarter counts approvedAt in the quarter or an approved status (250)', t.approvedThisQuarter === 250, t);
check('total approved counts approvedAt set or approved status (320)', t.totalApproved === 320, t);
check('ledger approval rule', isApprovedForLedger({ status: 'SUBMITTED', approvedAt: at('2026-01-01') }) && isApprovedForLedger({ status: 'CONVERTED_TO_PO', approvedAt: null }) && !isApprovedForLedger({ status: 'REJECTED', approvedAt: null }));

// ---- resubmission fingerprint
const base = { title: 'POS terminals', description: 'Rollout', category: 'Procurement request: Equipment', currency: 'USD', amount: 250000, needBy: '2026-11-30', priority: 'High' };
const fp = requisitionFingerprint(base);
check('the fingerprint is stable for the same content', fp === requisitionFingerprint({ ...base, title: '  POS terminals ', currency: 'usd', amount: '250000.00' }));
check('changing the amount changes the fingerprint', fp !== requisitionFingerprint({ ...base, amount: 249999 }));
check('changing the description changes the fingerprint', fp !== requisitionFingerprint({ ...base, description: 'Rollout v2' }));

// ---- compliance health
const due = [
  { dueDate: at('2026-01-15'), status: 'accepted', submittedAt: new Date('2026-01-14T10:00:00Z') },
  { dueDate: at('2026-02-15'), status: 'submitted', submittedAt: new Date('2026-02-15T23:00:00Z') },
  { dueDate: at('2026-03-15'), status: 'accepted', submittedAt: new Date('2026-03-20T10:00:00Z') },
  { dueDate: at('2026-04-15'), status: 'open', submittedAt: null },
];
const h = healthRatio(due);
check('compliance health = on-time obligations / obligations due (2 of 4 = 50%)', h.due === 4 && h.onTime === 2 && h.ratio === 50, h);
check('compliance health is null when nothing fell due', healthRatio([]).ratio === null);

console.log(failures ? `\n${failures} offline S7 check(s) FAILED` : '\nall offline S7 checks passed');
process.exit(failures ? 1 : 0);
