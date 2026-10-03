import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue, type NotifyPermissionPayload, type NotifyUsersPayload } from '../../lib/outbox';
import { ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { requirePermission } from '../../middleware/requireAuth';
import { validateBody } from '../../middleware/validate';
import { IntegrationNotConfiguredError, dayFromIso, isoDay, lastWeekdayOnOrBefore } from '../../integrations/common';
import { custodianFeedMode, getCustodianFeedAdapter } from '../../integrations/custodian-feed';
import { ingestStatementFile } from '../../integrations/custodian-feed/file-drop';
import { fakeStatementFile } from '../../integrations/custodian-feed/fake';
import { StatementParseError, parseStatements } from '../../integrations/custodian-feed/parsers';
import { createInvitation } from '../identity/invitations';
import { saveInviteGrant } from '../identity/invite-grant';
import { CURRENCIES } from './custodian.schemas';
import { cp, dayEndView, executionView, filesById, latestReviews, packageHash, tradeControlFor } from './custodian.service';

/**
 * Native custodian portal support (R4-7): dashboard, day-end control totals, statement and holdings upload through the
 * custodian-feed adapter layer, and counterparty user / role management. Mounted by `custodian.routes.ts` after
 * authentication and counterparty resolution. Everything is scoped to the signed-in user's counterparty.
 */
export const custodianNativeRoutes = Router();

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'custodian');
const D = Prisma.Decimal;

// ------------------------------------------------------------------ dashboard

custodianNativeRoutes.get('/dashboard', async (req, res) => {
  const c = cp(res);
  const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [byStatus, today, awaiting, rejected, exceptions, lastFile, unread, drafts] = await Promise.all([
    prisma.counterpartyExecution.groupBy({ by: ['status'], where: { counterpartyId: c.id, cancelledAt: null }, _count: { _all: true } }),
    prisma.counterpartyExecution.count({ where: { counterpartyId: c.id, submittedAt: { gte: dayStart }, cancelledAt: null } }),
    prisma.counterpartyDayEndPackage.findMany({ where: { counterpartyId: c.id, status: 'Received' }, orderBy: { submittedAt: 'desc' }, take: 10 }),
    prisma.counterpartyDayEndPackage.findMany({ where: { counterpartyId: c.id, status: 'Rejected' }, orderBy: { submittedAt: 'desc' }, take: 5 }),
    prisma.counterpartyExecution.findMany({ where: { counterpartyId: c.id, status: { in: ['Exception', 'Queried'] }, cancelledAt: null }, orderBy: { submittedAt: 'desc' }, take: 10 }),
    prisma.custodianFeedFile.findFirst({ where: { counterpartyId: c.id, status: 'Imported' }, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    prisma.counterpartyDayEndPackage.count({ where: { counterpartyId: c.id, status: 'Draft', submittedById: req.user!.id } }),
  ]);
  const reviews = await latestReviews(rejected.map((r) => r.id));
  res.json({
    counterparty: { ref: c.ref, name: c.name, type: c.type, accounts: c.accounts },
    role: c.role,
    executions: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    submittedToday: today,
    draftPackages: drafts,
    unreadNotifications: unread,
    awaitingApproval: awaiting.map((p) => dayEndView(p)),
    rejectedPackages: rejected.map((p) => ({ ...dayEndView(p), review: reviews.get(p.id) ? { decision: reviews.get(p.id)!.decision, note: reviews.get(p.id)!.note, at: reviews.get(p.id)!.at } : null })),
    exceptions: exceptions.map(executionView),
    lastStatement: lastFile ? { filename: lastFile.filename, statementDate: lastFile.statementDate ? isoDay(lastFile.statementDate) : null, at: lastFile.createdAt.toISOString() } : null,
    feed: { mode: custodianFeedMode() },
  });
});

// ------------------------------------------------------------------ day-end control totals

/**
 * Control totals of the executions already received for a statement date, per account and currency. The day-end form
 * pre-fills its declared totals from here, and the screen shows any active package covering the same key.
 */
custodianNativeRoutes.get('/control-totals', async (req, res) => {
  const c = cp(res);
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw HttpError.badRequest('Give the statement date as YYYY-MM-DD');
  const start = dayFromIso(date);
  const end = new Date(start.getTime() + 86_400_000);
  const [rows, packages] = await Promise.all([
    prisma.counterpartyExecution.findMany({
      where: { counterpartyId: c.id, executionAt: { gte: start, lt: end }, status: { not: 'Superseded' }, cancelledAt: null },
      select: { accountRef: true, currency: true, quantity: true, price: true },
    }),
    prisma.counterpartyDayEndPackage.findMany({
      where: { counterpartyId: c.id, statementDate: start, status: { notIn: ['Superseded'] } },
      orderBy: { submittedAt: 'desc' },
    }),
  ]);
  const groups = new Map<string, { accountRef: string; currency: string; count: number; quantity: Prisma.Decimal; notional: Prisma.Decimal }>();
  for (const r of rows) {
    const k = `${r.accountRef}|${r.currency}`;
    const g = groups.get(k) ?? { accountRef: r.accountRef, currency: r.currency, count: 0, quantity: new D(0), notional: new D(0) };
    g.count += 1;
    g.quantity = g.quantity.plus(r.quantity);
    g.notional = g.notional.plus(r.quantity.times(r.price));
    groups.set(k, g);
  }
  // Accounts with no executions still show, so a nil day-end can be declared.
  for (const a of c.accounts) if (![...groups.values()].some((g) => g.accountRef === a)) groups.set(`${a}|`, { accountRef: a, currency: '', count: 0, quantity: new D(0), notional: new D(0) });
  res.json({
    date,
    items: [...groups.values()]
      .sort((a, b) => a.accountRef.localeCompare(b.accountRef) || a.currency.localeCompare(b.currency))
      .map((g) => ({
        accountRef: g.accountRef,
        currency: g.currency || null,
        executions: g.count,
        quantity: g.quantity.toFixed(8),
        notional: g.notional.toDecimalPlaces(2).toFixed(2),
        packages: packages.filter((p) => p.accountRef === g.accountRef && (!g.currency || p.currency === g.currency)).map((p) => ({ id: p.id, ref: p.ref, status: p.status, currency: p.currency })),
      })),
  });
});

/** Declared-versus-received control comparison for an existing package, with its status history. */
custodianNativeRoutes.get('/day-end/:id/controls', async (req, res) => {
  const c = cp(res);
  const pkg = await prisma.counterpartyDayEndPackage.findFirst({ where: { id: param(req, 'id'), counterpartyId: c.id } });
  if (!pkg) throw HttpError.notFound('Day-end package not found');
  res.json({ controls: await tradeControlFor(pkg) });
});

// ------------------------------------------------------------------ statements and holdings (custodian-feed adapter)

const statementSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(1_000_000),
  format: z.enum(['CSV', 'MT940', 'JSON']).optional(),
});

function assertUploadChannel() {
  if (custodianFeedMode() === 'live') {
    throw new HttpError(503, 'integration_not_configured', 'The live custodian feed is not configured; upload statements as files instead or ask Matanho operations to enable it', { requiredEnv: ['INTEGRATION_CUSTODIAN_FEED'] });
  }
}

/** Parses a statement file and checks it against this counterparty: account scope, dates, currencies, locked days. */
async function checkStatement(counterpartyId: string, accounts: string[], b: z.infer<typeof statementSchema>) {
  let statements;
  try {
    statements = parseStatements(b.content, b.format);
  } catch (e) {
    if (e instanceof StatementParseError) throw new HttpError(422, 'statement_rejected', e.message, { problems: e.problems });
    throw e;
  }
  const problems: string[] = [];
  const today = isoDay(new Date(Date.now() + 2 * 3_600_000));
  const ccy = new Set<string>(CURRENCIES);
  const out = [];
  for (const s of statements) {
    if (!accounts.includes(s.accountRef)) problems.push(`Account ${s.accountRef} is not serviced by your organisation`);
    if (s.statementDate > today) problems.push(`Statement date ${s.statementDate} for ${s.accountRef} is in the future`);
    if (s.currency && !ccy.has(s.currency)) problems.push(`Currency ${s.currency} for ${s.accountRef} is not supported`);
    for (const t of s.transactions) if (!ccy.has(t.currency)) problems.push(`Trade ${t.tradeRef} has unsupported currency ${t.currency}`);
    const date = dayFromIso(s.statementDate);
    const locked = await prisma.counterpartyDayEndPackage.findFirst({
      where: { counterpartyId, accountRef: s.accountRef, statementDate: date, status: { in: ['Approved', 'Accepted'] } },
      select: { ref: true, status: true },
    });
    if (locked) problems.push(`Day-end package ${locked.ref} (${locked.status.toLowerCase()}) already covers ${s.accountRef} on ${s.statementDate}; supersede that package instead`);
    const refs = s.transactions.map((t) => t.tradeRef);
    const existing = refs.length ? await prisma.counterpartyExecution.count({ where: { counterpartyId, tradeRef: { in: refs } } }) : 0;
    out.push({
      accountRef: s.accountRef,
      statementDate: s.statementDate,
      currency: s.currency,
      closingCash: s.closingCash,
      holdings: s.holdings.length,
      holdingsMv: s.holdings.reduce((n, h) => n.plus(h.marketValue ?? 0), new D(0)).toDecimalPlaces(2).toFixed(2),
      trades: s.transactions.length,
      newTrades: s.transactions.length - existing,
      duplicateTrades: existing,
      warnings: s.warnings,
    });
  }
  return { format: statements[0]!.format, statements: out, problems };
}

custodianNativeRoutes.post('/statements/validate', requirePermission('custodian.dayend.submit'), validateBody(statementSchema), async (req, res) => {
  const c = cp(res);
  assertUploadChannel();
  const r = await checkStatement(c.id, c.accounts, req.body as z.infer<typeof statementSchema>);
  if (r.problems.length) throw new HttpError(422, 'statement_rejected', r.problems.slice(0, 3).join('; '), { problems: r.problems, statements: r.statements });
  res.json({ valid: true, ...r });
});

/**
 * Loads the file through the file-drop adapter's ingest path: trades -> executions, cash and holdings value -> a
 * Received day-end package (approval by a second counterparty user is still required), holdings -> line detail.
 * Re-sending identical content is refused (sha-256) and re-sent trade references are skipped.
 */
custodianNativeRoutes.post('/statements', requirePermission('custodian.dayend.submit'), idempotent('custodian.statements.upload', { required: false }), validateBody(statementSchema), async (req, res) => {
  const c = cp(res);
  assertUploadChannel();
  const b = req.body as z.infer<typeof statementSchema>;
  const checked = await checkStatement(c.id, c.accounts, b);
  if (checked.problems.length) throw new HttpError(422, 'statement_rejected', checked.problems.slice(0, 3).join('; '), { problems: checked.problems, statements: checked.statements });
  const result = await ingestStatementFile({ counterpartyId: c.id, filename: b.filename, content: b.content, format: b.format, userId: req.user!.id, audit: audit(req), adapter: custodianFeedMode() });

  // Fix each created package's fingerprint to the portal's canonical form so the approval integrity check passes.
  const refs = result.statements.map((s) => s.dayEndRef).filter((x): x is string => !!x);
  const packages = refs.length ? await prisma.counterpartyDayEndPackage.findMany({ where: { counterpartyId: c.id, ref: { in: refs }, status: 'Received' } }) : [];
  const approvers = (await prisma.counterpartyUser.findMany({ where: { counterpartyId: c.id, status: 'active', role: 'approver', userId: { not: req.user!.id } }, select: { userId: true } })).map((r) => r.userId);
  await prisma.$transaction(async (tx) => {
    for (const p of packages) {
      const sha = await packageHash(p, c.ref);
      if (sha !== p.sha256) await tx.counterpartyDayEndPackage.update({ where: { id: p.id }, data: { sha256: sha } });
    }
    await writeAudit(tx, audit(req), {
      action: 'custodian.statement.uploaded',
      objectType: 'custodian_feed_file',
      objectId: result.fileId,
      after: { counterparty: c.ref, filename: b.filename, format: result.format, mode: custodianFeedMode(), packages: refs, statements: result.statements.map((s) => ({ account: s.accountRef, date: s.statementDate, trades: s.tradesImported, holdings: s.holdings })) },
    });
    if (refs.length && approvers.length) {
      await enqueue(tx, 'notify.users', {
        userIds: approvers,
        type: 'custodian.dayend.submitted',
        title: `Statement ${b.filename} produced ${refs.length} day-end package${refs.length === 1 ? '' : 's'} awaiting approval`,
        body: refs.join(', '),
      } satisfies NotifyUsersPayload);
    }
    await enqueue(tx, 'notify.permission', {
      permission: 'custodian.review',
      type: 'custodian.statement.uploaded',
      title: `${c.name}: statement ${b.filename} uploaded`,
      body: result.statements.map((s) => `${s.accountRef} ${s.statementDate}`).slice(0, 10).join(', '),
      link: '/ops/custodian',
    } satisfies NotifyPermissionPayload);
  });
  res.status(201).json({ data: result });
});

const fileRow = (f: Awaited<ReturnType<typeof prisma.custodianFeedFile.findFirstOrThrow>>) => ({
  id: f.id,
  adapter: f.adapter,
  filename: f.filename,
  format: f.format,
  accountRef: f.accountRef,
  statementDate: f.statementDate ? isoDay(f.statementDate) : null,
  currency: f.currency,
  closingCash: f.closingCash?.toFixed(2) ?? null,
  holdingsMv: f.holdingsMv?.toFixed(2) ?? null,
  status: f.status,
  tradesImported: f.tradesImported,
  tradesSkipped: f.tradesSkipped,
  holdingsCount: f.holdingsCount,
  dayEndRef: f.dayEndRef,
  warnings: (f.warnings as string[] | null) ?? [],
  error: f.error,
  createdAt: f.createdAt.toISOString(),
});

/** Uploaded files plus the adapter's statement list (fake: deterministic; live: reported as not configured). */
custodianNativeRoutes.get('/statements', async (_req, res) => {
  const c = cp(res);
  const mode = custodianFeedMode();
  const files = await prisma.custodianFeedFile.findMany({ where: { counterpartyId: c.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  let statements: Awaited<ReturnType<ReturnType<typeof getCustodianFeedAdapter>['listStatements']>> = [];
  let adapterError: string | null = null;
  try {
    statements = await getCustodianFeedAdapter().listStatements({ counterpartyId: c.id, limit: 50 });
  } catch (e) {
    if (e instanceof IntegrationNotConfiguredError) adapterError = e.message;
    else throw e;
  }
  res.json({ mode, formats: ['CSV', 'MT940', 'JSON'], adapterError, files: files.map(fileRow), statements });
});

custodianNativeRoutes.get('/statements/template/:format', (req, res) => {
  const c = cp(res);
  const f = param(req, 'format').toUpperCase();
  if (f !== 'CSV' && f !== 'MT940' && f !== 'JSON') throw HttpError.notFound('Unknown format');
  const t = fakeStatementFile('template', c.accounts[0] ?? 'ACC-001', lastWeekdayOnOrBefore(isoDay(new Date())), f, 'USD');
  res.json({ data: { format: f, filename: t.filename.replace('fake-', 'template-'), content: t.content } });
});

custodianNativeRoutes.get('/statements/files/:id', async (req, res) => {
  const c = cp(res);
  const f = await prisma.custodianFeedFile.findFirst({ where: { id: param(req, 'id'), counterpartyId: c.id } });
  if (!f) throw HttpError.notFound('File not found');
  const holdings = await prisma.custodianFeedHolding.findMany({ where: { fileId: f.id }, orderBy: [{ accountRef: 'asc' }, { ticker: 'asc' }] });
  res.json({ file: fileRow(f), holdings: holdings.map(holdingRow) });
});

const holdingRow = (h: Awaited<ReturnType<typeof prisma.custodianFeedHolding.findFirstOrThrow>>) => ({
  accountRef: h.accountRef,
  statementDate: isoDay(h.statementDate),
  ticker: h.ticker,
  isin: h.isin,
  quantity: h.quantity.toString(),
  price: h.price?.toString() ?? null,
  marketValue: h.marketValue?.toFixed(2) ?? null,
  currency: h.currency,
});

/** Latest holdings reported for an account (or one statement date). */
custodianNativeRoutes.get('/holdings', async (req, res) => {
  const c = cp(res);
  const accountRef = typeof req.query.accountRef === 'string' && req.query.accountRef ? req.query.accountRef : undefined;
  if (accountRef && !c.accounts.includes(accountRef)) throw HttpError.forbidden(`Account ${accountRef} is not serviced by your organisation`, 'account_out_of_scope');
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? dayFromIso(req.query.date) : undefined;
  const latest = date
    ? { statementDate: date }
    : await prisma.custodianFeedHolding.findFirst({ where: { counterpartyId: c.id, ...(accountRef ? { accountRef } : {}) }, orderBy: { statementDate: 'desc' }, select: { statementDate: true } });
  if (!latest) return res.json({ date: null, items: [] });
  const rows = await prisma.custodianFeedHolding.findMany({
    where: { counterpartyId: c.id, statementDate: latest.statementDate, ...(accountRef ? { accountRef } : {}) },
    orderBy: [{ accountRef: 'asc' }, { ticker: 'asc' }],
    take: 1000,
  });
  res.json({ date: isoDay(latest.statementDate), items: rows.map(holdingRow) });
});

// ------------------------------------------------------------------ users and roles

const ROLES = ['submitter', 'approver'] as const;

/** Managing the counterparty's people needs the approver role (permission and counterparty link). */
const manage = [
  requirePermission('custodian.dayend.approve'),
  ((_req, res, next) => {
    if (cp(res).role !== 'approver') throw HttpError.forbidden('Only approvers can manage users', 'not_approver');
    next();
  }) as import('express').RequestHandler,
];

custodianNativeRoutes.get('/users', async (req, res) => {
  const c = cp(res);
  const links = await prisma.counterpartyUser.findMany({ where: { counterpartyId: c.id }, orderBy: { createdAt: 'asc' } });
  const users = await prisma.user.findMany({ where: { id: { in: links.map((l) => l.userId) } }, select: { id: true, name: true, email: true, lastLoginAt: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  res.json({
    canManage: c.role === 'approver' && req.user!.permissions.includes('custodian.dayend.approve'),
    items: links.map((l) => ({
      userId: l.userId,
      name: byId.get(l.userId)?.name ?? null,
      email: byId.get(l.userId)?.email ?? '',
      role: l.role,
      status: l.status,
      lastLoginAt: byId.get(l.userId)?.lastLoginAt?.toISOString() ?? null,
      you: l.userId === req.user!.id,
      since: l.createdAt.toISOString(),
    })),
  });
});

const inviteSchema = z.object({ email: z.string().trim().email().max(254), name: z.string().trim().max(120).optional(), role: z.enum(ROLES).default('submitter') });

custodianNativeRoutes.post('/users/invite', ...manage, idempotent('custodian.users.invite'), validateBody(inviteSchema), async (req, res) => {
  const c = cp(res);
  const b = req.body as z.infer<typeof inviteSchema>;
  const email = b.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const link = await prisma.counterpartyUser.findUnique({ where: { counterpartyId_userId: { counterpartyId: c.id, userId: existing.id } } });
    if (link?.status === 'active') throw HttpError.conflict('This person already has access', 'already_member');
  }
  const inv = await prisma.$transaction(async (tx) => {
    const { invitation } = await createInvitation(tx, { email, name: b.name ?? null, portal: 'custodian', roleKeys: [b.role], invitedById: req.user!.id, context: `${c.name}'s custodian portal` });
    await saveInviteGrant(tx, invitation.id, { kind: 'custodian', counterpartyId: c.id, role: b.role, invitedById: req.user!.id });
    await writeAudit(tx, audit(req), { action: 'custodian.user.invited', objectType: 'invitation', objectId: invitation.id, after: { email, role: b.role, counterparty: c.ref } });
    return invitation;
  });
  res.status(201).json({ invitation: { id: inv.id, email, role: b.role, expiresAt: inv.expiresAt.toISOString() } });
});

const userPatch = z
  .object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'inactive']).optional(), reason: z.string().trim().min(3).max(255) })
  .refine((v) => v.role !== undefined || v.status !== undefined, { message: 'Nothing to change' });

custodianNativeRoutes.patch('/users/:userId', ...manage, idempotent('custodian.users.update'), validateBody(userPatch), async (req, res) => {
  const c = cp(res);
  const b = req.body as z.infer<typeof userPatch>;
  const userId = param(req, 'userId');
  if (userId === req.user!.id) throw HttpError.forbidden('You cannot change your own access', 'self_change');
  const link = await prisma.counterpartyUser.findUnique({ where: { counterpartyId_userId: { counterpartyId: c.id, userId } } });
  if (!link) throw HttpError.notFound('User not found');
  const next = { role: b.role ?? link.role, status: b.status ?? link.status };
  if (next.role === link.role && next.status === link.status) throw HttpError.badRequest('Nothing to change');

  const updated = await prisma.$transaction(async (tx) => {
    // Keep at least one other active approver so day-end packages can always be approved.
    if (link.role === 'approver' && link.status === 'active' && (next.role !== 'approver' || next.status !== 'active')) {
      const others = await tx.counterpartyUser.count({ where: { counterpartyId: c.id, role: 'approver', status: 'active', userId: { not: userId } } });
      if (!others) throw HttpError.conflict('The organisation must keep at least one active approver', 'last_approver');
    }
    const row = await tx.counterpartyUser.update({ where: { counterpartyId_userId: { counterpartyId: c.id, userId } }, data: next });
    if (next.role !== link.role) {
      const roles = await tx.role.findMany({ where: { portal: 'custodian', key: { in: [...ROLES] } }, select: { id: true } });
      const target = await tx.role.findUnique({ where: { portal_key: { portal: 'custodian', key: next.role } }, select: { id: true } });
      if (!target) throw HttpError.conflict(`The ${next.role} role is not defined; run the role seed`, 'role_missing');
      await tx.userRole.deleteMany({ where: { userId, roleId: { in: roles.map((r) => r.id) } } });
      await tx.userRole.create({ data: { userId, roleId: target.id } });
    }
    await writeAudit(tx, audit(req), {
      action: 'custodian.user.updated',
      objectType: 'counterparty_user',
      objectId: userId,
      before: { role: link.role, status: link.status },
      after: { role: next.role, status: next.status, counterparty: c.ref, userId },
      reason: b.reason,
    });
    await enqueue(tx, 'notify.users', { userIds: [userId], type: 'custodian.user.updated', title: 'Your custodian portal access changed', body: `Role: ${next.role}, status: ${next.status}` } satisfies NotifyUsersPayload);
    return row;
  });
  res.json({ user: { userId, role: updated.role, status: updated.status } });
});
