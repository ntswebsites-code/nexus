import { prisma } from '../../lib/prisma';

/**
 * Global search and record-detail registry for the admin shell (SRD 5A.0, 5A.29). One entry per record kind: which
 * permission lets a user see it, which columns are searched, how a hit is labelled and which console page owns it.
 * Search only returns kinds the caller may view, so the palette never leaks a record the module itself would refuse.
 */
export interface KindDef {
  kind: string;
  label: string;
  /** Any one of these permissions allows search and detail. Empty = any staff user. */
  perms: string[];
  /** Prisma delegate name. */
  delegate: string;
  searchFields: string[];
  titleField: string;
  refField?: string;
  statusField?: string;
  /** Console page that owns the record. */
  route: string;
  /** Columns never returned by the record view. */
  omit?: string[];
}

export const KINDS: KindDef[] = [
  { kind: 'portfolio', label: 'Portfolio', perms: ['portfolio.view'], delegate: 'portfolio', searchFields: ['ref', 'name'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/portfolios' },
  { kind: 'security', label: 'Security', perms: ['portfolio.view', 'research.view', 'orders.view'], delegate: 'security', searchFields: ['ticker', 'name', 'isin'], titleField: 'name', refField: 'ticker', statusField: 'status', route: '/ops/securities' },
  { kind: 'client', label: 'Client', perms: ['clients.view'], delegate: 'client', searchFields: ['ref', 'name', 'email'], titleField: 'name', refField: 'ref', statusField: 'kycStatus', route: '/ops/clients' },
  { kind: 'order', label: 'Order', perms: ['orders.view'], delegate: 'order', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'status', route: '/ops/orders' },
  { kind: 'research-case', label: 'Research case', perms: ['research.view'], delegate: 'researchCase', searchFields: ['ref', 'title'], titleField: 'title', refField: 'ref', statusField: 'status', route: '/ops/research' },
  { kind: 'fund', label: 'Fund', perms: ['funds.view'], delegate: 'fund', searchFields: ['ref', 'name', 'shortName'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/funds' },
  { kind: 'nav-run', label: 'NAV run', perms: ['valuation.view'], delegate: 'navRun', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'stage', route: '/ops/nav' },
  { kind: 'journal', label: 'Accounting journal', perms: ['valuation.view'], delegate: 'accJournal', searchFields: ['ref', 'description'], titleField: 'description', refField: 'ref', statusField: 'status', route: '/ops/accounting' },
  { kind: 'recon-break', label: 'Reconciliation break', perms: ['operations.view'], delegate: 'reconBreak', searchFields: ['ref', 'label'], titleField: 'label', refField: 'ref', statusField: 'status', route: '/ops/reconciliation' },
  { kind: 'corporate-action', label: 'Corporate action', perms: ['operations.view'], delegate: 'corpActionEvent', searchFields: ['ref', 'ticker', 'securityName'], titleField: 'securityName', refField: 'ref', statusField: 'status', route: '/ops/corporate-actions' },
  { kind: 'ops-task', label: 'Operations task', perms: ['operations.view'], delegate: 'opsTask', searchFields: ['ref', 'title'], titleField: 'title', refField: 'ref', statusField: 'status', route: '/ops/operations' },
  { kind: 'capital-call', label: 'Capital call', perms: ['capital.view'], delegate: 'capitalCall', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'status', route: '/ops/capital-calls' },
  { kind: 'distribution', label: 'Distribution', perms: ['capital.view', 'distributions.create', 'distributions.approve'], delegate: 'distribution', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'status', route: '/ops/distributions' },
  { kind: 'term-sheet', label: 'Term sheet', perms: ['term_sheets.view'], delegate: 'termSheet', searchFields: ['ref', 'title'], titleField: 'title', refField: 'ref', statusField: 'status', route: '/ops/term-sheets' },
  { kind: 'kyc-case', label: 'KYC case', perms: ['onboarding.view'], delegate: 'kycCase', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'stage', route: '/ops/onboarding' },
  { kind: 'service-request', label: 'Service request', perms: ['clients.view'], delegate: 'serviceRequest', searchFields: ['ref', 'title'], titleField: 'title', refField: 'ref', statusField: 'status', route: '/ops/investor-services' },
  { kind: 'document', label: 'Document', perms: ['documents.view'], delegate: 'document', searchFields: ['ref', 'name'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/vault' },
  { kind: 'report-run', label: 'Report run', perms: ['reports.view'], delegate: 'reportRun', searchFields: ['ref', 'title'], titleField: 'title', refField: 'ref', statusField: 'status', route: '/ops/reports' },
  { kind: 'regulatory-filing', label: 'Regulatory filing', perms: ['reports.view'], delegate: 'regFiling', searchFields: ['ref'], titleField: 'ref', refField: 'ref', statusField: 'status', route: '/ops/regulatory' },
  { kind: 'financing-facility', label: 'Financing facility', perms: ['risk.view'], delegate: 'finFacility', searchFields: ['ref', 'name'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/financing' },
  { kind: 'private-fund', label: 'Private-markets fund', perms: ['portfolio.view'], delegate: 'pmFund', searchFields: ['ref', 'name'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/private-markets' },
  { kind: 'counterparty', label: 'Counterparty', perms: ['custodian.view'], delegate: 'counterparty', searchFields: ['ref', 'name'], titleField: 'name', refField: 'ref', statusField: 'status', route: '/ops/custodian' },
  { kind: 'staff-user', label: 'Staff user', perms: ['admin.rbac'], delegate: 'user', searchFields: ['name', 'email'], titleField: 'name', refField: 'email', route: '/ops/rbac', omit: ['passwordHash', 'failedLogins', 'lockedUntil'] },
];

export const kindDef = (kind: string) => KINDS.find((k) => k.kind === kind);

export const canSee = (k: KindDef, perms: Set<string>) => k.perms.length === 0 || k.perms.some((p) => perms.has(p));

interface Delegate {
  findMany(args: object): Promise<Record<string, unknown>[]>;
  findUnique(args: object): Promise<Record<string, unknown> | null>;
}
const delegate = (k: KindDef) => (prisma as unknown as Record<string, Delegate>)[k.delegate]!;

export interface SearchHit {
  kind: string;
  kindLabel: string;
  id: string;
  ref: string | null;
  title: string;
  status: string | null;
  href: string;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function searchKind(k: KindDef, q: string, take: number): Promise<SearchHit[]> {
  const where = { OR: k.searchFields.map((f) => ({ [f]: { contains: q } })) };
  const rows = await delegate(k).findMany({ where, take, orderBy: { [k.refField ?? k.titleField]: 'asc' } });
  return rows.map((r) => ({
    kind: k.kind,
    kindLabel: k.label,
    id: text(r.id),
    ref: k.refField ? text(r[k.refField]) || null : null,
    title: text(r[k.titleField]) || text(r.id),
    status: k.statusField ? text(r[k.statusField]) || null : null,
    href: `/ops/record/${k.kind}/${text(r.id)}`,
  }));
}

const SENSITIVE = /(hash|secret|password|token|storage|enc|key|salt)$/i;

const humanise = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

export interface RecordView {
  kind: string;
  kindLabel: string;
  id: string;
  ref: string | null;
  title: string;
  status: string | null;
  route: string;
  fields: { label: string; value: string }[];
}

export async function loadRecord(k: KindDef, id: string): Promise<RecordView | null> {
  const row = await delegate(k).findUnique({ where: { id } });
  if (!row) return null;
  const omit = new Set(k.omit ?? []);
  const fields: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(row)) {
    if (omit.has(key) || SENSITIVE.test(key) || raw === null || raw === undefined) continue;
    let value: string;
    if (raw instanceof Date) value = raw.toISOString();
    else if (typeof raw === 'object') {
      const s = JSON.stringify(raw);
      value = s.length > 400 ? `${s.slice(0, 400)}...` : s;
    } else value = String(raw);
    fields.push({ label: humanise(key), value });
  }
  return {
    kind: k.kind,
    kindLabel: k.label,
    id,
    ref: k.refField ? text(row[k.refField]) || null : null,
    title: text(row[k.titleField]) || id,
    status: k.statusField ? text(row[k.statusField]) || null : null,
    route: k.route,
    fields,
  };
}
