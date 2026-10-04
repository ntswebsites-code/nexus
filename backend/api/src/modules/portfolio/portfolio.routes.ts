import { Router } from 'express';
import type { RequestHandler } from 'express';
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
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { signedDownloadUrl } from '../../lib/storage';
import { vaultDocument } from '../../lib/vault';
import { ensureTask, endOfDay } from '../wiring/tasks';
import { names } from '../rp-common';
import {
  getBrokerList,
  getPortfolioSnapshot,
  getPortfolioSummaries,
  getSecurityWithPrice,
  latestPrices,
  loadPortfolio,
  portfolioHeader,
  resolveFxRate,
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
export const RISK_PROFILES = ['LOW', 'MODERATE', 'HIGH'] as const;
export const EVIDENCE_KINDS = ['MANDATE', 'APPROVAL', 'KYC', 'OTHER'] as const;
const KPI_CURRENCY = 'USD';

/**
 * FR-PORT-010: KPIs computed from the rows shown. AUM is each portfolio's market value converted to USD at the latest
 * rate (portfolios with no rate are named and left out, never guessed); weighted TWR is the AUM-weighted average of each
 * portfolio's latest LOCKED performance period; open breaches counts OPEN risk breaches on the listed portfolios.
 */
async function summaryKpis(rows: Awaited<ReturnType<typeof getPortfolioSummaries>>) {
  const ids = rows.map((r) => r.id);
  const rates = new Map<string, Prisma.Decimal | null>();
  for (const c of new Set(rows.map((r) => r.baseCurrency))) rates.set(c, await resolveFxRate(c, KPI_CURRENCY, new Date()));
  const usd = new Map<string, Prisma.Decimal>();
  const fxMissing = new Set<string>();
  for (const r of rows) {
    const rate = rates.get(r.baseCurrency);
    if (!rate) fxMissing.add(r.baseCurrency);
    else usd.set(r.id, new Prisma.Decimal(r.marketValueBase).mul(rate));
  }
  const total = [...usd.values()].reduce((a, v) => a.add(v), new Prisma.Decimal(0));
  const periods = ids.length ? await prisma.perfPeriod.findMany({ where: { portfolioId: { in: ids }, status: 'LOCKED' }, orderBy: { periodEnd: 'desc' }, select: { portfolioId: true, twrPct: true, periodEnd: true } }) : [];
  const latest = new Map<string, (typeof periods)[number]>();
  for (const p of periods) if (!latest.has(p.portfolioId)) latest.set(p.portfolioId, p);
  let wSum = new Prisma.Decimal(0);
  let wTwr = new Prisma.Decimal(0);
  let covered = 0;
  for (const [id, p] of latest) {
    const w = usd.get(id);
    if (!w || w.lte(0)) continue;
    wSum = wSum.add(w);
    wTwr = wTwr.add(w.mul(p.twrPct));
    covered += 1;
  }
  const breaches = ids.length ? await prisma.riskBreach.count({ where: { portfolioId: { in: ids }, status: 'OPEN' } }) : 0;
  return {
    currency: KPI_CURRENCY,
    portfolios: rows.length,
    totalAum: total.toFixed(2),
    fxMissing: [...fxMissing],
    weightedTwrPct: wSum.isZero() ? null : wTwr.div(wSum).toFixed(4),
    twrCoverage: { portfolios: covered, of: rows.length, aumPct: total.isZero() ? '0.00' : wSum.div(total).mul(100).toFixed(2) },
    openBreaches: breaches,
  };
}

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
  strategy: z.string().trim().max(40).optional(),
  riskProfile: z.enum(RISK_PROFILES).optional(),
  /** 1 adds the summary KPIs computed from the very rows returned (FR-PORT-010). */
  kpis: z.enum(['1', 'true']).optional(),
  asOf: dateStr.optional(),
});

portfolioRoutes.get('/portfolios', ...staff, requirePermission('portfolio.view'), validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const rows = await getPortfolioSummaries(
    { q: f.q, type: f.type, currency: f.currency, status: f.status, clientId: f.clientId, managerUserId: f.mine ? req.user!.id : f.managerId, strategy: f.strategy, riskProfile: f.riskProfile },
    { asOf: asOfOf(f.asOf) },
  );
  res.json({ data: rows, total: rows.length, ...(f.kpis ? { kpis: await summaryKpis(rows) } : {}) });
});

/** Distinct strategies, risk profiles and managers present on portfolios, for the filter selects. */
portfolioRoutes.get('/portfolios/facets', ...staff, requirePermission('portfolio.view'), async (_req, res) => {
  const [strategies, risks, managers] = await Promise.all([
    prisma.portfolio.findMany({ where: { strategy: { not: null } }, select: { strategy: true }, distinct: ['strategy'], orderBy: { strategy: 'asc' } }),
    prisma.portfolio.findMany({ where: { riskProfile: { not: null } }, select: { riskProfile: true }, distinct: ['riskProfile'] }),
    prisma.portfolio.findMany({ where: { managerUserId: { not: null } }, select: { managerUserId: true }, distinct: ['managerUserId'] }),
  ]);
  const nm = await names(managers.map((m) => m.managerUserId));
  res.json({
    data: {
      strategies: strategies.map((x) => x.strategy!),
      riskProfiles: RISK_PROFILES.filter((r) => risks.some((x) => x.riskProfile === r)),
      managers: [...nm.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    },
  });
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
  strategy: z.string().trim().min(2).max(40).optional(),
  riskProfile: z.enum(RISK_PROFILES).optional(),
  /** What the evidence file is, when one is sent with the create. */
  evidenceKind: z.enum(EVIDENCE_KINDS).default('MANDATE'),
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

/** The wizard may send multipart: a `payload` JSON field plus an `evidence` file. Plain JSON still works. */
const withEvidence: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  uploadFiles('evidence')(req, res, (err?: unknown) => {
    if (err) return next(err);
    try {
      const raw = (req.body as { payload?: string } | undefined)?.payload;
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      return next(HttpError.badRequest('The payload field must be JSON'));
    }
    next();
  });
};

portfolioRoutes.post(
  '/portfolios',
  ...staff,
  requirePermission('portfolio.manage'),
  withEvidence,
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
          strategy: b.strategy ?? null,
          riskProfile: b.riskProfile ?? null,
          mandateJson: mandate as Prisma.InputJsonValue,
          createdBy: req.user!.id,
          updatedBy: req.user!.id,
        },
      });
      const file = uploadedFiles(req)[0];
      const doc = file
        ? await vaultDocument(tx, req, { file, name: `${ref} ${b.evidenceKind.toLowerCase()} evidence`, type: 'compliance', label: `portfolio ${b.evidenceKind.toLowerCase()} evidence`, relatedType: 'portfolio', relatedId: p.id, relatedLabel: `${ref} ${b.name}`, sourceType: 'PORTFOLIO_EVIDENCE', classification: 'Restricted' })
        : null;
      // A portfolio in Setup is not live: the activation steps become real runbook tasks (Operations Control).
      if (b.status === 'Setup') {
        const due = endOfDay(new Date(Date.now() + 5 * 86_400_000));
        const steps = [
          ['Confirm the mandate and evidence', 'Check the mandate limits and the evidence filed in the vault, then activate the portfolio.'],
          ['Open the cash account', 'Open the cash ledger and fund it before the first trade.'],
          ['Run the first IBOR refresh', 'Load the opening positions and tax lots for the new portfolio.'],
        ] as const;
        for (const [i, [title, detail]] of steps.entries()) await ensureTask(tx, { area: 'OTHER', title: `${ref}: ${title}`, detail, dueAt: due, sourceRef: `portfolio-activation:${p.id}:${i + 1}`, link: `/ops/portfolios/${p.id}` });
      }
      const { evidenceKind: _k, ...audited } = b;
      await writeAudit(tx, audit(req), { action: 'portfolio.created', objectType: 'portfolio', objectId: p.id, after: { ref, ...audited, mandate, evidence: doc ? doc.document.ref : null } });
      return p;
    });
    res.status(201).json({ data: await getPortfolioSnapshot(created.id) });
  },
);

/** FR-PORT-011: evidence filed against a portfolio lives in the document vault (type compliance, restricted). */
const evidenceBody = z.object({ kind: z.enum(EVIDENCE_KINDS).default('OTHER'), title: z.string().trim().max(160).optional() });

portfolioRoutes.post('/portfolios/:id/evidence', ...staff, requirePermission('portfolio.manage'), uploadFiles('file'), idempotent('portfolio.evidence'), async (req, res) => {
  const p = await loadPortfolio(param(req, 'id'));
  const parsed = evidenceBody.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const file = uploadedFiles(req)[0];
  if (!file) throw HttpError.badRequest('Validation failed', [{ path: 'file', message: 'Attach the evidence file' }]);
  const b = parsed.data;
  const doc = await prisma.$transaction((tx) =>
    vaultDocument(tx, req, { file, name: b.title ?? `${p.ref} ${b.kind.toLowerCase()} evidence`, type: 'compliance', label: `portfolio ${b.kind.toLowerCase()} evidence`, relatedType: 'portfolio', relatedId: p.id, relatedLabel: `${p.ref} ${p.name}`, sourceType: 'PORTFOLIO_EVIDENCE', classification: 'Restricted' }),
  );
  res.status(201).json({ data: { documentRef: doc.document.ref, name: doc.document.name, fileName: file.originalname, sha256: doc.file.sha256, version: 1 } });
});

portfolioRoutes.get('/portfolios/:id/evidence', ...staff, requirePermission('portfolio.view'), async (req, res) => {
  const p = await loadPortfolio(param(req, 'id'));
  const docs = await prisma.document.findMany({ where: { relatedType: 'portfolio', relatedId: p.id, sourceType: 'PORTFOLIO_EVIDENCE' }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ data: docs.map((d) => ({ documentRef: d.ref, name: d.name, label: d.label, status: d.status, version: d.versions[0]?.version ?? null, sha256: d.versions[0]?.sha256 ?? null, addedBy: d.ownerName, addedAt: d.createdAt.toISOString() })), total: docs.length });
});

portfolioRoutes.get('/portfolios/:id/evidence/:ref/download-url', ...staff, requirePermission('portfolio.view'), async (req, res) => {
  const p = await loadPortfolio(param(req, 'id'));
  const d = await prisma.document.findFirst({ where: { ref: param(req, 'ref'), relatedType: 'portfolio', relatedId: p.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
  const v = d?.versions[0];
  if (!d || !v) throw HttpError.notFound('Evidence not found');
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'portfolio.evidence_downloaded', objectType: 'portfolio', objectId: p.id, after: { document: d.ref, version: v.version } }));
  res.json({ url: signedDownloadUrl(v.fileId), expiresIn: 300 });
});

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    type: z.string().trim().min(1).max(64),
    clientId: z.string().trim().max(36).nullable(),
    managerUserId: z.string().trim().max(36).nullable(),
    benchmark: z.string().trim().max(160).nullable(),
    status: z.enum(['Setup', 'Active', 'Suspended', 'Closed']),
    strategy: z.string().trim().min(2).max(40).nullable(),
    riskProfile: z.enum(RISK_PROFILES).nullable(),
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
  if (b.strategy !== undefined) data.strategy = b.strategy;
  if (b.riskProfile !== undefined) data.riskProfile = b.riskProfile;
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
