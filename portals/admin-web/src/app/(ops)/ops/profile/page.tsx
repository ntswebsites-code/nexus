'use client';

import { useState, type FormEvent } from 'react';
import { api, apiRequest, describeError, v1 } from '@/ops/api';
import { Alert, Card, DefinitionList, Field, FieldGrid, Loaded, PageHeader, formatDateTime, useAction, useResource } from '@/ops/ui';
import { StatusBadge } from '@/ops/ui';

interface Me {
  id: string;
  name: string | null;
  email: string;
  roles: { key: string; label: string }[];
  permissions: string[];
  lastLoginAt: string | null;
  memberSince: string | null;
  mfa: { enrolled: boolean; enrolledAt: string | null; required: boolean };
  roleFocus: string | null;
  sessions: { id: string; current: boolean; createdAt: string; lastUsedAt: string; expiresAt: string; userAgent: string | null; ip: string | null }[];
}

/** Self-service profile (SRD 5A.30): name, authenticator enrolment, password change and active sessions. */
export default function ProfilePage() {
  const res = useResource(() => api.get<Me>(v1('/shell/me')) as unknown as Promise<Me>, []);
  return (
    <>
      <PageHeader kicker="Account" title="My profile and security" subtitle="Your sign-in, second factor and active sessions." />
      <Loaded res={res} what="your profile">
        {(me) => (
          <>
            <Account me={me} onChanged={res.reload} />
            <Mfa me={me} onChanged={res.reload} />
            <Password onChanged={res.reload} />
            <Sessions me={me} onChanged={res.reload} />
          </>
        )}
      </Loaded>
    </>
  );
}

function Account({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [name, setName] = useState(me.name ?? '');
  const action = useAction();
  const [saved, setSaved] = useState(false);
  return (
    <Card title="Account">
        <DefinitionList
          items={[
            ['Email', me.email],
            ['Roles', me.roles.map((r) => r.label).join(', ') || '—'],
            ['Member since', formatDateTime(me.memberSince)],
            ['Last sign-in', formatDateTime(me.lastLoginAt)],
          ]}
        />
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setSaved(false);
            const ok = await action.run(async () => api.put(v1('/shell/me'), { name }).then(() => true));
            if (ok) {
              setSaved(true);
              onChanged();
            }
          }}
        >
          <FieldGrid>
            <Field label="Display name">
              <input className="ops-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </Field>
          </FieldGrid>
          <button className="ops-btn primary" type="submit" disabled={action.busy || name.trim() === (me.name ?? '')}>
            Save name
          </button>
          {saved && <span className="ops-muted"> Saved.</span>}
          <Alert>{action.error}</Alert>
        </form>
    </Card>
  );
}

function Mfa({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const start = useAction();
  const verify = useAction();
  return (
    <Card title="Two-factor authentication">
        <p>
          Status: <StatusBadge status={me.mfa.enrolled ? 'Enrolled' : me.mfa.required ? 'Required, not enrolled' : 'Not enrolled'} />
          {me.mfa.enrolledAt && <span className="ops-muted"> since {formatDateTime(me.mfa.enrolledAt)}</span>}
        </p>
        {!me.mfa.enrolled && !setup && (
          <>
            <p className="ops-muted">An authenticator app (Microsoft Authenticator, Google Authenticator, 1Password) is needed to approve money movements and access changes.</p>
            <button
              className="ops-btn primary"
              type="button"
              disabled={start.busy}
              onClick={async () => {
                const r = await start.run(() => apiRequest<{ secret: string; otpauthUri: string }>('POST', '/api/auth/mfa/enroll', {}));
                if (r) setSetup(r);
              }}
            >
              Set up authenticator
            </button>
            <Alert>{start.error}</Alert>
          </>
        )}
        {!me.mfa.enrolled && setup && (
          <form
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              const ok = await verify.run(() => apiRequest('POST', '/api/auth/mfa/verify', { code }).then(() => true));
              if (ok) {
                setSetup(null);
                setCode('');
                onChanged();
              }
            }}
          >
            <p>Add this account to your authenticator app, then enter the 6-digit code it shows.</p>
            <DefinitionList items={[['Setup key', <code key="s">{setup.secret}</code>], ['Setup link', <a key="u" href={setup.otpauthUri}>Open in authenticator</a>]]} />
            <FieldGrid>
              <Field label="6-digit code">
                <input className="ops-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              </Field>
            </FieldGrid>
            <button className="ops-btn primary" type="submit" disabled={verify.busy || code.length !== 6}>
              Confirm and turn on
            </button>
            <Alert>{verify.error}</Alert>
          </form>
        )}
        {me.mfa.enrolled && <p className="ops-muted">To move to a new phone or if you lose your device, ask a System Administrator to reset your second factor; you will enrol again at your next sign-in.</p>}
    </Card>
  );
}

function Password({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const action = useAction();
  const [done, setDone] = useState<number | null>(null);
  const mismatch = again !== '' && again !== next;
  return (
    <Card title="Change password">
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setDone(null);
            const r = await action.run((key) => api.post<{ otherSessionsRevoked: number }>(v1('/shell/me/password'), { currentPassword: current, newPassword: next }, { idempotencyKey: key }));
            if (r) {
              setDone(r.otherSessionsRevoked);
              setCurrent('');
              setNext('');
              setAgain('');
              onChanged();
            }
          }}
        >
          <FieldGrid>
            <Field label="Current password">
              <input className="ops-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              <input className="ops-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={10} required />
            </Field>
            <Field label="Repeat new password" hint={mismatch ? 'The passwords do not match.' : undefined}>
              <input className="ops-input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            </Field>
          </FieldGrid>
          <button className="ops-btn primary" type="submit" disabled={action.busy || mismatch || !current || next.length < 10}>
            Change password
          </button>
          {done !== null && <Alert kind="ok">Password changed. {done} other session{done === 1 ? '' : 's'} signed out.</Alert>}
          <Alert>{action.error}</Alert>
        </form>
    </Card>
  );
}

function Sessions({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError('');
      onChanged();
    } catch (e) {
      setError(describeError(e));
    }
  };
  return (
    <Card
      title="Active sessions"
      actions={
        <button className="ops-btn small" type="button" disabled={me.sessions.length < 2} onClick={() => void run(() => api.post(v1('/shell/me/sessions/revoke-others'), {}))}>
          Sign out all other sessions
        </button>
      }
    >
      <Alert>{error}</Alert>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Started</th>
              <th>Last used</th>
              <th>Address</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {me.sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {(s.userAgent ?? 'Unknown device').slice(0, 70)} {s.current && <StatusBadge status="This browser" />}
                </td>
                <td>{formatDateTime(s.createdAt)}</td>
                <td>{formatDateTime(s.lastUsedAt)}</td>
                <td>{s.ip ?? '—'}</td>
                <td className="r">
                  {!s.current && (
                    <button className="ops-btn small" type="button" onClick={() => void run(() => apiRequest('DELETE', v1(`/shell/me/sessions/${s.id}`)))}>
                      Sign out
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
