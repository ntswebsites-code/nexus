'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/ibor)

export interface IborPosition {
  portfolioId: string;
  portfolioRef: string;
  portfolioName: string;
  securityId: string;
  ticker: string;
  name: string;
  market: string;
  assetClass: string;
  sector: string | null;
  currency: string;
  baseCurrency: string;
  quantity: string;
  settled: string;
  unsettled: string;
  unsettledBuys: string;
  unsettledSells: string;
  openSellRemaining: string;
  price: string | null;
  priceSource: string | null;
  marketValueLocal: string | null;
  marketValueBase: string | null;
  costBase: string | null;
  avgCost: string;
  accrued: string | null;
  available: string | null;
  restricted: boolean;
  lotCount: number;
  lotQuantity: string;
  drift: string;
  state: 'Current' | 'Review';
  reasons: string[];
}

export interface IborLedger {
  data: IborPosition[];
  total: number;
  asOf: string;
}

export interface HealthItem {
  key: string;
  title: string;
  ok: boolean;
  detail: string;
}

export interface BookHealth {
  items: HealthItem[];
  openBreaks: number;
  latestRun: { id: string; ref: string; status: string; asOfDate: string | null; breakCount: number } | null;
}

export interface IborOverview {
  asOf: string;
  kpis: {
    marketValueBase: string;
    positions: number;
    portfolios: number;
    availableCash: string;
    unsettledBuys: string;
    unsettledBuyCount: number;
    accruedIncome: string;
    exceptions: number;
    materialExceptions: number;
  };
  control: {
    bookState: 'Current' | 'Review';
    lastEvent: { ref: string; type: string; summary: string; at: string } | null;
    lastRefresh: { ref: string; at: string; status: string; durationMs: number } | null;
    refreshAgeSeconds: number | null;
  };
  health: BookHealth;
}

export interface LadderFlow {
  currency: string;
  netCash: string;
  buys: number;
  sells: number;
}

export interface Ladder {
  asOf: string;
  buckets: { bucket: string; flows: LadderFlow[] }[];
  items: { fillId: string; orderId: string; orderRef: string; portfolioId: string; portfolioName: string | null; ticker: string | null; side: string; quantity: string; price: string; currency: string; netCash: string; executedOn: string | null; settlesOn: string | null; bucket: string }[];
}

export interface IborLot {
  id: string;
  securityId: string;
  ticker: string | null;
  name: string | null;
  openedOn: string | null;
  originalQty: string;
  remainingQty: string;
  unitCost: string;
  costRemaining: string;
  currency: string;
  sourceType: string;
  sourceId: string;
  status: string;
  closedOn: string | null;
}

export interface IborEventRow {
  id: string;
  ref: string;
  type: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  securityId: string | null;
  ticker: string | null;
  quantityDelta: string | null;
  price: string | null;
  effectiveDate: string | null;
  sourceType: string | null;
  summary: string;
  detail: unknown;
  createdAt: string;
}

export interface RefreshResult {
  id: string;
  ref: string;
  status: string;
  asOf: string;
  positionCount: number;
  marketValueBase: string;
  eventsIngested: number;
  lotsOpened: number;
  adjustments: number;
  exceptions: { portfolio: string; ticker: string; issue: string }[];
  durationMs: number;
}

export interface PositionDetail {
  position: IborPosition;
  lots: IborLot[];
  lotSummary: { openLots: number; openQuantity: string; averageCost: string | null };
  unsettledFills: { id: string; orderRef: string; side: string; status: string; quantity: string; price: string; executedAt: string }[];
  events: IborEventRow[];
  history: { asOf: string | null; quantity: string; avgCost: string }[];
  orders: { id: string; ref: string; side: string; status: string; quantity: string; filledQty: string }[];
  reconciliation: { id: string; ref: string; label: string; status: string; severity: string; difference: string | null }[];
}

// ------------------------------------------------------------------ helpers

export const qty = (v: string | null | undefined) => formatDecimal(v, 0);
export const qtyFine = (v: string | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const n = formatDecimal(v, 6).replace(/\.?0+$/, '');
  return n === '' ? '0' : n;
};
export const money2 = (v: string | null | undefined) => formatDecimal(v, 2);
export const signed = (v: string | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (n === 0) return '—';
  return `${n > 0 ? '+' : ''}${formatDecimal(v, 0)}`;
};

export const BUCKET_LABEL: Record<string, string> = { OVERDUE: 'Overdue', TODAY: 'Today', 'T+1': 'T+1', 'T+2': 'T+2', 'T+3': 'T+3', LATER: 'Later' };
export const EVENT_LABEL: Record<string, string> = { OPENING: 'Opening lot', FILL: 'Fill', ADJUSTMENT: 'Adjustment', REFRESH: 'Refresh', RECON: 'Reconciliation' };

export function StateBadge({ state, reasons }: { state: string; reasons?: string[] }) {
  return (
    <span className={`ops-badge ${state === 'Current' ? 'green' : 'amber'}`} title={reasons?.join('. ')}>
      {state}
    </span>
  );
}

export function ageText(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: 'warn' | 'bad'; onClick?: () => void }) {
  const style = { textAlign: 'left' as const, cursor: onClick ? 'pointer' : 'default', ...(tone === 'warn' ? { borderColor: 'var(--ops-amber)' } : tone === 'bad' ? { borderColor: 'var(--ops-red, #c0392b)' } : {}) };
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={style}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 24, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}
