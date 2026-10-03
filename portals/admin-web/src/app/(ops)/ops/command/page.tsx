'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, v1 } from '@/ops/api';
import { CommandPanels } from '@/ops/commandpanels';
import { Tile, moneyFmt } from '@/ops/operations';
import { Card, Empty, formatDateTime, Loaded, PageHeader, useResource } from '@/ops/ui';

interface Today {
  asOf: string;
  aum: { byCurrency: { currency: string; amount: string }[]; portfolios: number; positions: number; cashPct: string; warnings: number } | null;
  ordersWorking: { total: number; byStatus: Record<string, number> } | null;
  breaks: { open: number; high: number; pendingChecker: number } | null;
  approvals: { total: number; items: { key: string; label: string; count: number; link: string }[] };
  cash: { ledgers: number; byCurrency: { currency: string; posted: string; reserved: string; available: string }[] } | null;
  nav: { latestReleasedDate: string | null; latestReleasedRef: string | null; inProgress: Record<string, number>; portfoliosReleasedThisWeek: number; portfolios: number } | null;
  risk: { open: number; acknowledged: number } | null;
  runbookDueToday: number | null;
}

export default function CommandCentrePage() {
  const router = useRouter();
  const today = useResource<Today>(() => api.get<Today>(v1('/dashboard/today')), []);
  const go = (href: string) => () => router.push(href);
  const progress = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${v} ${k.replace(/_/g, ' ').toLowerCase()}`).join(', ') || 'none in progress';

  return (
    <>
      <PageHeader
        kicker="Global investment office"
        title="Today"
        subtitle="Decisions, risk and exceptions that need you, aggregated live from portfolios, orders, reconciliations, cash, NAV and the approval queues."
        actions={
          <button className="ops-btn" type="button" onClick={today.reload}>
            Refresh
          </button>
        }
      />
      <Loaded res={today} what="today's figures">
        {(t) => (
          <>
            <div className="ops-tiles">
              {t.aum && <Tile label="Assets under management" value={t.aum.byCurrency.length ? t.aum.byCurrency.map((a) => moneyFmt(a.amount, a.currency)).join(' · ') : '0.00'} hint={`${t.aum.portfolios} portfolios · ${t.aum.positions} positions · cash ${t.aum.cashPct}%`} onClick={go('/ops/portfolios')} />}
              {t.ordersWorking && <Tile label="Orders working" value={t.ordersWorking.total} hint={progress(t.ordersWorking.byStatus)} onClick={go('/ops/orders')} />}
              {t.breaks && <Tile label="Open breaks" value={t.breaks.open} hint={`${t.breaks.high} high · ${t.breaks.pendingChecker} awaiting checker`} onClick={go('/ops/reconciliation')} />}
              <Tile label="Approval queue" value={t.approvals.total} hint={t.approvals.items.filter((i) => i.count).map((i) => `${i.count} ${i.key}`).join(' · ') || 'Nothing waiting on you'} />
              {t.cash && <Tile label="Cash available" value={t.cash.byCurrency.length ? t.cash.byCurrency.map((c) => moneyFmt(c.available, c.currency)).join(' · ') : '0.00'} hint={`${t.cash.ledgers} bank ledger${t.cash.ledgers === 1 ? '' : 's'}, after holds`} onClick={go('/ops/cash')} />}
              {t.nav && <Tile label="NAV status" value={t.nav.latestReleasedDate ?? 'None released'} hint={`${progress(t.nav.inProgress)} · ${t.nav.portfoliosReleasedThisWeek}/${t.nav.portfolios} released this week`} onClick={go('/ops/nav')} />}
              {t.risk && <Tile label="Risk breaches" value={t.risk.open} hint={`${t.risk.acknowledged} acknowledged`} onClick={go('/ops/risk')} />}
              {t.runbookDueToday !== null && <Tile label="Runbook due today" value={t.runbookDueToday} hint="Operations Control" onClick={go('/ops/operations')} />}
            </div>

            <Card title="What needs action now">
              {t.approvals.items.length === 0 ? (
                <Empty>Your role has no approval queues.</Empty>
              ) : (
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Queue</th>
                      <th>Waiting</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {t.approvals.items.map((i) => (
                      <tr key={i.key}>
                        <td>{i.label}</td>
                        <td>{i.count}</td>
                        <td>
                          <Link href={i.link}>Open</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {t.cash && t.cash.byCurrency.length > 0 && (
              <Card title="Cash before commitments">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th>Posted</th>
                      <th>Held</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.cash.byCurrency.map((c) => (
                      <tr key={c.currency}>
                        <td>{c.currency}</td>
                        <td>{moneyFmt(c.posted)}</td>
                        <td>{moneyFmt(c.reserved)}</td>
                        <td>{moneyFmt(c.available)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <CommandPanels />
            <p className="ops-muted">Figures as of {formatDateTime(t.asOf)}. Each tile opens the workspace that owns it.</p>
          </>
        )}
      </Loaded>
    </>
  );
}
