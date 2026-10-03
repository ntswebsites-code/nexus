import { Router } from 'express';
import { pageEnvelope, sqlPage } from '../../middleware/paginate';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { nextRef } from '../../lib/refs';
import { expectVersion, hasPermission, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import {
  getBrokerList,
  getPortfolioSnapshot,
  getPortfolioSummaries,
  getSecurityWithPrice,
  latestPrices,
  loadPortfolio,
  portfolioHeader,
  withPrice,
  type PortfolioMandate,
} from './portfolio.service';

/**
 * Staff portfolio foundation (SRD 11.3): `/portfolios`, `/securities`, `/ibor/positions`, `/brokers`.
 * Admin-portal staff only. Reads need `portfolio.view` (securities and brokers also open to
 * `research.view` / `orders.view`); writes need `portfolio.manage` and are audited.
 * Mounted at the root of `/api/v1`, so auth is applied per route and never leaks to other routers.
 */
export const portfolioRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canRead = requireAnyPermission('portfolio.view', 'research.view', 'orders.view');

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const asOfOf = (v?: string) => (v ? toDate(v) : new Date());
const ccy = z.string().trim().length(3).toUpperCase();

const mandateSchema = z
  .object({
    maxSingleNamePct: z.number().gt(0).max(100).nullable(),
    maxSectorPct: z.number().gt(0).max(100).nullable(),
    cashFloorPct: z.number().min(0).max(100).nullable(),
    maxCashPct: z.number().min(0).max(100).nullable(),
    maxPositions: z.number().int().min(1).max(10000).nullable(),
    restrictedTickers: z.array(z.string().trim().min(1).max(24)).max(500).nullable(),
    allowedMarkets: z.array(z.string().trim().min(1).max(8)).max(10).nullable(),
    allowedAssetClasses: z.array(z.string().trim().min(1).max(24)).max(20).nullable(),
    notes: z.string().trim().max(500).nullable(),
  })
  .partial()
  .strict();

/** Merge a mandate patch into the stored limits; `null` removes a limit. */
function mergeMandate(current: PortfolioMandate, patch: z.infer<typeof mandateSchema>): PortfolioMandate {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  const { maxCashPct, cashFloorPct } = next as PortfolioMandate;
  if (maxCashPct !== undefined && cashFloorPct !== undefined && cashFloorPct > maxCashPct) {
    throw HttpError.badRequest('Validation failed', [{ path: 'mandate.cashFloorPct', message: 'The cash floor cannot exceed the maximum cash limit' }]);
  }
  return next as PortfolioMandate;
}

// ---------------------------------------------------------------- portfolios

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.string().trim().max(64).optional(),
  currency: ccy.optional(),
  status: z.string().trim().max(16).optional(),
  clientId: z.string().trim().max(36).optional(),
  managerId: z.string().trim().max(36).optional(),
  mine: z.enum(['1', 'true']).optional(),
  asOf: dateStr.optional(),
});

portfolioRoutes.get('/portfolios', ...staff, requirePermission('portfolio.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const rows = await getPortfolioSummaries(
    { q: f.q, type: f.type, currency: f.currency, status: f.status, clientId: f.clientId, managerUserId: f.mine ? req.user!.id : f.managerId },
    { asOf: asOfOf(f.asOf) },
  );
  res.json({ data: rows, total: rows.length });
});

const snapshotQuery = z.object({ asOf: dateStr.optional() });

portfolioRoutes.get('/portfolios/:id', ...staff, requirePermission('portfolio.view'), validateQuery(snapshotQuery), async (req, res) => {
  const { asOf } = query<z.infer<typeof snapshotQuery>>(req);
  res.json({ data: await getPortfolioSnapshot(param(req, 'id'), { asOf: asOfOf(asOf) }) });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.string().trim().min(1).max(64),
  baseCurrency: ccy.default('USD'),
  clientId: z.string().trim().max(36).optional(),
  managerUserId: z.string().trim().max(36).optional(),
  benchmark: z.string().trim().max(160).optional(),
  status: z.enum(['Setup', 'Active', 'Suspended', 'Closed']).default('Active'),
  mandate: mandateSchema.optional(),
});

async function assertLinks(clientId?: string | null, managerUserId?: string | null) {
  if (clientId && !(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) {
    throw HttpError.badRequest('Validation failed', [{ path: 'clientId', message: 'Unknown client' }]);
  }
  if (managerUserId) {
    const u = await prisma.user.findUnique({ where: { id: managerUserId }, select: { id: true, isActive: true } });
    if (!u?.isActive) throw HttpError.badRequest('Validation failed', [{ path: 'managerUserId', message: 'Unknown or inactive user' }]);
  }
}

portfolioRoutes.post(
  '/portfolios',
  ...staff,
  requirePermission('portfolio.manage'),
  validateBody(createSchema),
  idempotent('portfolio.create'),
  async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    await assertLinks(b.clientId, b.managerUserId);
    const mandate = mergeMandate({}, b.mandate ?? {});
    const created = await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'portfolio');
      const p = await tx.portfolio.create({
        data: {
          ref,
          name: b.name,
          type: b.type,
          baseCurrency: b.baseCurrency,
          clientId: b.clientId ?? null,
          managerUserId: b.managerUserId ?? null,
          benchmark: b.benchmark ?? null,
          status: b.status,
          mandateJson: mandate as Prisma.InputJsonValue,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), { action: 'portfolio.created', objectType: 'portfolio', objectId: p.id, after: { ref, ...b, mandate } });
      return p;
    });
    res.status(201).json({ data: await getPortfolioSnapshot(created.id) });
  },
);

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    type: z.string().trim().min(1).max(64),
    clientId: z.string().trim().max(36).nullable(),
    managerUserId: z.string().trim().max(36).nullable(),
    benchmark: z.string().trim().max(160).nullable(),
    status: z.enum(['Setup', 'Active', 'Suspended', 'Closed']),
    mandate: mandateSchema,
    version: z.number().int(),
  })
  .partial();

portfolioRoutes.patch('/portfolios/:id', ...staff, requirePermission('portfolio.manage'), validateBody(patchSchema), async (req, res) => {
  const p = await loadPortfolio(param(req, 'id'));
  expectVersion(req, p.version);
  const b = req.body as z.infer<typeof patchSchema>;
  await assertLinks(b.clientId, b.managerUserId);
  const data: Prisma.PortfolioUpdateManyMutationInput = { version: { increment: 1 }, updatedBy: req.user!.id };
  if (b.name !== undefined) data.name = b.name;
  if (b.type !== undefined) data.type = b.type;
  if (b.clientId !== undefined) data.clientId = b.clientId;
  if (b.managerUserId !== undefined) data.managerUserId = b.managerUserId;
  if (b.benchmark !== undefined) data.benchmark = b.benchmark;
  if (b.status !== undefined) data.status = b.status;
  const before = portfolioHeader(p);
  let nextMandate = before.mandate;
  if (b.mandate !== undefined) {
    nextMandate = mergeMandate(before.mandate, b.mandate);
    data.mandateJson = nextMandate as Prisma.InputJsonValue;
  }
  await prisma.$transaction(async (tx) => {
    const r = await tx.portfolio.updateMany({ where: { id: p.id, version: p.version }, data });
    if (r.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    const { version: _v, mandate: _m, ...changed } = b;
    await writeAudit(tx, audit(req), {
      action: b.mandate !== undefined ? 'portfolio.mandate_updated' : 'portfolio.updated',
      objectType: 'portfolio',
      objectId: p.id,
      before: { ...before, version: p.version },
      after: { ...changed, mandate: nextMandate },
    });
  });
  res.json({ data: await getPortfolioSnapshot(p.id) });
});

// ---------------------------------------------------------------- securities and prices

const secQuery = z.object({
  q: z.string().trim().max(100).optional(),
  market: z.enum(['ZSE', 'VFEX', 'OTC']).optional(),
  assetClass: z.string().trim().max(24).optional(),
  status: z.string().trim().max(16).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  asOf: dateStr.optional(),
});

portfolioRoutes.get('/securities', ...staff, canRead, validateQuery(secQuery), async (req, res) => {
  const f = query<z.infer<typeof secQuery>>(req);
  const where: Prisma.SecurityWhereInput = {};
  if (f.q) where.OR = [{ ticker: { contains: f.q } }, { name: { contains: f.q } }, { isin: { contains: f.q } }, { sector: { contains: f.q } }];
  if (f.market) where.market = f.market;
  if (f.assetClass) where.assetClass = f.assetClass;
  where.status = f.status ?? undefined;
  const [rows, total] = await Promise.all([
    prisma.security.findMany({ where, orderBy: { ticker: 'asc' }, take: f.limit, skip: f.offset }),
    prisma.security.count({ where }),
  ]);
  const prices = await latestPrices(rows.map((r) => r.id), asOfOf(f.asOf));
  res.json({ data: rows.map((s) => withPrice(s, prices.get(s.id))), total });
});

portfolioRoutes.get('/securities/:id', ...staff, canRead, validateQuery(snapshotQuery), async (req, res) => {
  const { asOf } = query<z.infer<typeof snapshotQuery>>(req);
  const sec = await getSecurityWithPrice(param(req, 'id'), { asOf: asOfOf(asOf) });
  const history = await prisma.securityPrice.findMany({ where: { securityId: sec.id }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }], take: 30 });
  res.json({
    data: { ...sec, history: history.map((h) => ({ price: h.price.toFixed(6), priceDate: h.priceDate.toISOString().slice(0, 10), source: h.source })) },
  });
});

const priceQuery = z.object({ from: dateStr.optional(), to: dateStr.optional(), limit: z.coerce.number().int().min(1).max(1000).default(250) });

portfolioRoutes.get('/securities/:id/prices', ...staff, canRead, validateQuery(priceQuery), async (req, res) => {
  const f = query<z.infer<typeof priceQuery>>(req);
  const sec = await getSecurityWithPrice(param(req, 'id'));
  const pg = sqlPage(req, f.limit, 1000);
  const where: Prisma.SecurityPriceWhereInput = { securityId: sec.id, priceDate: { gte: f.from ? toDate(f.from) : undefined, lte: f.to ? toDate(f.to) : undefined } };
  const [rows, total] = await Promise.all([
    prisma.securityPrice.findMany({ where, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.securityPrice.count({ where }),
  ]);
  res.json(pageEnvelope(pg, rows.map((h) => ({ price: h.price.toFixed(6), priceDate: h.priceDate.toISOString().slice(0, 10), source: h.source })), total));
});

const priceSchema = z.object({
  priceDate: dateStr,
  price: z
    .union([z.string().trim(), z.number()])
    .transform((v) => String(v))
    .refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && new Prisma.Decimal(v).gt(0), 'Enter a positive price (up to 6 decimals)'),
  source: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .transform((v) => v.toUpperCase())
    .default('MANUAL'),
});

/** Upsert one price (unique per security, date and source). Re-posting the same value is a no-op. */
portfolioRoutes.post(
  '/securities/:id/prices',
  ...staff,
  requirePermission('portfolio.manage'),
  validateBody(priceSchema),
  idempotent('price.upsert', { required: false }),
  async (req, res) => {
    const sec = await getSecurityWithPrice(param(req, 'id'));
    const b = req.body as z.infer<typeof priceSchema>;
    if (new Date(toDate(b.priceDate).getTime() - 86_400_000) > new Date()) {
      throw HttpError.badRequest('Validation failed', [{ path: 'priceDate', message: 'A price cannot be dated in the future' }]);
    }
    const where = { securityId_priceDate_source: { securityId: sec.id, priceDate: toDate(b.priceDate), source: b.source } };
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.securityPrice.findUnique({ where });
      const value = new Prisma.Decimal(b.price);
      if (existing && existing.price.eq(value)) return { created: false, changed: false };
      await tx.securityPrice.upsert({
        where,
        update: { price: value, createdBy: req.user!.id },
        create: { securityId: sec.id, priceDate: toDate(b.priceDate), source: b.source, price: value, createdBy: req.user!.id },
      });
      await writeAudit(tx, audit(req), {
        action: existing ? 'security_price.updated' : 'security_price.created',
        objectType: 'security',
        objectId: sec.id,
        before: existing ? { price: existing.price.toFixed(6) } : undefined,
        after: { ticker: sec.ticker, priceDate: b.priceDate, source: b.source, price: value.toFixed(6) },
      });
      return { created: !existing, changed: true };
    });
    res.status(result.created ? 201 : 200).json({ data: { ...(await getSecurityWithPrice(sec.id)), ...result } });
  },
);

// ---------------------------------------------------------------- positions (IBOR view)

const posQuery = z.object({
  portfolioId: z.string().trim().max(36).optional(),
  q: z.string().trim().max(100).optional(),
  assetClass: z.string().trim().max(24).optional(),
  asOf: dateStr.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Flat position lines valued as of a date: one portfolio, or every portfolio when `portfolioId` is omitted. */
portfolioRoutes.get('/ibor/positions', ...staff, requirePermission('portfolio.view'), validateQuery(posQuery), async (req, res) => {
  const f = query<z.infer<typeof posQuery>>(req);
  const asOf = asOfOf(f.asOf);
  const portfolios = f.portfolioId ? [await loadPortfolio(f.portfolioId)] : await prisma.portfolio.findMany({ orderBy: { name: 'asc' }, take: 500 });
  const needle = f.q?.toLowerCase();
  const rows = [];
  for (const p of portfolios) {
    const snap = await getPortfolioSnapshot(p.id, { asOf });
    for (const l of snap.lines) {
      if (f.assetClass && l.assetClass !== f.assetClass) continue;
      if (needle && !`${l.ticker} ${l.name} ${snap.portfolio.name}`.toLowerCase().includes(needle)) continue;
      rows.push({ ...l, portfolioId: p.id, portfolioRef: p.ref, portfolioName: p.name, baseCurrency: p.baseCurrency, asOf: snap.asOf });
    }
  }
  res.json({ data: rows.slice(f.offset, f.offset + f.limit), total: rows.length, asOf: asOf.toISOString().slice(0, 10) });
});

// ---------------------------------------------------------------- brokers

portfolioRoutes.get('/brokers', ...staff, canRead, async (req, res) => {
  const all = req.query.status === 'all' && hasPermission(req, 'portfolio.manage');
  const data = await getBrokerList({ activeOnly: !all });
  res.json({ data, total: data.length });
});
