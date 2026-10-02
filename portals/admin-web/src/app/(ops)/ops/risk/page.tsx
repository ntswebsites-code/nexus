'use client';

import { useState } from 'react';
import { api } from '@/ops/api';
import { useCan } from '@/ops/session';
import { Alert, ActionButton, PageHeader } from '@/ops/ui';
import { BreachesTab } from '@/ops/risk/BreachesTab';
import { CasesTab } from '@/ops/risk/CasesTab';
import { risk, TabBar } from '@/ops/risk/common';
import { LimitsTab } from '@/ops/risk/LimitsTab';
import { ScenariosTab } from '@/ops/risk/ScenariosTab';
import type { MonitorSummary } from '@/ops/risk/types';

type Tab = 'limits' | 'breaches' | 'scenarios' | 'cases';

export default function RiskPage() {
  const canView = useCan('risk.view', 'risk.manage');
  const canManage = useCan('risk.manage');
  const [tab, setTab] = useState<Tab>('limits');
  const [caseQuery, setCaseQuery] = useState<string | undefined>();
  const [monitor, setMonitor] = useState<MonitorSummary | null>(null);
  // Bumped after a monitor run so the tabs refetch.
  const [stamp, setStamp] = useState(0);

  if (!canView) {
    return (
      <>
        <PageHeader kicker="Risk & compliance" title="Risk & compliance" />
        <Alert>Your role does not include risk and compliance. Ask an administrator for the risk.view permission.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        kicker="Risk & compliance"
        title="Risk & compliance"
        subtitle="Approved limits, daily breach monitoring, stress scenarios and compliance cases."
        actions={
          canManage && (
            <ActionButton
              label="Run monitor"
              primary
              title="Evaluate every active limit now. Safe to repeat: a breach is recorded once per day."
              onRun={async (key) => setMonitor(await api.post<MonitorSummary>(risk('/monitor'), {}, { idempotencyKey: key }))}
              onDone={() => setStamp((n) => n + 1)}
            />
          )
        }
      />
      {monitor && (
        <Alert kind={monitor.newBreaches.length ? 'warn' : 'ok'}>
          Monitor run for {monitor.detectedOn}: {monitor.limitsEvaluated} limit checks across {monitor.portfoliosChecked} portfolios.{' '}
          {monitor.newBreaches.length
            ? `${monitor.newBreaches.length} new breach(es): ${monitor.newBreaches.map((b) => `${b.limitRef} on ${b.portfolioRef} (case ${b.caseRef}, ${b.severity.toLowerCase()})`).join('; ')}.`
            : 'No new breaches.'}{' '}
          {monitor.alreadyRecorded > 0 && `${monitor.alreadyRecorded} already recorded today.`}
        </Alert>
      )}
      <TabBar<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'limits', label: 'Limits' },
          { key: 'breaches', label: 'Breaches' },
          { key: 'scenarios', label: 'Scenarios' },
          { key: 'cases', label: 'Cases' },
        ]}
      />
      {tab === 'limits' && <LimitsTab key={stamp} canManage={canManage} />}
      {tab === 'breaches' && (
        <BreachesTab
          key={stamp}
          canManage={canManage}
          onOpenCase={(ref) => {
            setCaseQuery(ref);
            setTab('cases');
          }}
        />
      )}
      {tab === 'scenarios' && <ScenariosTab canManage={canManage} />}
      {tab === 'cases' && <CasesTab key={stamp} canManage={canManage} initialQuery={caseQuery} />}
    </>
  );
}
