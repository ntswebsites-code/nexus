/**
 * Admin Core rule checks. Pure engine only (no database, no API): privileged-change classification, segregation-of-duties
 * rules, platform settings validation and the Copilot intent router. Run:
 *
 *   npx tsx scripts/test-admin-core.ts
 */
import {
  MONETARY,
  matchPortfolio,
  privilegedPermissionAdds,
  privilegedRoleAdds,
  routeIntent,
  SETTINGS,
  settingDef,
  sodHits,
  validateSetting,
} from '../src/modules/admin-core/admin-core.engine';

let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
};

// privileged classification
check('adding admin.rbac is privileged', privilegedPermissionAdds(['dashboard.view'], ['dashboard.view', 'admin.rbac']).join() === 'admin.rbac');
check('adding a view permission is not privileged', privilegedPermissionAdds(['dashboard.view'], ['dashboard.view', 'orders.view']).length === 0);
check('keeping an existing privileged permission is not new', privilegedPermissionAdds(['orders.approve'], ['orders.approve', 'orders.view']).length === 0);
check('every monetary permission is privileged', MONETARY.every((p) => privilegedPermissionAdds([], [p]).length === 1));
check(
  'gaining system_admin is privileged',
  privilegedRoleAdds([{ key: 'dealer', permissions: ['orders.view'] }], [{ key: 'system_admin', permissions: ['admin.rbac'] }]).includes('role:system_admin'),
);
check(
  'swapping to a role with a new monetary permission is privileged',
  privilegedRoleAdds([{ key: 'viewer', permissions: ['orders.view'] }], [{ key: 'trader', permissions: ['orders.view', 'orders.create'] }]).join() === 'orders.create',
);
check('removing roles is not privileged', privilegedRoleAdds([{ key: 'a', permissions: ['orders.approve'] }], [{ key: 'b', permissions: ['orders.view'] }]).length === 0);

// SoD
check('maker and checker in one set conflicts', sodHits(['orders.create', 'orders.approve']).some((h) => h.rule === 'orders-maker-checker'));
check('access control plus cash approval conflicts', sodHits(['admin.rbac', 'cash.journal.approve']).some((h) => h.rule === 'rbac-cash'));
check('a clean set has no conflicts', sodHits(['orders.view', 'cash.view', 'audit.view']).length === 0);

// settings validation
const mfa = settingDef('security.mfa_required')!;
const idle = settingDef('security.session_idle_minutes')!;
const audit = settingDef('retention.audit_years')!;
const channel = settingDef('notify.critical_channel')!;
check('boolean accepts boolean only', validateSetting(mfa, true).ok && !validateSetting(mfa, 'yes').ok);
check('int enforces minimum', !validateSetting(idle, 2).ok && validateSetting(idle, 15).ok);
check('int enforces maximum', !validateSetting(idle, 1000).ok);
check('int rejects fractions', !validateSetting(idle, 12.5).ok);
check('audit retention cannot drop below 7 years', !validateSetting(audit, 5).ok && validateSetting(audit, 7).ok);
check('enum accepts listed options only', validateSetting(channel, 'email').ok && !validateSetting(channel, 'sms').ok);
check('setting keys are unique', new Set(SETTINGS.map((s) => s.key)).size === SETTINGS.length);
check('every default passes its own validation', SETTINGS.every((s) => validateSetting(s, s.default).ok));
check('security settings require step-up', SETTINGS.filter((s) => s.category === 'Security').every((s) => s.stepUp));

// copilot router
const route = (q: string) => routeIntent(q).intent;
check('positions question', route('What are our largest positions in Growth Fund?') === 'positions');
check('orders question', route('Which orders are awaiting approval?') === 'orders');
check('nav question', route('Show the latest NAV for each portfolio') === 'nav');
check('breaks question', route('Are there open reconciliation breaks?') === 'breaks');
check('risk question', route('Any open risk breaches?') === 'risk');
check('cash question', route('What is the cash balance by portfolio?') === 'cash');
check('audit question', route('Show recent audit activity') === 'audit');
check('nonsense falls back to help', route('tell me a joke') === 'help');
const ports = [{ ref: 'PF-1001', name: 'Matanho Balanced Fund' }, { ref: 'PF-1002', name: 'Growth' }];
check('portfolio matched by ref', matchPortfolio('positions in pf-1002', ports)?.ref === 'PF-1002');
check('portfolio matched by name', matchPortfolio('what does the Matanho Balanced Fund hold', ports)?.ref === 'PF-1001');
check('no portfolio when none named', matchPortfolio('largest positions', ports) === null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll admin-core checks passed');
process.exit(failures ? 1 : 0);
