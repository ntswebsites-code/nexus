'use client';

import { useState } from 'react';
import { Card, Empty, Field, Loading, Notice, PageHead } from '@/components/ui';
import { auth, errorText, fmtDateTime, platform, useLoad } from '@/lib/api';

interface SecurityData {
  mfa: { enrolled: boolean; enrolledAt: string | null; required: boolean; backupCodesRemaining: number };
  sessions: { id: string; current: boolean; createdAt: string; lastUsedAt: string; userAgent: string | null; ip: string | null }[];
}

/** FR-AUTH-018: authenticator enrolment with backup codes, active sessions and password change for custodian users. */
export default function SecurityPage() {
  const sec = useLoad(async () => (await platform.get<{ data: SecurityData }>('/account/security')).data);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [stepCode, setStepCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setEnrol(await auth.post<{ secret: string; otpauthUri: string }>('/api/v1/auth/mfa/enroll', {})));
  const makeCodes = async () => setCodes((await platform.post<{ data: { codes: string[] } }>('/account/security/mfa/backup-codes', {})).data.codes);
  const confirm = () =>
    run(async () => {
      if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) throw new Error('Enter the 6-digit code from your authenticator app.');
      await auth.post('/api/v1/auth/mfa/verify', { code: code.replace(/\s+/g, '') });
      setEnrol(null);
      setCode('');
      setOk('Two-factor authentication is on.');
      await makeCodes();
      await sec.reload();
    });
  const regenerate = () =>
    run(async () => {
      if (!/^\d{6}$/.test(stepCode.replace(/\s+/g, ''))) throw new Error('Enter the 6-digit code from your authenticator app to confirm.');
      await auth.post('/api/v1/auth/mfa/step-up', { code: stepCode.replace(/\s+/g, '') });
      setStepCode('');
      await makeCodes();
      await sec.reload();
    });
  const revoke = (id: string) =>
    run(async () => {
      await platform.post(`/account/security/sessions/${id}/revoke`, {});
      setOk('Session signed out.');
      await sec.reload();
    });
  const revokeOthers = () =>
    run(async () => {
      await platform.post('/account/security/sessions/revoke-others', {});
      setOk('Other sessions signed out.');
      await sec.reload();
    });
  const changePassword = () =>
    run(async () => {
      if (pw.next.length < 10) throw new Error('Use at least 10 characters for the new password.');
      if (pw.next !== pw.again) throw new Error('The new passwords do not match.');
      await platform.post('/account/security/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', again: '' });
      setOk('Password changed. Other sessions were signed out.');
      await sec.reload();
    });

  const d = sec.data;
  return (
    <>
      <PageHead title="Security" sub="Two-factor authentication, signed-in devices and your password." />
      {err && <Notice kind="error">{err}</Notice>}
      {ok && <Notice kind="ok">{ok}</Notice>}
      <Loading loading={sec.loading && !d} error={sec.error} />
      {d && (
        <>
          <Card title="Two-factor authentication">
            {!d.mfa.enrolled && !enrol && (
              <p>
                <button type="button" className="cx-btn" disabled={busy} onClick={() => void start()}>
                  Set up authenticator app
                </button>
              </p>
            )}
            {enrol && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirm();
                }}
              >
                <p>Add this key to your authenticator app (manual entry, time-based), then enter the 6-digit code it shows.</p>
                <p>
                  <code data-testid="mfa-secret">{enrol.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                </p>
                <p>
                  <a href={enrol.otpauthUri}>Open in authenticator app</a>
                </p>
                <Field label="Authentication code">
                  <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
                </Field>
                <button type="submit" className="cx-btn" disabled={busy}>
                  Confirm and turn on
                </button>
              </form>
            )}
            {d.mfa.enrolled && (
              <>
                <p>
                  Enabled{d.mfa.enrolledAt ? ` on ${fmtDateTime(d.mfa.enrolledAt)}` : ''}. Backup codes left: <strong>{d.mfa.backupCodesRemaining}</strong>.
                </p>
                <Field label="Authentication code" hint="Needed to create new backup codes.">
                  <input value={stepCode} onChange={(e) => setStepCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
                </Field>
                <p>
                  <button type="button" className="cx-btn" disabled={busy} onClick={() => void regenerate()}>
                    Generate new backup codes
                  </button>
                </p>
              </>
            )}
            {codes && (
              <div data-testid="backup-codes">
                <p>
                  <strong>Save these backup codes now.</strong> Each works once if you lose your authenticator; they are not shown again.
                </p>
                <ul>
                  {codes.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
                <button type="button" className="cx-btn sm" onClick={() => setCodes(null)}>
                  I have saved them
                </button>
              </div>
            )}
          </Card>

          <Card
            title="Active sessions"
            actions={
              <button type="button" className="cx-btn sm" disabled={busy || d.sessions.every((s) => s.current)} onClick={() => void revokeOthers()}>
                Sign out other sessions
              </button>
            }
          >
            {d.sessions.length === 0 && <Empty>No active sessions.</Empty>}
            {d.sessions.length > 0 && (
              <div className="cx-table-wrap">
                <table className="cx-table">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>IP address</th>
                      <th>Last active</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.sessions.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.userAgent ?? 'Unknown device'} {s.current && <strong>(this browser)</strong>}
                        </td>
                        <td>{s.ip ?? 'Unknown'}</td>
                        <td>{fmtDateTime(s.lastUsedAt)}</td>
                        <td>
                          {!s.current && (
                            <button type="button" className="cx-btn sm" disabled={busy} onClick={() => void revoke(s.id)}>
                              Sign out
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Change password">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void changePassword();
              }}
            >
              <Field label="Current password">
                <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </Field>
              <Field label="New password" hint="At least 10 characters. Changing it signs you out everywhere else.">
                <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </Field>
              <Field label="Repeat new password">
                <input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
              </Field>
              <button type="submit" className="cx-btn" disabled={busy || !pw.current}>
                Change password
              </button>
            </form>
          </Card>
        </>
      )}
    </>
  );
}
