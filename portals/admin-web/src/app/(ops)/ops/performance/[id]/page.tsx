'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, qs, v1 } from '@/ops/api';
import { Tile } from '@/ops/ibor';
import { bpsText, ControlList, money2, pct, plainPct, ReturnChart, tone, type PeriodDetail } from '@/ops/performance';
import { useSession } from '@/ops/session';
import { ActionButton, Alert, Card, DefinitionList, Field, FieldGrid, FormModal, formatDate, formatDateTime, Loaded, optStr, PageHeader, str, useResource } from '@/ops/ui';

export default function PeriodPage() {
  const { id } = useParams<{ id: string }>();
  const res = useResource<PeriodDetail>(() => api.get<PeriodDetail>(v1(`/performance/periods/${encodeURIComponent(id)}`)), [id]);
  return (
    <>
      <p>
        <Link href="/ops/performance">← Performance &amp; Attribution</Link>
      </p>
      <Loaded res={res} what="this period">
        {(p) => <Detail p={p} reload={res.reload} />}
      </Loaded>
    </>
  );
}

type Dialog = 'lock' | 'correct' | null;

function Detail({ p, reload }: { p: PeriodDetail; reload: () => void }) {
  const router = useRouter();
  const { user } = useSession();
  const [dialog, setDialog] = useState<Dialog>(null);
  const base = v1(`/performance/periods/${encodeURIComponent(p.id)}`);
  const isMaker = user.id === p.makerId;
  const canLockPerm = user.permissions.includes('performance.lock');
  const canPrepare = user.permissions.includes('reports.create');
  const label = p.status === 'LOCKED' ? 'Official' : p.status === 'SUPERSEDED' ? 'Superseded' : 'Draft';
  const lockBlocked = isMaker ? 'You prepared this period, so a different person must lock it.' : p.stale ? 'Positions, prices or flows changed since this draft was prepared. Recompute it first.' : p.controlsPending > 0 ? `${p.controlsPending} control(s) are not done.` : null;

  return (
    <>
      <PageHeader
        kicker={`Performance period · ${p.portfolioName ?? ''}`}
        title={
          <>
            {p.ref} <span className={`ops-badge ${p.status === 'LOCKED' ? 'green' : p.status === 'DRAFT' ? 'amber' : 'grey'}`}>{label}</span>
          </>
        }
        subtitle={`${formatDate(p.periodStart)} to ${formatDate(p.periodEnd)} · version ${p.version} · ${p.baseCurrency}`}
        actions={
          <>
            {p.status === 'DRAFT' && (p.makerId === user.id || canLockPerm) && canPrepare && (
              <ActionButton label="Recompute" title="Rebuilds the return, attribution and controls from the live data" onRun={(key) => api.post(`${base}/recompute`, {}, { idempotencyKey: key })} onDone={reload} />
            )}
            {p.status === 'DRAFT' && canLockPerm && (
              <button className="ops-btn primary" type="button" disabled={!!lockBlocked} title={lockBlocked ?? 'Locks the return as Official (step-up MFA)'} onClick={() => setDialog('lock')}>
                Lock official return
              </button>
            )}
            {p.status === 'LOCKED' && canPrepare && (
              <button className="ops-btn" type="button" onClick={() => setDialog('correct')}>
                Start correction
              </button>
            )}
          </>
        }
      />
      {p.status === 'DRAFT' && lockBlocked && <Alert kind="warn">{lockBlocked}</Alert>}
      {p.status === 'SUPERSEDED' && <Alert kind="info">A later version replaced this period. It is kept as evidence and cannot change.</Alert>}
      {p.correctionReason && <Alert kind="info">Correction of an earlier Official period: {p.correctionReason}</Alert>}

      <div className="ops-tiles">
        <Tile label="Net TWR" value={pct(p.twrPct)} hint={`${p.dayCount} day(s)`} />
        <Tile label="Benchmark" value={pct(p.benchmarkPct)} hint={p.attribution?.benchmark?.name ?? 'No benchmark composition'} tone={p.benchmarkPct === null ? 'warn' : undefined} />
        <Tile label="Active return" value={pct(p.activePct)} hint="Portfolio less benchmark" />
        <Tile label="End value" value={`${p.baseCurrency} ${money2(p.endValue)}`} hint={`Start ${money2(p.startValue)} · net flows ${money2(p.netFlows)}`} />
      </div>

      <Card title="Cumulative return">
        <ReturnChart series={p.series} />
      </Card>

      <Card title={p.controlsPending === 0 ? 'Official-return controls: all done' : `Official-return controls: ${p.controlsPending} to clear`}>
        {p.controls && <ControlList controls={p.controls} />}
        {p.navCheck && (
          <p className="ops-muted" style={{ marginTop: 12 }}>
            NAV cross-check: {p.navCheck.ref} {money2(p.navCheck.nav)} vs computed {money2(p.navCheck.computed)} ({p.navCheck.diffPct}% apart).
          </p>
        )}
        {p.status === 'DRAFT' && <p className="ops-muted">Shown live for a draft; stored as evidence when the period is locked.</p>}
      </Card>

      {p.attribution && p.attribution.segments.length > 0 && (
        <Card title="Allocation & selection">
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th className="r">Avg wt.</th>
                  <th className="r">BM wt.</th>
                  <th className="r">Allocation</th>
                  <th className="r">Selection</th>
                  <th className="r">Interaction</th>
                  <th className="r">Total active</th>
                </tr>
              </thead>
              <tbody>
                {p.attribution.segments.map((s) => (
                  <tr key={s.sector}>
                    <td>
                      <strong>{s.sector}</strong>
                    </td>
                    <td className="r">{plainPct(s.avgWeightPct, 1)}</td>
                    <td className="r">{plainPct(s.benchWeightPct, 1)}</td>
                    <td className="r">{bpsText(s.allocationBps)}</td>
                    <td className="r">{bpsText(s.selectionBps)}</td>
                    <td className="r">{bpsText(s.interactionBps)}</td>
                    <td className="r" style={{ color: tone(s.totalBps) }}>
                      {bpsText(s.totalBps)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {p.contributions && (
        <Card title="Contribution by security">
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th>Sector</th>
                  <th className="r">Avg wt.</th>
                  <th className="r">Return</th>
                  <th className="r">Contribution</th>
                  <th>Drill</th>
                </tr>
              </thead>
              <tbody>
                {p.contributions.map((c) => (
                  <tr key={`${c.ticker}-${c.securityId}`}>
                    <td>
                      <strong>{c.ticker}</strong>
                      <span className="ops-sub">{c.name}</span>
                    </td>
                    <td>{c.sector}</td>
                    <td className="r">{plainPct(c.avgWeightPct, 1)}</td>
                    <td className="r">{c.returnPct === null ? '—' : pct(c.returnPct)}</td>
                    <td className="r" style={{ color: tone(c.contributionBps) }}>
                      {bpsText(c.contributionBps)}
                    </td>
                    <td>
                      {c.securityId ? (
                        <>
                          <Link href={`/ops/ibor/position${qs({ portfolioId: p.portfolioId, securityId: c.securityId })}`}>Positions</Link> · <Link href={`/ops/orders?q=${encodeURIComponent(c.ticker)}`}>Orders</Link>
                        </>
                      ) : (
                        <span className="ops-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Governance">
        <DefinitionList
          items={[
            ['Prepared by', `${p.makerName ?? '—'} · ${formatDateTime(p.createdAt)}`],
            ['Locked by', p.checkerName ? `${p.checkerName} · ${formatDateTime(p.lockedAt)}` : 'Not locked'],
            ['Lock note', p.lockNote ?? '—'],
            ['Evidence hash', p.dataHash.slice(0, 16)],
            ['Replaces', p.supersedesId ? <Link key="s" href={`/ops/performance/${encodeURIComponent(p.supersedesId)}`}>Earlier version</Link> : '—'],
          ]}
        />
      </Card>

      {dialog === 'lock' && (
        <FormModal
          title="Lock official return"
          kicker={p.ref}
          subtitle="Once locked the period is immutable; a change after this is a new version with a reason. Step-up confirmation is required."
          submitLabel="Lock as Official"
          onClose={() => setDialog(null)}
          onSubmit={(fd, key) => api.post(`${base}/lock`, optStr(fd, 'note') ? { note: optStr(fd, 'note') } : {}, { idempotencyKey: key })}
          onDone={reload}
        >
          <FieldGrid>
            <Field label="Note" span={2}>
              <textarea className="ops-input" name="note" rows={2} maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
      {dialog === 'correct' && (
        <FormModal
          title="Start correction"
          kicker={p.ref}
          subtitle="Creates a new draft version from the live data. The Official return stays in force until the correction is locked."
          submitLabel="Create correction draft"
          onClose={() => setDialog(null)}
          onSubmit={(fd, key) => api.post<PeriodDetail>(`${base}/correct`, { reason: str(fd, 'reason') }, { idempotencyKey: key })}
          onDone={(r) => router.push(`/ops/performance/${encodeURIComponent((r as PeriodDetail).id)}`)}
        >
          <FieldGrid>
            <Field label="Reason" span={2} hint="Required, 5+ characters">
              <textarea className="ops-input" name="reason" rows={3} required minLength={5} maxLength={500} />
            </Field>
          </FieldGrid>
        </FormModal>
      )}
    </>
  );
}
