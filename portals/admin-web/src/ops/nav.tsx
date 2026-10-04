'use client';

import { formatDecimal } from './money';

// ------------------------------------------------------------------ types (mirror /api/v1/nav)

export type NavStatus = 'DRAFT' | 'EXCEPTIONS_OPEN' | 'MAKER_REVIEWED' | 'RELEASED' | 'SUPERSEDED';

export interface NavExternal {
  nav: string;
  abor: string;
  variance: string;
  variancePct: string | null;
  tolerance: string;
  state: 'Agree' | 'Variance';
  source: string | null;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}

export interface NavRunRow {
  id: string;
  ref: string;
  portfolioId: string;
  portfolioRef: string | null;
  portfolioName: string | null;
  fundId: string | null;
  fundRef: string | null;
  fundName: string | null;
  navDate: string;
  version: number;
  stage: string;
  status: NavStatus;
  baseCurrency: string;
  marketValue: string;
  cash: string;
  accruals: string;
  fees: string;
  liabilities: string;
  feeRatePct: string | null;
  nav: string;
  units: string | null;
  navPerUnit: string | null;
  priceCoverage: string;
  positionCount: number;
  openExceptions: number;
  openMaterialExceptions: number;
  totalExceptions: number;
  makerId: string;
  makerName: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  checkerId: string | null;
  checkerName: string | null;
  releasedAt: string | null;
  notes: string | null;
  /** FR-VAL-017: the administrator NAV, variance and state; absent until one is recorded. */
  external?: NavExternal | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NavList {
  data: NavRunRow[];
  total: number;
  summary: { byStatus: Record<string, number>; awaitingRelease: number; openExceptions: number; released: number };
}

export interface NavLine {
  id: string;
  securityId: string;
  ticker: string;
  name: string;
  currency: string;
  quantity: string;
  price: string | null;
  priceSource: string | null;
  priceDate: string | null;
  fxRate: string | null;
  valueLocal: string | null;
  valueBase: string | null;
  flags: string[];
}

export interface NavException {
  id: string;
  type: 'STALE_PRICE' | 'MISSING_PRICE' | 'MISSING_FX' | 'TOLERANCE' | 'NEGATIVE_CASH';
  securityId: string | null;
  ticker: string | null;
  detail: string;
  currentValue: string | null;
  referenceValue: string | null;
  difference: string | null;
  material: boolean;
  status: 'OPEN' | 'RESOLVED';
  resolution: string | null;
  evidenceRef: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export interface NavDetail extends NavRunRow {
  stageBar: { key: string; label: string; state: 'done' | 'current' | 'todo' | 'skipped' }[];
  bridge: { key: string; label: string; sign: number; amount: string }[];
  settings: { staleDays: number; priceMovePct: number; tolerancePct: number; toleranceAbs: number } | null;
  lines: NavLine[];
  exceptions: NavException[];
  versions: { id: string; ref: string; version: number; status: NavStatus }[];
  timeline: { at: string; action: string; actor: string; reason: string | null }[];
  allowed: {
    recalculate: boolean;
    editInputs: boolean;
    resolve: boolean;
    makerReview: boolean;
    makerReviewBlockers: string[];
    release: boolean;
    releaseBlocker: string | null;
    /** FR-VAL-009: set when the user's role lacks valuation.run / valuation.maker ("Not permitted for <Role>"). */
    runBlocker?: string | null;
    makerBlocker?: string | null;
    recordExternal?: boolean;
  };
  fundUpdate?: Record<string, unknown> | null;
}

export interface NavPack {
  generatedAt: string;
  draft: boolean;
  title: string;
  navDate: string;
  baseCurrency: string;
  portfolio: { ref: string | null; name: string | null };
  fund: { ref: string | null; name: string | null; currentNavPerUnit: string | null; currentAsOfDate: string | null; currentStatus: string | null } | null;
  kpis: { nav: string; navPerUnit: string | null; units: string | null; priceCoverage: string; positionCount: number };
  bridge: { key: string; label: string; sign: number; amount: string }[];
  topPositions: { ticker: string; name: string; quantity: string; price: string | null; priceDate: string | null; priceSource: string | null; valueBase: string | null }[];
  exceptions: { open: number; material: number; total: number; items: { type: string; ticker: string | null; detail: string; material: boolean; status: string; resolution: string | null; evidenceRef: string | null }[] };
  approvals: { preparedBy: string | null; preparedAt: string | null; reviewedBy: string | null; reviewedAt: string | null; releasedBy: string | null; releasedAt: string | null };
  notes: string | null;
}

// ------------------------------------------------------------------ presentation

export const NAV_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  EXCEPTIONS_OPEN: 'Exceptions open',
  MAKER_REVIEWED: 'Maker reviewed',
  RELEASED: 'Released',
  SUPERSEDED: 'Superseded',
};
const TONE: Record<string, string> = { DRAFT: 'grey', EXCEPTIONS_OPEN: 'amber', MAKER_REVIEWED: 'blue', RELEASED: 'green', SUPERSEDED: 'grey' };

export function NavStatusBadge({ status }: { status: string }) {
  return <span className={`ops-badge ${TONE[status] ?? 'grey'}`}>{NAV_STATUS_LABEL[status] ?? status}</span>;
}

export const EXCEPTION_LABEL: Record<string, string> = {
  STALE_PRICE: 'Stale price',
  MISSING_PRICE: 'Missing price',
  MISSING_FX: 'Missing FX',
  TOLERANCE: 'Price move',
  NEGATIVE_CASH: 'Negative cash',
};

export const money2 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 2));
export const units6 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 4));
export const nav4 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatDecimal(v, 4));
export const pct4 = (v: string | null | undefined) => (v === null || v === undefined ? '—' : `${formatDecimal(v, 2)}%`);

const STATE_STYLE: Record<string, { bg: string; fg: string; border: string }> = {
  done: { bg: 'var(--ops-green-soft, #e3f4ea)', fg: 'var(--ops-green, #17803d)', border: 'var(--ops-green, #17803d)' },
  current: { bg: 'var(--ops-blue-soft, #e6efff)', fg: 'var(--ops-blue, #1d4ed8)', border: 'var(--ops-blue, #1d4ed8)' },
  todo: { bg: 'transparent', fg: 'var(--ops-muted, #5b6675)', border: 'var(--ops-line, #d7dde5)' },
  skipped: { bg: 'transparent', fg: 'var(--ops-muted, #5b6675)', border: 'var(--ops-line, #d7dde5)' },
};

/** Positions, Cash, Prices & FX, Fees, Units, Maker review, Release. */
export function StageBar({ stages }: { stages: NavDetail['stageBar'] }) {
  return (
    <ol aria-label="NAV run stages" style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 8, margin: '0 0 18px', padding: 0 }}>
      {stages.map((s, i) => {
        const st = STATE_STYLE[s.state] ?? STATE_STYLE.todo!;
        return (
          <li
            key={s.key}
            aria-current={s.state === 'current' ? 'step' : undefined}
            style={{ flex: '1 1 110px', padding: '8px 10px', borderRadius: 8, border: `1px solid ${st.border}`, background: st.bg, color: st.fg, fontSize: 12, fontWeight: 700 }}
          >
            <span style={{ opacity: 0.7, marginRight: 6 }}>{s.state === 'done' ? '✓' : i + 1}</span>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
