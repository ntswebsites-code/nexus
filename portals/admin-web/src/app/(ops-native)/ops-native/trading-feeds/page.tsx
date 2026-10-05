'use client';

import { TradingFeedsPage } from '@/ops/trading-feeds';
import { PageHeader } from '@/ops/ui';

export default function TradingFeedsRoute() {
  return (
    <>
      <PageHeader kicker="Trading" title="Trading feeds" subtitle="Broker contract notes, FIX fills, breaks, settlement instructions and the corporate-action feed." />
      <TradingFeedsPage />
    </>
  );
}
