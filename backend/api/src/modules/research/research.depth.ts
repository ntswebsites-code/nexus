import type { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { param, query } from '../../lib/http';
import { signedDownloadUrl } from '../../lib/storage';
import { vaultDocument } from '../../lib/vault';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { assertUpdated, audit } from '../ops/ops.common';
import { latestPrices } from '../portfolio/portfolio.service';
import { ccy, D, dateStr, f4, f6, invalidState, isoDay, iso, listPage, names, toDate, UUID } from '../rp-common';
import { runValuation, valuationInputs, type ValuationInputs } from './research.valuation';

/**
 * Research depth (SRD 5.A.6): issuer universe with prices, financials and filings (FR-RES-006), valuation model with
 * ranges, versions and target (FR-RES-007), timestamped notes, catalysts and risks (FR-RES-008) and filing import to
 * the document vault (FR-RES-009). Registered on the research router by `registerResearchDepth`.
 * `research.view` reads; `research.edit` writes. Every write is audited; creates take an Idempotency-Key.
 */

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('research.view')];
const canEdit = [...staff, requirePermission('research.view'), requirePermission('research.edit')];

export const FILING_TYPES = ['ANNUAL_REPORT', 'INTERIM_REPORT', 'TRADING_UPDATE', 'CIRCULAR', 'PROSPECTUS', 'OTHER'] as const;
const PERIOD_TYPES = ['FY', 'H1', 'H2', 'Q'] as const;

async function loadIssuer(v: string) {
  const s = await prisma.security.findFirst({ where: UUID.test(v) ? { id: v } : { ticker: v.toUpperCase() } });
  if (!s) throw HttpError.notFound('Issuer not found');
  return s;
}

const priceOf = (p: { price: string; priceDate: string; source: string } | undefined | null) => (p ? { price: p.price, asOf: p.priceDate, source: p.source } : null);

const financialView = (f: Prisma.IssuerFinancialGetPayload<object>) => ({
  id: f.id,
  period: f.period,
  periodType: f.periodType,
  periodEnd: isoDay(f.periodEnd),
  currency: f.currency,
  revenue: f4(f.revenue),
  ebitda: f4(f.ebitda),
  netIncome: f4(f.netIncome),
  eps: f6(f.eps),
  totalAssets: f4(f.totalAssets),
  totalDebt: f4(f.totalDebt),
  equity: f4(f.equity),
  source: f.source,
  asOf: isoDay(f.asOf),
  updatedAt: f.updatedAt.toISOString(),
});

type EntryRow = Prisma.ResearchEntryGetPayload<object>;
async function entryViews(rows: EntryRow[]) {
  const usr = await names(rows.flatMap((r) => [r.createdBy, r.resolvedBy]));
  return rows.map((e) => ({
    id: e.id,
    securityId: e.securityId,
    caseId: e.caseId,
    kind: e.kind,
    title: e.title,
    body: e.body,
    eventDate: isoDay(e.eventDate),
    trigger: e.triggerText,
    impact: e.impact,
    severity: e.severity,
    status: e.status,
    resolvedAt: iso(e.resolvedAt),
    resolvedByName: e.resolvedBy ? (usr.get(e.resolvedBy) ?? null) : null,
    resolutionNote: e.resolutionNote,
    authorName: usr.get(e.createdBy) ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}

async function filingViews(rows: Prisma.IssuerFilingGetPayload<object>[]) {
  const docs = rows.length ? await prisma.document.findMany({ where: { id: { in: rows.map((r) => r.documentId) } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } }) : [];
  const dm = new Map(docs.map((d) => [d.id, d]));
  const usr = await names(rows.map((r) => r.createdBy));
  return rows.map((f) => {
    const d = dm.get(f.documentId);
    return {
      id: f.id,
      filingType: f.filingType,
      title: f.title,
      period: f.period,
      periodEnd: isoDay(f.periodEnd),
      filedOn: isoDay(f.filedOn),
      source: f.source,
      sourceUrl: f.sourceUrl,
      documentRef: d?.ref ?? null,
      documentVersion: d?.versions[0]?.version ?? null,
      documentStatus: d?.status ?? null,
      importedBy: usr.get(f.createdBy) ?? null,
      importedAt: f.createdAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------- valuation summary (also used by GET /cases/:id)

type ValRow = Prisma.ResearchValuationGetPayload<{ include: { versions: true } }>;
function versionView(v: ValRow['versions'][number], who: Map<string, string>, price: Prisma.Decimal | null) {
  const target = v.targetPrice;
  return {
    version: v.version,
    inputs: v.inputs,
    result: v.result,
    targetPrice: f6(target),
    lowPrice: f6(v.lowPrice),
    highPrice: f6(v.highPrice),
    upsidePct: price && !price.isZero() ? target.div(price).sub(1).mul(100).toFixed(1) : null,
    note: v.note,
    authorName: who.get(v.createdBy) ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}

/** Current model version for a case, with the latest price so the hero can show target and upside. */
export async function valuationSummary(caseId: string, securityId: string) {
  const val = await prisma.researchValuation.findUnique({ where: { caseId }, include: { versions: { orderBy: { version: 'desc' } } } });
  if (!val) return null;
  const price = (await latestPrices([securityId], new Date())).get(securityId)?.latestDec ?? null;
  const who = await names(val.versions.map((v) => v.createdBy));
  const cur = val.versions[0]!;
  return { id: val.id, method: val.method, currency: val.currency, currentVersion: val.currentVersion, current: versionView(cur, who, price), versions: val.versions.map((v) => versionView(v, who, price)) };
}

// ---------------------------------------------------------------- bodies

const money = z.number().min(-1e15).max(1e15);
const finBody = z
  .object({
    period: z.string().trim().min(2).max(16),
    periodType: z.enum(PERIOD_TYPES),
    periodEnd: dateStr,
    currency: ccy.optional(),
    revenue: money.nullish(),
    ebitda: money.nullish(),
    netIncome: money.nullish(),
    eps: z.number().min(-1e9).max(1e9).nullish(),
    totalAssets: money.nullish(),
    totalDebt: money.nullish(),
    equity: money.nullish(),
    source: z.string().trim().min(2, 'Name the source').max(120),
    asOf: dateStr,
  })
  .strict();
const finPatch = finBody.omit({ period: true, periodType: true }).partial().strict();

const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : new D(v));

const entryBody = z
  .object({
    securityId: z.string().trim().min(1).max(36).optional(),
    caseId: z.string().trim().min(1).max(36).optional(),
    kind: z.enum(['NOTE', 'CATALYST', 'RISK']),
    title: z.string().trim().min(3, 'Give the entry a title').max(200),
    body: z.string().trim().max(5000).optional(),
    eventDate: dateStr.optional(),
    trigger: z.string().trim().max(300).optional(),
    impact: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  })
  .strict();

const resolveBody = z.object({ status: z.enum(['OCCURRED', 'MISSED', 'CANCELLED', 'MITIGATED', 'CLOSED']), note: z.string().trim().min(3, 'Add a short note').max(500) }).strict();
const CATALYST_OUT = ['OCCURRED', 'MISSED', 'CANCELLED'];
const RISK_OUT = ['MITIGATED', 'CLOSED'];

const valBody = z.object({ inputs: valuationInputs, targetPrice: z.number().positive('Target must be greater than zero').max(1e12).optional(), note: z.string().trim().max(500).optional() }).strict();

const filingBody = z.object({
  filingType: z.enum(FILING_TYPES),
  title: z.string().trim().min(3, 'Give the filing a title').max(200),
  period: z.string().trim().max(16).optional(),
  periodEnd: dateStr.optional(),
  filedOn: dateStr,
  source: z.string().trim().min(2, 'Name the source (exchange, issuer website...)').max(120),
  sourceUrl: z.string().trim().url().max(500).optional(),
});

export function registerResearchDepth(r: Router) {
  // ================================================================ issuers (FR-RES-006)

  const issuersQuery = listPage.extend({ q: z.string().trim().max(80).optional(), market: z.string().trim().max(8).optional(), withCases: z.enum(['1', 'true']).optional() });
  r.get('/issuers', ...canView, validateQuery(issuersQuery), async (req, res) => {
    const f = query<z.infer<typeof issuersQuery>>(req);
    const where: Prisma.SecurityWhereInput = { assetClass: { in: ['Equity', 'Fixed income', 'Fund'] }, status: { not: 'Delisted' } };
    if (f.q) where.OR = [{ ticker: { contains: f.q } }, { name: { contains: f.q } }, { isin: { contains: f.q } }];
    if (f.market) where.market = f.market.toUpperCase();
    if (f.withCases) where.id = { in: (await prisma.researchCase.findMany({ select: { securityId: true }, distinct: ['securityId'] })).map((c) => c.securityId) };
    const [rows, total] = await Promise.all([prisma.security.findMany({ where, orderBy: { ticker: 'asc' }, take: f.limit, skip: f.offset }), prisma.security.count({ where })]);
    const ids = rows.map((s) => s.id);
    const [prices, fins, filings, catalysts, cases] = await Promise.all([
      latestPrices(ids, new Date()),
      ids.length ? prisma.issuerFinancial.findMany({ where: { securityId: { in: ids } }, orderBy: { periodEnd: 'desc' } }) : [],
      ids.length ? prisma.issuerFiling.groupBy({ by: ['securityId'], where: { securityId: { in: ids } }, _count: { _all: true } }) : [],
      ids.length ? prisma.researchEntry.groupBy({ by: ['securityId'], where: { securityId: { in: ids }, kind: 'CATALYST', status: 'PENDING' }, _count: { _all: true } }) : [],
      ids.length ? prisma.researchCase.groupBy({ by: ['securityId'], where: { securityId: { in: ids }, status: { not: 'ARCHIVED' } }, _count: { _all: true } }) : [],
    ]);
    res.json({
      data: rows.map((s) => ({
        id: s.id,
        ticker: s.ticker,
        isin: s.isin,
        name: s.name,
        market: s.market,
        assetClass: s.assetClass,
        sector: s.sector,
        currency: s.currency,
        status: s.status,
        latestPrice: priceOf(prices.get(s.id)?.latest),
        latestFinancial: (() => {
          const x = fins.find((y) => y.securityId === s.id);
          return x ? { period: x.period, asOf: isoDay(x.asOf), source: x.source } : null;
        })(),
        filings: filings.find((x) => x.securityId === s.id)?._count._all ?? 0,
        pendingCatalysts: catalysts.find((x) => x.securityId === s.id)?._count._all ?? 0,
        openCases: cases.find((x) => x.securityId === s.id)?._count._all ?? 0,
      })),
      total,
    });
  });

  r.get('/issuers/:id', ...canView, async (req, res) => {
    const s = await loadIssuer(param(req, 'id'));
    const [prices, history, fins, filings, entries, cases] = await Promise.all([
      latestPrices([s.id], new Date()),
      prisma.securityPrice.findMany({ where: { securityId: s.id }, orderBy: [{ priceDate: 'desc' }, { createdAt: 'desc' }], take: 30 }),
      prisma.issuerFinancial.findMany({ where: { securityId: s.id }, orderBy: { periodEnd: 'desc' }, take: 40 }),
      prisma.issuerFiling.findMany({ where: { securityId: s.id }, orderBy: [{ filedOn: 'desc' }, { createdAt: 'desc' }], take: 100 }),
      prisma.researchEntry.findMany({ where: { securityId: s.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
      prisma.researchCase.findMany({ where: { securityId: s.id }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, ref: true, title: true, rating: true, status: true, targetPrice: true, currency: true } }),
    ]);
    res.json({
      data: {
        security: { id: s.id, ticker: s.ticker, isin: s.isin, name: s.name, market: s.market, assetClass: s.assetClass, sector: s.sector, currency: s.currency, status: s.status },
        latestPrice: priceOf(prices.get(s.id)?.latest),
        previousPrice: priceOf(prices.get(s.id)?.previous),
        priceHistory: history.map((h) => ({ asOf: isoDay(h.priceDate), price: f6(h.price), source: h.source })),
        financials: fins.map(financialView),
        filings: await filingViews(filings),
        entries: await entryViews(entries),
        cases: cases.map((c) => ({ id: c.id, ref: c.ref, title: c.title, rating: c.rating, status: c.status, targetPrice: f6(c.targetPrice), currency: c.currency })),
      },
    });
  });

  r.post('/issuers/:id/financials', ...canEdit, validateBody(finBody), idempotent('research.financial_create'), async (req, res) => {
    const s = await loadIssuer(param(req, 'id'));
    const b = req.body as z.infer<typeof finBody>;
    if (b.asOf > isoDay(new Date())!) throw HttpError.badRequest('Validation failed', [{ path: 'asOf', message: 'The as-of date cannot be in the future' }]);
    if ([b.revenue, b.ebitda, b.netIncome, b.eps, b.totalAssets, b.totalDebt, b.equity].every((v) => v === null || v === undefined)) throw HttpError.badRequest('Validation failed', [{ path: 'revenue', message: 'Enter at least one figure' }]);
    if (await prisma.issuerFinancial.findUnique({ where: { securityId_period: { securityId: s.id, period: b.period } } })) throw HttpError.conflict(`${s.ticker} already has ${b.period}. Correct it instead of adding it again.`, 'duplicate_period');
    const row = await prisma.$transaction(async (tx) => {
      const f = await tx.issuerFinancial.create({
        data: { securityId: s.id, period: b.period, periodType: b.periodType, periodEnd: toDate(b.periodEnd), currency: b.currency ?? s.currency, revenue: dec(b.revenue), ebitda: dec(b.ebitda), netIncome: dec(b.netIncome), eps: dec(b.eps), totalAssets: dec(b.totalAssets), totalDebt: dec(b.totalDebt), equity: dec(b.equity), source: b.source, asOf: toDate(b.asOf), createdBy: req.user!.id },
      });
      await writeAudit(tx, audit(req), { action: 'research.financial_added', objectType: 'issuer_financial', objectId: f.id, after: { ticker: s.ticker, period: b.period, source: b.source, asOf: b.asOf } });
      return f;
    });
    res.status(201).json({ data: financialView(row) });
  });

  r.patch('/financials/:fid', ...canEdit, validateBody(finPatch), idempotent('research.patch.financials_id', { required: false }), async (req, res) => {
    const f = await prisma.issuerFinancial.findUnique({ where: { id: param(req, 'fid') } });
    if (!f) throw HttpError.notFound('Financial record not found');
    const b = req.body as z.infer<typeof finPatch>;
    const data: Prisma.IssuerFinancialUpdateInput = {};
    if (b.periodEnd !== undefined) data.periodEnd = toDate(b.periodEnd);
    if (b.currency !== undefined) data.currency = b.currency;
    for (const k of ['revenue', 'ebitda', 'netIncome', 'eps', 'totalAssets', 'totalDebt', 'equity'] as const) if (b[k] !== undefined) data[k] = dec(b[k]);
    if (b.source !== undefined) data.source = b.source;
    if (b.asOf !== undefined) {
      if (b.asOf > isoDay(new Date())!) throw HttpError.badRequest('Validation failed', [{ path: 'asOf', message: 'The as-of date cannot be in the future' }]);
      data.asOf = toDate(b.asOf);
    }
    const row = await prisma.$transaction(async (tx) => {
      const u = await tx.issuerFinancial.update({ where: { id: f.id }, data });
      await writeAudit(tx, audit(req), { action: 'research.financial_corrected', objectType: 'issuer_financial', objectId: f.id, before: financialView(f), after: financialView(u) });
      return u;
    });
    res.json({ data: financialView(row) });
  });

  // ================================================================ filings (FR-RES-006 list, FR-RES-009 import)

  r.post('/issuers/:id/filings', ...canEdit, uploadFiles('file'), idempotent('research.filing_import'), async (req, res) => {
    const s = await loadIssuer(param(req, 'id'));
    const parsed = filingBody.safeParse(req.body);
    if (!parsed.success) throw HttpError.badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const b = parsed.data;
    if (b.filedOn > isoDay(new Date())!) throw HttpError.badRequest('Validation failed', [{ path: 'filedOn', message: 'The filing date cannot be in the future' }]);
    const file = uploadedFiles(req)[0];
    if (!file) throw HttpError.badRequest('Validation failed', [{ path: 'file', message: 'Attach the filing' }]);
    const row = await prisma.$transaction(async (tx) => {
      const { document, file: stored } = await vaultDocument(tx, req, {
        file,
        name: `${s.ticker} ${b.title}`,
        type: 'research',
        label: b.filingType.replace(/_/g, ' ').toLowerCase(),
        relatedType: 'security',
        relatedId: s.id,
        relatedLabel: `${s.ticker} ${s.name}`,
        sourceType: 'ISSUER_FILING',
        documentDate: toDate(b.filedOn),
      });
      const f = await tx.issuerFiling.create({ data: { securityId: s.id, documentId: document.id, filingType: b.filingType, title: b.title, period: b.period ?? null, periodEnd: b.periodEnd ? toDate(b.periodEnd) : null, filedOn: toDate(b.filedOn), source: b.source, sourceUrl: b.sourceUrl ?? null, createdBy: req.user!.id } });
      await writeAudit(tx, audit(req), { action: 'research.filing_imported', objectType: 'issuer_filing', objectId: f.id, after: { ticker: s.ticker, filingType: b.filingType, document: document.ref, sha256: stored.sha256, source: b.source } });
      return f;
    });
    res.status(201).json({ data: (await filingViews([row]))[0] });
  });

  r.get('/filings/:fid/download-url', ...canView, async (req, res) => {
    const f = await prisma.issuerFiling.findUnique({ where: { id: param(req, 'fid') } });
    if (!f) throw HttpError.notFound('Filing not found');
    const v = await prisma.documentVersion.findFirst({ where: { documentId: f.documentId }, orderBy: { version: 'desc' } });
    if (!v) throw HttpError.notFound('The vault document has no file');
    await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'research.filing_downloaded', objectType: 'issuer_filing', objectId: f.id, after: { documentId: f.documentId, version: v.version } }));
    res.json({ url: signedDownloadUrl(v.fileId), expiresIn: 300 });
  });

  // ================================================================ notes, catalysts, risks (FR-RES-008)

  const entriesQuery = listPage.extend({ securityId: z.string().trim().max(36).optional(), caseId: z.string().trim().max(36).optional(), kind: z.enum(['NOTE', 'CATALYST', 'RISK']).optional(), status: z.string().trim().max(12).optional() });
  r.get('/entries', ...canView, validateQuery(entriesQuery), async (req, res) => {
    const f = query<z.infer<typeof entriesQuery>>(req);
    const where: Prisma.ResearchEntryWhereInput = {};
    if (f.securityId) where.securityId = (await loadIssuer(f.securityId)).id;
    if (f.caseId) where.caseId = f.caseId;
    if (f.kind) where.kind = f.kind;
    if (f.status) where.status = f.status.toUpperCase();
    const [rows, total] = await Promise.all([prisma.researchEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.limit, skip: f.offset }), prisma.researchEntry.count({ where })]);
    res.json({ data: await entryViews(rows), total });
  });

  r.post('/entries', ...canEdit, validateBody(entryBody), idempotent('research.entry_create'), async (req, res) => {
    const b = req.body as z.infer<typeof entryBody>;
    const errs: { path: string; message: string }[] = [];
    if (b.kind === 'NOTE' && !b.body) errs.push({ path: 'body', message: 'Write the note' });
    if (b.kind === 'CATALYST') {
      if (!b.eventDate) errs.push({ path: 'eventDate', message: 'A catalyst needs a date' });
      if (!b.trigger) errs.push({ path: 'trigger', message: 'State what triggers the catalyst' });
    }
    if (b.kind === 'RISK' && !b.severity) errs.push({ path: 'severity', message: 'Rate the risk (low, medium or high)' });
    if (errs.length) throw HttpError.badRequest('Validation failed', errs);
    let securityId: string;
    let caseId: string | null = null;
    if (b.caseId) {
      const c = await prisma.researchCase.findFirst({ where: UUID.test(b.caseId) ? { id: b.caseId } : { ref: b.caseId } });
      if (!c) throw HttpError.badRequest('Validation failed', [{ path: 'caseId', message: 'Unknown research case' }]);
      securityId = c.securityId;
      caseId = c.id;
    } else if (b.securityId) securityId = (await loadIssuer(b.securityId).catch(() => { throw HttpError.badRequest('Validation failed', [{ path: 'securityId', message: 'Unknown issuer' }]); })).id;
    else throw HttpError.badRequest('Validation failed', [{ path: 'securityId', message: 'Pick the issuer or the research case' }]);
    const row = await prisma.$transaction(async (tx) => {
      const e = await tx.researchEntry.create({
        data: {
          securityId,
          caseId,
          kind: b.kind,
          title: b.title,
          body: b.body ?? null,
          eventDate: b.eventDate ? toDate(b.eventDate) : null,
          triggerText: b.kind === 'CATALYST' ? (b.trigger ?? null) : null,
          impact: b.kind === 'CATALYST' ? (b.impact ?? 'NEUTRAL') : null,
          severity: b.kind === 'RISK' ? (b.severity ?? null) : null,
          status: b.kind === 'CATALYST' ? 'PENDING' : b.kind === 'RISK' ? 'OPEN' : 'RECORDED',
          createdBy: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), { action: `research.${b.kind.toLowerCase()}_added`, objectType: 'research_entry', objectId: e.id, after: { kind: b.kind, title: b.title, securityId, caseId, eventDate: b.eventDate ?? null } });
      return e;
    });
    res.status(201).json({ data: (await entryViews([row]))[0] });
  });

  r.post('/entries/:id/resolve', ...canEdit, validateBody(resolveBody), idempotent('research.entry_resolve', { required: false }), async (req, res) => {
    const e = await prisma.researchEntry.findUnique({ where: { id: param(req, 'id') } });
    if (!e) throw HttpError.notFound('Entry not found');
    const b = req.body as z.infer<typeof resolveBody>;
    const allowed = e.kind === 'CATALYST' ? CATALYST_OUT : e.kind === 'RISK' ? RISK_OUT : [];
    if (!allowed.includes(b.status)) throw invalidState(`A ${e.kind.toLowerCase()} cannot be set to ${b.status}`);
    if (e.status !== 'PENDING' && e.status !== 'OPEN') throw invalidState(`This ${e.kind.toLowerCase()} is already ${e.status}`);
    const row = await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.researchEntry.updateMany({ where: { id: e.id, status: e.status }, data: { status: b.status, resolvedAt: new Date(), resolvedBy: req.user!.id, resolutionNote: b.note } })).count);
      await writeAudit(tx, audit(req), { action: `research.${e.kind.toLowerCase()}_resolved`, objectType: 'research_entry', objectId: e.id, before: { status: e.status }, after: { status: b.status }, reason: b.note });
      return tx.researchEntry.findUniqueOrThrow({ where: { id: e.id } });
    });
    res.json({ data: (await entryViews([row]))[0] });
  });

  // ================================================================ valuation model (FR-RES-007)

  async function caseOf(v: string) {
    const c = await prisma.researchCase.findFirst({ where: UUID.test(v) ? { id: v } : { ref: v } });
    if (!c) throw HttpError.notFound('Research case not found');
    return c;
  }

  r.get('/cases/:id/valuation', ...canView, async (req, res) => {
    const c = await caseOf(param(req, 'id'));
    res.json({ data: await valuationSummary(c.id, c.securityId) });
  });

  /** Saving assumptions always creates a new immutable version with author and time. */
  r.put('/cases/:id/valuation', ...canEdit, validateBody(valBody), idempotent('research.valuation_save'), async (req, res) => {
    const c = await caseOf(param(req, 'id'));
    if (c.status === 'ARCHIVED') throw invalidState(`${c.ref} is archived; its model cannot change`);
    const b = req.body as z.infer<typeof valBody>;
    const inputs: ValuationInputs = b.inputs;
    const out = runValuation(inputs);
    const target = b.targetPrice ?? out.prices.base;
    if (!(target > 0)) throw HttpError.badRequest('Validation failed', [{ path: 'targetPrice', message: 'The base case does not give a positive value. Revisit the assumptions or enter a target of your own.' }]);
    const d6 = (n: number) => new D(n.toFixed(6));
    await prisma.$transaction(async (tx) => {
      let val = await tx.researchValuation.findUnique({ where: { caseId: c.id } });
      const next = (val?.currentVersion ?? 0) + 1;
      if (!val) val = await tx.researchValuation.create({ data: { caseId: c.id, method: 'DCF', currency: c.currency, currentVersion: 1, createdBy: req.user!.id } });
      else await tx.researchValuation.update({ where: { id: val.id }, data: { currentVersion: next } });
      await tx.researchValuationVersion.create({
        data: {
          valuationId: val.id,
          version: next,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          result: { ...out, targetSource: b.targetPrice === undefined ? 'MODEL' : 'OVERRIDE' } as unknown as Prisma.InputJsonValue,
          targetPrice: d6(target),
          lowPrice: d6(out.prices.low),
          highPrice: d6(out.prices.high),
          note: b.note ?? null,
          createdBy: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), { action: 'research.valuation_saved', objectType: 'research_case', objectId: c.id, after: { case: c.ref, version: next, target: target.toFixed(6), low: out.prices.low.toFixed(6), high: out.prices.high.toFixed(6), targetSource: b.targetPrice === undefined ? 'MODEL' : 'OVERRIDE' } });
    });
    res.status(201).json({ data: await valuationSummary(c.id, c.securityId) });
  });

  /** Copies the current model target onto the case. A draft only, by its author: a published target changes through Revise and review. */
  r.post('/cases/:id/valuation/apply-target', ...canEdit, idempotent('research.valuation_apply', { required: false }), async (req, res) => {
    const c = await caseOf(param(req, 'id'));
    if (c.status !== 'DRAFT') throw invalidState(`${c.ref} is ${c.status}; revise the case before changing its target`);
    if (c.analystId !== req.user!.id) throw HttpError.forbidden('Only the case author can apply the model target', 'not_maker');
    const val = await prisma.researchValuation.findUnique({ where: { caseId: c.id }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    const v = val?.versions[0];
    if (!v) throw invalidState('Save the valuation model first');
    await prisma.$transaction(async (tx) => {
      assertUpdated((await tx.researchCase.updateMany({ where: { id: c.id, status: 'DRAFT', version: c.version }, data: { targetPrice: v.targetPrice, version: { increment: 1 } } })).count);
      await writeAudit(tx, audit(req), { action: 'research.valuation_applied', objectType: 'research_case', objectId: c.id, before: { targetPrice: c.targetPrice.toString() }, after: { targetPrice: v.targetPrice.toString(), modelVersion: v.version } });
    });
    res.json({ data: { caseId: c.id, targetPrice: f6(v.targetPrice), modelVersion: v.version } });
  });

}
