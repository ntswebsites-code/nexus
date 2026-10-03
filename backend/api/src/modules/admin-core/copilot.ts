import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { matchPortfolio, routeIntent, type CopilotIntent } from './admin-core.engine';

/**
 * Investment Copilot: a deterministic, grounded query router. No external model or key: the question is routed to a
 * domain by keywords, answered from live database rows the caller is permitted to see, and every answer lists its
 * sources (the data set, row count, as-of time and the console page that shows the same data).
 */

export interface CopilotSource {
  label: string;
  endpoint: string;
  rows: number;
  href: string;
  asOf: string;
}

export interface CopilotAnswer {
  intent: CopilotIntent;
  answer: string;
  table: { columns: string[]; rows: string[][] } | null;
  sources: CopilotSource[];
  /** R4-8: more result tables when the question needed several data sets. */
  extraTables?: { title: string; columns: string[]; rows: string[][] }[];
  /** R4-8: which engine answered (the LLM adapter calling tools, or the keyword router) and the tool calls it made. */
  engine?: 'LLM' | 'ROUTER';
  toolCalls?: CopilotToolCall[];
  model?: string;
}

export interface CopilotToolCall {
  tool: string;
  permission: string | null;
  status: 'OK' | 'DENIED';
  rows: number;
}

const D = Prisma.Decimal;
const fmt = (v: Prisma.Decimal | number | string, dp = 2) =>
  new D(v.toString()).toDecimalPlaces(dp).toNumber().toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const day = (d: Date) => d.toISOString().slice(0, 10);

export const SUGGESTIONS = [
  'What are our largest positions?',
  'Which orders are awaiting approval?',
  'Show the latest NAV for each portfolio',
  'Are there open reconciliation breaks?',
  'Any open risk breaches?',
  'What is the cash position by portfolio?',
  'What approvals are waiting on me?',
  'Show recent audit activity',
  'Are the books balanced and which journals await approval?',
];

const src = (label: string, endpoint: string, rows: number, href: string): CopilotSource => ({ label, endpoint, rows, href, asOf: new Date().toISOString() });
const denied = (intent: CopilotIntent, perm: string): CopilotAnswer => ({
  intent,
  answer: `I cannot answer that for you: it draws on data that needs the ${perm} permission, which your roles do not include.`,
  table: null,
  sources: [],
});

export async function answerQuestion(question: string, perms: Set<string>): Promise<CopilotAnswer> {
  const { intent } = routeIntent(question);
  switch (intent) {
    case 'positions':
      return perms.has('portfolio.view') ? positions(question) : denied(intent, 'portfolio.view');
    case 'orders':
      return perms.has('orders.view') ? orders() : denied(intent, 'orders.view');
    case 'nav':
      return perms.has('valuation.view') ? nav() : denied(intent, 'valuation.view');
    case 'breaks':
      return perms.has('operations.view') ? breaks() : denied(intent, 'operations.view');
    case 'risk':
      return perms.has('risk.view') ? risk() : denied(intent, 'risk.view');
    case 'cash':
      return perms.has('cash.view') ? cash() : denied(intent, 'cash.view');
    case 'approvals':
      return approvals(perms);
    case 'audit':
      return perms.has('audit.view') ? auditTrail() : denied(intent, 'audit.view');
    case 'accounting':
      return perms.has('valuation.view') ? accounting() : denied(intent, 'valuation.view');
    default:
      return {
        intent: 'help',
        answer:
          'I answer from live platform data: positions and exposure, orders and approvals, NAV runs, accounting journals, reconciliation breaks, risk breaches, cash by portfolio, pending approvals and recent audit activity. Try one of the suggested questions. I do not give investment advice.',
        table: null,
        sources: [],
      };
  }
}

async function positions(question: string): Promise<CopilotAnswer> {
  const portfolios = await prisma.portfolio.findMany({ where: { status: 'Active' }, select: { id: true, ref: true, name: true, baseCurrency: true } });
  const chosen = matchPortfolio(question, portfolios);
  const scope = chosen ? [chosen] : portfolios;
  const rows = await prisma.portfolioPosition.findMany({
    where: { portfolioId: { in: scope.map((p) => p.id) } },
    orderBy: { asOf: 'desc' },
    include: { security: { select: { ticker: true, name: true, currency: true } } },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(`${r.portfolioId}:${r.securityId}`)) latest.set(`${r.portfolioId}:${r.securityId}`, r);
  const held = [...latest.values()].filter((r) => r.quantity.gt(0));
  const prices = await prisma.securityPrice.findMany({ where: { securityId: { in: [...new Set(held.map((h) => h.securityId))] } }, orderBy: { priceDate: 'desc' } });
  const px = new Map<string, Prisma.Decimal>();
  for (const p of prices) if (!px.has(p.securityId)) px.set(p.securityId, p.price);
  const name = new Map(portfolios.map((p) => [p.id, p]));
  const valued = held
    .map((h) => ({ h, price: px.get(h.securityId) ?? h.avgCost, priced: px.has(h.securityId) }))
    .map((v) => ({ ...v, mv: v.h.quantity.mul(v.price) }))
    .sort((a, b) => b.mv.comparedTo(a.mv));
  const totals = new Map<string, Prisma.Decimal>();
  for (const v of valued) totals.set(v.h.portfolioId, (totals.get(v.h.portfolioId) ?? new D(0)).plus(v.mv));
  const sources = [
    src('Portfolio positions', 'portfolio_positions (latest as-of per holding)', held.length, '/ops/portfolios'),
    src('Security prices', 'security_prices (latest per security)', px.size, '/ops/securities'),
  ];
  if (!valued.length) return { intent: 'positions', answer: chosen ? `${chosen.name} (${chosen.ref}) holds no positions.` : 'No active portfolio holds positions.', table: null, sources };
  const top = valued.slice(0, 10);
  const head = chosen
    ? `${chosen.name} (${chosen.ref}) holds ${valued.length} positions worth about ${fmt(totals.get(chosen.id) ?? 0)} ${chosen.baseCurrency}. Largest holding: ${top[0]!.h.security.ticker} at ${fmt(top[0]!.mv)}.`
    : `${scope.length} active portfolios hold ${valued.length} positions. Largest single position: ${top[0]!.h.security.ticker} in ${name.get(top[0]!.h.portfolioId)?.ref} at ${fmt(top[0]!.mv)}. Values are shown per portfolio in their own currency and not added together.`;
  const unpriced = valued.filter((v) => !v.priced).length;
  return {
    intent: 'positions',
    answer: head + (unpriced ? ` ${unpriced} position(s) have no market price and use average cost.` : ''),
    table: {
      columns: ['Portfolio', 'Security', 'Quantity', 'Price', 'Market value', 'Weight', 'Valued at'],
      rows: top.map((v) => [
        name.get(v.h.portfolioId)?.ref ?? '',
        v.h.security.ticker,
        fmt(v.h.quantity, 0),
        fmt(v.price, 4),
        `${fmt(v.mv)} ${v.h.security.currency}`,
        `${fmt(v.mv.div(totals.get(v.h.portfolioId) || 1).mul(100), 1)}%`,
        v.priced ? 'Market' : 'Avg cost',
      ]),
    },
    sources,
  };
}

async function orders(): Promise<CopilotAnswer> {
  const [groups, waiting] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { status: { notIn: ['Draft', 'Validated'] } }, _count: { _all: true } }),
    prisma.order.findMany({ where: { status: 'AwaitingApproval' }, orderBy: { submittedAt: 'asc' }, take: 10 }),
  ]);
  const secs = await prisma.security.findMany({ where: { id: { in: waiting.map((o) => o.securityId) } }, select: { id: true, ticker: true } });
  const ports = await prisma.portfolio.findMany({ where: { id: { in: waiting.map((o) => o.portfolioId) } }, select: { id: true, ref: true } });
  const tk = new Map(secs.map((s) => [s.id, s.ticker]));
  const pf = new Map(ports.map((p) => [p.id, p.ref]));
  const total = groups.reduce((n, g) => n + g._count._all, 0);
  const mix = groups.map((g) => `${g._count._all} ${g.status}`).join(', ') || 'none';
  return {
    intent: 'orders',
    answer: `${total} orders are past draft (${mix}). ${waiting.length} awaiting approval${waiting.length ? ', oldest first below' : ''}.`,
    table: waiting.length
      ? {
          columns: ['Order', 'Portfolio', 'Security', 'Side', 'Quantity', 'Submitted'],
          rows: waiting.map((o) => [o.ref, pf.get(o.portfolioId) ?? '', tk.get(o.securityId) ?? '', o.side, fmt(o.quantity, 0), o.submittedAt ? day(o.submittedAt) : '']),
        }
      : null,
    sources: [src('Orders', 'orders (status counts and AwaitingApproval queue)', total, '/ops/orders')],
  };
}

async function nav(): Promise<CopilotAnswer> {
  const runs = await prisma.navRun.findMany({ orderBy: [{ navDate: 'desc' }, { version: 'desc' }], take: 60 });
  const seen = new Set<string>();
  const latest = runs.filter((r) => (seen.has(r.portfolioId) ? false : (seen.add(r.portfolioId), true))).slice(0, 10);
  const ports = await prisma.portfolio.findMany({ where: { id: { in: latest.map((r) => r.portfolioId) } }, select: { id: true, ref: true, name: true } });
  const pf = new Map(ports.map((p) => [p.id, p]));
  const open = await prisma.navException.count({ where: { status: 'OPEN', runId: { in: latest.map((r) => r.id) } } });
  if (!latest.length) return { intent: 'nav', answer: 'No NAV runs exist yet.', table: null, sources: [src('NAV runs', 'nav_runs', 0, '/ops/nav')] };
  return {
    intent: 'nav',
    answer: `Latest NAV run for ${latest.length} portfolio(s). ${open} open exception(s) across these runs. Runs not in RELEASED status are drafts, not official NAV.`,
    table: {
      columns: ['Run', 'Portfolio', 'NAV date', 'Status', 'NAV', 'Per unit'],
      rows: latest.map((r) => [r.ref, pf.get(r.portfolioId)?.name ?? '', day(r.navDate), r.status, `${fmt(r.nav)} ${r.baseCurrency}`, r.navPerUnit ? fmt(r.navPerUnit, 4) : '-']),
    },
    sources: [src('NAV runs', 'nav_runs (latest per portfolio)', latest.length, '/ops/nav'), src('NAV exceptions', 'nav_exceptions (OPEN)', open, '/ops/nav')],
  };
}

async function breaks(): Promise<CopilotAnswer> {
  const openStates = ['NEW', 'ASSIGNED', 'INVESTIGATING', 'PENDING_CHECKER'];
  const [groups, top] = await Promise.all([
    prisma.reconBreak.groupBy({ by: ['severity'], where: { status: { in: openStates } }, _count: { _all: true } }),
    prisma.reconBreak.findMany({ where: { status: { in: openStates } }, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], take: 10 }),
  ]);
  const total = groups.reduce((n, g) => n + g._count._all, 0);
  const sev = groups.map((g) => `${g._count._all} ${g.severity}`).join(', ');
  return {
    intent: 'breaks',
    answer: total ? `${total} reconciliation breaks are open (${sev}). The oldest are listed below.` : 'There are no open reconciliation breaks.',
    table: top.length
      ? {
          columns: ['Break', 'Family', 'Item', 'Severity', 'Status', 'Difference', 'Opened'],
          rows: top.map((b) => [b.ref, b.family, b.label, b.severity, b.status, b.difference ? `${fmt(b.difference)} ${b.currency ?? ''}`.trim() : '-', day(b.createdAt)]),
        }
      : null,
    sources: [src('Reconciliation breaks', 'recon_breaks (open statuses)', total, '/ops/reconciliation')],
  };
}

async function risk(): Promise<CopilotAnswer> {
  const rows = await prisma.riskBreach.findMany({ where: { status: 'OPEN' }, orderBy: { detectedOn: 'desc' }, take: 10, include: { limit: { select: { ref: true, metric: true, breachAction: true } } } });
  const ports = await prisma.portfolio.findMany({ where: { id: { in: rows.map((r) => r.portfolioId) } }, select: { id: true, ref: true } });
  const pf = new Map(ports.map((p) => [p.id, p.ref]));
  const total = await prisma.riskBreach.count({ where: { status: 'OPEN' } });
  return {
    intent: 'risk',
    answer: total ? `${total} risk limit breaches are open. The most recent ${rows.length} are listed below.` : 'There are no open risk limit breaches.',
    table: rows.length
      ? {
          columns: ['Limit', 'Metric', 'Portfolio', 'Detected', 'Value %', 'Threshold %', 'Action'],
          rows: rows.map((r) => [r.limit.ref, r.limit.metric, pf.get(r.portfolioId) ?? '', day(r.detectedOn), fmt(r.value, 2), fmt(r.threshold, 2), r.limit.breachAction]),
        }
      : null,
    sources: [src('Risk breaches', 'risk_breaches (OPEN)', total, '/ops/risk')],
  };
}

async function cash(): Promise<CopilotAnswer> {
  const rows = await prisma.portfolioCash.findMany({ orderBy: { asOf: 'desc' } });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(`${r.portfolioId}:${r.currency}`)) latest.set(`${r.portfolioId}:${r.currency}`, r);
  const list = [...latest.values()].sort((a, b) => b.available.comparedTo(a.available));
  const ports = await prisma.portfolio.findMany({ where: { id: { in: list.map((l) => l.portfolioId) } }, select: { id: true, ref: true, name: true } });
  const pf = new Map(ports.map((p) => [p.id, p]));
  const reserved = await prisma.cashReservation.aggregate({ where: { status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] } }, _count: { _all: true }, _sum: { amount: true } }).catch(() => null);
  const byCcy = new Map<string, Prisma.Decimal>();
  for (const l of list) byCcy.set(l.currency, (byCcy.get(l.currency) ?? new D(0)).plus(l.available));
  const totals = [...byCcy.entries()].map(([c, v]) => `${fmt(v)} ${c}`).join(', ');
  return {
    intent: 'cash',
    answer: list.length ? `Available cash across ${list.length} portfolio balances: ${totals}.${reserved?._count._all ? ` ${reserved._count._all} live reservation(s) are held against cash.` : ''}` : 'No cash balances are recorded.',
    table: list.length
      ? { columns: ['Portfolio', 'Name', 'Currency', 'Available', 'As of'], rows: list.slice(0, 12).map((l) => [pf.get(l.portfolioId)?.ref ?? '', pf.get(l.portfolioId)?.name ?? '', l.currency, fmt(l.available), day(l.asOf)]) }
      : null,
    sources: [src('Portfolio cash', 'portfolio_cash (latest per portfolio and currency)', list.length, '/ops/cash'), src('Cash reservations', 'cash_reservations (live)', reserved?._count._all ?? 0, '/ops/cash')],
  };
}

async function approvals(perms: Set<string>): Promise<CopilotAnswer> {
  const lines: string[] = [];
  const sources: CopilotSource[] = [];
  const rows: string[][] = [];
  if (perms.has('orders.view')) {
    const n = await prisma.order.count({ where: { status: 'AwaitingApproval' } });
    lines.push(`${n} order(s) awaiting approval`);
    rows.push(['Orders', String(n), '/ops/orders']);
    sources.push(src('Orders', 'orders (AwaitingApproval)', n, '/ops/orders'));
  }
  if (perms.has('admin.rbac')) {
    const n = await prisma.accessChangeRequest.count({ where: { status: 'PENDING' } });
    lines.push(`${n} access change request(s) pending`);
    rows.push(['Access changes', String(n), '/ops/rbac']);
    sources.push(src('Access change requests', 'access_change_requests (PENDING)', n, '/ops/rbac'));
  }
  if (perms.has('valuation.view')) {
    const n = await prisma.navRun.count({ where: { status: { in: ['MAKER_REVIEWED', 'EXCEPTIONS_OPEN'] } } });
    lines.push(`${n} NAV run(s) in review`);
    rows.push(['NAV runs', String(n), '/ops/nav']);
    sources.push(src('NAV runs', 'nav_runs (in review)', n, '/ops/nav'));
  }
  if (!rows.length) return denied('approvals', 'orders.view, admin.rbac or valuation.view');
  return { intent: 'approvals', answer: `Waiting for approval: ${lines.join('; ')}.`, table: { columns: ['Queue', 'Items', 'Console page'], rows }, sources };
}

async function auditTrail(): Promise<CopilotAnswer> {
  const rows = await prisma.auditEvent.findMany({ orderBy: { id: 'desc' }, take: 10 });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const nm = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  return {
    intent: 'audit',
    answer: `The ${rows.length} most recent audit events are listed below. Open the Audit Trail page to filter, drill into an entity or verify the hash chain.`,
    table: { columns: ['When (UTC)', 'Who', 'Action', 'Object'], rows: rows.map((r) => [r.occurredAt.toISOString().replace('T', ' ').slice(0, 19), r.actorId ? nm.get(r.actorId) ?? 'Unknown' : 'System', r.action, `${r.objectType} ${r.objectId.slice(0, 12)}`]) },
    sources: [src('Audit events', 'audit_events (latest)', rows.length, '/ops/audit')],
  };
}

async function accounting(): Promise<CopilotAnswer> {
  const [groups, pending, periods, posted] = await Promise.all([
    prisma.accJournal.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.accJournal.findMany({ where: { status: 'PENDING_APPROVAL' }, orderBy: { submittedAt: 'asc' }, take: 10 }),
    prisma.accPeriod.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.accJournal.aggregate({ where: { status: { in: ['POSTED', 'REVERSED'] } }, _sum: { totalDebit: true, totalCredit: true } }),
  ]);
  const ports = await prisma.portfolio.findMany({ where: { id: { in: pending.map((j) => j.portfolioId) } }, select: { id: true, ref: true } });
  const pf = new Map(ports.map((p) => [p.id, p.ref]));
  const total = groups.reduce((n, g) => n + g._count._all, 0);
  const mix = groups.map((g) => `${g._count._all} ${g.status}`).join(', ') || 'none';
  const dr = posted._sum.totalDebit ?? new D(0);
  const cr = posted._sum.totalCredit ?? new D(0);
  const per = periods.map((p) => `${p._count._all} ${p.status}`).join(', ') || 'none';
  return {
    intent: 'accounting',
    answer: `${total} journals (${mix}). Posted debits ${fmt(dr)} and credits ${fmt(cr)}: the books ${dr.equals(cr) ? 'balance' : 'DO NOT balance'}. Accounting periods: ${per}. ${pending.length} journal(s) awaiting approval${pending.length ? ', oldest first below' : ''}.`,
    table: pending.length
      ? { columns: ['Journal', 'Portfolio', 'Entry date', 'Description', 'Debit', 'Submitted'], rows: pending.map((j) => [j.ref, pf.get(j.portfolioId) ?? '', day(j.entryDate), j.description.slice(0, 60), `${fmt(j.totalDebit)} ${j.currency}`, j.submittedAt ? day(j.submittedAt) : '']) }
      : null,
    sources: [src('Accounting journals', 'acc_journals (status counts, PENDING_APPROVAL queue, posted totals)', total, '/ops/accounting'), src('Accounting periods', 'acc_periods (status counts)', periods.reduce((n, p) => n + p._count._all, 0), '/ops/accounting')],
  };
}

// ------------------------------------------------------------------ R4-8: tools the LLM adapter can call

export interface CopilotTool {
  name: CopilotIntent;
  /** Permission the caller needs (null: the tool applies its own per-queue permission checks). */
  permission: string | null;
  description: string;
  run: (question: string, perms: Set<string>) => Promise<CopilotAnswer>;
}

/** Every tool reads live rows only, is permission-gated by the same rules as the router, and returns its sources as citations. */
export const COPILOT_TOOLS: CopilotTool[] = [
  { name: 'positions', permission: 'portfolio.view', description: 'Largest positions and market value by portfolio (optionally one portfolio by ref or name)', run: (q) => positions(q) },
  { name: 'orders', permission: 'orders.view', description: 'Order status counts and the queue awaiting approval', run: () => orders() },
  { name: 'nav', permission: 'valuation.view', description: 'Latest NAV run per portfolio and open NAV exceptions', run: () => nav() },
  { name: 'breaks', permission: 'operations.view', description: 'Open reconciliation breaks by severity', run: () => breaks() },
  { name: 'risk', permission: 'risk.view', description: 'Open risk limit breaches', run: () => risk() },
  { name: 'cash', permission: 'cash.view', description: 'Available cash by portfolio and currency, with live reservations', run: () => cash() },
  { name: 'approvals', permission: null, description: 'Items waiting for approval (orders, access changes, NAV runs) the caller may see', run: (_q, p) => approvals(p) },
  { name: 'audit', permission: 'audit.view', description: 'Most recent audit events', run: () => auditTrail() },
  { name: 'accounting', permission: 'valuation.view', description: 'Journals by status, posted debit/credit balance, accounting periods and the approval queue', run: () => accounting() },
];
