import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { num } from '../../lib/http';
import { fmtDate, fmtDay, fmtOpened, fmtSize, fmtStamp } from '../../lib/format';

export const INVESTOR_ROLE_LABELS: Record<string, string> = {
  admin: 'Investor Admin',
  investment: 'Investment Viewer',
  finance: 'Finance / Treasury',
  auditor: 'Auditor',
};

export const SCOPE_LABELS: Record<string, string> = {
  all: 'All accounts',
  managed: 'Managed accounts only',
  private: 'Private funds only',
  documents: 'Documents only',
};

/** Investor roles that may sign on behalf of the client (authorised signatories). */
export const SIGNING_ROLES = new Set(['admin', 'finance']);

export interface InvestorContext {
  userId: string;
  client: { id: string; ref: string; name: string; baseCurrency: string };
  role: string;
  scope: string;
  permissions: Set<string>;
}

/**
 * Resolves the signed-in investor's client relationship. Every investor query is
 * filtered by `client.id` from here - never from request input (SRD 8.2).
 */
export async function investorContext(req: Request): Promise<InvestorContext> {
  const user = req.user!;
  const requested = typeof req.query.client === 'string' ? req.query.client : undefined;
  const memberships = await prisma.clientUser.findMany({
    where: { userId: user.id, client: { archivedAt: null } },
    include: { client: { select: { id: true, ref: true, name: true, baseCurrency: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const m = (requested && memberships.find((x) => x.client.ref === requested)) || memberships[0];
  if (!m) throw HttpError.forbidden('This account is not linked to an investor relationship', 'no_client_access');
  const role = await prisma.role.findUnique({
    where: { portal_key: { portal: 'investor', key: m.investorRole } },
    include: { permissions: true },
  });
  return {
    userId: user.id,
    client: m.client,
    role: m.investorRole,
    scope: m.accountScope,
    permissions: new Set(role?.permissions.map((p) => p.permission) ?? []),
  };
}

export function requireInvestorPermission(ic: InvestorContext, code: string) {
  if (!ic.permissions.has(code)) {
    throw HttpError.forbidden('Your portal role does not include this workspace', 'permission_denied');
  }
}

const isPrivate = (kind: string) => kind.includes('Private');

function scopeAllows(scope: string, kind: string) {
  if (scope === 'documents') return false;
  if (scope === 'managed') return !isPrivate(kind);
  if (scope === 'private') return isPrivate(kind);
  return true;
}

// ---------------------------------------------------------------- snapshot

export const snapshotInclude = {
  investments: { orderBy: { sort: 'asc' } },
  holdings: { orderBy: { sort: 'asc' } },
  transactions: { orderBy: [{ tradeDate: 'desc' }, { sort: 'asc' }] },
  performance: { orderBy: [{ range: 'asc' }, { idx: 'asc' }] },
  allocation: { orderBy: { sort: 'asc' } },
} satisfies Prisma.InvestorSnapshotInclude;

export type SnapshotRow = Prisma.InvestorSnapshotGetPayload<{ include: typeof snapshotInclude }>;

export function latestPublishedSnapshot(clientId: string) {
  return prisma.investorSnapshot.findFirst({
    where: { clientId, status: 'Published' },
    orderBy: [{ valuationDate: 'desc' }, { publishedAt: 'desc' }],
    include: snapshotInclude,
  });
}

export function investmentView(i: SnapshotRow['investments'][number]) {
  return {
    id: i.key,
    name: i.name,
    kind: i.kind,
    value: num(i.value)!,
    return: num(i.returnPct),
    benchmark: num(i.benchmarkPct),
    ccy: i.currency,
    status: i.status,
    unfunded: num(i.unfunded) ?? 0,
    commitment: num(i.commitment) ?? 0,
    called: num(i.called) ?? 0,
    irr: num(i.irr),
    tvpi: num(i.tvpi),
    dpi: num(i.dpi),
    dist: num(i.distributions),
  };
}

export function holdingView(h: SnapshotRow['holdings'][number]) {
  return {
    id: h.key,
    security: h.security,
    account: h.account,
    asset: h.asset,
    qty: h.quantity,
    price: h.price,
    value: num(h.value)!,
    weight: num(h.weightPct)!,
    ytd: num(h.ytdPct)!,
  };
}

export function transactionView(t: SnapshotRow['transactions'][number]) {
  return {
    id: t.key,
    date: fmtDate(t.tradeDate),
    type: t.type,
    account: t.account,
    desc: t.description,
    qty: t.quantity,
    amount: num(t.amount)!,
    status: t.status,
  };
}

/** `{ '1M': [[0,0],[1,.3],...], ... }` - the prototype's chart series. */
export function performanceSets(points: SnapshotRow['performance']) {
  const sets: Record<string, [number, number][]> = {};
  const bench: Record<string, [number, number][]> = {};
  for (const p of points) {
    (sets[p.range] ??= []).push([p.idx, num(p.portfolioPct)!]);
    if (p.benchmarkPct !== null) (bench[p.range] ??= []).push([p.idx, num(p.benchmarkPct)!]);
  }
  return { sets, bench };
}

/** Portfolio data filtered by the member's account scope. */
export function scopedSnapshot(s: SnapshotRow | null, scope: string) {
  if (!s) return null;
  const investments = s.investments.filter((i) => scopeAllows(scope, i.kind));
  const accounts = new Set(investments.map((i) => i.name));
  const holdingOk = (account: string) => scope === 'all' || accounts.has(account) || (scope !== 'documents' && account === 'Consolidated');
  const { sets, bench } = performanceSets(s.performance);
  return {
    id: s.id,
    valuationDate: fmtDate(s.valuationDate),
    reportingCurrency: s.reportingCurrency,
    fx: s.fx,
    metrics: s.metrics,
    activity: s.activity,
    investments: investments.map(investmentView),
    holdings: s.holdings.filter((h) => holdingOk(h.account)).map(holdingView),
    transactions: s.transactions.filter((t) => holdingOk(t.account)).map(transactionView),
    perfSets: sets,
    benchSets: bench,
    allocation: s.allocation.map((a) => ({ label: a.label, pct: num(a.pct)! })),
  };
}

// ---------------------------------------------------------------- capital

type CapitalRow = Prisma.CapitalEventGetPayload<object>;

export function capitalView(c: CapitalRow) {
  return {
    id: c.ref,
    date: fmtDate(c.publishedAt ?? c.createdAt),
    investment: c.investmentName,
    type: c.type,
    amount: num(c.amount)!,
    status: c.status,
    evidence: c.evidenceName ?? (c.type === 'Capital call' ? 'Not uploaded' : 'Notice published'),
    due: fmtDate(c.dueDate),
    purpose: c.purpose ?? '',
    breakdown: (c.breakdown as [string, number][] | null) ?? [],
    bank: c.bankText ?? '',
    ccy: c.currency,
    version: c.version,
  };
}

/** Investor-visible capital events: published and in an investor-facing state. */
export const publishedCapitalWhere = (clientId: string): Prisma.CapitalEventWhereInput => ({
  clientId,
  publishedAt: { not: null },
  status: { in: ['Expected', 'Due', 'Processing', 'Funded', 'Paid'] },
});

// ---------------------------------------------------------------- documents

export const publishedDocInclude = (clientId: string, userId: string) =>
  ({
    versions: { orderBy: { version: 'desc' }, take: 1 },
    publications: { where: { clientId, withdrawnAt: null } },
    reads: { where: { userId } },
    signatureRequests: { where: { clientId, status: 'Pending' } },
  }) satisfies Prisma.DocumentInclude;

export type PublishedDocRow = Prisma.DocumentGetPayload<{ include: ReturnType<typeof publishedDocInclude> }>;

export const publishedDocWhere = (clientId: string): Prisma.DocumentWhereInput => ({
  status: 'Published',
  publications: { some: { clientId, withdrawnAt: null } },
});

export function documentView(d: PublishedDocRow, sizes: Map<string, number>) {
  const v = d.versions[0];
  const published = d.publications[0]?.publishedAt ?? d.approvedAt ?? d.createdAt;
  const date = d.documentDate ?? published;
  return {
    id: d.ref,
    title: d.name,
    type: d.type,
    label: d.label ?? d.type,
    date: fmtDate(date),
    year: String(d.year ?? new Date(date).getFullYear()),
    investment: d.relatedLabel ?? 'Consolidated',
    size: fmtSize(v ? sizes.get(v.fileId) : null),
    unread: d.reads.length === 0,
    signature: d.signatureRequests.length > 0,
    hasFile: !!v,
  };
}

export async function fileSizes(docs: { versions: { fileId: string }[] }[]) {
  const ids = docs.flatMap((d) => d.versions.map((v) => v.fileId));
  const files = ids.length
    ? await prisma.fileObject.findMany({ where: { id: { in: ids } }, select: { id: true, size: true } })
    : [];
  return new Map(files.map((f) => [f.id, f.size]));
}

// ---------------------------------------------------------------- requests & threads

export const requestInclude = { events: { orderBy: { at: 'asc' } } } satisfies Prisma.ServiceRequestInclude;
type RequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

export function requestView(r: RequestRow) {
  return {
    id: r.ref,
    title: r.title,
    type: r.type,
    priority: r.priority,
    status: r.status,
    owner: r.ownerName,
    opened: fmtOpened(r.createdAt),
    progress: r.progress,
    detail: r.detail ?? '',
    timeline: r.events.map((e) => [fmtOpened(e.at).replace('Today · ', ''), e.title, e.detail ?? ''] as [string, string, string]),
    hasFile: !!r.fileId,
    version: r.version,
  };
}

export const threadInclude = (userId: string) =>
  ({
    messages: { orderBy: { createdAt: 'asc' } },
    reads: { where: { userId } },
  }) satisfies Prisma.MessageThreadInclude;
type ThreadRow = Prisma.MessageThreadGetPayload<{ include: ReturnType<typeof threadInclude> }>;

/** `fromClient` messages are "me" for investor viewers and "them" for staff. */
export function threadView(t: ThreadRow, viewer: 'investor' | 'staff') {
  const readAt = t.reads[0]?.readAt?.getTime() ?? 0;
  const mine = (m: ThreadRow['messages'][number]) => (viewer === 'investor' ? m.fromClient : !m.fromClient);
  const last = t.messages.at(-1)?.createdAt ?? t.createdAt;
  return {
    id: t.id,
    title: t.title,
    owner: t.ownerName,
    role: t.ownerRole ?? 'Client Services',
    last: fmtDay(last),
    unread: t.messages.filter((m) => !mine(m) && m.createdAt.getTime() > readAt).length,
    messages: t.messages.map((m) => ({ who: mine(m) ? 'me' : 'them', text: m.body, time: fmtStamp(m.createdAt), author: m.authorName })),
  };
}

// ---------------------------------------------------------------- users

export async function portalUsersView(clientId: string) {
  const [members, invites] = await Promise.all([
    prisma.clientUser.findMany({
      where: { clientId },
      include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { clientId, portal: 'investor', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return [
    ...members.map((m) => ({
      id: m.id,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      role: INVESTOR_ROLE_LABELS[m.investorRole] ?? m.investorRole,
      roleKey: m.investorRole,
      scope: SCOPE_LABELS[m.accountScope] ?? m.accountScope,
      last: m.user.lastLoginAt ? fmtStamp(m.user.lastLoginAt).replace(/^(\d\d:\d\d)$/, 'Today · $1') : 'Never signed in',
      pending: false,
    })),
    ...invites.map((i) => {
      const key = ((i.roleKeys as string[]) ?? [])[0] ?? 'investment';
      return {
        id: i.id,
        name: i.name ?? i.email,
        email: i.email,
        role: INVESTOR_ROLE_LABELS[key] ?? key,
        roleKey: key,
        scope: SCOPE_LABELS[i.scope ?? 'all'] ?? i.scope ?? 'All accounts',
        last: 'Invitation pending',
        pending: true,
      };
    }),
  ];
}

export function bankInstructionView(b: { bank: string; accountName: string | null; masked: string; verifiedAt: Date | null; version: number } | null) {
  if (!b) return null;
  return {
    bank: b.bank,
    accountName: b.accountName,
    masked: b.masked.replace('**** ', '•••• '),
    lastVerified: fmtDate(b.verifiedAt),
    version: b.version,
  };
}