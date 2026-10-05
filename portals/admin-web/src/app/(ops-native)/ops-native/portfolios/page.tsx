'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, apiRequest, describeError, qs, v1 } from '@/ops/api';
import { createPortfolio } from '@/ops/portfolio-evidence';
import { formatDecimal } from '@/ops/money';
import { Tile } from '@/ops/rp';
import { useCan } from '@/ops/session';
import type { PortfolioSnapshot, PortfolioSummary } from '@/ops/types';
import { Alert, Card, Empty, Field, FieldGrid, FormModal, Loaded, Money, PageHeader, StatusBadge, str, useResource } from '@/ops/ui';

const RISKS = ['LOW', 'MODERATE', 'HIGH'] as const;
const riskText = (r?: string | null) => (r ? r.charAt(0) + r.slice(1).toLowerCase() : '—');

type Row = PortfolioSummary & { strategy?: string | null; riskProfile?: string | null; managerUserId?: string | null; stalePrices?: number };
interface Kpis {
  currency: string;
  portfolios: number;
  totalAum: string;
  fxMissing: string[];
  weightedTwrPct: string | null;
  twrCoverage: { portfolios: number; of: number; aumPct: string };
  openBreaches: number;
}
interface Listing {
  data: Row[];
  total: number;
  kpis?: Kpis;
}
interface Facets {
  strategies: string[];
  riskProfiles: string[];
  managers: { id: string; name: string }[];
}
interface Filters {
  q: string;
  currency: string;
  status: string;
  strategy: string;
  riskProfile: string;
  managerId: string;
}
interface SavedView {
  id: string;
  name: string;
  isDefault: boolean;
  config: Partial<Filters>;
}
const NO_FILTERS: Filters = { q: '', currency: '', status: '', strategy: '', riskProfile: '', managerId: '' };

export default function PortfoliosPage() {
  const router = useRouter();
  const canManage = useCan('portfolio.manage');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewId, setViewId] = useState('');
  const [views, setViews] = useState<SavedView[]>([]);
  const [facets, setFacets] = useState<Facets>({ strategies: [], riskProfiles: [], managers: [] });
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const set = (k: keyof Filters) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const rows = useResource<Listing>(() => apiRequest<Listing>('GET', v1(`/portfolios${qs({ ...f, kpis: '1' })}`)), [f.q, f.currency, f.status, f.strategy, f.riskProfile, f.managerId]);

  // Filter choices, and the user's saved views (a default view is applied once, when the page opens).
  const loadViews = () => api.get<SavedView[]>(v1('/views?scope=portfolio.list')).then((v) => setViews(v ?? []));
  useEffect(() => {
    let alive = true;
    api
      .get<Facets>(v1('/portfolios/facets'))
      .then((x) => alive && x && setFacets(x))
      .catch(() => undefined);
    api
      .get<SavedView[]>(v1('/views?scope=portfolio.list'))
      .then((v) => {
        if (!alive) return;
        setViews(v ?? []);
        const def = v?.find((x) => x.isDefault);
        if (def) {
          setViewId(def.id);
          setF({ ...NO_FILTERS, ...def.config });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const applyView = (id: string) => {
    setViewId(id);
    const v = views.find((x) => x.id === id);
    setF(v ? { ...NO_FILTERS, ...v.config } : NO_FILTERS);
  };
  const active = Object.values(f).some(Boolean);
  const removeView = async () => {
    const v = views.find((x) => x.id === viewId);
    if (!v) return;
    try {
      await apiRequest('DELETE', v1(`/views/${encodeURIComponent(v.id)}`));
      setViewId('');
      setNote({ kind: 'ok', text: `Deleted the saved view "${v.name}".` });
      await loadViews();
    } catch (e) {
      setNote({ kind: 'error', text: describeError(e) });
    }
  };

  return (
    <>
      <PageHeader
        kicker="Portfolio"
        title="Portfolios"
        subtitle="Managed portfolios and mandates, valued at the latest prices in each portfolio's base currency."
        actions={
          canManage && (
            <button className="ops-btn primary" type="button" onClick={() => setCreating(true)}>
              New portfolio
            </button>
          )
        }
      />
      {note && <Alert kind={note.kind === 'ok' ? 'ok' : 'error'}>{note.text}</Alert>}
      {rows.state === 'ok' && rows.data.kpis && (
        <div className="ops-tiles" aria-label="Summary of the portfolios shown">
          <Tile label="Total AUM" value={`${rows.data.kpis.currency} ${formatDecimal(rows.data.kpis.totalAum, 2)}`} hint={rows.data.kpis.fxMissing.length ? `Excludes ${rows.data.kpis.fxMissing.join(', ')}: no FX rate to ${rows.data.kpis.currency}` : `Sum of the ${rows.data.kpis.portfolios} portfolio(s) listed, converted to ${rows.data.kpis.currency}`} />
          <Tile
            label="Weighted TWR"
            value={rows.data.kpis.weightedTwrPct === null ? '—' : `${Number(rows.data.kpis.weightedTwrPct) > 0 ? '+' : ''}${formatDecimal(rows.data.kpis.weightedTwrPct, 2)}%`}
            hint={rows.data.kpis.weightedTwrPct === null ? 'No locked performance period for these portfolios' : `AUM-weighted, latest locked period · ${rows.data.kpis.twrCoverage.portfolios} of ${rows.data.kpis.twrCoverage.of} portfolio(s) (${formatDecimal(rows.data.kpis.twrCoverage.aumPct, 0)}% of AUM)`}
          />
          <Tile label="Open breaches" value={String(rows.data.kpis.openBreaches)} hint="Open limit breaches on the portfolios listed" onClick={rows.data.kpis.openBreaches ? () => router.push('/ops-native/risk') : undefined} />
        </div>
      )}
      <Card>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input className="ops-input" placeholder="Search name, ref or benchmark" value={f.q} onChange={(e) => set('q')(e.target.value)} style={{ maxWidth: 280 }} />
          <select className="ops-input" aria-label="Currency" value={f.currency} onChange={(e) => set('currency')(e.target.value)} style={{ maxWidth: 140 }}>
            <option value="">All currencies</option>
            <option value="USD">USD</option>
            <option value="ZWG">ZWG</option>
            <option value="ZAR">ZAR</option>
          </select>
          <select className="ops-input" aria-label="Status" value={f.status} onChange={(e) => set('status')(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All statuses</option>
            {['Setup', 'Active', 'Suspended', 'Closed'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="ops-input" aria-label="Strategy" value={f.strategy} onChange={(e) => set('strategy')(e.target.value)} style={{ maxWidth: 170 }}>
            <option value="">All strategies</option>
            {[...new Set([...facets.strategies, ...(f.strategy ? [f.strategy] : [])])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="ops-input" aria-label="Risk profile" value={f.riskProfile} onChange={(e) => set('riskProfile')(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All risk levels</option>
            {RISKS.map((r) => (
              <option key={r} value={r}>
                {riskText(r)} risk
              </option>
            ))}
          </select>
          <select className="ops-input" aria-label="Manager" value={f.managerId} onChange={(e) => set('managerId')(e.target.value)} style={{ maxWidth: 190 }}>
            <option value="">All managers</option>
            {facets.managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="ops-input" aria-label="Saved views" value={viewId} onChange={(e) => applyView(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Saved views{views.length ? '' : ' (none yet)'}</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <button className="ops-btn" type="button" disabled={!active} title={active ? 'Keep these filters as a named view' : 'Set a filter first'} onClick={() => setSaving(true)}>
            Save view
          </button>
          {viewId && (
            <button className="ops-btn" type="button" onClick={removeView}>
              Delete view
            </button>
          )}
          {active && (
            <button className="ops-btn" type="button" onClick={() => { setF(NO_FILTERS); setViewId(''); }}>
              Clear filters
            </button>
          )}
          {rows.state === 'ok' && (
            <span className="ops-muted" role="status" style={{ marginLeft: 'auto' }}>
              {rows.data.data.length} portfolio{rows.data.data.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <Loaded res={rows} what="portfolios">
          {(res) =>
            res.data.length === 0 ? (
              <Empty>No portfolios match.</Empty>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Portfolio</th>
                      <th>Type</th>
                      <th>Strategy</th>
                      <th>Risk</th>
                      <th>Ccy</th>
                      <th className="r">Market value</th>
                      <th className="r">Cash %</th>
                      <th className="r">Positions</th>
                      <th>Largest position</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.data.map((p) => {
                      const limit = p.mandate.maxSingleNamePct;
                      const over = limit !== undefined && Number(p.largestPositionPct) > limit;
                      return (
                        <tr key={p.id} className="clickable" onClick={() => router.push(`/ops-native/portfolios/${encodeURIComponent(p.id)}`)}>
                          <td>
                            <strong>{p.name}</strong>
                            <span className="ops-sub">{p.ref}</span>
                          </td>
                          <td>{p.type}</td>
                          <td>{p.strategy ?? '—'}</td>
                          <td>{riskText(p.riskProfile)}</td>
                          <td>{p.baseCurrency}</td>
                          <td className="r">
                            <Money value={p.marketValueBase} currency={p.baseCurrency} />
                            {p.warnings > 0 && <span className="ops-sub">{p.warnings} unvalued</span>}
                            {(p.stalePrices ?? 0) > 0 && <span className="ops-sub">{p.stalePrices} stale price{p.stalePrices === 1 ? '' : 's'}</span>}
                          </td>
                          <td className="r">{formatDecimal(p.cashPct, 1)}%</td>
                          <td className="r">{p.positionCount}</td>
                          <td>
                            {p.largestPositionTicker ?? '—'}
                            {p.largestPositionTicker && (
                              <span className="ops-sub">
                                {formatDecimal(p.largestPositionPct, 1)}%{limit !== undefined ? ` of ${limit}% mandate limit${over ? ' (over)' : ''}` : ''}
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={p.status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loaded>
      </Card>
      {saving && (
        <FormModal
          kicker="Portfolio"
          title="Save view"
          subtitle="Keeps the filters now applied. Only you can see your views."
          submitLabel="Save view"
          onClose={() => setSaving(false)}
          onSubmit={(fd) =>
            api.put<SavedView>(v1('/views'), {
              scope: 'portfolio.list',
              name: str(fd, 'name'),
              isDefault: fd.get('isDefault') === 'on',
              config: Object.fromEntries(Object.entries(f).filter(([, v]) => v)),
            })
          }
          onDone={(r) => {
            const v = r as SavedView | undefined;
            if (v) setViewId(v.id);
            setNote({ kind: 'ok', text: `Saved the view "${v?.name ?? ''}".` });
            void loadViews();
          }}
        >
          <Field label="View name">
            <input className="ops-input" name="name" required maxLength={80} placeholder="High-risk growth" />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" name="isDefault" /> Open the page with this view
          </label>
        </FormModal>
      )}
      {creating && (
        <FormModal
          kicker="Portfolio"
          title="New portfolio"
          subtitle="A portfolio created in Setup raises its activation steps in Operations; activate it from its page once they are done."
          submitLabel="Create portfolio"
          onClose={() => setCreating(false)}
          onSubmit={(fd, key) => createPortfolio(fd, key)}
          onDone={(r) => {
            const id = (r as PortfolioSnapshot | undefined)?.portfolio?.id;
            if (id) router.push(`/ops-native/portfolios/${encodeURIComponent(id)}`);
            else rows.reload();
          }}
        >
          <FieldGrid>
            <Field label="Name" span={2}>
              <input className="ops-input" name="name" required minLength={2} maxLength={160} />
            </Field>
            <Field label="Type">
              <input className="ops-input" name="type" required maxLength={64} defaultValue="Balanced Fund" />
            </Field>
            <Field label="Base currency">
              <input className="ops-input" name="baseCurrency" required minLength={3} maxLength={3} defaultValue="USD" style={{ textTransform: 'uppercase' }} />
            </Field>
            <Field label="Strategy" hint="Balanced, Growth, Income...">
              <input className="ops-input" name="strategy" maxLength={40} list="portfolio-strategies" />
              <datalist id="portfolio-strategies">
                {facets.strategies.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Risk profile">
              <select className="ops-input" name="riskProfile" defaultValue="">
                <option value="">Not set</option>
                {RISKS.map((r) => (
                  <option key={r} value={r}>
                    {riskText(r)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Opening status" hint="Setup raises activation tasks; Active is ready to trade">
              <select className="ops-input" name="status" defaultValue="Setup">
                <option value="Setup">Setup</option>
                <option value="Active">Active</option>
              </select>
            </Field>
            <Field label="Benchmark">
              <input className="ops-input" name="benchmark" maxLength={160} />
            </Field>
            <Field label="Max single name %">
              <input className="ops-input" name="maxSingleNamePct" type="number" step="0.01" min={0.01} max={100} />
            </Field>
            <Field label="Max sector %">
              <input className="ops-input" name="maxSectorPct" type="number" step="0.01" min={0.01} max={100} />
            </Field>
            <Field label="Cash floor %">
              <input className="ops-input" name="cashFloorPct" type="number" step="0.01" min={0} max={100} />
            </Field>
            <Field label="Max cash %">
              <input className="ops-input" name="maxCashPct" type="number" step="0.01" min={0} max={100} />
            </Field>
            <Field label="Evidence file" hint="Mandate or approval document; stored in the document vault">
              <input className="ops-input" name="evidence" type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv,.txt" />
            </Field>
            <Field label="Evidence is">
              <select className="ops-input" name="evidenceKind" defaultValue="MANDATE">
                <option value="MANDATE">Mandate</option>
                <option value="APPROVAL">Approval</option>
                <option value="KYC">KYC</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
