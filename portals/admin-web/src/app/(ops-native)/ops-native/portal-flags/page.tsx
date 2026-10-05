'use client';

import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { Badge } from '@/ops/admin-core';
import { useCan } from '@/ops/session';
import { Alert, Card, Field, FieldGrid, formatDateTime, Loaded, PageHeader, useAction, useResource } from '@/ops/ui';

/**
 * Portal flags and demo-mode switches (build-plan S26). Each portal domain is live (calls the API) or demo (shows the
 * "Demo data" ribbon). The environment sets the default; a switch here overrides it without a restart, and the master
 * demo switch forces every portal to demo data. Permission admin.settings, step-up MFA, reason recorded.
 */
interface Flags {
  lp: Record<string, boolean>;
  investee: { liveActions: string[] };
  custodian: { live: boolean };
  onboarding: { live: boolean };
}
interface Overrides {
  demoMode: boolean;
  lp: Record<string, boolean>;
  investeeLiveActions: string[] | null;
  custodianLive: boolean | null;
  onboardingLive: boolean | null;
}
interface Payload {
  env: Flags;
  overrides: Overrides;
  effective: Flags;
  version: number;
  updatedAt: string | null;
  lpDomains: string[];
}

type Tri = 'env' | 'live' | 'demo';
const toTri = (v: boolean | null | undefined): Tri => (v === true ? 'live' : v === false ? 'demo' : 'env');
const fromTri = (t: Tri): boolean | null => (t === 'live' ? true : t === 'demo' ? false : null);

const label = (live: boolean) => <Badge tone={live ? 'green' : 'amber'}>{live ? 'live' : 'demo'}</Badge>;

export default function PortalFlagsPage() {
  const can = useCan('admin.settings');
  const res = useResource<Payload>(() => api.get<Payload>(v1('/platform/flags/admin')), []);
  if (!can) {
    return (
      <>
        <PageHeader kicker="Administration" title="Portal flags" />
        <Alert>Your role does not include platform settings. Ask a System Administrator for the admin.settings permission.</Alert>
      </>
    );
  }
  return (
    <>
      <PageHeader kicker="Administration" title="Portal flags" subtitle="Choose which portal areas serve live data and which show demo data. The environment value is the default; a switch here overrides it at once, without a restart." />
      <Loaded res={res} what="portal flags">
        {(p) => <Editor key={p.version} p={p} onSaved={res.reload} />}
      </Loaded>
    </>
  );
}

function Editor({ p, onSaved }: { p: Payload; onSaved: () => void }) {
  const [demo, setDemo] = useState(p.overrides.demoMode);
  const [lp, setLp] = useState<Record<string, Tri>>(() => Object.fromEntries(p.lpDomains.map((d) => [d, toTri(p.overrides.lp[d])])));
  const [custodian, setCustodian] = useState<Tri>(toTri(p.overrides.custodianLive));
  const [onboarding, setOnboarding] = useState<Tri>(toTri(p.overrides.onboardingLive));
  const [investee, setInvestee] = useState(p.overrides.investeeLiveActions === null ? '' : p.overrides.investeeLiveActions.join(', '));
  const [useEnvInvestee, setUseEnvInvestee] = useState(p.overrides.investeeLiveActions === null);
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState('');
  const act = useAction();

  const save = () =>
    act.run(async (key) => {
      const lpBody: Record<string, boolean> = {};
      for (const [d, t] of Object.entries(lp)) if (t !== 'env') lpBody[d] = t === 'live';
      await api.put(
        v1('/platform/flags/admin'),
        {
          demoMode: demo,
          lp: lpBody,
          investeeLiveActions: useEnvInvestee ? null : investee.split(/[\s,]+/).filter(Boolean),
          custodianLive: fromTri(custodian),
          onboardingLive: fromTri(onboarding),
          reason,
          version: p.version,
        },
        { idempotencyKey: key },
      );
      setOk('Portal flags saved. Portals pick the change up on their next load.');
      onSaved();
    });

  const triSelect = (v: Tri, set: (t: Tri) => void, name: string) => (
    <select className="ops-input" aria-label={name} value={v} onChange={(e) => set(e.target.value as Tri)} disabled={demo}>
      <option value="env">Use environment</option>
      <option value="live">Live</option>
      <option value="demo">Demo data</option>
    </select>
  );

  return (
    <>
      <Alert kind="ok">{ok}</Alert>
      <Alert>{act.error}</Alert>
      <Card title="Demo mode">
        <label>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> Force every portal to demo data
        </label>
        <p className="ops-muted">When on, investors, investees, custodians and applicants see the "Demo data" ribbon and nothing calls the live API for data, whatever the settings below say.{p.updatedAt ? ` Last changed ${formatDateTime(p.updatedAt)}.` : ''}</p>
      </Card>
      <Card title="Investor portal areas">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Area</th>
              <th>Environment</th>
              <th>Override</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            {p.lpDomains.map((d) => (
              <tr key={d}>
                <td>{d}</td>
                <td>{label(p.env.lp[d] ?? false)}</td>
                <td>{triSelect(lp[d] ?? 'env', (t) => setLp({ ...lp, [d]: t }), `${d} override`)}</td>
                <td>{label(demo ? false : lp[d] === 'live' ? true : lp[d] === 'demo' ? false : (p.env.lp[d] ?? false))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Other portals">
        <FieldGrid>
          <Field label={`Custodian portal (environment: ${p.env.custodian.live ? 'live' : 'demo'})`}>{triSelect(custodian, setCustodian, 'custodian override')}</Field>
          <Field label={`Onboarding portal (environment: ${p.env.onboarding.live ? 'live' : 'demo'})`}>{triSelect(onboarding, setOnboarding, 'onboarding override')}</Field>
          <Field label={`Investee live actions (environment: ${p.env.investee.liveActions.join(', ') || 'none'})`}>
            <label>
              <input type="checkbox" checked={useEnvInvestee} onChange={(e) => setUseEnvInvestee(e.target.checked)} disabled={demo} /> Use environment list
            </label>
            <input className="ops-input" value={investee} onChange={(e) => setInvestee(e.target.value)} disabled={demo || useEnvInvestee} placeholder="action, action" aria-label="Investee live actions" />
          </Field>
        </FieldGrid>
      </Card>
      <Card title="Save">
        <Field label="Reason (recorded in the audit trail)">
          <input className="ops-input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} />
        </Field>
        <button className="ops-btn primary" type="button" disabled={act.busy || reason.trim().length < 3} onClick={() => void save()}>
          {act.busy ? 'Saving...' : 'Save flags'}
        </button>
      </Card>
    </>
  );
}
