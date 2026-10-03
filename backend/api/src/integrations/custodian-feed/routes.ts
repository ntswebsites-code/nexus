import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../../modules/ops/ops.common';
import { IntegrationNotConfiguredError, isoDay, lastWeekdayOnOrBefore } from '../common';
import { custodianFeedMode, getCustodianFeedAdapter } from './index';
import { ingestStatementFile } from './file-drop';
import { fakeStatementFile } from './fake';
import { CUSTODIAN_LIVE_REQUIRED_ENV, liveMissingEnv } from './live';

/**
 * Custodian feed API (`/api/v1/custodian-feed`). Admin staff only. Reads: `operations.view`. Upload: `recon.manage`
 * (the same maker permission that runs matching). The file text travels as JSON (`{ filename, content }`), at most 1 MB.
 */
export const custodianFeedRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('operations.view')];
const canManage = [...staff, requirePermission('operations.view', 'recon.manage')];

const uploadSchema = z.object({
  counterpartyId: z.string().trim().length(36),
  filename: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(1_000_000),
  format: z.enum(['CSV', 'MT940', 'JSON']).optional(),
});

const rethrow = (e: unknown): never => {
  if (e instanceof IntegrationNotConfiguredError) throw new HttpError(503, e.code, e.message, { requiredEnv: e.requiredEnv });
  throw e;
};

const fileView = (f: Awaited<ReturnType<typeof prisma.custodianFeedFile.findFirstOrThrow>>) => ({
  id: f.id,
  counterpartyId: f.counterpartyId,
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

/** Feed status: adapter mode, what live would need, per-counterparty last file, recent files. */
custodianFeedRoutes.get('/status', ...canView, async (_req, res) => {
  const mode = custodianFeedMode();
  const [cps, files] = await Promise.all([
    prisma.counterparty.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, ref: true, name: true, type: true, accounts: true } }),
    prisma.custodianFeedFile.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const last = new Map<string, (typeof files)[number]>();
  for (const f of files) if (f.status === 'Imported' && !last.has(f.counterpartyId)) last.set(f.counterpartyId, f);
  res.json({
    data: {
      mode,
      live: { configured: false, requiredEnv: CUSTODIAN_LIVE_REQUIRED_ENV, missingEnv: liveMissingEnv(), note: 'SWIFT or API connectivity is not implemented; supply credentials and the vendor client to enable.' },
      formats: ['CSV', 'MT940', 'JSON'],
      counterparties: cps.map((c) => ({ id: c.id, ref: c.ref, name: c.name, type: c.type, lastFile: last.has(c.id) ? { filename: last.get(c.id)!.filename, statementDate: last.get(c.id)!.statementDate ? isoDay(last.get(c.id)!.statementDate!) : null, at: last.get(c.id)!.createdAt.toISOString() } : null })),
      files: files.map(fileView),
    },
  });
});

custodianFeedRoutes.post('/upload', ...canManage, validateBody(uploadSchema), idempotent('custodian_feed.upload', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof uploadSchema>;
  const result = await ingestStatementFile({ counterpartyId: b.counterpartyId, filename: b.filename, content: b.content, format: b.format, userId: req.user!.id, audit: audit(req) });
  res.status(201).json({ data: result });
});

custodianFeedRoutes.get('/files/:id', ...canView, async (req, res) => {
  const f = await prisma.custodianFeedFile.findUnique({ where: { id: param(req, 'id') } });
  if (!f) throw HttpError.notFound('File not found');
  const holdings = await prisma.custodianFeedHolding.findMany({ where: { fileId: f.id }, orderBy: [{ accountRef: 'asc' }, { ticker: 'asc' }] });
  res.json({ data: { ...fileView(f), holdings: holdings.map((h) => ({ accountRef: h.accountRef, ticker: h.ticker, isin: h.isin, quantity: h.quantity.toString(), price: h.price?.toString() ?? null, marketValue: h.marketValue?.toFixed(2) ?? null, currency: h.currency })) } });
});

/** Adapter statements (file-drop: uploaded; fake: generated; live: 503 until configured). */
custodianFeedRoutes.get('/statements', ...canView, async (req, res) => {
  try {
    const adapter = getCustodianFeedAdapter();
    const counterpartyId = typeof req.query.counterpartyId === 'string' ? req.query.counterpartyId : undefined;
    res.json({ data: await adapter.listStatements({ counterpartyId, limit: 50 }), mode: adapter.name });
  } catch (e) {
    rethrow(e);
  }
});

/** Downloadable format templates so operations can see exactly what the parsers expect. */
custodianFeedRoutes.get('/templates/:format', ...canView, (req, res) => {
  const f = param(req, 'format').toUpperCase();
  if (f !== 'CSV' && f !== 'MT940' && f !== 'JSON') throw HttpError.notFound('Unknown format');
  const { content, filename } = fakeStatementFile('template', 'ACC-001', lastWeekdayOnOrBefore(isoDay(new Date())), f, 'USD');
  res.json({ data: { format: f, filename: filename.replace('fake-', 'template-'), content } });
});

/** Fake mode only: generate a deterministic statement and push it through the real ingest path. */
const sampleSchema = z.object({
  counterpartyId: z.string().trim().length(36),
  accountRef: z.string().trim().min(1).max(64),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  format: z.enum(['CSV', 'MT940', 'JSON']).default('CSV'),
});
custodianFeedRoutes.post('/sample', ...canManage, validateBody(sampleSchema), async (req, res) => {
  if (custodianFeedMode() !== 'fake') throw HttpError.conflict('Sample statements are only available when INTEGRATION_CUSTODIAN_FEED=fake', 'not_fake_mode');
  const b = req.body as z.infer<typeof sampleSchema>;
  const f = fakeStatementFile(b.counterpartyId, b.accountRef, b.statementDate, b.format);
  const result = await ingestStatementFile({ counterpartyId: b.counterpartyId, filename: f.filename, content: f.content, format: b.format, userId: req.user!.id, audit: audit(req), adapter: 'fake' });
  res.status(201).json({ data: result });
});
