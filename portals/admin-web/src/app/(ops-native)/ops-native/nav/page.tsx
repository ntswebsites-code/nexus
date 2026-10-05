'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, apiRequest, qs, v1 } from '@/ops/api';
import { NavStatusBadge, NAV_STATUS_LABEL, money2, nav4, pct4, type NavDetail, type NavList } from '@/ops/nav';
import { NavHistoryModal, NavPolicyModal } from '@/ops/nav-depth';
import { useCan } from '@/ops/session';
import type { PortfolioSummary } from '@/ops/types';
import { Card, Empty, Field, FieldGrid, FormModal, formatDate, Loaded, PageHeader, optStr, str, useResource } from '@/ops/ui';

const PAGE = 25;
const STATUSES = ['DRAFT', 'EXCEPTIONS_OPEN', 'MAKER_REVIEWED', 'RELEASED', 'SUPERSEDED'];
const today = () => new Date().toISOString().slice(0, 10);

function Tile({ label, value, hint, onClick, active }: { label: string; value: string; hint?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', borderColor: active ? 'var(--ops-blue)' : undefined }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}

export default function NavRunsPage() {
  const router = useRouter();
  // Preparing a run needs valuation.run on top of the read permission (FR-VAL-009).
  const canView = useCan('valuation.view');
  const canRunPerm = useCan('valuation.run');
  const canRun = canView && canRunPerm;
  const [panel, setPanel] = useState<'history' | 'policy' | null>(null);
  const [portfolioId, setPortfolioId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);

  const portfolios = useResource<PortfolioSummary[]>(() => api.get<PortfolioSummary[]>(v1('/portfolios')), []);
  const runs = useResource<NavList>(
    () => apiRequest<NavList>('GET', v1(`/nav/runs${qs({ portfolioId, status, from, to, limit: String(PAGE), offset: String(offset) })}`)),
    [portfolioId, status, from, to, offset],
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    setOffset(0);
    set(v);
  };

  return (
    <>
      <PageHeader
        kicker="Valuation"
        title="NAV & valuation"
        subtitle="Daily NAV runs: valued from positions, cash, prices and FX, checked for exceptions, maker reviewed and released by a second person."
        actions={
          <>
            <button className="ops-btn" type="button" onClick={() => setPanel('history')}>
              NAV history
            </button>
            <button className="ops-btn" type="button" onClick={() => setPanel('policy')}>
              Valuation policy
            </button>
            {canRun && (
              <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
                New NAV run
              </button>
            )}
          </>
        }
      />

      {panel === 'history' && <NavHistoryModal portfolioId={portfolioId} onClose={() => setPanel(null)} />}
      {panel === 'policy' && <NavPolicyModal onClose={() => setPanel(null)} />}

      <Loaded res={runs} what="NAV runs">
        {(list) => (
          <>
            <div className="ops-tiles">
              <Tile label="Awaiting release" value={String(list.summary.awaitingRelease)} hint="Maker reviewed, needs a second person" onClick={() => filter(setStatus)('MAKER_REVIEWED')} active={status === 'MAKER_REVIEWED'} />
              <Tile label="Exceptions open" value={String(list.summary.openExceptions)} hint="Runs with price or cash exceptions" onClick={() => filter(setStatus)('EXCEPTIONS_OPEN')} active={status === 'EXCEPTIONS_OPEN'} />
              <Tile label="Released" value={String(list.summary.released)} hint="Final NAVs" onClick={() => filter(setStatus)('RELEASED')} active={status === 'RELEASED'} />
            </div>

            <Card>
              <div className="ops-filters">
                <Field label="Portfolio">
                  <select className="ops-input" value={portfolioId} onChange={(e) => filter(setPortfolioId)(e.target.value)}>
                    <option value="">All portfolios</option>
                    {portfolios.state === 'ok' &&
                      portfolios.data.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.ref})
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select className="ops-input" value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {NAV_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="NAV date from">
                  <input className="ops-input" type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
                </Field>
                <Field label="NAV date to">
                  <input className="ops-input" type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
                </Field>
              </div>
              {list.data.length === 0 ? (
                <Empty>No NAV runs match these filters. Use New NAV run to value a portfolio.</Empty>
              ) : (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Portfolio</th>
                        <th>NAV date</th>
                        <th className="r">NAV</th>
                        <th className="r">NAV / unit</th>
                        <th className="r">Coverage</th>
                        <th className="r">Exceptions</th>
                        <th>Status</th>
                        <th>Prepared by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.data.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => router.push(`/ops-native/nav/${encodeURIComponent(r.id)}`)}>
                          <td>
                            <strong>{r.ref}</strong>
                            <span className="ops-sub">version {r.version}</span>
                          </td>
                          <td>
                            {r.portfolioName}
                            <span className="ops-sub">{r.fundName ?? r.portfolioRef}</span>
                          </td>
                          <td>{formatDate(r.navDate)}</td>
                          <td className="r">
                            {money2(r.nav)}
                            <span className="ops-sub">{r.baseCurrency}</span>
                          </td>
                          <td className="r">{nav4(r.navPerUnit)}</td>
                          <td className="r">{pct4(r.priceCoverage)}</td>
                          <td className="r">
                            {r.openExceptions}
                            {r.openMaterialExceptions > 0 && <span className="ops-sub">{r.openMaterialExceptions} material</span>}
                          </td>
                          <td>
                            <NavStatusBadge status={r.status} />
                          </td>
                          <td>{r.makerName ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="ops-actions" style={{ marginTop: 12, justifyContent: 'space-between' }}>
                <span className="ops-muted">
                  {list.total === 0 ? '0 runs' : `${offset + 1}–${Math.min(offset + PAGE, list.total)} of ${list.total}`}
                </span>
                <span>
                  <button className="ops-btn small" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Previous
                  </button>{' '}
                  <button className="ops-btn small" type="button" disabled={offset + PAGE >= list.total} onClick={() => setOffset(offset + PAGE)}>
                    Next
                  </button>
                </span>
              </div>
            </Card>
          </>
        )}
      </Loaded>

      {creating && (
        <FormModal
          title="New NAV run"
          kicker="Valuation"
          subtitle="Values the portfolio from its positions, cash, prices and FX at the date. Creating a run for a date that already has one makes a new version and supersedes unreleased drafts."
          submitLabel="Calculate NAV"
          wide
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) =>
            api.post<NavDetail>(
              v1('/nav/runs'),
              {
                portfolioId: str(fd, 'portfolioId'),
                navDate: str(fd, 'navDate'),
                ...numeric(fd, ['accruals', 'fees', 'liabilities']),
                ...(optStr(fd, 'units') ? { units: optStr(fd, 'units')!.replace(/,/g, '') } : {}),
                ...(optStr(fd, 'notes') ? { notes: optStr(fd, 'notes') } : {}),
              },
              { idempotencyKey: key },
            )
          }
          onDone={(r) => router.push(`/ops-native/nav/${encodeURIComponent((r as NavDetail).id)}`)}
        >
          <FieldGrid>
            <Field label="Portfolio" span={2}>
              <select className="ops-input" name="portfolioId" required defaultValue="">
                <option value="" disabled>
                  Choose a portfolio
                </option>
                {portfolios.state === 'ok' &&
                  portfolios.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.ref}, {p.baseCurrency})
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="NAV date">
              <input className="ops-input" type="date" name="navDate" required defaultValue={today()} max={today()} />
            </Field>
            <Field label="Units" hint="Fund units in issue. Leave blank to carry over the last run's units.">
              <input className="ops-input" name="units" inputMode="decimal" placeholder="Carry over" />
            </Field>
            <Field label="Accruals" hint="Optional; blank carries over">
              <input className="ops-input" name="accruals" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Fees" hint="Optional; blank carries over">
              <input className="ops-input" name="fees" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Liabilities" hint="Optional; blank carries over">
              <input className="ops-input" name="liabilities" inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Notes" span={2}>
              <textarea className="ops-input" name="notes" rows={2} maxLength={2000} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}

function numeric(fd: FormData, names: string[]) {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = optStr(fd, n);
    if (v) out[n] = v.replace(/,/g, '');
  }
  return out;
}
