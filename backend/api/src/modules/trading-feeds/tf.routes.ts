import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { brokerRoutingMode } from '../../integrations/broker-routing';
import { marketDataMode } from '../../integrations/market-data';
import { generateMissingInstructions, generateSettlementInstruction, ingestContractNote, ingestExecutionReports, instructionFile, instructionView, moveInstruction, pollExecutionReports, resolveBreak, routeOrderViaAdapter, syncCorporateActions } from './tf.service';
import { BREAK_REASONS, PRICE_DEVIATION_PCT, SETTLEMENT_DAYS } from './tf.engine';

/**
 * Trading and corporate-action feeds (R4-10), mounted at `/api/v1/trading-feeds`. Admin staff only.
 *   reads                                  orders.view (corporate-action feed reads: operations.view)
 *   upload / FIX / resolve / instructions  orders.route
 *   release a settlement instruction       orders.approve (a different person from the generator)
 *   corporate-action sync                  corporate_actions.manage
 */
export const tradingFeedsRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('orders.view')];
const canManage = [...staff, requirePermission('orders.route')];
const canRelease = [...staff, requirePermission('orders.approve')];
const canViewCa = [...staff, requirePermission('operations.view')];
const canSyncCa = [...staff, requirePermission('corporate_actions.manage')];

const idStr = z.string().trim().min(1).max(40);
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) };

// ---------------------------------------------------------------- overview

tradingFeedsRoutes.get('/overview', ...canView, async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [openBreaks, breaksByReason, linesToday, files, instr, lastRun, caDrafts] = await Promise.all([
    prisma.tradeFeedLine.count({ where: { status: 'BREAK' } }),
    prisma.tradeFeedLine.groupBy({ by: ['breakReason'], where: { status: 'BREAK' }, _count: { _all: true } }),
    prisma.tradeFeedLine.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.tradeFeedFile.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
    prisma.settlementInstruction.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.caFeedRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.corpActionEvent.count({ where: { status: 'ANNOUNCED', makerId: '00000000-0000-4000-8000-000000000000' } }),
  ]);
  res.json({
    data: {
      brokerRouting: { mode: brokerRoutingMode(), note: brokerRoutingMode() === 'live' ? 'The FIX session is not built; every feed call fails with a not-configured error.' : brokerRoutingMode() === 'fake' ? 'Fake broker: test data only; use INTEGRATION_BROKER_ROUTING=file-drop in production.' : 'File drop: upload contract notes or post FIX reports.' },
      marketData: { mode: marketDataMode() },
      openBreaks,
      breaksByReason: Object.fromEntries(breaksByReason.map((b) => [b.breakReason ?? 'OTHER', b._count._all])),
      linesLast24h: Object.fromEntries(linesToday.map((b) => [b.status, b._count._all])),
      lastFile: files[0] ? { filename: files[0].filename, at: files[0].createdAt.toISOString(), matched: files[0].linesMatched, breaks: files[0].linesBreak } : null,
      instructions: Object.fromEntries(instr.map((b) => [b.status, b._count._all])),
      caFeed: lastRun ? { at: lastRun.startedAt.toISOString(), status: lastRun.status, drafted: lastRun.drafted, duplicates: lastRun.duplicates, rejected: lastRun.rejected, error: lastRun.error } : null,
      caDraftsAwaitingConfirmation: caDrafts,
      rules: { breakReasons: BREAK_REASONS, priceDeviationPct: PRICE_DEVIATION_PCT, settlementDays: SETTLEMENT_DAYS },
    },
  });
});

// ---------------------------------------------------------------- contract notes

const uploadSchema = z.object({
  brokerId: idStr,
  filename: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(3_000_000),
  /** PDF: `content` is the file, base64 encoded. TEXT: the narrative text of a note. */
  format: z.enum(['CSV', 'JSON', 'TEXT', 'PDF']).optional(),
});

tradingFeedsRoutes.post('/contract-notes', ...canManage, validateBody(uploadSchema), idempotent('trading_feeds.contract_note', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof uploadSchema>;
  res.status(201).json({ data: await ingestContractNote({ brokerId: b.brokerId, filename: b.filename, content: b.content, format: b.format, userId: req.user!.id, ctx: audit(req) }) });
});

tradingFeedsRoutes.get('/contract-notes/template', ...canView, (req, res) => {
  const fmt = String(req.query.format ?? 'csv').toLowerCase();
  if (fmt === 'json') {
    const content = JSON.stringify({ trades: [{ tradeRef: 'TRD-0001', orderRef: 'ORD-00001', ticker: 'DLTA.ZW', side: 'BUY', quantity: '1000', price: '1.250000', fees: '12.50', tradeDate: '2026-10-02', executedAt: '2026-10-02T09:41:00Z' }] }, null, 2);
    return void res.json({ data: { format: 'JSON', filename: 'contract-note-template.json', content } });
  }
  const content = 'trade_ref,order_ref,broker_order_ref,ticker,side,quantity,price,fees,trade_date,executed_at\nTRD-0001,ORD-00001,,DLTA.ZW,BUY,1000,1.250000,12.50,2026-10-02,2026-10-02T09:41:00Z\n';
  res.json({ data: { format: 'CSV', filename: 'contract-note-template.csv', content } });
});

const fileView = (f: Prisma.TradeFeedFileGetPayload<object>, brokers: Map<string, string>) => ({
  id: f.id,
  broker: brokers.get(f.brokerId) ?? f.brokerId,
  brokerId: f.brokerId,
  adapter: f.adapter,
  filename: f.filename,
  format: f.format,
  status: f.status,
  total: f.linesTotal,
  matched: f.linesMatched,
  breaks: f.linesBreak,
  duplicates: f.linesDuplicate,
  error: f.error,
  createdAt: f.createdAt.toISOString(),
});

tradingFeedsRoutes.get('/files', ...canView, validateQuery(z.object({ ...page })), async (req, res) => {
  const q = req.query as unknown as { limit: number; offset: number };
  const [rows, total] = await Promise.all([prisma.tradeFeedFile.findMany({ orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }), prisma.tradeFeedFile.count()]);
  const brokers = new Map((await prisma.broker.findMany({ where: { id: { in: rows.map((r) => r.brokerId) } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  res.json({ data: rows.map((r) => fileView(r, brokers)), meta: { total } });
});

// ---------------------------------------------------------------- FIX

const fixSchema = z.object({ messages: z.array(z.string().min(10).max(4000)).min(1).max(500), brokerId: idStr.optional() });
tradingFeedsRoutes.post('/fix/execution-reports', ...canManage, validateBody(fixSchema), idempotent('trading_feeds.fix_ingest', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof fixSchema>;
  res.status(201).json({ data: await ingestExecutionReports({ messages: b.messages, brokerId: b.brokerId, userId: req.user!.id, ctx: audit(req) }) });
});

tradingFeedsRoutes.post('/fix/poll', ...canManage, idempotent('trading_feeds.fix_poll', { required: false }), async (req, res) => {
  res.status(201).json({ data: await pollExecutionReports({ userId: req.user!.id, ctx: audit(req) }) });
});

tradingFeedsRoutes.post('/fix/route', ...canManage, validateBody(z.object({ orderId: idStr })), idempotent('trading_feeds.fix_route', { required: false }), async (req, res) => {
  res.status(201).json({ data: await routeOrderViaAdapter({ orderId: (req.body as { orderId: string }).orderId, ctx: audit(req) }) });
});

// ---------------------------------------------------------------- lines and breaks

const lineQuery = z.object({
  status: z.string().trim().max(60).optional(),
  source: z.enum(['CONTRACT_NOTE', 'FIX']).optional(),
  fileId: z.string().trim().max(40).optional(),
  q: z.string().trim().max(60).optional(),
  ...page,
});

const lineView = (l: Prisma.TradeFeedLineGetPayload<object>) => ({
  id: l.id,
  ref: l.ref,
  source: l.source,
  fileId: l.fileId,
  externalRef: l.externalRef,
  orderRef: l.orderRef,
  brokerOrderRef: l.brokerOrderRef,
  orderId: l.orderId,
  ticker: l.ticker,
  side: l.side,
  quantity: l.quantity.toString(),
  price: l.price.toString(),
  fees: l.fees.toFixed(2),
  tradeDate: l.tradeDate.toISOString().slice(0, 10),
  executedAt: l.executedAt.toISOString(),
  status: l.status,
  breakReason: l.breakReason,
  detail: l.detail,
  resolution: l.resolution,
  resolvedBy: l.resolvedBy,
  resolvedAt: l.resolvedAt?.toISOString() ?? null,
  createdBy: l.createdBy,
  createdAt: l.createdAt.toISOString(),
});

tradingFeedsRoutes.get('/lines', ...canView, validateQuery(lineQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof lineQuery>;
  const where: Prisma.TradeFeedLineWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',').map((s) => s.trim().toUpperCase()) } } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.fileId ? { fileId: q.fileId } : {}),
    ...(q.q ? { OR: [{ ref: { contains: q.q } }, { ticker: { contains: q.q } }, { orderRef: { contains: q.q } }, { externalRef: { contains: q.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([prisma.tradeFeedLine.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }), prisma.tradeFeedLine.count({ where })]);
  res.json({ data: rows.map(lineView), meta: { total } });
});

const resolveSchema = z
  .object({
    action: z.enum(['MATCH', 'REJECT']),
    orderId: idStr.optional(),
    note: z.string().trim().min(5, 'Give a reason (5+ characters)').max(500),
    force: z.boolean().optional(),
  })
  .strict();
tradingFeedsRoutes.post('/lines/:id/resolve', ...canManage, validateBody(resolveSchema), idempotent('trading_feeds.resolve', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof resolveSchema>;
  res.json({ data: lineView(await resolveBreak({ lineId: param(req, 'id'), action: b.action, orderId: b.orderId, note: b.note, force: b.force, userId: req.user!.id, ctx: audit(req) })) });
});

// ---------------------------------------------------------------- settlement instructions

const instrQuery = z.object({ status: z.string().trim().max(80).optional(), q: z.string().trim().max(40).optional(), ...page });
tradingFeedsRoutes.get('/settlement-instructions', ...canView, validateQuery(instrQuery), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof instrQuery>;
  const where: Prisma.SettlementInstructionWhereInput = {
    ...(q.status ? { status: { in: q.status.split(',').map((s) => s.trim().toUpperCase()) } } : {}),
    ...(q.q ? { OR: [{ ref: { contains: q.q } }, { orderRef: { contains: q.q } }, { ticker: { contains: q.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([prisma.settlementInstruction.findMany({ where, orderBy: [{ settleDate: 'asc' }, { createdAt: 'desc' }], take: q.limit, skip: q.offset }), prisma.settlementInstruction.count({ where })]);
  res.json({ data: rows.map(instructionView), meta: { total } });
});

tradingFeedsRoutes.post('/settlement-instructions/generate', ...canManage, validateBody(z.object({ orderId: idStr })), idempotent('trading_feeds.instr_generate', { required: false }), async (req, res) => {
  const r = await generateSettlementInstruction(audit(req), (req.body as { orderId: string }).orderId, req.user!.id);
  res.status(r.created ? 201 : 200).json({ data: { ...instructionView(r.instruction), created: r.created } });
});

tradingFeedsRoutes.post('/settlement-instructions/generate-missing', ...canManage, idempotent('trading_feeds.instr_generate_missing', { required: false }), async (req, res) => {
  res.json({ data: await generateMissingInstructions(audit(req), req.user!.id) });
});

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const act = (action: 'release' | 'confirm', guards: typeof canManage) =>
  tradingFeedsRoutes.post(`/settlement-instructions/:id/${action}`, ...guards, idempotent(`trading_feeds.instr_${action}`, { required: false }), async (req, res) => {
    res.json({ data: instructionView(await moveInstruction({ id: param(req, 'id'), action, userId: req.user!.id, ctx: audit(req) })) });
  });
act('release', canRelease);
act('confirm', canManage);
for (const action of ['fail', 'cancel'] as const) {
  tradingFeedsRoutes.post(`/settlement-instructions/:id/${action}`, ...canManage, validateBody(reasonSchema), idempotent(`trading_feeds.instr_${action}`, { required: false }), async (req, res) => {
    res.json({ data: instructionView(await moveInstruction({ id: param(req, 'id'), action, reason: (req.body as { reason: string }).reason, userId: req.user!.id, ctx: audit(req) })) });
  });
}

tradingFeedsRoutes.get('/settlement-instructions/:id/file', ...canView, async (req, res) => {
  const fmt = String(req.query.format ?? 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  res.json({ data: await instructionFile(param(req, 'id'), fmt) });
});

// ---------------------------------------------------------------- corporate-action feed

tradingFeedsRoutes.get('/ca-feed', ...canViewCa, validateQuery(z.object({ status: z.string().trim().max(60).optional(), ...page })), async (req, res) => {
  const q = req.query as unknown as { status?: string; limit: number; offset: number };
  const where: Prisma.CaFeedItemWhereInput = q.status ? { status: { in: q.status.split(',').map((s) => s.trim().toUpperCase()) } } : {};
  const [items, total, runs] = await Promise.all([
    prisma.caFeedItem.findMany({ where, orderBy: { lastSeenAt: 'desc' }, take: q.limit, skip: q.offset }),
    prisma.caFeedItem.count({ where }),
    prisma.caFeedRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);
  const events = new Map((await prisma.corpActionEvent.findMany({ where: { id: { in: items.map((i) => i.eventId).filter((x): x is string => !!x) } }, select: { id: true, ref: true, status: true } })).map((e) => [e.id, e]));
  res.json({
    data: {
      provider: marketDataMode(),
      items: items.map((i) => ({ id: i.id, source: i.source, sourceRef: i.sourceRef, ticker: i.ticker, type: i.caType, exDate: i.exDate?.toISOString().slice(0, 10) ?? null, status: i.status, reason: i.reason, seenCount: i.seenCount, firstSeenAt: i.firstSeenAt.toISOString(), lastSeenAt: i.lastSeenAt.toISOString(), event: i.eventId ? { id: i.eventId, ref: events.get(i.eventId)?.ref ?? null, status: events.get(i.eventId)?.status ?? null } : null })),
      runs: runs.map((r) => ({ id: r.id, trigger: r.trigger, provider: r.provider, status: r.status, fetched: r.fetched, drafted: r.drafted, duplicates: r.duplicates, rejected: r.rejected, error: r.error, startedAt: r.startedAt.toISOString() })),
    },
    meta: { total },
  });
});

tradingFeedsRoutes.post('/ca-feed/sync', ...canSyncCa, idempotent('trading_feeds.ca_sync', { required: false }), async (req, res) => {
  const r = await syncCorporateActions({ trigger: 'MANUAL', userId: req.user!.id, ctx: audit(req) });
  if (r.status === 'ERROR' && /not configured/i.test(r.error ?? '')) throw new HttpError(503, 'integration_not_configured', r.error!);
  res.status(201).json({ data: r });
});
