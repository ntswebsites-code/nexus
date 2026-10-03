'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, v1 } from '@/ops/api';
import { EXCEPTION_LABEL, money2, NavStatusBadge, nav4, pct4, StageBar, units6, type NavDetail, type NavException, type NavPack } from '@/ops/nav';
import { useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Empty, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, Modal, optStr, PageHeader, str, useResource } from '@/ops/ui';

export default function NavRunPage() {
  const { id } = useParams<{ id: string }>();
  const run = useResource<NavDetail>(() => api.get<NavDetail>(v1(`/nav/runs/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/nav">← NAV &amp; valuation</Link>
      </p>
      <Loaded res={run} what="this NAV run">
        {(r) => <Detail run={r} reload={run.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'inputs' | 'pack' | { resolve: NavException } | null;

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' | 'ok' }) {
  return (
    <div className="ops-tile" style={tone === 'warn' ? { borderColor: 'var(--ops-amber)' } : undefined}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}

function Detail({ run: r, reload }: { run: NavDetail; reload: () => void }) {
  const router = useRouter();
  const { user } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const base = v1(`/nav/runs/${encodeURIComponent(r.id)}`);
  const close = () => setDialog(null);
  const done = () => {
    close();
    reload();
  };
  const immutable = r.status === 'RELEASED' || r.status === 'SUPERSEDED';
  const latest = r.versions[0];

  return (
    <>
      <PageHeader
        kicker={`NAV run · ${r.portfolioName ?? ''}`}
        title={
          <>
            {r.ref} <NavStatusBadge status={r.status} />
          </>
        }
        subtitle={
          <>
            {formatDate(r.navDate)} · version {r.version} · {r.baseCurrency}
            {r.fundName ? ` · fund ${r.fundName}` : ' · portfolio only (no linked fund)'}
          </>
        }
        actions={
          <>
            <button className="ops-btn" type="button" onClick={() => setDialog('pack')}>
              Preview pack
            </button>
            {r.allowed.editInputs && (
              <button className="ops-btn" type="button" onClick={() => setDialog('inputs')}>
                Edit inputs
              </button>
            )}
            {r.allowed.recalculate && (
              <ActionButton
                label="Recalculate"
                title="Values the book again as a new version and supersedes this one"
                onRun={(key) => api.post<NavDetail>(`${base}/recalculate`, {}, { idempotencyKey: key }).then((n) => router.push(`/ops/nav/${encodeURIComponent(n.id)}`))}
              />
            )}
            {(r.status === 'DRAFT' || r.status === 'EXCEPTIONS_OPEN') && (
              <ActionButton
                label="Maker review"
                primary
                disabled={!r.allowed.makerReview}
                title={r.allowed.makerReview ? 'Confirms you have reviewed this NAV and sends it for release' : r.allowed.makerReviewBlockers.join('. ')}
                confirm={`Confirm maker review of ${r.ref}? Someone else will then release it.`}
                onRun={(key) => api.post(`${base}/maker-review`, {}, { idempotencyKey: key }).catch((e: unknown) => { reload(); throw e; })}
                onDone={reload}
              />
            )}
            {r.status === 'MAKER_REVIEWED' && (
              <ActionButton
                label="Release NAV"
                primary
                disabled={!r.allowed.release}
                title={r.allowed.release ? 'Requires a fresh authenticator code' : (r.allowed.releaseBlocker ?? undefined)}
                confirm={`Release ${r.ref}? ${r.fundName ? `This publishes NAV per unit ${nav4(r.navPerUnit)} for ${r.fundName} to the LP portal. ` : ''}A released NAV cannot be edited.`}
                onRun={(key) => api.post(`${base}/release`, {}, { idempotencyKey: key }).catch((e: unknown) => { reload(); throw e; })}
                onDone={reload}
              />
            )}
          </>
        }
      />

      {r.status === 'SUPERSEDED' && (
        <Alert kind="warn">
          This version was superseded.{' '}
          {latest && latest.id !== r.id && (
            <>
              Latest for this date: <Link href={`/ops/nav/${latest.id}`}>{latest.ref} (version {latest.version})</Link>.
            </>
          )}
        </Alert>
      )}
      {r.status === 'RELEASED' && <Alert kind="ok">Released by {r.checkerName ?? 'a checker'} on {formatDateTime(r.releasedAt)}. This run is final and cannot be edited.</Alert>}
      {r.status === 'MAKER_REVIEWED' && (
        <Alert kind="info">
          Maker review by {r.reviewerName ?? 'someone'} done. {r.reviewerId === user.id ? 'You reviewed this NAV, so a different person with the release permission must release it.' : r.allowed.release ? 'You can release it (a fresh authenticator code is required).' : (r.allowed.releaseBlocker ?? '')}
        </Alert>
      )}
      {!immutable && r.allowed.makerReviewBlockers.length > 0 && r.status !== 'MAKER_REVIEWED' && <Alert kind="warn">Maker review is blocked: {r.allowed.makerReviewBlockers.join('; ')}.</Alert>}
      {r.priceCoverage !== '100.0000' && !immutable && <Alert kind="warn">Price coverage is {pct4(r.priceCoverage)}: some positions could not be valued, so the NAV excludes them.</Alert>}

      <StageBar stages={r.stageBar} />

      <div className="ops-tiles">
        <Tile label="Net asset value" value={money2(r.nav)} hint={r.baseCurrency} />
        <Tile label="NAV per unit" value={nav4(r.navPerUnit)} hint={r.navPerUnit ? 'NAV ÷ units, 4 dp' : 'Enter units to compute'} />
        <Tile label="Units" value={units6(r.units)} hint={r.fundName ? 'Fund units in issue' : 'Entered manually'} />
        <Tile label="Price coverage" value={pct4(r.priceCoverage)} hint={`${r.positionCount} positions`} tone={r.priceCoverage !== '100.0000' ? 'warn' : undefined} />
        <Tile label="Open exceptions" value={String(r.openExceptions)} hint={`${r.openMaterialExceptions} material`} tone={r.openMaterialExceptions > 0 ? 'warn' : undefined} />
      </div>

      <Card title="NAV bridge">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <tbody>
              {r.bridge.map((b, i) => (
                <tr key={b.key} style={i === r.bridge.length - 1 ? { fontWeight: 800 } : undefined}>
                  <td>
                    {b.sign === 1 ? '+ ' : b.sign === -1 ? '− ' : '= '}
                    {b.label}
                    {b.key === 'fees' && r.feeRatePct ? <span className="ops-sub">management fee {r.feeRatePct}% a year, accrued for one day</span> : null}
                  </td>
                  <td className="r">
                    {money2(b.amount)} {r.baseCurrency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Exceptions (${r.openExceptions} open of ${r.exceptions.length})`}
      >
        {r.exceptions.length === 0 ? (
          <Empty>No exceptions: every position has a current price and FX rate within tolerance.</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Detail</th>
                  <th className="r">Current</th>
                  <th className="r">Reference</th>
                  <th className="r">Difference</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.exceptions.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{EXCEPTION_LABEL[e.type] ?? e.type}</strong>
                      <span className="ops-sub">{e.material ? 'Material' : 'Not material'}</span>
                    </td>
                    <td>
                      {e.detail}
                      {e.status === 'RESOLVED' && (
                        <span className="ops-sub">
                          {e.resolution}
                          {e.evidenceRef ? ` · evidence ${e.evidenceRef}` : ''} · {e.resolvedByName ?? ''} {formatDateTime(e.resolvedAt)}
                        </span>
                      )}
                    </td>
                    <td className="r">{money2(e.currentValue)}</td>
                    <td className="r">{money2(e.referenceValue)}</td>
                    <td className="r">{money2(e.difference)}</td>
                    <td>
                      <span className={`ops-badge ${e.status === 'OPEN' ? (e.material ? 'red' : 'amber') : 'green'}`}>{e.status === 'OPEN' ? 'open' : 'resolved'}</span>
                    </td>
                    <td className="r">
                      {e.status === 'OPEN' && r.allowed.resolve && (
                        <button className="ops-btn small" type="button" onClick={() => setDialog({ resolve: e })}>
                          Resolve
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

      <Card title="Positions and prices">
        {r.lines.length === 0 ? (
          <Empty>The portfolio has no open positions at this date.</Empty>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th className="r">Quantity</th>
                  <th className="r">Price</th>
                  <th>Source</th>
                  <th>Price date</th>
                  <th className="r">FX</th>
                  <th className="r">Value ({r.baseCurrency})</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.ticker}</strong>
                      <span className="ops-sub">{l.name}</span>
                    </td>
                    <td className="r">{money2(l.quantity)}</td>
                    <td className="r">{l.price ? `${l.price} ${l.currency}` : '—'}</td>
                    <td>{l.priceSource ?? '—'}</td>
                    <td>{l.priceDate ? formatDate(l.priceDate) : '—'}</td>
                    <td className="r">{l.fxRate ?? '—'}</td>
                    <td className="r">{money2(l.valueBase)}</td>
                    <td>
                      {l.flags.length === 0 ? '—' : l.flags.map((f) => (
                        <span key={f} className="ops-badge amber" style={{ marginRight: 4 }}>
                          {(EXCEPTION_LABEL[f] ?? f).toLowerCase()}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Inputs and controls"
        actions={
          r.allowed.editInputs && (
            <button className="ops-btn small" type="button" onClick={() => setDialog('inputs')}>
              Edit inputs
            </button>
          )
        }
      >
        <DefinitionList
          items={[
            ['Accruals', `${money2(r.accruals)} ${r.baseCurrency}`],
            ['Fees', `${money2(r.fees)} ${r.baseCurrency}${r.feeRatePct ? ` (${r.feeRatePct}% a year)` : ''}`],
            ['Liabilities', `${money2(r.liabilities)} ${r.baseCurrency}`],
            ['Units', units6(r.units)],
            ['Prepared by', `${r.makerName ?? '—'} · ${formatDateTime(r.createdAt)}`],
            ['Maker review', r.reviewerName ? `${r.reviewerName} · ${formatDateTime(r.reviewedAt)}` : '—'],
            ['Released by', r.checkerName ? `${r.checkerName} · ${formatDateTime(r.releasedAt)}` : '—'],
            ['Notes', r.notes ?? '—'],
            ['Tolerances', r.settings ? `stale after ${r.settings.staleDays} days · price move ${r.settings.priceMovePct}% · material above ${r.settings.tolerancePct}% of position or ${r.settings.toleranceAbs.toLocaleString()}` : '—'],
          ]}
        />
      </Card>

      <Card title="Versions and history">
        <p className="ops-muted">
          Versions for {formatDate(r.navDate)}:{' '}
          {r.versions.map((v) => (
            <span key={v.id} style={{ marginRight: 10 }}>
              {v.id === r.id ? <strong>v{v.version}</strong> : <Link href={`/ops/nav/${v.id}`}>v{v.version}</Link>} <NavStatusBadge status={v.status} />
            </span>
          ))}
        </p>
        {r.timeline.length === 0 ? (
          <Empty>No history yet.</Empty>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.timeline.map((t, i) => (
              <li key={i}>
                <strong>{t.action.replace('nav.', '').replace(/_/g, ' ')}</strong> · {t.actor} · {formatDateTime(t.at)}
                {t.reason ? <span className="ops-sub">{t.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog === 'inputs' && <InputsDialog run={r} base={base} onClose={close} onDone={done} />}
      {dialog === 'pack' && <PackDialog base={base} onClose={close} />}
      {typeof dialog === 'object' && dialog && 'resolve' in dialog && <ResolveDialog exception={dialog.resolve} base={base} onClose={close} onDone={done} />}
    </>
  );
}

function ResolveDialog({ exception: e, base, onClose, onDone }: { exception: NavException; base: string; onClose: () => void; onDone: () => void }) {
  return (
    <FormModal
      title={`Resolve: ${EXCEPTION_LABEL[e.type] ?? e.type}`}
      kicker="Exception"
      subtitle={e.detail}
      submitLabel="Resolve exception"
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) => api.patch(`${base}/exceptions/${encodeURIComponent(e.id)}`, { resolution: str(fd, 'resolution'), ...(optStr(fd, 'evidenceRef') ? { evidenceRef: optStr(fd, 'evidenceRef') } : {}) })}
    >
      <FieldGrid>
        <Field label="Rationale" span={2} hint="Required, 5 or more characters. This is kept in the audit trail.">
          <textarea className="ops-input" name="resolution" rows={3} required minLength={5} maxLength={1000} />
        </Field>
        <Field label="Evidence reference" span={2} hint="Optional: a document ref, ticket or broker confirmation">
          <input className="ops-input" name="evidenceRef" maxLength={200} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}

function InputsDialog({ run: r, base, onClose, onDone }: { run: NavDetail; base: string; onClose: () => void; onDone: () => void }) {
  const clean = (v: string) => v.replace(/,/g, '');
  return (
    <FormModal
      title="Edit NAV inputs"
      kicker={r.ref}
      subtitle="Accruals, fees, liabilities and units feed the NAV bridge and NAV per unit. Set a fee rate to accrue the management fee as rate × NAV ÷ 365."
      submitLabel="Save inputs"
      wide
      onClose={onClose}
      onDone={onDone}
      onSubmit={(fd) => {
        const body: Record<string, string | null> = {};
        const set = (name: 'accruals' | 'liabilities', current: string) => {
          const v = clean(str(fd, name));
          if (v && Number(v) !== Number(current)) body[name] = v;
        };
        set('accruals', r.accruals);
        set('liabilities', r.liabilities);
        const rate = clean(str(fd, 'feeRatePct'));
        const fees = clean(str(fd, 'fees'));
        if (rate) {
          if (Number(rate) !== Number(r.feeRatePct ?? NaN)) body.feeRatePct = rate;
        } else if (r.feeRatePct) body.feeRatePct = null;
        if (!rate && fees && Number(fees) !== Number(r.fees)) body.fees = fees;
        const units = clean(str(fd, 'units'));
        if (units && Number(units) !== Number(r.units ?? NaN)) body.units = units;
        else if (!units && r.units) body.units = null;
        const notes = str(fd, 'notes');
        if (notes !== (r.notes ?? '')) body.notes = notes || null;
        if (Object.keys(body).length === 0) return Promise.reject(new Error('Nothing was changed.'));
        return api.patch(`${base}/inputs`, body);
      }}
    >
      <FieldGrid>
        <Field label="Accruals" hint="Income accrued, not yet received">
          <input className="ops-input" name="accruals" inputMode="decimal" defaultValue={r.accruals} />
        </Field>
        <Field label="Liabilities" hint="Payables and other deductions">
          <input className="ops-input" name="liabilities" inputMode="decimal" defaultValue={r.liabilities} />
        </Field>
        <Field label="Management fee rate, % a year" hint="When set, fees are calculated and the manual amount is ignored">
          <input className="ops-input" name="feeRatePct" inputMode="decimal" defaultValue={r.feeRatePct ?? ''} placeholder="e.g. 1.5" />
        </Field>
        <Field label="Fees (manual amount)" hint="Used when no fee rate is set">
          <input className="ops-input" name="fees" inputMode="decimal" defaultValue={r.fees} />
        </Field>
        <Field label="Units" hint="Fund units in issue; NAV per unit = NAV ÷ units">
          <input className="ops-input" name="units" inputMode="decimal" defaultValue={r.units ?? ''} />
        </Field>
        <Field label="Notes" span={2}>
          <textarea className="ops-input" name="notes" rows={2} maxLength={2000} defaultValue={r.notes ?? ''} />
        </Field>
      </FieldGrid>
    </FormModal>
  );
}

function PackDialog({ base, onClose }: { base: string; onClose: () => void }) {
  const pack = useResource<NavPack>(() => api.get<NavPack>(`${base}/pack`), [base]);
  return (
    <Modal title="NAV pack preview" kicker="Valuation" subtitle="Summary of this run for review. Marked draft until the run is released." onClose={onClose} wide>
      <div className="ops-modal-body">
        <Loaded res={pack} what="the pack">
          {(p) => (
            <>
              <h3 style={{ margin: '0 0 6px' }}>
                {p.title} {p.draft && <span className="ops-badge amber">draft</span>}
              </h3>
              <p className="ops-muted">
                {p.portfolio.name} · {formatDate(p.navDate)} · {p.baseCurrency}
                {p.fund ? ` · ${p.fund.name} (currently ${nav4(p.fund.currentNavPerUnit)} as of ${p.fund.currentAsOfDate ? formatDate(p.fund.currentAsOfDate) : '—'}, ${p.fund.currentStatus ?? '—'})` : ''}
              </p>
              <DefinitionList
                items={[
                  ['Net asset value', `${money2(p.kpis.nav)} ${p.baseCurrency}`],
                  ['NAV per unit', nav4(p.kpis.navPerUnit)],
                  ['Units', units6(p.kpis.units)],
                  ['Price coverage', pct4(p.kpis.priceCoverage)],
                  ['Exceptions', `${p.exceptions.open} open (${p.exceptions.material} material) of ${p.exceptions.total}`],
                  ['Prepared by', p.approvals.preparedBy ?? '—'],
                  ['Maker review', p.approvals.reviewedBy ? `${p.approvals.reviewedBy} · ${formatDateTime(p.approvals.reviewedAt)}` : '—'],
                  ['Released by', p.approvals.releasedBy ? `${p.approvals.releasedBy} · ${formatDateTime(p.approvals.releasedAt)}` : '—'],
                ]}
              />
              <div className="ops-table-wrap" style={{ marginTop: 12 }}>
                <table className="ops-table">
                  <tbody>
                    {p.bridge.map((b) => (
                      <tr key={b.key}>
                        <td>{b.label}</td>
                        <td className="r">{money2(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4>Largest positions</h4>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <tbody>
                    {p.topPositions.map((t) => (
                      <tr key={t.ticker}>
                        <td>
                          <strong>{t.ticker}</strong>
                          <span className="ops-sub">{t.name}</span>
                        </td>
                        <td className="r">{money2(t.valueBase)}</td>
                        <td>
                          {t.price ?? '—'} · {t.priceSource ?? '—'} · {t.priceDate ? formatDate(t.priceDate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Loaded>
      </div>
      <footer className="ops-modal-foot">
        <button className="ops-btn" type="button" onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  );
}
