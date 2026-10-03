/**
 * Clients, Investor Services, Onboarding & KYC and Document Vault: pure-rule checks (no database or API needed).
 *
 *   npx tsx scripts/test-clients-onboarding.ts
 *
 * The endpoints themselves (/api/v1/client-ops/*) follow the maker-checker pattern of the cash and accounting modules
 * and can be exercised with the same harness style as scripts/test-cash.ts against a disposable database.
 */
import { documentChangeProblem, ratingFor, retentionState, scoreRisk, slaState } from '../src/modules/clients-onboarding/co.engine';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
};

// risk scoring
const clean = scoreRisk({ country: 'Zimbabwe', pep: 'No', applicantType: 'Individual', expectedInvestment: 50_000, screening: { sanctions: 'Clear', pep: 'Clear' }, checks: [] });
check('clean individual is Low', clean.rating === 'Low' && clean.score === 0, clean);
const hot = scoreRisk({ country: 'Iran', pep: 'Yes', applicantType: 'Trust', expectedInvestment: 6_000_000, screening: { sanctions: 'Match' }, checks: [{ kind: 'ADDRESS', outcome: 'FAIL' }] });
check('high-risk jurisdiction + PEP + match is High and capped at 100', hot.rating === 'High' && hot.score === 100, hot);
check('latest check outcome per kind wins', scoreRisk({ checks: [{ kind: 'PEP', outcome: 'FAIL' }, { kind: 'PEP', outcome: 'PASS' }] }).score === 0);
check('referred check adds points', scoreRisk({ checks: [{ kind: 'UBO', outcome: 'REFER' }] }).score === 15);
check('rating thresholds', ratingFor(29) === 'Low' && ratingFor(30) === 'Medium' && ratingFor(59) === 'Medium' && ratingFor(60) === 'High');

// SLA
const t0 = new Date('2026-10-01T09:00:00Z');
const due = new Date('2026-10-03T09:00:00Z');
check('breached after due', slaState(due, t0, false, new Date('2026-10-03T10:00:00Z')) === 'Breached');
check('at risk in the last quarter', slaState(due, t0, false, new Date('2026-10-03T00:00:00Z')) === 'At risk');
check('on track early', slaState(due, t0, false, new Date('2026-10-01T10:00:00Z')) === 'On track');
check('closed is closed', slaState(due, t0, true, new Date('2026-12-01T00:00:00Z')) === 'Closed');
check('no due date', slaState(null, t0, false) === 'No SLA');

// retention
const now = new Date('2026-10-03T00:00:00Z');
check('retained', retentionState(new Date('2026-01-01'), 7, false, now).state === 'Retained');
check('disposal eligible', retentionState(new Date('2015-01-01'), 7, false, now).state === 'Disposal eligible');
check('held beats eligible', retentionState(new Date('2015-01-01'), 7, true, now).state === 'Held');
check('due within 90 days', retentionState(new Date('2019-11-15'), 7, false, now).state === 'Due within 90 days');

// document changes
check('same value rejected', documentChangeProblem('CLASSIFICATION', 'Client', 'Client', false) !== null);
check('unknown classification rejected', documentChangeProblem('CLASSIFICATION', 'Client', 'Secret', false) !== null);
check('classification change ok', documentChangeProblem('CLASSIFICATION', 'Client', 'Restricted', false) === null);
check('retention out of range rejected', documentChangeProblem('RETENTION', '7', '99', false) !== null);
check('held retention cannot shorten', documentChangeProblem('RETENTION', '7', '5', true) !== null);
check('held retention can lengthen', documentChangeProblem('RETENTION', '7', '10', true) === null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
