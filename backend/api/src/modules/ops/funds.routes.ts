import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { expectVersion, param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requirePermission } from '../../middleware/requireAuth';
import { D, ZERO, assertUpdated, audit, dateInput, isoDay, money, moneyInput, optionalMoneyInput, seqRef, storeWire, wireInput, wireView } from './ops.common';
import { idempotent } from '../../lib/idempotency';

/** `/ops/funds`, `/ops/commitments`: fund master data, commitments and open-ended holdings. */
export const opsFundsRoutes = Router();

const fundInclude = {
  commitments: { include: { client: { select: { id: true, ref: true, name: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.FundInclude;
type FundRow = Prisma.FundGetPayload<{ include: typeof fundInclude }>;
type FundBase = Prisma.FundGetPayload<object>;

const commitmentView = (c: FundRow['commitments'][number]) => ({
  id: c.id,
  fundId: c.fundId,
  clientId: c.clientId,
  clientRef: c.client.ref,
  clientName: c.client.name,
  commitmentAmount: money(c.commitmentAmount),
  currency: c.currency,
  status: c.status,
  effectiveDate: isoDay(c.effectiveDate),
  investorAccountRef: c.investorAccountRef,
  metrics: c.metricsJson ?? null,
  notes: c.notes,
  version: c.version,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

function fundView(f: FundBase, extra: { commitmentCount?: number; totalCommitment?: string } = {}) {
  return {
    id: f.id,
    ref: f.ref,
    name: f.name,
    shortName: f.shortName,
    publicReference: f.publicReference,
    operatingModel: f.operatingModel,
    currency: f.currency,
    vintage: f.vintage,
    status: f.status,
    portalVisible: f.portalVisible,
    defaultShareClass: f.defaultShareClass,
    valuationStatus: f.valuationStatus,
    asOfDate: isoDay(f.asOfDate),
    navPerUnit: f.navPerUnit?.toString() ?? null,
    totalNav: f.totalNav ? money(f.totalNav) : null,
    dealingRules: f.dealingRulesJson ?? null,
    wiring: wireView(f.wiringJson),
    makerId: f.makerId,
    version: f.version,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    ...extra,
    // The console reads `totalCommitted`; `totalCommitment` is kept for existing API consumers.
    totalCommitted: extra.totalCommitment ?? null,
  };
}

async function loadFund(id: string) {
  const f = await prisma.fund.findFirst({ where: { OR: [{ id }, { ref: id }] }, include: fundInclude });
  if (!f) throw HttpError.notFound('Fund not found');
  return f;
}

const detail = (f: FundRow) => ({
  ...fundView(f, {
    commitmentCount: f.commitments.length,
    totalCommitment: money(f.commitments.reduce((s, c) => s.add(c.commitmentAmount), ZERO)),
  }),
  commitments: f.commitments.map(commitmentView),
});

opsFundsRoutes.get('/funds', requirePermission('funds.view'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await prisma.fund.findMany({ where: status ? { status } : {}, include: fundInclude, orderBy: { name: 'asc' } });
  res.json({
    data: rows.map((f) =>
      fundView(f, {
        commitmentCount: f.commitments.length,
        totalCommitment: money(f.commitments.reduce((s, c) => s.add(c.commitmentAmount), ZERO)),
      }),
    ),
    total: rows.length,
  });
});

const rulesSchema = z
  .object({
    minBalanceAmount: optionalMoneyInput,
    minBalanceUnits: optionalMoneyInput,
    noticeDays: z.number().int().min(0).max(365),
    dealingFrequency: z.string().trim().max(40),
    nextEligibleDealingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    settlementLagDays: z.number().int().min(0).max(30),
    subscription: z.object({ mgmtFeeRate: z.string().regex(/^0(\.\d+)?$/), otherFeeFlat: optionalMoneyInput, maxFileMb: z.number().int().min(1).max(25) }).partial(),
    redemption: z.object({ feeRate: z.string().regex(/^0(\.\d+)?$/), modes: z.array(z.enum(['AMOUNT', 'UNITS', 'FULL'])).min(1) }).partial(),
    suspended: z.boolean(),
    termsUrl: z.string().max(255).nullable(),
  })
  .partial();

const fundSchema = z.object({
  name: z.string().trim().min(1).max(200),
  shortName: z.string().trim().min(1).max(80),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  operatingModel: z.enum(['PRIVATE_CAPITAL', 'OPEN_ENDED']).default('PRIVATE_CAPITAL'),
  vintage: z.number().int().min(1950).max(2100).optional(),
  publicReference: z.string().trim().max(40).optional(),
  defaultShareClass: z.string().trim().max(32).optional(),
  portalVisible: z.boolean().default(true),
  status: z.enum(['Draft', 'Active', 'Closed']).default('Active'),
  navPerUnit: optionalMoneyInput.optional(),
  asOfDate: dateInput.optional(),
  valuationStatus: z.enum(['ESTIMATED', 'PROVISIONAL', 'FINAL', 'RESTATED']).optional(),
  dealingRules: rulesSchema.optional(),
  wiring: wireInput.optional(),
});

opsFundsRoutes.post('/funds', requirePermission('funds.manage'), validateBody(fundSchema), idempotent('ops.post.funds', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof fundSchema>;
  const id = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'fund', 'FND-', 4);
    const f = await tx.fund.create({
      data: {
        ref,
        name: b.name,
        shortName: b.shortName,
        currency: b.currency,
        operatingModel: b.operatingModel,
        vintage: b.vintage ?? null,
        publicReference: b.publicReference ?? null,
        defaultShareClass: b.defaultShareClass ?? null,
        portalVisible: b.portalVisible,
        status: b.status,
        navPerUnit: b.navPerUnit ? new D(b.navPerUnit) : null,
        asOfDate: b.asOfDate ?? null,
        valuationStatus: b.valuationStatus ?? 'FINAL',
        dealingRulesJson: (b.dealingRules ?? undefined) as Prisma.InputJsonValue | undefined,
        wiringJson: b.wiring ? (storeWire(b.wiring) as unknown as Prisma.InputJsonValue) : undefined,
        makerId: req.user!.id,
      },
    });
    const { wiring: _w, ...logged } = b;
    await writeAudit(tx, audit(req), { action: 'fund.created', objectType: 'fund', objectId: f.id, after: { ref, ...logged, wiring: b.wiring ? 'set' : null } });
    return f.id;
  });
  res.status(201).json({ data: detail(await loadFund(id)) });
});

opsFundsRoutes.get('/funds/:id', requirePermission('funds.view'), async (req, res) => {
  res.json({ data: detail(await loadFund(param(req, 'id'))) });
});

const fundPatchSchema = fundSchema
  .partial()
  .extend({ totalNav: optionalMoneyInput.nullable().optional(), navPerUnit: optionalMoneyInput.nullable().optional(), version: z.number().int().optional() });

opsFundsRoutes.patch('/funds/:id', requirePermission('funds.manage'), validateBody(fundPatchSchema), idempotent('ops.patch.funds_id', { required: false }), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  expectVersion(req, f.version);
  const b = req.body as z.infer<typeof fundPatchSchema>;
  const data: Prisma.FundUpdateManyMutationInput = { version: { increment: 1 } };
  if (b.name !== undefined) data.name = b.name;
  if (b.shortName !== undefined) data.shortName = b.shortName;
  if (b.currency !== undefined) data.currency = b.currency;
  if (b.operatingModel !== undefined) data.operatingModel = b.operatingModel;
  if (b.vintage !== undefined) data.vintage = b.vintage;
  if (b.publicReference !== undefined) data.publicReference = b.publicReference;
  if (b.defaultShareClass !== undefined) data.defaultShareClass = b.defaultShareClass;
  if (b.portalVisible !== undefined) data.portalVisible = b.portalVisible;
  if (b.status !== undefined) data.status = b.status;
  if (b.navPerUnit !== undefined) data.navPerUnit = b.navPerUnit === null ? null : new D(b.navPerUnit);
  if (b.totalNav !== undefined) data.totalNav = b.totalNav === null ? null : new D(b.totalNav);
  if (b.asOfDate !== undefined) data.asOfDate = b.asOfDate;
  if (b.valuationStatus !== undefined) data.valuationStatus = b.valuationStatus;
  if (b.dealingRules !== undefined) {
    const current = (f.dealingRulesJson && typeof f.dealingRulesJson === 'object' ? f.dealingRulesJson : {}) as Record<string, unknown>;
    data.dealingRulesJson = { ...current, ...b.dealingRules } as Prisma.InputJsonValue;
  }
  if (b.wiring !== undefined) data.wiringJson = storeWire(b.wiring) as unknown as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.fund.updateMany({ where: { id: f.id, version: f.version }, data })).count);
    const { wiring: _w, version: _v, ...logged } = b;
    await writeAudit(tx, audit(req), {
      action: 'fund.updated',
      objectType: 'fund',
      objectId: f.id,
      before: { status: f.status, navPerUnit: f.navPerUnit?.toString() ?? null, version: f.version },
      after: { ...logged, wiring: b.wiring ? 'changed' : undefined },
    });
  });
  res.json({ data: detail(await loadFund(f.id)) });
});

// ---------------------------------------------------------------- commitments

opsFundsRoutes.get('/funds/:id/commitments', requirePermission('funds.view'), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  res.json({ data: f.commitments.map(commitmentView), total: f.commitments.length });
});

async function clientByIdOrRef(idOrRef: string) {
  const c = await prisma.client.findFirst({ where: { OR: [{ id: idOrRef }, { ref: idOrRef }], archivedAt: null }, select: { id: true, ref: true, name: true } });
  if (!c) throw HttpError.badRequest(`Unknown client ${idOrRef}`);
  return c;
}

const commitmentSchema = z.object({
  clientId: z.string().trim().min(1).max(36),
  commitmentAmount: moneyInput,
  currency: z.string().trim().length(3).toUpperCase().optional(),
  effectiveDate: dateInput.optional(),
  investorAccountRef: z.string().trim().max(64).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'CLOSED']).default('ACTIVE'),
  notes: z.string().max(2000).optional(),
});

opsFundsRoutes.post('/funds/:id/commitments', requirePermission('funds.manage'), validateBody(commitmentSchema), idempotent('ops.post.funds_id_commitments', { required: false }), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  const b = req.body as z.infer<typeof commitmentSchema>;
  const client = await clientByIdOrRef(b.clientId);
  if (f.commitments.some((c) => c.clientId === client.id)) throw HttpError.conflict(`${client.name} already has a commitment to ${f.name}`, 'duplicate');
  const id = await prisma.$transaction(async (tx) => {
    const c = await tx.fundCommitment.create({
      data: {
        clientId: client.id,
        fundId: f.id,
        commitmentAmount: new D(b.commitmentAmount),
        currency: b.currency ?? f.currency,
        status: b.status,
        effectiveDate: b.effectiveDate ?? null,
        investorAccountRef: b.investorAccountRef ?? null,
        notes: b.notes ?? null,
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'fund.commitment.created',
      objectType: 'fund_commitment',
      objectId: c.id,
      after: { fund: f.ref, client: client.ref, commitmentAmount: b.commitmentAmount, status: b.status },
    });
    return c.id;
  });
  const row = await prisma.fundCommitment.findUniqueOrThrow({ where: { id }, include: { client: { select: { id: true, ref: true, name: true } } } });
  res.status(201).json({ data: commitmentView(row) });
});

const commitmentPatchSchema = z.object({
  commitmentAmount: moneyInput.optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'CLOSED']).optional(),
  effectiveDate: dateInput.nullable().optional(),
  investorAccountRef: z.string().trim().max(64).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  metrics: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
  version: z.number().int().optional(),
});

opsFundsRoutes.patch('/commitments/:id', requirePermission('funds.manage'), validateBody(commitmentPatchSchema), idempotent('ops.patch.commitments_id', { required: false }), async (req, res) => {
  const c = await prisma.fundCommitment.findUnique({ where: { id: param(req, 'id') } });
  if (!c) throw HttpError.notFound('Commitment not found');
  expectVersion(req, c.version);
  const b = req.body as z.infer<typeof commitmentPatchSchema>;
  if (b.commitmentAmount !== undefined) {
    const called = await prisma.capitalCallAllocation.aggregate({
      where: { commitmentId: c.id, status: { not: 'CANCELLED' }, call: { status: { not: 'CANCELLED' } } },
      _sum: { callAmount: true },
    });
    if (new D(b.commitmentAmount).lt(called._sum.callAmount ?? ZERO)) {
      throw HttpError.badRequest(`Commitment cannot be below the capital already called (${money(called._sum.callAmount)})`);
    }
  }
  const data: Prisma.FundCommitmentUpdateManyMutationInput = { version: { increment: 1 } };
  if (b.commitmentAmount !== undefined) data.commitmentAmount = new D(b.commitmentAmount);
  if (b.status !== undefined) data.status = b.status;
  if (b.effectiveDate !== undefined) data.effectiveDate = b.effectiveDate;
  if (b.investorAccountRef !== undefined) data.investorAccountRef = b.investorAccountRef;
  if (b.notes !== undefined) data.notes = b.notes;
  if (b.metrics !== undefined) data.metricsJson = b.metrics as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.fundCommitment.updateMany({ where: { id: c.id, version: c.version }, data })).count);
    const { version: _v, ...logged } = b;
    await writeAudit(tx, audit(req), {
      action: 'fund.commitment.updated',
      objectType: 'fund_commitment',
      objectId: c.id,
      before: { commitmentAmount: money(c.commitmentAmount), status: c.status, version: c.version },
      after: logged,
    });
  });
  const row = await prisma.fundCommitment.findUniqueOrThrow({ where: { id: c.id }, include: { client: { select: { id: true, ref: true, name: true } } } });
  res.json({ data: commitmentView(row) });
});

// ---------------------------------------------------------------- holdings (open-ended)

opsFundsRoutes.get('/funds/:id/holdings', requirePermission('funds.view'), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  const rows = await prisma.lpHolding.findMany({ where: { fundId: f.id }, include: { client: { select: { ref: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  res.json({
    data: rows.map((h) => ({
      id: h.id,
      clientId: h.clientId,
      clientRef: h.client.ref,
      clientName: h.client.name,
      shareClassCode: h.shareClassCode,
      units: h.units.toString(),
      navPerUnit: h.navPerUnit.toString(),
      accountValue: money(h.accountValue),
      currency: h.currency,
      asOfDate: isoDay(h.asOfDate),
      valuationStatus: h.valuationStatus,
      isActive: h.isActive,
    })),
  });
});

const holdingSchema = z.object({
  clientId: z.string().trim().min(1).max(36),
  shareClassCode: z.string().trim().min(1).max(32).optional(),
  units: optionalMoneyInput.refine((v) => /^\d+(\.\d{1,8})?$/.test(v)),
  navPerUnit: optionalMoneyInput.optional(),
  asOfDate: dateInput.optional(),
  accountRef: z.string().trim().max(64).optional(),
});

/** Sets an LP's open-ended position (units at the fund NAV unless one is given). */
opsFundsRoutes.put('/funds/:id/holdings', requirePermission('funds.manage'), validateBody(holdingSchema), idempotent('ops.put.funds_id_holdings', { required: false }), async (req, res) => {
  const f = await loadFund(param(req, 'id'));
  const b = req.body as z.infer<typeof holdingSchema>;
  const client = await clientByIdOrRef(b.clientId);
  if (!f.commitments.some((c) => c.clientId === client.id)) throw HttpError.badRequest(`${client.name} has no commitment to ${f.name}`);
  const nav = b.navPerUnit ? new D(b.navPerUnit) : f.navPerUnit;
  if (!nav || nav.lte(0)) throw HttpError.badRequest('Set a NAV per unit on the fund (or in the request) first');
  const shareClassCode = b.shareClassCode ?? f.defaultShareClass ?? 'DEFAULT';
  const units = new D(b.units);
  const asOfDate = b.asOfDate ?? f.asOfDate ?? new Date(new Date().toISOString().slice(0, 10));
  const data = {
    units,
    navPerUnit: nav,
    accountValue: units.mul(nav).toDecimalPlaces(4, D.ROUND_HALF_UP),
    currency: f.currency,
    asOfDate,
    accountRef: b.accountRef ?? null,
    valuationStatus: f.valuationStatus,
    isActive: true,
  };
  const h = await prisma.$transaction(async (tx) => {
    const row = await tx.lpHolding.upsert({
      where: { clientId_fundId_shareClassCode: { clientId: client.id, fundId: f.id, shareClassCode } },
      create: { clientId: client.id, fundId: f.id, shareClassCode, ...data },
      update: data,
    });
    await writeAudit(tx, audit(req), {
      action: 'fund.holding.set',
      objectType: 'lp_holding',
      objectId: row.id,
      after: { fund: f.ref, client: client.ref, shareClassCode, units: units.toString(), navPerUnit: nav.toString() },
    });
    return row;
  });
  res.json({ data: { id: h.id, shareClassCode, units: h.units.toString(), navPerUnit: h.navPerUnit.toString(), accountValue: money(h.accountValue) } });
});
