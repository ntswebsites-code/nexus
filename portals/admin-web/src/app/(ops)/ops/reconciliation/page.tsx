'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/ops/session';
import { Alert, PageHeader } from '@/ops/ui';
import { BreakDetail } from '@/ops/recon/BreakDetail';
import { BreaksTab, type BreakFilter } from '@/ops/recon/BreaksTab';
import { TabBar } from '@/ops/recon/common';
import { OverviewTab } from '@/ops/recon/OverviewTab';
import { RunTab } from '@/ops/recon/RunTab';
import { SignoffTab } from '@/ops/recon/SignoffTab';
import { CustodianFeedSection } from '@/ops/market-data';

type Tab = 'overview' | 'breaks' | 'run' | 'signoff' | 'feed';

export default function ReconciliationPage() {
  const canView = useCan('operations.view');
  const canManage = useCan('recon.manage');
  const canSign = useCan('recon.signoff');
  const [tab, setTab] = useState<Tab>('overview');
  const [filter, setFilter] = useState<BreakFilter>({});
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped after any change so the tabs refetch.
  const [stamp, setStamp] = useState(0);

  // Notification links arrive as /ops/reconciliation?break=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('break');
    if (id) {
      setOpenId(id);
      setTab('breaks');
    }
  }, []);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Operations" title="Reconciliations" />
        <Alert>Your role does not include operations. Ask an administrator for the operations.view permission.</Alert>
      </>
    );
  }

  const bump = () => setStamp((n) => n + 1);

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="Reconciliations"
        subtitle="Match custodian trades, cash, holdings and day-end counts against the internal book, work the breaks with a maker and an independent checker, then sign the day off."
      />
      <TabBar<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'breaks', label: 'Breaks' },
          { key: 'run', label: 'Run matching' },
          { key: 'signoff', label: 'Daily sign-off' },
          { key: 'feed', label: 'Custodian feed' },
        ]}
      />
      {tab === 'overview' && (
        <OverviewTab
          key={stamp}
          onOpenBreaks={(f) => {
            setFilter(f);
            setTab('breaks');
          }}
        />
      )}
      {tab === 'breaks' && <BreaksTab key={`${filter.family ?? ''}${filter.severity ?? ''}`} initial={filter} stamp={stamp} onOpen={setOpenId} />}
      {tab === 'run' && <RunTab canManage={canManage} onOpenBreak={setOpenId} onChanged={bump} />}
      {tab === 'signoff' && <SignoffTab stamp={stamp} canSign={canSign} onOpenBreak={setOpenId} onChanged={bump} />}
      {tab === 'feed' && <CustodianFeedSection canManage={canManage} onChanged={bump} />}
      {openId && <BreakDetail id={openId} onClose={() => setOpenId(null)} onChanged={bump} />}
    </>
  );
}
