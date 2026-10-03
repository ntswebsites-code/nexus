/**
 * Offline rule tests: pure engine arithmetic, no database and no API. Run in CI and by `npm run verify`:
 *   npx tsx scripts/offline-rules.ts
 * Values are the hand-computed fixtures from scripts/test-nav.ts.
 */
import { Prisma } from '@prisma/client';
import { computeNav, feeFromRate, isMaterial, navPerUnit, priceCoverage, daysBetween, isStale } from '../src/modules/nav/nav.engine';

let failures = 0;
const check = (name: string, cond: unknown) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
};
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const tol = { tolerancePct: 1, toleranceAbs: 50000 };

check('NAV = MV + cash + accruals - fees - liabilities = 25,025.00', computeNav({ marketValue: D(20000), cash: D(5000), accruals: D(100), fees: D(25), liabilities: D(50) }).toFixed(2) === '25025.00');
check('NAV per unit 25,025 / 2,500 = 10.0100', navPerUnit(D(25025), D(2500))?.toFixed(4) === '10.0100');
check('NAV per unit rounds half-up (200/3, 100/3)', navPerUnit(D(200), D(3))?.toFixed(4) === '66.6667' && navPerUnit(D(100), D(3))?.toFixed(4) === '33.3333');
check('NAV per unit with no units is null', navPerUnit(D(100), null) === null && navPerUnit(D(100), D(0)) === null);
check('price coverage 13,000 / 14,400 = 90.2778', priceCoverage(D(13000), D(1400)).toFixed(4) === '90.2778');
check('price coverage with nothing to value is 100', priceCoverage(D(0), D(0)).toFixed(4) === '100.0000');
check('fee accrual 3.65% x 25,100 / 365 = 2.51', feeFromRate(D('3.65'), D(25100)).toFixed(2) === '2.51');
check('materiality threshold (pct and absolute)', !isMaterial(D(40), D(10000), tol) && isMaterial(D(150), D(10000), tol) && isMaterial(D(60000), D(100_000_000), tol));
check('daysBetween 2026-09-20..30 = 10', daysBetween(day('2026-09-20'), day('2026-09-30')) === 10);
check('staleness limit 3 days', isStale(day('2026-09-20'), day('2026-09-30'), 3) && !isStale(day('2026-09-29'), day('2026-09-30'), 3));

console.log(failures ? `\n${failures} offline rule check(s) FAILED` : '\nall offline rule checks passed');
process.exit(failures ? 1 : 0);
