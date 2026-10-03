'use client';

import { useState } from 'react';
import { useCan } from '@/ops/session';
import { Alert, PageHeader } from '@/ops/ui';
import { TabBar } from '@/ops/recon/common';
import { GatesTab, PositionsPullTab, SettlementFailsTab } from '@/ops/payrecon/ControlsTabs';
import { PayBreaks, PayItems, PayOverview } from '@/ops/payrecon/PaymentsTab';

type Tab = 'overview' | 'items' | 'breaks' | 'fails' | 'gates' | 'positions';

export default function PaymentsReconPage() {
  const canView = useCan('operations.view');
  const canManage = useCan('recon.manage');
  const canSign = useCan('recon.signoff');
  const [tab, setTab] = useState<Tab>('overview');
  // Bumped after any change so the tabs refetch.
  const [stamp, setStamp] = useState(0);
  const bump = () => setStamp((n) => n + 1);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Operations" title="Payments and close controls" />
        <Alert>Your role does not include operations. Ask an administrator for the operations.view permission.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="Payments and close controls"
        subtitle="Match distribution payouts and capital-call receipts to the imported bank statements, work the breaks with a maker and an independent checker, watch settlement fails, pull custody positions through the custodian feed, and see what blocks a period close."
      />
      <TabBar<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Payments matching' },
          { key: 'items', label: 'Expected payments' },
          { key: 'breaks', label: 'Payment breaks' },
          { key: 'fails', label: 'Settlement fails' },
          { key: 'positions', label: 'Custody positions' },
          { key: 'gates', label: 'Close gates' },
        ]}
      />
      {tab === 'overview' && <PayOverview canManage={canManage} stamp={stamp} onChanged={bump} />}
      {tab === 'items' && <PayItems stamp={stamp} />}
      {tab === 'breaks' && <PayBreaks canManage={canManage} canSign={canSign} stamp={stamp} onChanged={bump} />}
      {tab === 'fails' && <SettlementFailsTab canManage={canManage} stamp={stamp} onChanged={bump} />}
      {tab === 'positions' && <PositionsPullTab canManage={canManage} onChanged={bump} />}
      {tab === 'gates' && <GatesTab />}
    </>
  );
}
