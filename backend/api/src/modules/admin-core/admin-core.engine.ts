/**
 * Admin Core engine: pure rules with no database access, so they can be tested offline.
 * Privileged-change classification, segregation-of-duties rules, the platform settings registry and its
 * validation, and the Copilot intent router.
 */

export const SYSTEM_ADMIN = 'system_admin';

/**
 * Money-moving and approval permissions a platform administrator must never hold (SoD). Single source of truth:
 * the legacy `/admin` direct endpoints and the admin-core change-request flow both import this list.
 */
export const MONETARY = [
  'orders.create',
  'orders.approve',
  'orders.route',
  'cash.approve',
  'cash.journal.create',
  'cash.journal.approve',
  'cash.close',
  'performance.lock',
  'valuation.release',
  'accounting.close',
  'accounting.reopen',
  'capital.create',
  'capital.approve',
  'capital.settle',
  'distributions.create',
  'distributions.approve',
  'distributions.settle',
  'corporate_actions.process',
  'financing.manage',
  'financing.approve',
  'private.mark.approve',
  'research.ic.decide',
  'reports.approve',
  'reports.submit',
  'model.approve',
];

/** Permissions whose grant needs an independent checker. */
export const PRIVILEGED_PERMISSIONS = new Set<string>([...MONETARY, 'admin.rbac', 'admin.settings', 'risk.manage']);

export type ChangeKind = 'USER_ROLES' | 'ROLE_PERMISSIONS' | 'USER_DISABLE';

export const isPrivilegedPermission = (p: string) => PRIVILEGED_PERMISSIONS.has(p);

/** Reasons a role-permission change is privileged: privileged permissions being added. */
export function privilegedPermissionAdds(before: string[], next: string[]): string[] {
  const had = new Set(before);
  return next.filter((p) => !had.has(p) && isPrivilegedPermission(p)).sort();
}

export interface RoleBundle {
  key: string;
  permissions: string[];
}

/** Reasons a user-role change is privileged: gaining system_admin or a role carrying new privileged permissions. */
export function privilegedRoleAdds(beforeRoles: RoleBundle[], nextRoles: RoleBundle[]): string[] {
  const beforeKeys = new Set(beforeRoles.map((r) => r.key));
  const beforePerms = new Set(beforeRoles.flatMap((r) => r.permissions));
  const reasons = new Set<string>();
  for (const r of nextRoles) {
    if (beforeKeys.has(r.key)) continue;
    if (r.key === SYSTEM_ADMIN) reasons.add(`role:${SYSTEM_ADMIN}`);
    for (const p of r.permissions) if (!beforePerms.has(p) && isPrivilegedPermission(p)) reasons.add(p);
  }
  return [...reasons].sort();
}

/** Pairs of permissions one person (or one role) should not hold together. */
export const SOD_RULES: { id: string; a: string; b: string; why: string }[] = [
  { id: 'orders-maker-checker', a: 'orders.create', b: 'orders.approve', why: 'Prepare and approve the same order' },
  { id: 'orders-approve-route', a: 'orders.approve', b: 'orders.route', why: 'Approve and release the same order to market' },
  { id: 'orders-create-route', a: 'orders.create', b: 'orders.route', why: 'Prepare and route an order without an independent check' },
  { id: 'cash-maker-checker', a: 'cash.journal.create', b: 'cash.journal.approve', why: 'Prepare and post the same cash journal' },
  { id: 'cash-close', a: 'cash.journal.create', b: 'cash.close', why: 'Move cash and close the period it sits in' },
  { id: 'accounting-close', a: 'accounting.post', b: 'accounting.close', why: 'Post journals and close the period' },
  { id: 'nav-release', a: 'valuation.release', b: 'accounting.post', why: 'Release NAV and post the ledger entries behind it' },
  { id: 'rbac-orders', a: 'admin.rbac', b: 'orders.approve', why: 'Grant access and use it to approve orders' },
  { id: 'rbac-cash', a: 'admin.rbac', b: 'cash.journal.approve', why: 'Grant access and use it to approve cash' },
  { id: 'financing-maker-checker', a: 'financing.manage', b: 'financing.approve', why: 'Set up a facility or drawdown and approve it' },
  { id: 'pm-mark', a: 'portfolio.manage', b: 'private.mark.approve', why: 'Propose a private-markets NAV mark and approve it' },
  { id: 'research-ic', a: 'research.edit', b: 'research.ic.decide', why: 'Write a research case and decide it at the investment committee' },
  { id: 'reports-maker-checker', a: 'reports.create', b: 'reports.approve', why: 'Prepare a report or regulatory filing and approve it' },
  { id: 'reports-approve-submit', a: 'reports.approve', b: 'reports.submit', why: 'Approve a regulatory filing and submit it to the regulator' },
  { id: 'model-maker-checker', a: 'risk.manage', b: 'model.approve', why: 'Develop a model and validate or approve it' },
  { id: 'capital-maker-checker', a: 'capital.create', b: 'capital.approve', why: 'Raise a capital call and approve it' },
  { id: 'capital-approve-settle', a: 'capital.approve', b: 'capital.settle', why: 'Approve a capital call and confirm its receipt' },
  { id: 'distributions-maker-checker', a: 'distributions.create', b: 'distributions.approve', why: 'Prepare a distribution and approve it' },
  { id: 'distributions-approve-settle', a: 'distributions.approve', b: 'distributions.settle', why: 'Approve a distribution and mark it paid' },
  { id: 'accounting-reopen', a: 'accounting.post', b: 'accounting.reopen', why: 'Post journals and reopen the closed period they sit in' },
  { id: 'rbac-ic', a: 'admin.rbac', b: 'research.ic.decide', why: 'Grant access and use it to decide at the investment committee' },
  { id: 'rbac-financing', a: 'admin.rbac', b: 'financing.approve', why: 'Grant access and use it to approve financing' },
  { id: 'rbac-marks', a: 'admin.rbac', b: 'private.mark.approve', why: 'Grant access and use it to approve private-markets marks' },
  { id: 'rbac-reports', a: 'admin.rbac', b: 'reports.approve', why: 'Grant access and use it to approve regulatory filings' },
  { id: 'rbac-models', a: 'admin.rbac', b: 'model.approve', why: 'Grant access and use it to approve models' },
  { id: 'rbac-nav', a: 'admin.rbac', b: 'valuation.release', why: 'Grant access and use it to release NAV' },
  { id: 'rbac-settings', a: 'admin.rbac', b: 'admin.settings', why: 'Change access and the controls that police it' },
];

export interface SodHit {
  rule: string;
  a: string;
  b: string;
  why: string;
}

export function sodHits(perms: Iterable<string>): SodHit[] {
  const set = new Set(perms);
  return SOD_RULES.filter((r) => set.has(r.a) && set.has(r.b)).map((r) => ({ rule: r.id, a: r.a, b: r.b, why: r.why }));
}

/** Permission area label: the part before the first dot, e.g. orders.approve -> orders. */
export const permissionArea = (p: string) => p.split('.')[0]!;

/** Actions that demand a fresh authenticator code, for the step-up policy view. */
export const STEP_UP_ACTIONS: { area: string; action: string; permission: string }[] = [
  { area: 'Access control', action: 'Invite, disable or change roles of a staff user', permission: 'admin.rbac' },
  { area: 'Access control', action: 'Edit a role permission bundle or create a role', permission: 'admin.rbac' },
  { area: 'Access control', action: 'Approve a privileged access change request', permission: 'admin.rbac' },
  { area: 'Access control', action: 'Reset a user second factor', permission: 'admin.rbac' },
  { area: 'Access control', action: 'Change the access policy', permission: 'admin.rbac' },
  { area: 'Settings', action: 'Change a security setting (MFA, session timeout)', permission: 'admin.settings' },
  { area: 'Cash', action: 'Post or reverse a cash journal', permission: 'cash.journal.approve' },
  { area: 'Cash', action: 'Close or reopen a cash period', permission: 'cash.close' },
  { area: 'Accounting', action: 'Close or reopen an accounting period', permission: 'accounting.close' },
  { area: 'Valuation', action: 'Release a NAV run', permission: 'valuation.release' },
  { area: 'Corporate actions', action: 'Process a corporate action', permission: 'corporate_actions.process' },
];

// ---------------------------------------------------------------- platform settings registry

export type SettingType = 'boolean' | 'int' | 'enum';

export interface SettingDef {
  key: string;
  category: 'Feature flags' | 'Retention' | 'Notifications' | 'Security';
  label: string;
  help: string;
  type: SettingType;
  default: boolean | number | string;
  min?: number;
  max?: number;
  options?: string[];
  /** Change needs a fresh authenticator code. */
  stepUp?: boolean;
  /** Stored in the policies table (source of truth for enforcement) and mirrored in the change history. */
  policyKey?: 'mfa_required' | 'session_idle_minutes' | 'document_approval' | 'client_publish_approval' | 'kyc_dual_control';
  /** True when platform code reads the value to change behaviour today. */
  enforced: boolean;
}

export const SETTINGS: SettingDef[] = [
  { key: 'feature.copilot', category: 'Feature flags', label: 'Investment Copilot', help: 'Show and serve the Copilot on the admin console.', type: 'boolean', default: true, enforced: true },
  { key: 'feature.lp_dealing', category: 'Feature flags', label: 'LP dealing requests', help: 'Let investors submit dealing requests from the LP portal.', type: 'boolean', default: true, enforced: true },
  { key: 'feature.investee_requests', category: 'Feature flags', label: 'Investee information requests', help: 'Allow staff to send reporting questions to portfolio companies.', type: 'boolean', default: true, enforced: true },
  { key: 'feature.statement_import', category: 'Feature flags', label: 'Bank statement import', help: 'Allow cash statement files to be staged.', type: 'boolean', default: true, enforced: true },
  { key: 'retention.audit_years', category: 'Retention', label: 'Audit evidence retention (years)', help: 'Minimum time audit events are kept (the hash chain is never purged; this is the floor reported by the retention job). Regulatory floor is 7 years.', type: 'int', default: 7, min: 7, max: 25, stepUp: true, enforced: true },
  { key: 'retention.documents_years', category: 'Retention', label: 'Client document retention (years)', help: 'Time superseded client documents are kept after the relationship ends.', type: 'int', default: 7, min: 5, max: 25, enforced: true },
  { key: 'retention.session_days', category: 'Retention', label: 'Session record retention (days)', help: 'How long expired session rows are kept for forensics.', type: 'int', default: 30, min: 7, max: 365, enforced: true },
  { key: 'notify.email_enabled', category: 'Notifications', label: 'Email notifications', help: 'Send email for approvals, notices and alerts.', type: 'boolean', default: true, enforced: true },
  { key: 'notify.digest_hour', category: 'Notifications', label: 'Daily digest hour (Harare time)', help: 'Hour of day for the operations digest.', type: 'int', default: 7, min: 0, max: 23, enforced: true },
  { key: 'notify.critical_channel', category: 'Notifications', label: 'Critical alert channel', help: 'Where breaches and failed controls are announced.', type: 'enum', default: 'in_app_email', options: ['in_app', 'email', 'in_app_email'], enforced: true },
  { key: 'security.mfa_required', category: 'Security', label: 'Require MFA for all staff', help: 'Staff must enrol an authenticator before using the console.', type: 'boolean', default: false, stepUp: true, policyKey: 'mfa_required', enforced: true },
  { key: 'security.session_idle_minutes', category: 'Security', label: 'Idle session timeout (minutes)', help: 'Sessions end after this long without activity.', type: 'int', default: 30, min: 5, max: 240, stepUp: true, policyKey: 'session_idle_minutes', enforced: true },
  { key: 'security.document_approval', category: 'Security', label: 'Independent document approval', help: 'Client documents need a different approver before publishing.', type: 'boolean', default: true, stepUp: true, policyKey: 'document_approval', enforced: true },
  { key: 'security.client_publish_approval', category: 'Security', label: 'Independent client publish approval', help: 'Client-facing publications need a different approver.', type: 'boolean', default: true, stepUp: true, policyKey: 'client_publish_approval', enforced: true },
  { key: 'security.kyc_dual_control', category: 'Security', label: 'KYC dual control', help: 'KYC decisions need a second reviewer.', type: 'boolean', default: true, stepUp: true, policyKey: 'kyc_dual_control', enforced: true },
];

export const settingDef = (key: string) => SETTINGS.find((s) => s.key === key);

/** Validates and normalises a proposed setting value; returns an error string or the clean value. */
export function validateSetting(def: SettingDef, value: unknown): { ok: true; value: boolean | number | string } | { ok: false; error: string } {
  if (def.type === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: 'Expected true or false' };
  if (def.type === 'int') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return { ok: false, error: 'Expected a whole number' };
    if (def.min !== undefined && value < def.min) return { ok: false, error: `Must be at least ${def.min}` };
    if (def.max !== undefined && value > def.max) return { ok: false, error: `Must be at most ${def.max}` };
    return { ok: true, value };
  }
  if (typeof value !== 'string' || !def.options?.includes(value)) return { ok: false, error: `Must be one of ${def.options?.join(', ')}` };
  return { ok: true, value };
}

// ---------------------------------------------------------------- copilot router

export type CopilotIntent = 'positions' | 'orders' | 'nav' | 'breaks' | 'risk' | 'cash' | 'approvals' | 'audit' | 'help';

const INTENT_WORDS: Record<Exclude<CopilotIntent, 'help'>, string[]> = {
  positions: ['position', 'positions', 'holding', 'holdings', 'exposure', 'hold', 'aum', 'invested'],
  orders: ['order', 'orders', 'trade', 'trades', 'ticket', 'tickets', 'routed', 'filled', 'pending'],
  nav: ['nav', 'valuation', 'valued', 'unit price', 'navs'],
  breaks: ['break', 'breaks', 'recon', 'reconciliation', 'reconciliations', 'unmatched', 'mismatch'],
  risk: ['risk', 'breach', 'breaches', 'limit', 'limits', 'compliance'],
  cash: ['cash', 'balance', 'balances', 'liquidity', 'reservation', 'reservations'],
  approvals: ['approval', 'approvals', 'access', 'rbac', 'role', 'roles', 'privileged', 'request', 'requests', 'review'],
  audit: ['audit', 'activity', 'who', 'changed', 'log', 'recent'],
};

/** Scores each domain by keyword hits; ties resolve by declaration order. Returns 'help' when nothing matches. */
export function routeIntent(question: string): { intent: CopilotIntent; scores: Record<string, number> } {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ')} `;
  const scores: Record<string, number> = {};
  let best: CopilotIntent = 'help';
  let top = 0;
  for (const [intent, words] of Object.entries(INTENT_WORDS) as [Exclude<CopilotIntent, 'help'>, string[]][]) {
    let s = 0;
    for (const w of words) if (q.includes(` ${w} `) || (w.length > 4 && q.includes(` ${w}`))) s += 1;
    scores[intent] = s;
    if (s > top) {
      top = s;
      best = intent;
    }
  }
  return { intent: best, scores };
}

/** Finds a portfolio by ref ("PF-1001") or by name words inside the question. */
export function matchPortfolio<T extends { ref: string; name: string }>(question: string, list: T[]): T | null {
  const q = question.toLowerCase();
  const byRef = list.find((p) => q.includes(p.ref.toLowerCase()));
  if (byRef) return byRef;
  const named = list
    .filter((p) => p.name.length >= 4 && q.includes(p.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  return named[0] ?? null;
}
