#!/usr/bin/env node
/**
 * One-off (idempotent) catalogue update for the day-one fund-operations slice.
 * LP permission bundles come from docs/srd/appendix/5B__roles-permissions.md (VIEWER 25,
 * SIGNATORY +8, MANAGER +1) and map onto the existing investor roles per SRD Q-154:
 * admin -> MANAGER, finance -> SIGNATORY, investment and auditor -> VIEWER.
 * Staff codes follow BUILD-PLAN 5.2 / DEV-PLAN 10 personas; no new roles are created
 * except the custodian portal's submitter/approver (SRD 10.3.5, Q-165).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'backend', 'api', 'prisma', 'seed', 'role-catalog.json');
const catalog = JSON.parse(readFileSync(file, 'utf8'));

const LP_VIEWER = [
  'lp.portal.access', 'lp.portal.switch_fund', 'lp.portal.view_notifications', 'lp.dashboard.view',
  'lp.investments.view', 'lp.commitment.view', 'lp.capital_account.view', 'lp.holdings.view',
  'lp.capital_calls.view', 'lp.capital_calls.download_notice', 'lp.distributions.view',
  'lp.distributions.download', 'lp.dealing.view', 'lp.dealing.estimate', 'lp.performance.view',
  'lp.performance.download_report', 'lp.activity.view', 'lp.activity.export', 'lp.documents.view',
  'lp.documents.download', 'lp.notices.view', 'lp.requests.view', 'lp.messages.view',
  'lp.organisation.view', 'lp.settings.view',
];
const LP_SIGNATORY = [
  ...LP_VIEWER,
  'lp.capital_calls.acknowledge', 'lp.capital_calls.upload_payment_confirmation', 'lp.dealing.subscribe',
  'lp.dealing.redeem', 'lp.notices.acknowledge', 'lp.requests.create', 'lp.messages.reply',
  'lp.settings.manage_mfa',
];
const LP_MANAGER = [...LP_SIGNATORY, 'lp.organisation.manage_colleagues'];

const INVESTOR = { admin: LP_MANAGER, finance: LP_SIGNATORY, investment: LP_VIEWER, auditor: LP_VIEWER };

/** Staff codes for the ops console. Makers and checkers are different roles by construction. */
const STAFF = {
  investment_director: ['funds.view', 'capital.view', 'capital.approve', 'distributions.approve', 'notices.view', 'dealing.view', 'dealing.approve', 'term_sheets.view', 'term_sheets.approve', 'custodian.view'],
  portfolio_manager: ['funds.view', 'capital.view', 'capital.create', 'distributions.create', 'notices.view', 'dealing.view', 'term_sheets.view', 'term_sheets.create'],
  analyst: ['funds.view', 'term_sheets.view', 'term_sheets.create'],
  compliance: ['funds.view', 'capital.view', 'capital.approve', 'distributions.approve', 'notices.view', 'notices.publish', 'dealing.view', 'dealing.approve', 'term_sheets.view', 'custodian.view'],
  operations: ['funds.view', 'funds.manage', 'capital.view', 'capital.create', 'capital.settle', 'distributions.create', 'distributions.settle', 'notices.view', 'dealing.view', 'dealing.process', 'custodian.view', 'custodian.review'],
  fund_accountant: ['funds.view', 'funds.manage', 'capital.view', 'capital.create', 'capital.settle', 'distributions.create', 'distributions.settle', 'dealing.view', 'dealing.process', 'custodian.view', 'custodian.review'],
  client_services: ['funds.view', 'capital.view', 'notices.view', 'notices.create', 'notices.publish', 'dealing.view'],
  auditor: ['funds.view', 'capital.view', 'notices.view', 'dealing.view', 'term_sheets.view', 'custodian.view'],
  system_admin: ['funds.view'],
};

const CUSTODIAN_ROLES = [
  { portal: 'custodian', key: 'submitter', label: 'Custodian Submitter', permissions: ['custodian.portal.access', 'custodian.executions.submit', 'custodian.dayend.submit'] },
  { portal: 'custodian', key: 'approver', label: 'Custodian Approver', permissions: ['custodian.portal.access', 'custodian.executions.submit', 'custodian.dayend.submit', 'custodian.dayend.approve'] },
];

const add = (role, codes) => {
  for (const c of codes) if (!role.permissions.includes(c)) role.permissions.push(c);
};
for (const role of catalog.roles) {
  if (role.portal === 'investor' && INVESTOR[role.key]) add(role, INVESTOR[role.key]);
  if (role.portal === 'admin' && STAFF[role.key]) add(role, STAFF[role.key]);
}
for (const r of CUSTODIAN_ROLES) if (!catalog.roles.some((x) => x.portal === r.portal && x.key === r.key)) catalog.roles.push(r);

catalog._comment =
  'Roles and permission codes discovered in the original prototype (index.html rolePermissions/roleLabels and client-portal.html data-entitlement), plus the day-one fund-operations codes: lp.* bundles from SRD 5B (admin=MANAGER, finance=SIGNATORY, investment/auditor=VIEWER, Q-154), staff ops-console codes, and the custodian portal roles of SRD 10.3.5 (Q-165).';
writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
console.log('role catalogue updated:', catalog.roles.length, 'roles');
