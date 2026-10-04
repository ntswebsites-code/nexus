'use client';

import type { ReactNode } from 'react';

/** Types and small pieces shared by Operations Control (`/ops/operations`) and the Command Centre (`/ops/command`). */

export interface Dependency {
  key: string;
  label: string;
  readinessPct: number;
  detail: string;
  link: string;
}
export interface OpsStatus {
  asOf: string;
  kpis: {
    dueToday: number;
    blockedTasks: number;
    settlementExposure: { currency: string; amount: string }[];
    unsettledOrders: number;
    cashDeadlines: number;
    cashGross: string;
    corporateActions: number;
    electionsDue: number;
    closeBlockers: number;
    serviceHealth: 'ok' | 'degraded';
  };
  dependencies: Dependency[];
  recon: { open: number; pendingChecker: number; high: number; oldestDays: number };
  cash: { periodEnd: string | null; blockers: number; readinessPct: number; pendingJournals: number; systemJournals: number; stagedImports: number; portfolios: { portfolioId: string; portfolioRef: string; portfolioName: string; closeStatus: string; blockers: number; failing: string[]; canClose: boolean }[] };
  nav: { unreleased: { id: string; ref: string; portfolioRef: string | null; portfolioName: string | null; navDate: string | null; status: string; openExceptions: number; materialExceptions: number }[]; blockers: number };
  accounting: { pendingJournals: number; systemJournals: number; postedThisMonth: number; periodsByStatus: Record<string, number> };
  corporateActions: { due: { id: string; ref: string; ticker: string; type: string; status: string; payDate: string | null; electionDeadline: string | null; overdue: boolean; electionDue: boolean; needsProcessing: boolean }[]; count: number; electionsDue: number; overdue: number; awaitingProcessing: number };
  settlement: { unsettled: number };
  risk: { openBreaches: number };
}

export interface Task {
  id: string;
  ref: string;
  area: string;
  title: string;
  detail: string | null;
  dueAt: string;
  status: string;
  state: 'DONE' | 'CANCELLED' | 'BLOCKED' | 'DUE' | 'SCHEDULED';
  ownerName: string | null;
  dependsOn: { ref: string; title: string; status: string } | null;
  blockedReason: string | null;
  link: string | null;
  system: boolean;
  isControl?: boolean;
  createdById?: string;
  completedByName: string | null;
  completedAt: string | null;
  commentCount?: number;
  version: number;
}
export interface HandOff {
  ref: string;
  title: string;
  state: 'DUE' | 'SCHEDULED' | 'BLOCKED';
  notified: 'owner' | 'team';
}
export interface TaskList {
  data: Task[];
  total: number;
  summary: { due: number; blocked: number; scheduled: number; done: number };
}

export const AREAS = ['SETTLEMENT', 'CASH', 'CORPORATE_ACTIONS', 'VALUATION', 'CLOSE', 'REPORTING', 'RISK', 'OTHER'];
export const areaLabel = (a: string) => a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const STATE_TONE: Record<string, string> = { DUE: 'amber', BLOCKED: 'red', SCHEDULED: 'blue', DONE: 'green', CANCELLED: 'grey' };

export function Tile({ label, value, hint, onClick }: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="ops-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, fontWeight: 800 }}>{label}</p>
      <h3 style={{ fontSize: 26, margin: '6px 0 2px' }}>{value}</h3>
      {hint && <p>{hint}</p>}
    </button>
  );
}

export function Bar({ pct }: { pct: number }) {
  const tone = pct >= 90 ? '#0a9474' : pct >= 60 ? '#d58b1d' : '#d83c54';
  return (
    <div style={{ height: 6, background: 'rgba(120,130,150,.25)', borderRadius: 3, marginTop: 6 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: tone }} />
    </div>
  );
}

export const moneyFmt = (v: string | number, currency?: string) => {
  const n = Number(v);
  const s = Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : String(v);
  return currency ? `${currency} ${s}` : s;
};
