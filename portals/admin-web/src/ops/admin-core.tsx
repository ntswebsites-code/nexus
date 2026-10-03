'use client';

import { apiBase, describeError, OpsError } from './api';

/** Shared types and helpers for the Admin Core screens (RBAC, Settings, Audit Trail, Copilot). */

export function Badge({ tone, children }: { tone: 'grey' | 'amber' | 'blue' | 'green' | 'red'; children: React.ReactNode }) {
  return <span className={`ops-badge ${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, 'grey' | 'amber' | 'blue' | 'green' | 'red'> = {
  PENDING: 'amber',
  APPLIED: 'green',
  REJECTED: 'red',
  WITHDRAWN: 'grey',
  OPEN: 'amber',
  COMPLETED: 'green',
  CERTIFIED: 'green',
  REVOKE: 'red',
};

export const StatusPill = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? 'grey'}>{status.toLowerCase()}</Badge>;

/** Downloads an authenticated CSV (cookie session) as a file; throws a readable error. */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new OpsError(0, 'network_error', 'The API could not be reached.');
  }
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { describeError };

export const jsonText = (v: unknown) => (v === null || v === undefined ? '' : JSON.stringify(v, null, 2));

// ------------------------------------------------------------------ RBAC

export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  access: string;
  last: string;
  mfa: boolean;
}
export interface RoleRow {
  key: string;
  label: string;
  locked: boolean;
  custom: boolean;
  users: number;
  permissions: string[];
}
export interface Matrix {
  roles: { key: string; label: string; locked: boolean; custom: boolean; users: number; permissionCount: number }[];
  areas: { area: string; permissions: { code: string; privileged: boolean; roles: string[] }[] }[];
  privilegedRule: string;
}
export interface ChangeRequest {
  id: string;
  ref: string;
  kind: 'USER_ROLES' | 'ROLE_PERMISSIONS' | 'USER_DISABLE';
  targetType: string;
  targetId: string;
  targetLabel: string;
  before: Record<string, unknown> | null;
  proposal: Record<string, unknown>;
  privileged: boolean;
  privilegedBy: string[] | null;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  fromReview: boolean;
  version: number;
}
export interface ReviewRow {
  id: string;
  ref: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  status: string;
  openedBy: string;
  openedAt: string;
  completedAt: string | null;
  counts: { total: number; pending: number; certified: number; revoke: number };
}
export interface ReviewItem {
  id: string;
  userId: string;
  userName: string;
  email: string;
  roles: { key: string; label: string }[];
  permissionCount: number;
  mfaEnrolled: boolean;
  lastLoginAt: string | null;
  decision: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  request: { id: string; ref: string; status: string } | null;
}
export interface ReviewDetail extends Omit<ReviewRow, 'overdue'> {
  items: ReviewItem[];
}
export interface SodHit {
  rule: string;
  a: string;
  b: string;
  why: string;
}
export interface SodReport {
  rules: (SodHit & { id: string })[];
  protectedMonetary: string[];
  roleConflicts: { key: string; label: string; hits: SodHit[] }[];
  userConflicts: { userId: string; name: string; email: string; roles: string[]; hits: SodHit[]; viaCombination: number }[];
  summary: { rules: number; roles: number; users: number };
  scannedAt: string;
}
export interface SodScan {
  findings: { severity: 'block' | 'warn' | 'ok'; title: string; detail: string; action: string }[];
  blocking: number;
  scannedAt: string;
}
export interface StepUpPolicy {
  windowMinutes: number;
  mfaRequired: boolean;
  sessionIdleMinutes: number;
  enrolment: { staff: number; enrolled: number };
  actions: { area: string; action: string; permission: string }[];
  note: string;
}

// ------------------------------------------------------------------ settings

export interface SettingRow {
  key: string;
  category: string;
  label: string;
  help: string;
  type: 'boolean' | 'int' | 'enum';
  options: string[] | null;
  min: number | null;
  max: number | null;
  value: boolean | number | string;
  default: boolean | number | string;
  isDefault: boolean;
  stepUp: boolean;
  enforced: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface SettingChange {
  id: string;
  key: string;
  label: string;
  version: number;
  before: unknown;
  after: unknown;
  reason: string;
  changedBy: string;
  changedAt: string;
}
export interface NumberingRow {
  kind: string;
  prefix: string;
  pad: number;
  first: string;
  next: string;
  issued: number;
}

// ------------------------------------------------------------------ audit

export interface AuditRow {
  id: string;
  at: string;
  user: string;
  role: string;
  portal: string | null;
  action: string;
  actionLabel: string;
  objectType: string;
  objectId: string;
  previous: string;
  next: string;
  before: unknown;
  after: unknown;
  reason: string;
  ip: string | null;
  requestId: string | null;
  hash: string;
}
export interface AuditList {
  data: AuditRow[];
  nextBefore: string | null;
}
export interface AuditFacets {
  actions: { value: string; count: number }[];
  objectTypes: { value: string; count: number }[];
  portals: { value: string; count: number }[];
  stats: { total: number; last24h: number; firstAt: string | null; lastAt: string | null; headId: string | null; headHash: string | null };
}
export interface AuditDetail {
  id: string;
  at: string;
  actor: string;
  role: string | null;
  portal: string | null;
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  requestId: string | null;
  prevHash: string;
  hash: string;
  linkedToPrevious: boolean;
  linkedToNext: boolean | null;
  previousId: string | null;
  nextId: string | null;
  eventsOnObject: number;
}

// ------------------------------------------------------------------ copilot

export interface CopilotSource {
  label: string;
  endpoint: string;
  rows: number;
  href: string;
  asOf: string;
}
export interface CopilotReply {
  id: string;
  question: string;
  intent: string;
  answer: string;
  table: { columns: string[]; rows: string[][] } | null;
  sources: CopilotSource[];
  at: string;
}
