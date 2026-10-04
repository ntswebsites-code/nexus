import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LpSecurityPanels } from '@/components/lp-portal/lp-security-panels';
import { LpCapitalActivityScreen } from '@/components/lp-portal/screens/lp-capital-activity-screen';
import { ValuationBadge } from '@/components/lp-portal/valuation-badge';
import { InfoHint } from '@/components/lp-portal/info-hint';
import { kpiDefinition } from '@/lib/lp-portal/kpi-definitions';
import { mapAccountActivityRow } from '@/lib/lp-portal/mappers';
import { getLpClientScope, setLpClientScope } from '@/lib/lp-portal/client-scope';
import { toast } from 'sonner';
import { ok, fail, raw, screen, waitFor, within, expectCalled } from '../_helpers';
import { API, liveApi, renderLp, list } from './_lp';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/lp-portal/realtime', async () => (await import('./_rt')).rtMock);

beforeEach(() => vi.clearAllMocks());

const SECURITY = (over: Record<string, unknown> = {}) =>
  raw({
    data: {
      email: 'lp@alpha.test',
      mfa: { enrolled: false, enrolledAt: null, required: false, backupCodesRemaining: 0 },
      sessions: [{ id: 's1', current: true, createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-04T08:00:00Z', userAgent: 'Chrome', ip: '10.0.0.1' }],
      ...over,
    },
  });

describe('FR-LP-102 MFA enrolment with backup codes', () => {
  it('enrols, verifies the first code and shows ten backup codes once', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `abcd${i}-1234${i}`);
    let enrolled = false;
    const api = liveApi({
      'GET /api/v1/account/security': () => SECURITY(enrolled ? { mfa: { enrolled: true, enrolledAt: '2026-10-04T00:00:00Z', required: false, backupCodesRemaining: 10 } } : {}),
      'POST /api/v1/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' }),
      'POST /api/v1/auth/mfa/verify': () => {
        enrolled = true;
        return raw({ user: {} });
      },
      'POST /api/v1/account/security/mfa/backup-codes': raw({ data: { codes, count: 10 } }),
    });
    const { user } = renderLp(<LpSecurityPanels panel="mfa" />);
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByTestId('lp-mfa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    await user.click(screen.getByLabelText('Authentication code'));
    await user.paste('12');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));
    expect(await screen.findByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument();
    expect(api.calls('POST /api/v1/auth/mfa/verify')).toHaveLength(0);
    await user.clear(screen.getByLabelText('Authentication code'));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));
    const shown = await screen.findByTestId('lp-backup-codes');
    expect(within(shown).getAllByRole('listitem')).toHaveLength(10);
    expect(expectCalled(api, 'POST /api/v1/auth/mfa/verify')[0].body).toEqual({ code: '123456' });
    await user.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByTestId('lp-backup-codes')).not.toBeInTheDocument();
  });

  it('a wrong code shows the API message and creates no backup codes', async () => {
    const api = liveApi({
      'GET /api/v1/account/security': SECURITY(),
      'POST /api/v1/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://x' }),
      'POST /api/v1/auth/mfa/verify': fail(401, 'invalid_mfa_code', 'That code is not valid. Try the latest code.'),
    });
    const { user } = renderLp(<LpSecurityPanels panel="mfa" />);
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator' }));
    await user.click(await screen.findByLabelText('Authentication code'));
    await user.paste('000000');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));
    expect(await screen.findByText('That code is not valid. Try the latest code.')).toBeInTheDocument();
    expect(api.calls('POST /api/v1/account/security/mfa/backup-codes')).toHaveLength(0);
  });
});

describe('FR-LP-102 password change and sessions', () => {
  it('refuses a mismatch locally and posts the change once valid', async () => {
    const api = liveApi({ 'POST /api/v1/account/security/password': raw({ data: { ok: true, otherSessionsRevoked: 2 } }) });
    const { user } = renderLp(<LpSecurityPanels panel="password" />);
    await user.click(await screen.findByLabelText('Current password'));
    await user.paste('old-password-1');
    await user.click(screen.getByLabelText('New password'));
    await user.paste('a-new-password-1');
    await user.click(screen.getByLabelText('Repeat new password'));
    await user.paste('a-new-password-2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(api.calls('POST /api/v1/account/security/password')).toHaveLength(0);
    await user.clear(screen.getByLabelText('Repeat new password'));
    await user.paste('a-new-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Password changed. 2 other session(s) signed out.'));
    expect(expectCalled(api, 'POST /api/v1/account/security/password')[0].body).toEqual({ currentPassword: 'old-password-1', newPassword: 'a-new-password-1' });
  });

  it('a wrong current password shows the server message', async () => {
    liveApi({ 'POST /api/v1/account/security/password': fail(400, 'invalid_current_password', 'Your current password is not correct') });
    const { user } = renderLp(<LpSecurityPanels panel="password" />);
    await user.click(await screen.findByLabelText('Current password'));
    await user.paste('nope');
    await user.click(screen.getByLabelText('New password'));
    await user.paste('a-new-password-1');
    await user.click(screen.getByLabelText('Repeat new password'));
    await user.paste('a-new-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not correct')).toBeInTheDocument();
  });

  it('signs a single other session out and keeps this browser without a button', async () => {
    const api = liveApi({
      'GET /api/v1/account/security': SECURITY({
        sessions: [
          { id: 's1', current: true, createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-04T08:00:00Z', userAgent: 'Chrome', ip: '10.0.0.1' },
          { id: 's2', current: false, createdAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-10-03T08:00:00Z', userAgent: 'Safari', ip: '10.0.0.2' },
        ],
      }),
      'DELETE /api/v1/account/security/sessions/s2': raw({ data: { ok: true } }),
    });
    const { user } = renderLp(<LpSecurityPanels panel="sessions" />);
    expect(await screen.findByText('This browser')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Sign out (?!other)/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Sign out Safari' }));
    await waitFor(() => expect(api.calls('DELETE /api/v1/account/security/sessions/s2')).toHaveLength(1));
  });
});

const CALL = {
  id: 'cc-013', callNo: 13, fundId: 'fund-growth-1', fundName: 'Growth Fund I', issueDate: '2026-05-01', dueDate: '2099-06-01',
  currencyCode: 'USD', amount: '200000.00', paid: '50000.00', outstanding: '150000.00', status: 'ISSUED', acknowledgedAt: null,
};
const DETAIL = {
  ...CALL,
  wiring: { bankName: 'First Bank', accountName: 'Growth Fund I Ltd', accountNumber: null, accountNumberMasked: '****1234', abaRouting: '021000021', reference: 'GF1-CALL-13', raw: null },
  timeline: [],
};
const callRoutes = (extra: Record<string, unknown> = {}) =>
  ({
    [`GET ${API}/capital-calls/summary`]: ok({ openCount: 1, outstanding: '150000.00', overdue: '0.00', paidYtd: '0', currencyCode: 'USD', paidCallCount: 0, dueSoonCount: 0, dueSoonAmount: '0', totalDistributions: '0', upcomingDistributionNotices: { count: 0 } }),
    [`GET ${API}/capital-calls/:id/documents`]: ok([]),
    [`GET ${API}/capital-calls/:id`]: ok(DETAIL),
    [`GET ${API}/capital-calls`]: ok(list([CALL])),
    [`GET ${API}/distributions`]: ok(list([])),
    ...extra,
  }) as never;

describe('BR-101 account number reveal', () => {
  it('a MANAGER can reveal the full number (audited call) and hide it again', async () => {
    const api = liveApi(callRoutes({ [`POST ${API}/capital-calls/cc-013/wiring/reveal`]: ok({ accountNumber: '4100123456789', accountNumberMasked: '****6789', revealedAt: '2026-10-04T00:00:00Z' }) }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(await screen.findByText('View full details →'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('wiring-account-value')).toHaveTextContent('****1234');
    await user.click(within(dialog).getByRole('button', { name: 'Reveal' }));
    await waitFor(() => expect(within(dialog).getByTestId('wiring-account-value')).toHaveTextContent('4100123456789'));
    expect(api.calls(`POST ${API}/capital-calls/cc-013/wiring/reveal`)).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Hide' }));
    expect(within(dialog).getByTestId('wiring-account-value')).toHaveTextContent('****1234');
  });

  it('a VIEWER has no reveal control and stays masked', async () => {
    const api = liveApi(callRoutes(), { session: { lpRole: 'VIEWER' } });
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(await screen.findByText('View full details →'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('wiring-account-value')).toHaveTextContent('****1234');
    expect(within(dialog).queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    expect(api.calls(`POST ${API}/capital-calls/cc-013/wiring/reveal`)).toHaveLength(0);
  });

  it('a 403 from the API shows an error and the number stays masked', async () => {
    liveApi(callRoutes({ [`POST ${API}/capital-calls/cc-013/wiring/reveal`]: fail(403, 'LP_FORBIDDEN', 'Authorised Signatory access required') }));
    const { user } = renderLp(<LpCapitalActivityScreen />);
    await screen.findByText('****1234');
    await user.click(await screen.findByText('View full details →'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reveal' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(within(dialog).getByTestId('wiring-account-value')).toHaveTextContent('****1234');
  });
});

describe('valuation status badge (BR-094) and KPI popover (FR-LP-010)', () => {
  it('RESTATED is purple, PROVISIONAL amber, FINAL green', () => {
    const { container } = render(
      <>
        <ValuationBadge status="RESTATED" />
        <ValuationBadge status="PROVISIONAL" />
        <ValuationBadge status="FINAL" />
      </>,
    );
    const dots = [...container.querySelectorAll('i')].map((i) => i.className);
    expect(dots[0]).toContain('bg-purple-500');
    expect(dots[1]).toContain('bg-amber-500');
    expect(dots[2]).toContain('bg-emerald-500');
    expect(container.querySelector('[data-valuation-status="RESTATED"]')).not.toBeNull();
  });

  it('the info popover shows the definition, formula, period and as-of date', async () => {
    const { user } = renderLp(<InfoHint label="TVPI" description={kpiDefinition('TVPI')?.definition} formula={kpiDefinition('TVPI')?.formula} period="Since inception" asOf="30 Jun 2026" />);
    await user.click(screen.getByRole('button', { name: 'TVPI info' }));
    expect(await screen.findByText(/Formula:/)).toBeInTheDocument();
    expect(screen.getByText(/\(Distributions \+ NAV\) \/ Paid-in capital/)).toBeInTheDocument();
    expect(screen.getByText(/Period: Since inception/)).toBeInTheDocument();
    expect(screen.getByText(/As of 30 Jun 2026/)).toBeInTheDocument();
  });
});

describe('BR-152 / BR-171 ledger FX fields', () => {
  const entry = { entryId: 'e1', entryType: 'CAPITAL_CALL', fundId: 'f', fundName: 'F', transactionDate: '2026-03-01', amount: '100.00', currency: 'USD', description: 'Call', status: 'POSTED' };

  it('uses the stamped transaction-date rate and reporting amount from the API', () => {
    const row = mapAccountActivityRow({ ...entry, reportingAmount: '2650.00', reportingCurrency: 'ZIG', fxRate: '26.5000000000', fxRateDate: '2026-03-01', fxNote: null });
    expect(row.reportingAmount).toBe(2650);
    expect(row.exchangeRate).toBe(26.5);
    expect(row.fxNote).toContain('Converted at 26.5000');
  });

  it('a missing rate keeps the original amount and shows the API note, never a silent conversion', () => {
    const row = mapAccountActivityRow({ ...entry, reportingAmount: null, reportingCurrency: 'USD', fxRate: null, fxRateDate: null, fxNote: 'FX rate unavailable for USD/ZIG; original currency shown.' });
    expect(row.reportingAmount).toBe(100);
    expect(row.exchangeRate).toBe(1);
    expect(row.fxNote).toBe('FX rate unavailable for USD/ZIG; original currency shown.');
  });

  it('an entry without FX fields (older payload) still maps with rate 1', () => {
    const row = mapAccountActivityRow(entry);
    expect(row.exchangeRate).toBe(1);
    expect(row.fxNote).toBe('No FX required');
  });
});

describe('FR-LP-004 client scope', () => {
  it('remembers the chosen relationship and clears it', () => {
    expect(getLpClientScope()).toBeNull();
    setLpClientScope('INV-0002');
    expect(getLpClientScope()).toBe('INV-0002');
    setLpClientScope(null);
    expect(getLpClientScope()).toBeNull();
  });
});
