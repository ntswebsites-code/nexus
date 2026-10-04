import { describe, it, expect } from 'vitest';
import SecurityPage from '@/app/(portal)/security/page';
import { expectCalled, expectNotCalled, fail, mockApi, raw, screen, waitFor, within } from '../_helpers';
import { renderPortal, shellRoutes } from './_support';

const SEC = '/api/v1/account/security';

const data = (over: Record<string, unknown> = {}) =>
  raw({
    data: {
      mfa: { enrolled: false, enrolledAt: null, required: false, backupCodesRemaining: 0 },
      sessions: [
        { id: 's1', current: true, createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-04T08:00:00.000Z', userAgent: 'Chrome on Windows', ip: '10.0.0.1' },
        { id: 's2', current: false, createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-03T08:00:00.000Z', userAgent: 'Safari on iPhone', ip: '10.0.0.2' },
      ],
      ...over,
    },
  });

describe('custodian security page (FR-AUTH-018)', () => {
  it('lists active sessions, marks this browser and signs another one out', async () => {
    const api = mockApi({ ...shellRoutes(), [`GET ${SEC}`]: data(), [`POST ${SEC}/sessions/s2/revoke`]: raw({ data: { ok: true } }) });
    const { user } = renderPortal(<SecurityPage />);
    const row = (await screen.findByText('Safari on iPhone')).closest('tr')!;
    expect(screen.getByText('(this browser)')).toBeInTheDocument();
    expect(within(screen.getByText('Chrome on Windows').closest('tr')!).queryByRole('button', { name: 'Sign out' })).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expectCalled(api, `POST ${SEC}/sessions/s2/revoke`));
    expect(await screen.findByText('Session signed out.')).toBeInTheDocument();
  });

  it('enrols an authenticator: shows the key, rejects a short code locally, then shows backup codes once', async () => {
    let enrolled = false;
    const codes = Array.from({ length: 10 }, (_, i) => `abcd${i}-5678${i}`);
    const api = mockApi({
      ...shellRoutes(),
      [`GET ${SEC}`]: () => data(enrolled ? { mfa: { enrolled: true, enrolledAt: '2026-10-04T00:00:00.000Z', required: false, backupCodesRemaining: 10 } } : {}),
      'POST /api/v1/auth/mfa/enroll': raw({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }),
      'POST /api/v1/auth/mfa/verify': () => {
        enrolled = true;
        return raw({ user: {} });
      },
      [`POST ${SEC}/mfa/backup-codes`]: raw({ data: { codes, count: 10 } }),
    });
    const { user } = renderPortal(<SecurityPage />);
    await user.click(await screen.findByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    await user.click(screen.getByLabelText(/^Authentication code/));
    await user.paste('12');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));
    expect(await screen.findByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument();
    expectNotCalled(api, 'POST /api/v1/auth/mfa/verify');
    await user.clear(screen.getByLabelText(/^Authentication code/));
    await user.paste('123456');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));
    const shown = await screen.findByTestId('backup-codes');
    expect(within(shown).getAllByRole('listitem')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: 'I have saved them' }));
    expect(screen.queryByTestId('backup-codes')).toBeNull();
  });

  it('new backup codes need a fresh authentication code first', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `ffff${i}-0000${i}`);
    const api = mockApi({
      ...shellRoutes(),
      [`GET ${SEC}`]: data({ mfa: { enrolled: true, enrolledAt: '2026-10-01T00:00:00.000Z', required: false, backupCodesRemaining: 3 } }),
      'POST /api/v1/auth/mfa/step-up': raw({ ok: true, validForSeconds: 300 }),
      [`POST ${SEC}/mfa/backup-codes`]: raw({ data: { codes, count: 10 } }),
    });
    const { user } = renderPortal(<SecurityPage />);
    await user.click(await screen.findByRole('button', { name: 'Generate new backup codes' }));
    expect(await screen.findByText('Enter the 6-digit code from your authenticator app to confirm.')).toBeInTheDocument();
    expectNotCalled(api, `POST ${SEC}/mfa/backup-codes`);
    await user.click(screen.getByLabelText(/^Authentication code/));
    await user.paste('654321');
    await user.click(screen.getByRole('button', { name: 'Generate new backup codes' }));
    expect(await screen.findByTestId('backup-codes')).toBeInTheDocument();
    expect(expectCalled(api, 'POST /api/v1/auth/mfa/step-up')[0].body).toEqual({ code: '654321' });
  });

  it('changes the password, and shows the server message for a wrong current password', async () => {
    let n = 0;
    const api = mockApi({
      ...shellRoutes(),
      [`GET ${SEC}`]: data(),
      [`POST ${SEC}/password`]: () => (++n === 1 ? fail(400, 'invalid_current_password', 'Your current password is not correct') : raw({ data: { ok: true, otherSessionsRevoked: 1 } })),
    });
    const { user } = renderPortal(<SecurityPage />);
    await user.click(await screen.findByLabelText('Current password'));
    await user.paste('old-password-1');
    await user.click(screen.getByLabelText(/^New password/));
    await user.paste('a-new-password-1');
    await user.click(screen.getByLabelText('Repeat new password'));
    await user.paste('a-new-password-2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('The new passwords do not match.')).toBeInTheDocument();
    expectNotCalled(api, `POST ${SEC}/password`);
    await user.clear(screen.getByLabelText('Repeat new password'));
    await user.paste('a-new-password-1');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Your current password is not correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Password changed. Other sessions were signed out.')).toBeInTheDocument();
    expect(api.calls(`POST ${SEC}/password`)[1].body).toEqual({ currentPassword: 'old-password-1', newPassword: 'a-new-password-1' });
  });
});
