import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { audit, isoDay, seqRef } from '../ops/ops.common';
import { lineFingerprint, parseStatement, sha256, statementVariance } from '../cash/cash.engine';
import {
  adapterHealth,
  adapterMeta,
  adapterMode,
  allAdapterNames,
  fakeInProduction,
  getAdapter,
  INTEGRATION_NAMES,
  integrationEnvKey,
  missingEnv,
  runAdapterTest,
  type IntegrationName,
} from '../../integrations';
import { clearStateCache } from '../../integrations/core/calls';
import { fakeSsoCode } from '../../integrations/sso/fake';
import { fakeStatement } from '../../integrations/custodian-feed/fake';
import { marketDataMode } from '../../integrations/market-data';

/**
 * Integrations ops API (WP-8), mounted under `/api/v1/admin-core/integrations` (admin portal session required by the
 * parent router). Permission `admin.settings`. Lists every adapter with mode, health, last call and error counts, shows
 * the call log, runs a test call, simulates failures (fake mode only) and triggers the fake feeds that write into the
 * platform (market data, bank statements, custodian day-end packages).
 */
export const integrationsRoutes = Router();
const SETTINGS = requirePermission('admin.settings');
const DAY_MS = 86_400_000;
/** The fake generator returns the latest weekday whatever the requested date; real providers must match the date. */
const isRealMarketMode = () => marketDataMode() !== 'fake';

async function stepUp(req: Request, res: Response) {
  await requireStepUp(req, res, (err?: unknown) => {
    if (err) throw err;
  });
}

const nameOf = (req: Request): IntegrationName => {
  const n = param(req, 'name');
  if (!(INTEGRATION_NAMES as readonly string[]).includes(n)) throw HttpError.notFound(`Unknown integration ${n}`);
  return n as IntegrationName;
};

// ------------------------------------------------------------------ overview

integrationsRoutes.get('/', SETTINGS, async (_req, res) => {
  const since = new Date(Date.now() - DAY_MS);
  const [totals, errors, states] = await Promise.all([
    prisma.integrationCall.groupBy({ by: ['adapter'], _count: { _all: true }, _max: { createdAt: true } }),
    prisma.integrationCall.groupBy({ by: ['adapter'], where: { status: 'ERROR', createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.integrationState.findMany(),
  ]);
  const prodFake = new Set(fakeInProduction());
  const rows = await Promise.all(
    allAdapterNames().map(async (name) => {
      const meta = adapterMeta(name);
      const mode = adapterMode(name);
      const [health, last, lastError] = await Promise.all([
        adapterHealth(name),
        prisma.integrationCall.findFirst({ where: { adapter: name }, orderBy: { createdAt: 'desc' } }),
        prisma.integrationCall.findFirst({ where: { adapter: name, status: 'ERROR' }, orderBy: { createdAt: 'desc' } }),
      ]);
      const state = states.find((s) => s.adapter === name);
      return {
        name,
        label: meta.label,
        gap: meta.gap,
        description: meta.description,
        flag: integrationEnvKey(name),
        mode,
        requiredEnv: meta.requiredEnv,
        missingEnv: missingEnv(name),
        vendorCalls: meta.vendorCalls,
        health,
        productionWarning: prodFake.has(name),
        failure: state && state.failureMode === 'error' ? { mode: 'error', remaining: state.failuresRemaining } : null,
        calls: totals.find((t) => t.adapter === name)?._count._all ?? 0,
        errors24h: errors.find((e) => e.adapter === name)?._count._all ?? 0,
        lastCall: last ? { at: last.createdAt.toISOString(), operation: last.operation, status: last.status, durationMs: last.durationMs } : null,
        lastError: lastError ? { at: lastError.createdAt.toISOString(), operation: lastError.operation, message: lastError.error } : null,
      };
    }),
  );
  res.json({ data: rows, production: config.isProduction, allowFake: config.allowFakeIntegrations });
});

/** Any admin-portal staff member: drives the persistent /ops banner when fake adapters run in a production build. */
integrationsRoutes.get('/banner', async (_req, res) => {
  const names = fakeInProduction();
  res.json({ data: { production: config.isProduction, fakeAdapters: names.map((n) => adapterMeta(n).label), count: names.length } });
});

// ------------------------------------------------------------------ call log and inbox

const callsQuery = z.object({
  adapter: z.string().trim().max(32).optional(),
  status: z.enum(['OK', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

integrationsRoutes.get('/calls', SETTINGS, validateQuery(callsQuery), async (req, res) => {
  const f = query<z.infer<typeof callsQuery>>(req);
  const rows = await prisma.integrationCall.findMany({
    where: { ...(f.adapter ? { adapter: f.adapter } : {}), ...(f.status ? { status: f.status } : {}), ...(f.before ? { createdAt: { lt: new Date(f.before) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  res.json({
    data: rows.map((c) => ({ id: c.id, adapter: c.adapter, mode: c.mode, operation: c.operation, status: c.status, durationMs: c.durationMs, error: c.error, correlationId: c.correlationId, at: c.createdAt.toISOString() })),
    next: rows.length === f.limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
  });
});

integrationsRoutes.get('/calls/:id', SETTINGS, async (req, res) => {
  const c = await prisma.integrationCall.findUnique({ where: { id: param(req, 'id') } });
  if (!c) throw HttpError.notFound('Call not found');
  res.json({ data: { id: c.id, adapter: c.adapter, mode: c.mode, operation: c.operation, status: c.status, durationMs: c.durationMs, requestHash: c.requestHash, request: c.request, result: c.result, error: c.error, correlationId: c.correlationId, at: c.createdAt.toISOString() } });
});

const inboxQuery = z.object({ adapter: z.string().trim().max(32).optional(), kind: z.string().trim().max(32).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });

/** Simulated inbound artefacts (SMS codes, fake emails, payment instructions). Message bodies and codes are hidden in production. */
integrationsRoutes.get('/inbox', SETTINGS, validateQuery(inboxQuery), async (req, res) => {
  const f = query<z.infer<typeof inboxQuery>>(req);
  const rows = await prisma.integrationInbox.findMany({
    where: { ...(f.adapter ? { adapter: f.adapter } : {}), ...(f.kind ? { kind: f.kind } : {}) },
    orderBy: { createdAt: 'desc' },
    take: f.limit,
  });
  const hide = (p: unknown) => {
    if (!config.isProduction || !p || typeof p !== 'object') return p;
    const { text: _t, code: _c, message: _m, ...rest } = p as Record<string, unknown>;
    return rest;
  };
  res.json({ data: rows.map((r) => ({ id: r.id, adapter: r.adapter, kind: r.kind, externalRef: r.externalRef, status: r.status, payload: hide(r.payload), at: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })) });
});

// ------------------------------------------------------------------ test call and failure simulation

integrationsRoutes.post('/:name/test', SETTINGS, async (req, res) => {
  const name = nameOf(req);
  if (adapterMode(name) === 'live') await stepUp(req, res);
  const result = await runAdapterTest(name, { userEmail: req.user!.email });
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), { action: 'integration.tested', objectType: 'integration', objectId: name, after: { mode: adapterMode(name), ok: result.ok, durationMs: result.durationMs } }),
  );
  res.json({ data: { name, mode: adapterMode(name), ...result } });
});

const failureBody = z.object({ mode: z.enum(['none', 'error']), count: z.coerce.number().int().min(0).max(1000).default(0), reason: z.string().trim().max(200).optional() }).strict();

/** Fake mode only. `error` with count 0 fails every call until cleared; count N fails the next N calls. */
integrationsRoutes.put('/:name/failure', SETTINGS, validateBody(failureBody), async (req, res) => {
  const name = nameOf(req);
  if (adapterMode(name) !== 'fake') throw HttpError.conflict(`${name} is live; failure simulation applies to fake adapters only`, 'not_fake');
  const b = req.body as z.infer<typeof failureBody>;
  await prisma.$transaction(async (tx) => {
    await tx.integrationState.upsert({
      where: { adapter: name },
      update: { failureMode: b.mode, failuresRemaining: b.mode === 'error' ? b.count : 0, updatedBy: req.user!.id },
      create: { adapter: name, failureMode: b.mode, failuresRemaining: b.mode === 'error' ? b.count : 0, updatedBy: req.user!.id },
    });
    await writeAudit(tx, audit(req), { action: 'integration.failure_simulation', objectType: 'integration', objectId: name, after: { mode: b.mode, count: b.count }, reason: b.reason ?? null });
  });
  clearStateCache(name);
  res.json({ data: { name, failure: b.mode === 'error' ? { mode: 'error', remaining: b.count } : null } });
});

// ------------------------------------------------------------------ fake feeds that write into the platform

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const todayStr = () => new Date().toISOString().slice(0, 10);

const marketBody = z.object({ date: day.optional(), tickers: z.array(z.string().trim().min(1).max(24)).max(500).optional() }).strict();

/**
 * Pulls end-of-day prices and FX through the market-data adapter and stores them with source VENDOR. Securities that
 * already have a price for that date (any source) and FX pairs that already have a rate are left untouched.
 */
async function marketDataSync(req: Request, res: Response) {
  const b = req.body as z.infer<typeof marketBody>;
  const date = b.date ?? todayStr();
  if (toDate(date).getTime() - DAY_MS > Date.now()) throw HttpError.badRequest('Validation failed', [{ path: 'date', message: 'A feed date cannot be in the future' }]);
  const securities = await prisma.security.findMany({ where: { status: 'Active', ...(b.tickers ? { ticker: { in: b.tickers } } : {}) }, select: { id: true, ticker: true, currency: true } });
  const have = new Set((await prisma.securityPrice.findMany({ where: { priceDate: toDate(date), securityId: { in: securities.map((s) => s.id) } }, select: { securityId: true } })).map((p) => p.securityId));
  const todo = securities.filter((s) => !have.has(s.id));
  const adapter = getAdapter('market-data');
  const quoteBatch = todo.length ? await adapter.fetchQuotes(todo.map((s) => s.ticker)) : { items: [] };
  const quotes = quoteBatch.items.filter((q) => q.priceDate === date || !isRealMarketMode());
  const currencies = [...new Set(securities.map((s) => s.currency).filter((c) => c !== 'USD'))];
  const fxExisting = await prisma.fxRate.findMany({ where: { rateDate: toDate(date) } });
  const fxTodo = currencies.filter((c) => !fxExisting.some((r) => (r.fromCurrency === c && r.toCurrency === 'USD') || (r.fromCurrency === 'USD' && r.toCurrency === c)));
  const fx = (fxTodo.length ? await adapter.fetchFx(fxTodo.map((c) => ({ from: c, to: 'USD' }))) : { items: [] }).items;
  const byTicker = new Map(todo.map((s) => [s.ticker, s.id]));
  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.securityPrice.createMany({
      data: quotes.filter((q) => byTicker.has(q.ticker)).map((q) => ({ securityId: byTicker.get(q.ticker)!, priceDate: toDate(date), price: new Prisma.Decimal(q.price), source: 'VENDOR', createdBy: req.user!.id })),
      skipDuplicates: true,
    });
    const fxCreated = await tx.fxRate.createMany({
      data: fx.map((r) => ({ fromCurrency: r.from, toCurrency: r.to, rateDate: toDate(date), rate: new Prisma.Decimal(r.rate), source: 'VENDOR' })),
      skipDuplicates: true,
    });
    const out = { date, pricesCreated: created.count, pricesSkipped: securities.length - todo.length, fxCreated: fxCreated.count };
    await writeAudit(tx, audit(req), { action: 'integration.market_data_synced', objectType: 'integration', objectId: 'market-data', after: out });
    return out;
  });
  res.status(201).json({ data: result });
}
integrationsRoutes.post(['/market-data/sync', '/market-data/simulate'], SETTINGS, validateBody(marketBody), idempotent('integration.market_data', { required: false }), marketDataSync);

const statementBody = z
  .object({ ledgerId: z.string().trim().min(1).max(36), from: day.optional(), to: day.optional(), openingBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).default('0.00') })
  .strict();

/** Fetches a bank statement through the adapter and stages it as a cash statement import (a different person commits it). */
integrationsRoutes.post('/bank-statement/simulate', SETTINGS, validateBody(statementBody), idempotent('integration.bank_statement', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof statementBody>;
  const ledger = await prisma.cashLedger.findUnique({ where: { id: b.ledgerId } });
  if (!ledger) throw HttpError.notFound('Ledger not found');
  if (ledger.kind !== 'BANK') throw HttpError.badRequest('Validation failed', [{ path: 'ledgerId', message: 'Statements are imported against a bank ledger' }]);
  if (ledger.status !== 'ACTIVE') throw HttpError.conflict(`Ledger ${ledger.ref} is ${ledger.status.toLowerCase()}; imports are blocked`, 'ledger_not_active');
  const to = b.to ?? todayStr();
  const from = b.from ?? to;
  if (from > to) throw HttpError.badRequest('Validation failed', [{ path: 'to', message: 'The statement end is before its start' }]);
  const stmt = await getAdapter('bank-statement').fetchStatement({ accountRef: ledger.ref, from, to, currency: ledger.currency, openingBalance: b.openingBalance });
  const parsed = parseStatement('JSON', stmt.json, {});
  if (parsed.errors.length) throw HttpError.badRequest('The statement could not be read', parsed.errors.slice(0, 20));
  const variance = statementVariance(parsed.opening!, parsed.closing!, parsed.lines);
  const fileHash = sha256(`${ledger.id}|JSON|${stmt.json}`);
  if (await prisma.cashStatementImport.findUnique({ where: { ledgerId_fileHash: { ledgerId: ledger.id, fileHash } }, select: { id: true } })) throw HttpError.conflict('This statement was already fetched for this ledger', 'duplicate_file');
  const prints = parsed.lines.map((l) => lineFingerprint(ledger.id, l));
  const dup = await prisma.cashStatementLine.count({ where: { ledgerId: ledger.id, fingerprint: { in: prints }, import: { status: { in: ['STAGED', 'COMMITTED'] } } } });
  if (dup) throw new HttpError(409, 'duplicate_lines', `${dup} simulated line(s) already exist in an earlier statement for this ledger`);
  const imp = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashImport');
    const row = await tx.cashStatementImport.create({
      data: {
        ref,
        ledgerId: ledger.id,
        portfolioId: ledger.portfolioId,
        filename: `camt053-${ledger.ref}-${from}_${to}.json`,
        fileHash,
        format: 'JSON',
        statementFrom: toDate(from),
        statementTo: toDate(to),
        openingBalance: parsed.opening!,
        closingBalance: parsed.closing!,
        lineCount: parsed.lines.length,
        variance,
        makerId: req.user!.id,
        lines: { create: parsed.lines.map((l, i) => ({ lineNo: i + 1, ledgerId: ledger.id, valueDate: l.valueDate, amount: l.amount, reference: l.reference, description: l.description, fingerprint: prints[i]! })) },
      },
    });
    await writeAudit(tx, audit(req), { action: 'integration.bank_statement_staged', objectType: 'cash_statement_import', objectId: row.id, after: { ref, ledger: ledger.ref, lines: parsed.lines.length, from, to, source: 'bank-statement adapter' } });
    return row;
  });
  res.status(201).json({ data: { id: imp.id, ref: imp.ref, lines: imp.lineCount, openingBalance: stmt.openingBalance, closingBalance: stmt.closingBalance, status: imp.status } });
});

const dayEndBody = z.object({ counterpartyId: z.string().trim().min(1).max(36), accountRef: z.string().trim().min(1).max(64), date: day.optional(), currency: z.string().trim().length(3).toUpperCase().default('USD') }).strict();

/** Fetches a day-end statement through the custodian-feed adapter and records it as a Received day-end package. */
integrationsRoutes.post('/custodian-feed/simulate', SETTINGS, validateBody(dayEndBody), idempotent('integration.custodian_feed', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof dayEndBody>;
  const date = b.date ?? todayStr();
  const cp = await prisma.counterparty.findUnique({ where: { id: b.counterpartyId } });
  if (!cp) throw HttpError.notFound('Counterparty not found');
  const active = await prisma.counterpartyDayEndPackage.findFirst({ where: { counterpartyId: cp.id, accountRef: b.accountRef, statementDate: toDate(date), currency: b.currency, status: { not: 'Superseded' } }, select: { ref: true } });
  if (active) throw HttpError.conflict(`Package ${active.ref} already covers this account, date and currency`, 'package_exists');
  const adapter = getAdapter('custodian-feed');
  // Day-end totals come from the feed when it holds a statement for the account and date, else from the deterministic fake.
  const feedStatement = (await adapter.listStatements({ accountRef: b.accountRef, from: date, to: date, limit: 1 }))[0];
  const stmt = feedStatement ?? { closingCash: fakeStatement(cp.id, b.accountRef, date, b.currency).closingCash, holdingsMv: null, tradeCount: 0 };
  const synthetic = fakeStatement(cp.id, b.accountRef, date, b.currency);
  const dayEnd = {
    closingCash: stmt.closingCash ?? '0.00',
    holdingsMv: stmt.holdingsMv ?? synthetic.holdings.reduce((n, h) => n + Number(h.marketValue ?? 0), 0).toFixed(2),
    tradeCount: feedStatement ? stmt.tradeCount : synthetic.transactions.length,
    sha256: sha256(`${cp.id}|${b.accountRef}|${date}|${b.currency}|${stmt.closingCash}`),
  };
  const pkg = await prisma.$transaction(async (tx) => {
    const row = await tx.counterpartyDayEndPackage.create({
      data: {
        ref: await seqRef(tx, 'custodianDayEnd', 'CDE-', 5, 10001),
        counterpartyId: cp.id,
        accountRef: b.accountRef,
        statementDate: toDate(date),
        currency: b.currency,
        closingCash: dayEnd.closingCash,
        holdingsMv: dayEnd.holdingsMv,
        tradeCount: dayEnd.tradeCount,
        sha256: dayEnd.sha256,
        note: 'Fetched through the custodian-feed adapter (simulated MT950)',
        submittedById: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), { action: 'integration.day_end_received', objectType: 'counterparty_day_end_package', objectId: row.id, after: { ref: row.ref, counterparty: cp.ref, accountRef: b.accountRef, date, closingCash: dayEnd.closingCash } });
    return row;
  });
  res.status(201).json({ data: { id: pkg.id, ref: pkg.ref, statementDate: isoDay(pkg.statementDate), closingCash: dayEnd.closingCash, holdingsMv: dayEnd.holdingsMv, tradeCount: dayEnd.tradeCount, status: pkg.status } });
});

// ------------------------------------------------------------------ development identity provider (fake SSO)

/** Unauthenticated, development only: 404 in production or when INTEGRATION_SSO is not fake. */
export const integrationsPublicRoutes = Router();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

integrationsPublicRoutes.get('/sso/fake-idp', (req, res) => {
  if (config.isProduction || config.integrations.sso !== 'fake') throw HttpError.notFound();
  const redirect = String(req.query.redirect_uri ?? '');
  const state = String(req.query.state ?? '');
  let origin = '';
  try {
    origin = new URL(redirect).origin;
  } catch {
    throw HttpError.badRequest('redirect_uri is not a valid URL');
  }
  if (!config.corsOrigins.includes(origin) && origin !== new URL(config.publicApiUrl).origin) throw HttpError.badRequest('redirect_uri is not an allowed origin');
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  if (email && /^[^@\s]+@[^@\s]+$/.test(email)) {
    const u = new URL(redirect);
    u.searchParams.set('code', fakeSsoCode(email));
    u.searchParams.set('state', state);
    res.redirect(u.toString());
    return;
  }
  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><title>Fake identity provider</title><body style="font-family:sans-serif;max-width:28rem;margin:4rem auto"><h1>Fake identity provider</h1><p>Development only. Sign in as any email.</p><form method="get"><input type="hidden" name="redirect_uri" value="${esc(redirect)}"><input type="hidden" name="state" value="${esc(state)}"><input name="email" type="email" required placeholder="staff@example.com" style="padding:.5rem;width:100%"><p><button type="submit" style="padding:.5rem 1rem">Continue</button></p></form></body>`,
    );
});
