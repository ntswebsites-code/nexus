import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { policy } from '../../lib/policy';
import { actorName, ctx, expectVersion, param } from '../../lib/http';
import { fmtDate } from '../../lib/format';
import { signedDownloadUrl } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { capitalView, requestInclude, requestView, snapshotInclude, threadInclude, threadView } from './investor.service';
import { pageEnvelope, sqlPage } from '../../middleware/paginate';

/** Staff side of investor services (admin portal): capital notices, snapshots, requests, messages. */
export const investorStaffRoutes = Router();
investorStaffRoutes.use(requireAuth, requirePortalAccess('admin'));

const audit = (req: Parameters<typeof ctx>[0]) => ctx(req, 'admin');

async function clientByRef(ref: string) {
  const c = await prisma.client.findFirst({ where: { OR: [{ ref }, { id: ref }], archivedAt: null }, select: { id: true, ref: true, name: true } });
  if (!c) throw HttpError.badRequest(`Unknown client ${ref}`);
  return c;
}

async function notifyClient(tx: Prisma.TransactionClient, clientId: string, n: { type: string; title: string; body?: string; link?: string; email?: boolean }) {
  const members = await tx.clientUser.findMany({ where: { clientId }, select: { userId: true } });
  if (members.length) await enqueue(tx, 'notify.users', { userIds: members.map((m) => m.userId), ...n });
}

// ---------------------------------------------------------------- capital events

const capitalInclude = { client: { select: { ref: true, name: true } }, evidence: { orderBy: { confirmedAt: 'desc' } } } satisfies Prisma.CapitalEventInclude;
type CapitalRow = Prisma.CapitalEventGetPayload<{ include: typeof capitalInclude }>;

const staffCapitalView = (c: CapitalRow) => ({
  ...capitalView(c),
  uuid: c.id,
  clientId: c.client.ref,
  client: c.client.name,
  published: !!c.publishedAt,
  makerId: c.makerId,
  checkerId: c.checkerId,
  evidenceFiles: c.evidence.map((e) => ({ id: e.id, confirmedAt: e.confirmedAt, matchedAt: e.matchedAt })),
});

async function findCapital(refOrId: string) {
  const c = await prisma.capitalEvent.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }] }, include: capitalInclude });
  if (!c) throw HttpError.notFound('Capital event not found');
  return c;
}

investorStaffRoutes.get('/capital-events', requireAnyPermission('cash.view', 'clients.view'), async (req, res) => {
  const client = typeof req.query.clientId === 'string' ? await clientByRef(req.query.clientId) : null;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where = { ...(client ? { clientId: client.id } : {}), ...(status ? { status } : {}) };
  const pg = sqlPage(req, 500);
  const [rows, total] = await Promise.all([
    prisma.capitalEvent.findMany({ where, include: capitalInclude, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.capitalEvent.count({ where }),
  ]);
  res.json(pageEnvelope(pg, rows.map(staffCapitalView), total));
});

const capitalSchema = z.object({
  clientId: z.string().min(1),
  investment: z.string().trim().min(1).max(160),
  type: z.enum(['Capital call', 'Distribution', 'Contribution', 'Withdrawal']),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  due: z.coerce.date(),
  purpose: z.string().trim().max(2000).optional(),
  breakdown: z.array(z.tuple([z.string().trim().min(1).max(120), z.coerce.number()])).max(20).default([]),
  bank: z.string().trim().max(255).optional(),
});

investorStaffRoutes.post('/capital-events', requireAnyPermission('clients.edit', 'cash.journal.create'), validateBody(capitalSchema), async (req, res) => {
  const b = req.body as z.infer<typeof capitalSchema>;
  const client = await clientByRef(b.clientId);
  if (b.breakdown.length) {
    const total = b.breakdown.reduce((s, [, v]) => s + v, 0);
    if (Math.abs(total - b.amount) > 0.01) throw HttpError.badRequest('Breakdown lines must add up to the notice amount');
  }
  const id = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'capital');
    const row = await tx.capitalEvent.create({
      data: {
        ref,
        clientId: client.id,
        investmentName: b.investment,
        type: b.type,
        amount: new Prisma.Decimal(b.amount),
        currency: b.currency,
        dueDate: b.due,
        status: 'Draft',
        purpose: b.purpose ?? null,
        breakdown: b.breakdown,
        bankText: b.bank ?? null,
        makerId: req.user!.id,
      },
    });
    await writeAudit(tx, audit(req), { action: 'capital.created', objectType: 'capital_event', objectId: row.id, after: { ref, client: client.ref, ...b } });
    await enqueue(tx, 'notify.permission', { permission: 'cash.approve', type: 'capital.approval', title: `Approve ${b.type.toLowerCase()} · ${ref}`, body: `${client.name} · ${b.investment}` });
    return row.id;
  });
  res.status(201).json({ capital: staffCapitalView(await findCapital(id)) });
});

const allocateSchema = capitalSchema.omit({ clientId: true, breakdown: true });

/**
 * Fund-level event allocated to every client holding the vehicle in its latest
 * published snapshot: calls pro-rata to unfunded commitment, other events to commitment.
 * Creates one Draft notice per client for maker-checker approval.
 */
investorStaffRoutes.post('/capital-events/allocate', requireAnyPermission('clients.edit', 'cash.journal.create'), validateBody(allocateSchema), async (req, res) => {
  const b = req.body as z.infer<typeof allocateSchema>;
  const holdings = await prisma.snapshotInvestment.findMany({
    where: { name: { contains: b.investment }, snapshot: { status: 'Published' } },
    include: { snapshot: { select: { clientId: true } } },
  });
  const basis = holdings
    .map((h) => ({ clientId: h.snapshot.clientId, name: h.name, weight: Number((b.type === 'Capital call' ? h.unfunded : h.commitment) ?? 0) }))
    .filter((x) => x.weight > 0);
  const total = basis.reduce((s, x) => s + x.weight, 0);
  if (!total) throw HttpError.badRequest(`No investor holds an open commitment in ${b.investment}`);
  const refs = await prisma.$transaction(async (tx) => {
    const out: string[] = [];
    let allocated = 0;
    for (const [i, x] of basis.entries()) {
      const share = i === basis.length - 1 ? b.amount - allocated : Math.round((b.amount * x.weight) / total * 100) / 100;
      allocated += share;
      const ref = await nextRef(tx, 'capital');
      const row = await tx.capitalEvent.create({
        data: {
          ref,
          clientId: x.clientId,
          investmentName: x.name,
          type: b.type,
          amount: new Prisma.Decimal(share),
          currency: b.currency,
          dueDate: b.due,
          status: 'Draft',
          purpose: b.purpose ?? null,
          breakdown: [],
          bankText: b.bank ?? null,
          makerId: req.user!.id,
        },
      });
      await writeAudit(tx, audit(req), { action: 'capital.created', objectType: 'capital_event', objectId: row.id, after: { ref, allocatedFrom: b.investment, share, basis: x.weight / total } });
      out.push(ref);
    }
    await enqueue(tx, 'notify.permission', { permission: 'cash.approve', type: 'capital.approval', title: `Approve ${b.type.toLowerCase()} · ${b.investment}`, body: `${out.length} investor notices awaiting checker approval` });
    return out;
  });
  res.status(201).json({ refs, investors: refs.length });
});

investorStaffRoutes.post('/capital-events/:id/approve', requirePermission('cash.approve'), requireStepUp, async (req, res) => {
  const c = await findCapital(param(req, 'id'));
  expectVersion(req, c.version);
  if (c.status !== 'Draft') throw HttpError.conflict(`Only draft notices can be approved (currently ${c.status})`, 'invalid_state');
  if ((await policy('cash_approval')) && c.makerId === req.user!.id) {
    throw HttpError.forbidden('Maker-checker: a different person must approve this notice', 'sod_violation');
  }
  await prisma.$transaction(async (tx) => {
    await tx.capitalEvent.update({ where: { id: c.id }, data: { status: 'Approved', checkerId: req.user!.id, approvedAt: new Date(), version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'capital.approved', objectType: 'capital_event', objectId: c.id, before: { status: c.status }, after: { status: 'Approved' } });
  });
  res.json({ capital: staffCapitalView(await findCapital(c.id)) });
});

investorStaffRoutes.post('/capital-events/:id/publish', requireAnyPermission('clients.edit', 'cash.approve'), async (req, res) => {
  const c = await findCapital(param(req, 'id'));
  if (c.status !== 'Approved') throw HttpError.conflict('Only approved notices can be published', 'invalid_state');
  const status = c.type === 'Capital call' ? 'Due' : 'Expected';
  await prisma.$transaction(async (tx) => {
    await tx.capitalEvent.update({ where: { id: c.id }, data: { status, publishedAt: new Date(), version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'capital.published', objectType: 'capital_event', objectId: c.id, before: { status: c.status }, after: { status } });
    await notifyClient(tx, c.clientId, {
      type: 'capital.published',
      title: `${c.type} · ${c.ref}`,
      body: `${c.investmentName} · ${c.currency} ${Number(c.amount).toLocaleString('en-US')} · ${c.type === 'Capital call' ? 'due' : 'expected'} ${fmtDate(c.dueDate)}`,
      link: '/?page=capital',
      email: true,
    });
  });
  res.json({ capital: staffCapitalView(await findCapital(c.id)) });
});

/** Independent cash matching of investor funding evidence (or settlement of outgoing flows). */
investorStaffRoutes.post('/capital-events/:id/settle', requireAnyPermission('cash.approve', 'cash.journal.approve'), requireStepUp, async (req, res) => {
  const c = await findCapital(param(req, 'id'));
  const incoming = c.type === 'Capital call' || c.type === 'Contribution';
  const allowed = incoming ? ['Processing', 'Due', 'Expected'] : ['Expected', 'Due', 'Processing'];
  if (!allowed.includes(c.status)) throw HttpError.conflict(`Cannot settle a ${c.status} notice`, 'invalid_state');
  const evidence = c.evidence.find((e) => !e.matchedAt);
  if (incoming && evidence && evidence.confirmedById === req.user!.id) {
    throw HttpError.forbidden('The person matching cash cannot be the one who submitted the evidence', 'sod_violation');
  }
  const status = incoming ? 'Funded' : 'Paid';
  await prisma.$transaction(async (tx) => {
    if (evidence) await tx.fundingEvidence.update({ where: { id: evidence.id }, data: { matchedAt: new Date(), matchedById: req.user!.id } });
    await tx.capitalEvent.update({
      where: { id: c.id },
      data: { status, ...(incoming ? { evidenceName: c.evidenceName ? `${c.evidenceName} · matched` : 'Matched to cash ledger' } : { evidenceName: 'Settlement complete' }), version: { increment: 1 } },
    });
    await writeAudit(tx, audit(req), { action: incoming ? 'capital.matched' : 'capital.paid', objectType: 'capital_event', objectId: c.id, before: { status: c.status }, after: { status } });
    await notifyClient(tx, c.clientId, { type: 'capital.settled', title: `${c.ref} ${status.toLowerCase()}`, body: c.investmentName, link: '/?page=capital' });
  });
  res.json({ capital: staffCapitalView(await findCapital(c.id)) });
});

investorStaffRoutes.get('/capital-events/:id/evidence/:evidenceId/download-url', requireAnyPermission('cash.view', 'clients.view'), async (req, res) => {
  const c = await findCapital(param(req, 'id'));
  const e = await prisma.fundingEvidence.findFirst({ where: { id: param(req, 'evidenceId'), capitalEventId: c.id } });
  if (!e) throw HttpError.notFound('Evidence not found');
  res.json({ url: signedDownloadUrl(e.fileId), expiresIn: 300 });
});

// ---------------------------------------------------------------- snapshots

const pct = z.coerce.number().min(-1000).max(100000);
const snapshotSchema = z.object({
  clientId: z.string().min(1),
  valuationDate: z.coerce.date(),
  reportingCurrency: z.string().length(3).default('USD'),
  fx: z.record(z.string(), z.number().positive()).default({ USD: 1 }),
  metrics: z.record(z.string(), z.unknown()).default({}),
  activity: z.array(z.array(z.string())).optional(),
  investments: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        name: z.string().min(1).max(160),
        kind: z.string().min(1).max(64),
        value: z.coerce.number(),
        return: pct.nullable().optional(),
        benchmark: pct.nullable().optional(),
        ccy: z.string().length(3).default('USD'),
        status: z.string().max(64).default('Active'),
        commitment: z.coerce.number().nullable().optional(),
        called: z.coerce.number().nullable().optional(),
        unfunded: z.coerce.number().nullable().optional(),
        dist: z.coerce.number().nullable().optional(),
        irr: pct.nullable().optional(),
        tvpi: z.coerce.number().nullable().optional(),
        dpi: z.coerce.number().nullable().optional(),
      }),
    )
    .max(200)
    .default([]),
  holdings: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        security: z.string().min(1).max(160),
        account: z.string().min(1).max(120),
        asset: z.string().min(1).max(64),
        qty: z.string().max(40).default('—'),
        price: z.string().max(40).default('—'),
        value: z.coerce.number(),
        weight: pct,
        ytd: pct,
      }),
    )
    .max(2000)
    .default([]),
  transactions: z
    .array(
      z.object({
        id: z.string().min(1).max(24),
        date: z.coerce.date(),
        type: z.string().min(1).max(32),
        account: z.string().min(1).max(120),
        desc: z.string().min(1).max(255),
        qty: z.string().max(40).default('—'),
        amount: z.coerce.number(),
        status: z.string().max(32).default('Settled'),
      }),
    )
    .max(5000)
    .default([]),
  performance: z.record(z.string(), z.array(z.tuple([z.number().int(), z.number()]))).default({}),
  benchmark: z.record(z.string(), z.array(z.tuple([z.number().int(), z.number()]))).default({}),
  allocation: z.array(z.object({ label: z.string().min(1).max(80), pct })).max(50).default([]),
});

export type SnapshotInput = z.infer<typeof snapshotSchema>;

const dec = (v: number | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

/** Creates a Draft snapshot (used by the import endpoint and the demo seed). */
export async function createSnapshot(tx: Prisma.TransactionClient, clientId: string, b: SnapshotInput, makerId: string | null) {
  return tx.investorSnapshot.create({
    data: {
      clientId,
      valuationDate: b.valuationDate,
      reportingCurrency: b.reportingCurrency,
      fx: b.fx,
      metrics: b.metrics as Prisma.InputJsonValue,
      activity: b.activity ?? Prisma.JsonNull,
      makerId,
      investments: {
        create: b.investments.map((i, sort) => ({
          key: i.id,
          name: i.name,
          kind: i.kind,
          value: new Prisma.Decimal(i.value),
          returnPct: dec(i.return),
          benchmarkPct: dec(i.benchmark),
          currency: i.ccy,
          status: i.status,
          commitment: dec(i.commitment),
          called: dec(i.called),
          unfunded: dec(i.unfunded),
          distributions: dec(i.dist),
          irr: dec(i.irr),
          tvpi: dec(i.tvpi),
          dpi: dec(i.dpi),
          sort,
        })),
      },
      holdings: {
        create: b.holdings.map((h, sort) => ({
          key: h.id,
          security: h.security,
          account: h.account,
          asset: h.asset,
          quantity: h.qty,
          price: h.price,
          value: new Prisma.Decimal(h.value),
          weightPct: new Prisma.Decimal(h.weight),
          ytdPct: new Prisma.Decimal(h.ytd),
          sort,
        })),
      },
      transactions: {
        create: b.transactions.map((t, sort) => ({
          key: t.id,
          tradeDate: t.date,
          type: t.type,
          account: t.account,
          description: t.desc,
          quantity: t.qty,
          amount: new Prisma.Decimal(t.amount),
          status: t.status,
          sort,
        })),
      },
      performance: {
        create: Object.entries(b.performance).flatMap(([range, points]) =>
          points.map(([idx, v]) => {
            const bench = b.benchmark[range]?.find(([i]) => i === idx)?.[1];
            return { range, idx, portfolioPct: new Prisma.Decimal(v), benchmarkPct: dec(bench) };
          }),
        ),
      },
      allocation: { create: b.allocation.map((a, sort) => ({ label: a.label, pct: new Prisma.Decimal(a.pct), sort })) },
    },
  });
}

/** Publishes a snapshot and supersedes the client's previously published one. */
export async function publishSnapshot(tx: Prisma.TransactionClient, snapshotId: string, clientId: string, checkerId: string | null) {
  await tx.investorSnapshot.updateMany({ where: { clientId, status: 'Published' }, data: { status: 'Superseded' } });
  await tx.investorSnapshot.update({ where: { id: snapshotId }, data: { status: 'Published', checkerId, publishedAt: new Date(), version: { increment: 1 } } });
}

investorStaffRoutes.get('/snapshots', requirePermission('reports.view'), async (req, res) => {
  const client = typeof req.query.clientId === 'string' ? await clientByRef(req.query.clientId) : null;
  const rows = await prisma.investorSnapshot.findMany({
    where: client ? { clientId: client.id } : {},
    include: { client: { select: { ref: true, name: true } }, _count: { select: { investments: true, holdings: true, transactions: true } } },
    orderBy: [{ valuationDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  res.json({
    data: rows.map((s) => ({
      id: s.id,
      clientId: s.client.ref,
      client: s.client.name,
      valuationDate: fmtDate(s.valuationDate),
      status: s.status,
      counts: s._count,
      makerId: s.makerId,
      checkerId: s.checkerId,
      publishedAt: s.publishedAt,
      version: s.version,
    })),
  });
});

investorStaffRoutes.get('/snapshots/:id', requirePermission('reports.view'), async (req, res) => {
  const s = await prisma.investorSnapshot.findUnique({ where: { id: param(req, 'id') }, include: snapshotInclude });
  if (!s) throw HttpError.notFound('Snapshot not found');
  res.json({ snapshot: s });
});

investorStaffRoutes.post('/snapshots', requirePermission('reports.create'), validateBody(snapshotSchema), async (req, res) => {
  const b = req.body as SnapshotInput;
  const client = await clientByRef(b.clientId);
  const snap = await prisma.$transaction(async (tx) => {
    const s = await createSnapshot(tx, client.id, b, req.user!.id);
    await writeAudit(tx, audit(req), {
      action: 'snapshot.imported',
      objectType: 'investor_snapshot',
      objectId: s.id,
      after: { client: client.ref, valuationDate: b.valuationDate, investments: b.investments.length, holdings: b.holdings.length, transactions: b.transactions.length },
    });
    await enqueue(tx, 'notify.permission', { permission: 'reports.create', type: 'snapshot.review', title: `Snapshot ready for publication · ${client.name}`, body: `Valuation date ${fmtDate(b.valuationDate)}` });
    return s;
  });
  res.status(201).json({ snapshot: { id: snap.id, status: snap.status } });
});

investorStaffRoutes.post('/snapshots/:id/publish', requirePermission('reports.create'), requireStepUp, async (req, res) => {
  const s = await prisma.investorSnapshot.findUnique({ where: { id: param(req, 'id') }, include: { client: { select: { name: true } } } });
  if (!s) throw HttpError.notFound('Snapshot not found');
  expectVersion(req, s.version);
  if (s.status !== 'Draft') throw HttpError.conflict(`Only draft snapshots can be published (currently ${s.status})`, 'invalid_state');
  if ((await policy('client_publish_approval')) && s.makerId === req.user!.id) {
    throw HttpError.forbidden('Maker-checker: a different person must publish this snapshot', 'sod_violation');
  }
  await prisma.$transaction(async (tx) => {
    await publishSnapshot(tx, s.id, s.clientId, req.user!.id);
    await writeAudit(tx, audit(req), { action: 'snapshot.published', objectType: 'investor_snapshot', objectId: s.id, before: { status: s.status }, after: { status: 'Published' } });
    await notifyClient(tx, s.clientId, { type: 'snapshot.published', title: 'Portfolio valuation updated', body: `Published valuation as at ${fmtDate(s.valuationDate)}`, link: '/' });
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- service requests

investorStaffRoutes.get('/service-requests', requirePermission('clients.view'), async (req, res) => {
  const client = typeof req.query.clientId === 'string' ? await clientByRef(req.query.clientId) : null;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const where = { ...(client ? { clientId: client.id } : {}), ...(status ? { status } : {}) };
  const pg = sqlPage(req, 500);
  const [rows, total] = await Promise.all([
    prisma.serviceRequest.findMany({ where, include: { ...requestInclude, client: { select: { ref: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.serviceRequest.count({ where }),
  ]);
  res.json(
    pageEnvelope(
      pg,
      rows.map((r) => ({ ...requestView(r), uuid: r.id, clientId: r.client.ref, client: r.client.name, slaDueAt: r.slaDueAt, breached: !!r.slaDueAt && r.status !== 'Closed' && r.slaDueAt < new Date() })),
      total,
    ),
  );
});

const staffRequestSchema = z.object({
  clientId: z.string().min(1),
  type: z.string().trim().min(1).max(64),
  priority: z.string().trim().default('Normal').transform((p) => (p === 'Normal' ? 'Normal' : 'Time sensitive')),
  detail: z.string().trim().min(1).max(4000),
  due: z.coerce.date().optional(),
});

/** Request captured by staff on the client's behalf (phone, email, meeting). */
investorStaffRoutes.post('/service-requests', requirePermission('clients.edit'), validateBody(staffRequestSchema), async (req, res) => {
  const b = req.body as z.infer<typeof staffRequestSchema>;
  const client = await clientByRef(b.clientId);
  const row = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'request');
    const r = await tx.serviceRequest.create({
      data: {
        ref,
        clientId: client.id,
        type: b.type,
        priority: b.priority,
        title: b.type,
        detail: b.detail,
        status: 'Open',
        ownerName: actorName(req),
        ownerId: req.user!.id,
        slaDueAt: b.due ?? new Date(Date.now() + (b.priority === 'Normal' ? 48 : 8) * 3_600_000),
        openedById: req.user!.id,
        events: { create: { title: 'Submitted', detail: `Captured by ${actorName(req)} on behalf of the client`, actorId: req.user!.id } },
      },
      include: requestInclude,
    });
    await writeAudit(tx, audit(req), { action: 'service_request.created', objectType: 'service_request', objectId: r.id, after: { ref, client: client.ref, type: b.type } });
    return r;
  });
  res.status(201).json({ request: requestView(row) });
});

const requestUpdate = z.object({
  status: z.enum(['Open', 'In progress', 'Waiting on you', 'Closed']).optional(),
  owner: z.string().trim().max(120).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  note: z.string().trim().max(4000).optional(),
  version: z.number().int().optional(),
});

investorStaffRoutes.patch('/service-requests/:ref', requirePermission('clients.edit'), validateBody(requestUpdate), async (req, res) => {
  const r = await prisma.serviceRequest.findFirst({ where: { OR: [{ ref: param(req, 'ref') }, { id: param(req, 'ref') }] } });
  if (!r) throw HttpError.notFound('Request not found');
  expectVersion(req, r.version);
  const b = req.body as z.infer<typeof requestUpdate>;
  const status = b.status ?? r.status;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.serviceRequest.update({
      where: { id: r.id },
      data: {
        status,
        ...(b.owner !== undefined ? { ownerName: b.owner || 'Client Services', ownerId: req.user!.id } : {}),
        progress: status === 'Closed' ? 100 : (b.progress ?? r.progress),
        version: { increment: 1 },
        events: {
          create: {
            title: b.status && b.status !== r.status ? b.status : b.owner ? 'Assigned' : 'Update',
            detail: b.note || (b.owner ? `${b.owner} · Client Services` : null),
            actorId: req.user!.id,
          },
        },
      },
      include: requestInclude,
    });
    await writeAudit(tx, audit(req), {
      action: 'service_request.updated',
      objectType: 'service_request',
      objectId: r.id,
      before: { status: r.status, owner: r.ownerName, progress: r.progress },
      after: { status, owner: updated.ownerName, progress: updated.progress },
    });
    await notifyClient(tx, r.clientId, {
      type: 'service_request.updated',
      title: `Request ${r.ref} updated`,
      body: `${r.title} · ${status}${b.note ? ` — ${b.note.slice(0, 160)}` : ''}`,
      link: '/?page=requests',
      email: status === 'Waiting on you' || status === 'Closed',
    });
    return updated;
  });
  res.json({ request: requestView(row) });
});

// ---------------------------------------------------------------- secure messages

investorStaffRoutes.get('/message-threads', requirePermission('clients.view'), async (req, res) => {
  const client = typeof req.query.clientId === 'string' ? await clientByRef(req.query.clientId) : null;
  const rows = await prisma.messageThread.findMany({
    where: client ? { clientId: client.id } : {},
    include: { ...threadInclude(req.user!.id), client: { select: { ref: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  });
  res.json({ data: rows.map((t) => ({ ...threadView(t, 'staff'), clientId: t.client.ref, client: t.client.name })) });
});

investorStaffRoutes.post(
  '/message-threads',
  requirePermission('clients.edit'),
  validateBody(z.object({ clientId: z.string().min(1), title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(4000) })),
  async (req, res) => {
    const client = await clientByRef(req.body.clientId);
    const thread = await prisma.$transaction(async (tx) => {
      const t = await tx.messageThread.create({
        data: {
          clientId: client.id,
          title: req.body.title,
          ownerName: actorName(req),
          ownerRole: req.user!.roles.find((r) => r.portal === 'admin')?.label ?? 'Client Services',
          messages: { create: { authorId: req.user!.id, authorName: actorName(req), fromClient: false, body: req.body.text } },
        },
        include: threadInclude(req.user!.id),
      });
      await writeAudit(tx, audit(req), { action: 'message_thread.created', objectType: 'message_thread', objectId: t.id, after: { client: client.ref, title: req.body.title } });
      await notifyClient(tx, client.id, { type: 'message.received', title: `New secure message · ${req.body.title}`, link: '/?page=messages', email: true });
      return t;
    });
    res.status(201).json({ thread: threadView(thread, 'staff') });
  },
);

investorStaffRoutes.post('/message-threads/:id/read', requirePermission('clients.view'), async (req, res) => {
  const t = await prisma.messageThread.findUnique({ where: { id: param(req, 'id') }, select: { id: true } });
  if (!t) throw HttpError.notFound('Conversation not found');
  await prisma.messageRead.upsert({
    where: { threadId_userId: { threadId: t.id, userId: req.user!.id } },
    create: { threadId: t.id, userId: req.user!.id },
    update: { readAt: new Date() },
  });
  res.json({ ok: true });
});

investorStaffRoutes.post('/message-threads/:id/messages', requirePermission('clients.edit'), validateBody(z.object({ text: z.string().trim().min(1).max(4000) })), async (req, res) => {
  const t = await prisma.messageThread.findUnique({ where: { id: param(req, 'id') } });
  if (!t) throw HttpError.notFound('Conversation not found');
  const thread = await prisma.$transaction(async (tx) => {
    await tx.message.create({ data: { threadId: t.id, authorId: req.user!.id, authorName: actorName(req), fromClient: false, body: req.body.text } });
    await tx.messageRead.upsert({
      where: { threadId_userId: { threadId: t.id, userId: req.user!.id } },
      create: { threadId: t.id, userId: req.user!.id },
      update: { readAt: new Date() },
    });
    await tx.messageThread.update({ where: { id: t.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, audit(req), { action: 'message.sent', objectType: 'message_thread', objectId: t.id });
    await notifyClient(tx, t.clientId, { type: 'message.received', title: `Reply from ${actorName(req)}`, body: t.title, link: '/?page=messages', email: true });
    return tx.messageThread.findUniqueOrThrow({ where: { id: t.id }, include: threadInclude(req.user!.id) });
  });
  res.json({ thread: threadView(thread, 'staff') });
});
