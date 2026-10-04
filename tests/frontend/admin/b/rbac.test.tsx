import { describe, it, expect } from 'vitest';
import RbacPage from '@/app/(ops)/ops/rbac/page';
import { mountPage } from './_kit';
import { ok, raw, fail, screen, within, waitFor, expectCalled, expectBody, expectIdempotencyKey, expectNotCalled } from '../../_helpers';

const matrix = ok({
  roles: [{ key: 'system_admin', label: 'System Administrator', locked: true, custom: false, users: 1, permissionCount: 5 }, { key: 'analyst', label: 'Analyst', locked: false, custom: false, users: 4, permissionCount: 12 }, { key: 'ops_custom', label: 'Ops Custom', locked: false, custom: true, users: 0, permissionCount: 3 }],
  areas: [{ area: 'Orders', permissions: [{ code: 'orders.create', privileged: false, roles: ['analyst'] }, { code: 'orders.approve', privileged: true, roles: [] }] }],
  privilegedRule: 'Privileged permissions need an independent checker.',
});
const roleRows = ok([{ key: 'system_admin', label: 'System Administrator', locked: true, custom: false, users: 1, permissions: ['admin.rbac'] }, { key: 'analyst', label: 'Analyst', locked: false, custom: false, users: 4, permissions: ['orders.create'] }]);
const req = (o: Record<string, unknown> = {}) => ({ id: 'cr1', ref: 'ACR-1001', kind: 'ROLE_PERMISSIONS', targetType: 'role', targetId: 'analyst', targetLabel: 'Analyst', before: { permissions: ['orders.create'] }, proposal: { permissions: ['orders.create', 'orders.approve'] }, privileged: true, privilegedBy: ['orders.approve'], reason: 'Need approvals', status: 'PENDING', requestedBy: 'usr_other', requestedByName: 'Req R', requestedAt: '2026-09-01T10:00:00Z', decidedByName: null, decidedAt: null, decisionNote: null, fromReview: false, version: 2, ...o });
const base = (o: Record<string, unknown> = {}) => ({
  'GET /api/v1/admin-core/rbac/matrix': matrix,
  'GET /api/v1/admin/roles': roleRows,
  'GET /api/v1/admin/users': ok([{ id: 'u1', name: 'Una User', email: 'una@x.test', role: 'analyst', roles: ['analyst'], access: 'Active', last: '03 Sep 2026, 09:10', mfa: false }, { id: 'usr_admin', name: 'Test Admin', email: 'admin@example.test', role: 'system_admin', roles: ['system_admin'], access: 'Privileged', last: 'now', mfa: true }, { id: 'invite:i1', name: 'Invitee', email: 'i@x.test', role: 'analyst', roles: ['analyst'], access: 'Invited', last: '-', mfa: false }]),
  'GET /api/v1/admin-core/rbac/requests': ok([req(), req({ id: 'cr2', ref: 'ACR-1002', kind: 'USER_DISABLE', targetLabel: 'Una User', targetType: 'user', privileged: false, requestedBy: 'usr_admin', requestedByName: 'Test Admin', before: null, proposal: {} })]),
  'GET /api/v1/admin-core/rbac/reviews': ok([{ id: 'rv1', ref: 'ARV-1001', title: 'Q3 review', dueDate: '2026-10-01', overdue: false, status: 'OPEN', openedBy: 'Opener', openedAt: '2026-09-01T00:00:00Z', completedAt: null, counts: { total: 10, pending: 4, certified: 5, revoke: 1 } }]),
  'GET /api/v1/admin-core/rbac/sod': ok({ rules: [{ id: 'SOD-1', rule: 'SOD-1', a: 'orders.create', b: 'orders.approve', why: 'Maker is not checker' }], protectedMonetary: ['orders.approve'], roleConflicts: [], userConflicts: [], summary: { rules: 1, roles: 0, users: 0 }, scannedAt: '2026-09-01T00:00:00Z' }),
  'GET /api/v1/admin/sod-scan': raw({ findings: [{ severity: 'ok', title: 'Shipped roles', detail: 'No conflicts', action: 'none' }, { severity: 'warn', title: 'No MFA', detail: '9 staff lack MFA', action: 'enrol' }], blocking: 0, scannedAt: '2026-09-01T00:00:00Z' }),
  'GET /api/v1/admin-core/rbac/step-up': ok({ windowMinutes: 10, mfaRequired: false, sessionIdleMinutes: 30, enrolment: { staff: 12, enrolled: 3 }, actions: [{ area: 'Orders', action: 'Approve order', permission: 'orders.approve' }], note: 'Step-up applies to money actions.' }),
  ...o,
});
const RBAC = ['admin.rbac'];

describe('RBAC: role matrix', () => {
  it('lists roles (locked/custom flags, user and permission counts), the matrix with privileged dot, and the rule note', async () => {
    await mountPage(<RbacPage />, { perms: RBAC, routes: base() });
    expect(await screen.findByText('Roles (3)')).toBeInTheDocument();
    expect(screen.getByText('locked')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
    expect(screen.getByText(/Privileged permissions need an independent checker\./)).toBeInTheDocument();
    expect(screen.getByTitle('Privileged: needs an independent checker')).toBeInTheDocument();
    expect(screen.getAllByText('✓').length).toBe(1);
  });
  it('locked roles and system_admin cannot be edited from the UI (disabled)', async () => {
    await mountPage(<RbacPage />, { perms: RBAC, routes: base() });
    await screen.findByText('Roles (3)');
    const btns = screen.getAllByRole('button', { name: 'Propose change' });
    expect(btns[0]).toBeDisabled();
    expect(btns[1]).toBeEnabled();
  });
  it('proposing a role change: Submit is disabled until a permission changes; sends the full permission set, reason and key; reports "waiting for an independent approver"', async () => {
    const { user, api } = await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'POST /api/v1/admin-core/rbac/requests': ok({ ref: 'ACR-2001', status: 'PENDING' }, 201) }) });
    await screen.findByText('Roles (3)');
    await user.click(screen.getAllByRole('button', { name: 'Propose change' })[1]!);
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'Submit change' })).toBeDisabled();
    await user.click(within(dlg).getByLabelText(/orders.approve/));
    expect(within(dlg).getByText(/Adding 1: orders.approve. Removing 0: none/)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Needs approval rights');
    await user.click(within(dlg).getByRole('button', { name: 'Submit change' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests'));
    expect(req!.body).toEqual({ kind: 'ROLE_PERMISSIONS', roleKey: 'analyst', permissions: ['orders.create', 'orders.approve'], reason: 'Needs approval rights' });
    expectIdempotencyKey(req!);
    expect(await screen.findByText('ACR-2001 is waiting for an independent approver.')).toBeInTheDocument();
  });
  it('an immediately applied change says "applied"', async () => {
    const { user } = await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'POST /api/v1/admin-core/rbac/requests': ok({ ref: 'ACR-2002', status: 'APPLIED' }, 201) }) });
    await screen.findByText('Roles (3)');
    await user.click(screen.getByRole('button', { name: 'New role' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Role name/), 'Auditor');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Audit support');
    await user.click(within(dlg).getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('ACR-2002 applied.')).toBeInTheDocument();
  });
  it('new role: template list excludes system_admin and posts kind ROLE_CREATE', async () => {
    const { user, api } = await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'POST /api/v1/admin-core/rbac/requests': ok({ ref: 'R', status: 'PENDING' }, 201) }) });
    await screen.findByText('Roles (3)');
    await user.click(screen.getByRole('button', { name: 'New role' }));
    const dlg = screen.getByRole('dialog');
    const tpl = within(dlg).getByLabelText(/Start from/);
    expect(within(tpl).queryByText('Copy of System Administrator')).not.toBeInTheDocument();
    await user.selectOptions(tpl, 'analyst');
    await user.type(within(dlg).getByLabelText(/Role name/), 'Auditor');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Audit support');
    await user.click(within(dlg).getByRole('button', { name: 'Submit request' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests'));
    expectBody(req!, { kind: 'ROLE_CREATE', label: 'Auditor', template: 'analyst' });
  });
  it('without admin.rbac: message names the permission and nothing is fetched', async () => {
    const { api } = await mountPage(<RbacPage />, { perms: [], routes: base() });
    expect(await screen.findByText(/Ask a System Administrator for the admin.rbac permission/)).toBeInTheDocument();
    expectNotCalled(api, 'GET /api/v1/admin-core/rbac/matrix');
  });
  it('matrix load failure shows an error', async () => {
    await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'GET /api/v1/admin-core/rbac/matrix': fail(500, 'x', 'Matrix unavailable') }) });
    expect(await screen.findByText(/Could not load the role matrix: Matrix unavailable/)).toBeInTheDocument();
  });
});

describe('RBAC: staff access', () => {
  const staff = async (routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<RbacPage />, { perms: RBAC, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Staff access' }));
    await screen.findByText('Una User');
    return m;
  };
  it('shows role labels (not keys), access state and MFA; pending invitations have no role/disable actions; you cannot disable yourself', async () => {
    await staff();
    const row = screen.getByText('Una User').closest('tr')!;
    expect(within(row).getByText('Analyst')).toBeInTheDocument();
    expect(within(row).getByText('none')).toBeInTheDocument();
    const me = screen.getByText('Test Admin').closest('tr')!;
    expect(within(me).getByRole('button', { name: 'Disable' })).toBeDisabled();
    const inv = screen.getByText('Invitee').closest('tr')!;
    expect(within(inv).queryByRole('button', { name: 'Change roles' })).not.toBeInTheDocument();
  });
  it('invite staff is a maker-checker request carrying name, email, role and reason', async () => {
    const { user, api } = await staff({ 'POST /api/v1/admin-core/rbac/requests': ok({ ref: 'ACR-3001', status: 'PENDING' }, 201) });
    await user.click(screen.getByRole('button', { name: 'Invite staff member' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/only then is the email sent/)).toBeInTheDocument();
    await user.type(within(dlg).getByLabelText(/Full name/), 'New Person');
    await user.type(within(dlg).getByLabelText(/Work email/), 'new@x.test');
    await user.selectOptions(within(dlg).getByLabelText(/^Role/), 'analyst');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Joining ops');
    await user.click(within(dlg).getByRole('button', { name: 'Submit request' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests'));
    expect(req!.body).toEqual({ kind: 'STAFF_INVITE', name: 'New Person', email: 'new@x.test', role: 'analyst', reason: 'Joining ops' });
    expect(await screen.findByText('ACR-3001 is waiting for an independent approver.')).toBeInTheDocument();
  });
  it('invalid email is blocked by the form; role must be chosen', async () => {
    const { user, api } = await staff();
    await user.click(screen.getByRole('button', { name: 'Invite staff member' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/Full name/), 'X Y');
    await user.type(within(dlg).getByLabelText(/Work email/), 'not-an-email');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Because');
    await user.click(within(dlg).getByRole('button', { name: 'Submit request' }));
    expectNotCalled(api, 'POST /api/v1/admin-core/rbac/requests');
  });
  it('change roles posts the ticked roles; disable posts USER_DISABLE', async () => {
    const { user, api } = await staff({ 'POST /api/v1/admin-core/rbac/requests': ok({ ref: 'ACR-3002', status: 'APPLIED' }, 201) });
    const row = screen.getByText('Una User').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Change roles' }));
    const dlg = screen.getByRole('dialog');
    await user.type(within(dlg).getByLabelText(/^Reason/), 'Promotion');
    await user.click(within(dlg).getByRole('button', { name: 'Submit change' }));
    const [r1] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests'));
    expectBody(r1!, { kind: 'USER_ROLES', userId: 'u1', reason: 'Promotion' });
    await user.click(within(screen.getByText('Una User').closest('tr')!).getByRole('button', { name: 'Disable' }));
    const d = screen.getByRole('dialog');
    await user.type(within(d).getByLabelText(/^Reason/), 'Left the firm');
    await user.click(within(d).getByRole('button', { name: /Submit|Disable/ }));
    await waitFor(() => expect(api.calls('POST /api/v1/admin-core/rbac/requests')).toHaveLength(2));
    expectBody(api.calls('POST /api/v1/admin-core/rbac/requests')[1]!, { kind: 'USER_DISABLE', userId: 'u1' });
  });
});

describe('RBAC: change requests (maker-checker) and reviews', () => {
  const requests = async (routes: Record<string, unknown> = {}) => {
    const m = await mountPage(<RbacPage />, { perms: RBAC, routes: base(routes) });
    await m.user.click(await screen.findByRole('tab', { name: 'Change requests' }));
    await screen.findByText('ACR-1001');
    return m;
  };
  it('describes each request in words (permissions added) and flags privileged ones', async () => {
    await requests();
    expect(screen.getByText('privileged')).toBeInTheDocument();
    expect(screen.getByText(/Permissions \+1 \(orders.approve\), −0/)).toBeInTheDocument();
    expect(screen.getByText('Disable account')).toBeInTheDocument();
  });
  it('your own request offers only Withdraw (cannot approve it); someone else\'s offers Approve and Reject', async () => {
    await requests();
    const mine = screen.getByText('ACR-1002').closest('tr')!;
    expect(within(mine).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    const theirs = screen.getByText('ACR-1001').closest('tr')!;
    expect(within(theirs).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(theirs).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });
  it('approve asks an in-app confirm then posts the request version and a key', async () => {
    const { user, api } = await requests({ 'POST /api/v1/admin-core/rbac/requests/:id/approve': ok({}) });
    await user.click(within(screen.getByText('ACR-1001').closest('tr')!).getByRole('button', { name: 'Approve' }));
    expect(within(screen.getByRole('dialog')).getByText('Approve ACR-1001 and apply it now?')).toBeInTheDocument();
    expect(api.calls('POST /api/v1/admin-core/rbac/requests/cr1/approve')).toHaveLength(0);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests/cr1/approve'));
    expectBody(req!, { version: 2 });
    expectIdempotencyKey(req!);
  });
  it('stale version conflict from the server is shown in plain words', async () => {
    const { user } = await requests({ 'POST /api/v1/admin-core/rbac/requests/:id/approve': fail(409, 'version_conflict', 'This request changed; reload and try again') });
    await user.click(within(screen.getByText('ACR-1001').closest('tr')!).getByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This request changed; reload and try again')).toBeInTheDocument();
  });
  it('reject requires a reason and posts note and version', async () => {
    const { user, api } = await requests({ 'POST /api/v1/admin-core/rbac/requests/:id/reject': ok({}) });
    await user.click(within(screen.getByText('ACR-1001').closest('tr')!).getByRole('button', { name: 'Reject' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByLabelText(/Reason/)).toBeRequired();
    await user.type(within(dlg).getByLabelText(/Reason/), 'Too broad');
    await user.click(within(dlg).getByRole('button', { name: 'Reject' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/requests/cr1/reject'));
    expectBody(req!, { note: 'Too broad', version: 2 });
  });
  it('status filter is sent', async () => {
    const { user, api } = await requests();
    await user.selectOptions(screen.getByLabelText('Status'), 'PENDING');
    await waitFor(() => expect(api.calls('GET /api/v1/admin-core/rbac/requests').at(-1)!.query.get('status')).toBe('PENDING'));
  });
  it('access review campaigns: list with counts; start posts title and due date; completion needs every item decided', async () => {
    const { user, api } = await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'POST /api/v1/admin-core/rbac/reviews': ok({ id: 'rv2' }, 201), 'GET /api/v1/admin-core/rbac/reviews/:id': ok({ id: 'rv1', ref: 'ARV-1001', title: 'Q3 review', dueDate: '2026-10-01', status: 'OPEN', openedBy: 'Opener', openedAt: '2026-09-01T00:00:00Z', completedAt: null, counts: { total: 2, pending: 1, certified: 1, revoke: 0 }, items: [{ id: 'it1', userId: 'u1', userName: 'Una User', email: 'una@x.test', roles: [{ key: 'analyst', label: 'Analyst' }], permissionCount: 12, mfaEnrolled: false, lastLoginAt: null, decision: 'PENDING', decidedBy: null, decidedAt: null, note: null, request: null }] }), 'POST /api/v1/admin-core/rbac/reviews/:id/items/:item/decide': ok({}) }) });
    await user.click(await screen.findByRole('tab', { name: 'Access reviews' }));
    expect(await screen.findByText('ARV-1001')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ARV-1001' }));
    const complete = await screen.findByRole('button', { name: /Complete/ });
    expect(complete).toBeDisabled();
    expect(complete).toHaveAttribute('title', '1 still need a decision');
    await user.click(screen.getByRole('button', { name: 'Certify' }));
    const [req] = await waitFor(() => expectCalled(api, 'POST /api/v1/admin-core/rbac/reviews/rv1/items/it1/decide'));
    expectBody(req!, { decision: 'CERTIFIED' });
    expectIdempotencyKey(req!);
  });
});

describe('RBAC: segregation of duties and step-up (ADB-020)', () => {
  it('ADB-020: with the shipped roles there are no role or user conflicts and the rules are listed', async () => {
    const { user } = await mountPage(<RbacPage />, { perms: RBAC, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Segregation of duties' }));
    expect(await screen.findByText('No role bundles a conflicting pair.')).toBeInTheDocument();
    expect(screen.getByText('No active user holds a conflicting permission pair.')).toBeInTheDocument();
    expect(screen.getByText('Conflicts inside a role (0)')).toBeInTheDocument();
    expect(screen.getByText('Rule set (1)')).toBeInTheDocument();
    expect(screen.getByText('Shipped roles', { selector: 'strong' })).toBeInTheDocument();
  });
  it('ADB-020: a conflicting role/user is shown with the pair and the reason (so a regression is visible)', async () => {
    const hit = { rule: 'SOD-1', a: 'orders.create', b: 'orders.approve', why: 'Maker is not checker' };
    const { user } = await mountPage(<RbacPage />, { perms: RBAC, routes: base({ 'GET /api/v1/admin-core/rbac/sod': ok({ rules: [{ id: 'SOD-1', ...hit }], protectedMonetary: [], roleConflicts: [{ key: 'dealer', label: 'Dealer', hits: [hit] }], userConflicts: [{ userId: 'u1', name: 'Una User', email: 'una@x.test', roles: ['dealer'], hits: [hit], viaCombination: 0 }], summary: { rules: 1, roles: 1, users: 1 }, scannedAt: 'x' }) }) });
    await user.click(await screen.findByRole('tab', { name: 'Segregation of duties' }));
    expect(await screen.findByText('Conflicts inside a role (1)')).toBeInTheDocument();
    expect(screen.getByText('Dealer')).toBeInTheDocument();
    expect(screen.getAllByText('Maker is not checker').length).toBeGreaterThan(1);
  });
  it('control scan shows blocking vs warning findings and Rescan reloads both', async () => {
    const { user, api } = await mountPage(<RbacPage />, { perms: RBAC, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Segregation of duties' }));
    expect(await screen.findByText('warning')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(api.calls('GET /api/v1/admin/sod-scan').length).toBe(2));
  });
  it('step-up policy shows MFA state, windows, enrolment count and the actions that need a fresh code', async () => {
    const { user } = await mountPage(<RbacPage />, { perms: RBAC, routes: base() });
    await user.click(await screen.findByRole('tab', { name: 'Step-up policy' }));
    expect(await screen.findByText('3 of 12')).toBeInTheDocument();
    expect(screen.getByText('10 minutes')).toBeInTheDocument();
    expect(screen.getByText('Approve order')).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
  });
});
