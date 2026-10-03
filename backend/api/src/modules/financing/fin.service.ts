import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { latestPrices, resolveFxRate } from '../portfolio/portfolio.service';
import { D, f2, f4, iso, isoDay, names, securityMap, ZERO, type Dec } from '../rp-common';
import { margin, OPEN_CALL, valuePool, type Margin, type PoolValuation, type Rule } from './fin.engine';

type Db = Prisma.TransactionClient | typeof prisma;
export type FacilityRow = Prisma.FinFacilityGetPayload<object>;
export type CallRow = Prisma.FinMarginCallGetPayload<object>;
export type PoolRow = Prisma.FinPoolGetPayload<object>;

export async function loadRules(db: Db = prisma): Promise<Rule[]> {
  const rows = await db.finEligibilityRule.findMany();
  return rows.map((r) => ({ assetClass: r.assetClass, market: r.market, eligible: r.eligible, haircutPct: r.haircutPct, maxPoolPct: r.maxPoolPct }));
}

/** Values the POSTED items of a pool in `currency`, with haircuts, eligibility and caps applied. */
export async function valuePoolById(poolId: string, currency: string, db: Db = prisma, extra: { securityId: string; quantity: Dec }[] = []): Promise<PoolValuation> {
  const items = await db.finCollateralItem.findMany({ where: { poolId, status: 'POSTED' } });
  const all = [...items.map((i) => ({ itemId: i.id, securityId: i.securityId, quantity: i.quantity })), ...extra.map((e, n) => ({ itemId: `new-${n}`, ...e }))];
  const ids = [...new Set(all.map((i) => i.securityId))];
  const [sec, prices, rules] = await Promise.all([securityMap(ids), latestPrices(ids, new Date()), loadRules(db)]);
  const fx = new Map<string, Dec | null>();
  for (const s of sec.values()) if (!fx.has(s.currency)) fx.set(s.currency, await resolveFxRate(s.currency, currency, new Date()));
  return valuePool(
    all.map((i) => {
      const s = sec.get(i.securityId);
      const px = prices.get(i.securityId)?.latestDec ?? null;
      const rate = s ? (fx.get(s.currency) ?? null) : null;
      return { itemId: i.itemId, securityId: i.securityId, ticker: s?.ticker ?? i.securityId, assetClass: s?.assetClass ?? 'Unknown', market: s?.market ?? '', quantity: i.quantity, marketValue: px && rate ? i.quantity.mul(px).mul(rate) : null };
    }),
    rules,
  );
}

export async function drawnOf(facilityId: string, db: Db = prisma): Promise<Dec> {
  const g = await db.finMovement.groupBy({ by: ['kind'], where: { facilityId }, _sum: { amount: true } });
  const sum = (k: string) => g.find((x) => x.kind === k)?._sum.amount ?? ZERO;
  return sum('DRAW').sub(sum('REPAY'));
}

export async function facilityMargin(f: FacilityRow, db: Db = prisma): Promise<{ margin: Margin; valuation: PoolValuation | null; drawn: Dec }> {
  const drawn = await drawnOf(f.id, db);
  const valuation = f.poolId ? await valuePoolById(f.poolId, f.currency, db) : null;
  return { margin: margin({ limitAmount: f.limitAmount, initialRatio: f.initialRatio, maintenanceRatio: f.maintenanceRatio }, drawn, valuation?.counted ?? ZERO), valuation, drawn };
}

export const marginView = (m: Margin) => ({ drawn: f2(m.drawn), counted: f2(m.counted), coverage: f4(m.coverage), state: m.state, excess: f2(m.excess), callAmount: f2(m.callAmount), availableToDraw: f2(m.availableToDraw) });

export const valuationView = (v: PoolValuation | null) =>
  v && {
    marketValue: f2(v.marketValue),
    afterHaircut: f2(v.afterHaircut),
    counted: f2(v.counted),
    ineligible: f2(v.ineligible),
    warnings: v.warnings,
    lines: v.lines.map((l) => ({ itemId: l.itemId, securityId: l.securityId, ticker: l.ticker, assetClass: l.assetClass, market: l.market, quantity: l.quantity.toString(), marketValue: f2(l.marketValue), eligible: l.eligible, haircutPct: f2(l.haircutPct), afterHaircut: f2(l.afterHaircut), counted: f2(l.counted), capped: l.capped, reason: l.reason })),
  };

export async function callViews(rows: CallRow[]) {
  const usr = await names(rows.flatMap((c) => [c.issuedBy, c.acknowledgedBy, c.resolvedBy]));
  const fac = rows.length ? await prisma.finFacility.findMany({ where: { id: { in: [...new Set(rows.map((c) => c.facilityId))] } } }) : [];
  const fm = new Map(fac.map((f) => [f.id, f]));
  const now = Date.now();
  return rows.map((c) => ({
    id: c.id,
    ref: c.ref,
    facilityId: c.facilityId,
    facilityRef: fm.get(c.facilityId)?.ref ?? null,
    facilityName: fm.get(c.facilityId)?.name ?? null,
    lender: fm.get(c.facilityId)?.lender ?? null,
    currency: fm.get(c.facilityId)?.currency ?? null,
    status: c.status,
    calledAmount: f2(c.calledAmount),
    drawn: f2(c.drawn),
    eligibleValue: f2(c.eligibleValue),
    coverageRatio: f4(c.coverageRatio),
    coverageAfter: f4(c.coverageAfter),
    dueAt: c.dueAt.toISOString(),
    overdue: OPEN_CALL.includes(c.status) && c.dueAt.getTime() < now,
    issuedByName: usr.get(c.issuedBy) ?? null,
    issuedBy: c.issuedBy,
    acknowledgedByName: c.acknowledgedBy ? (usr.get(c.acknowledgedBy) ?? null) : null,
    acknowledgedAt: iso(c.acknowledgedAt),
    resolvedByName: c.resolvedBy ? (usr.get(c.resolvedBy) ?? null) : null,
    resolvedAt: iso(c.resolvedAt),
    resolution: c.resolution,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function facilityViews(rows: FacilityRow[]) {
  const usr = await names(rows.flatMap((f) => [f.makerId, f.approverId]));
  const pf = rows.length ? await prisma.portfolio.findMany({ where: { id: { in: [...new Set(rows.map((f) => f.portfolioId))] } }, select: { id: true, ref: true, name: true } }) : [];
  const pools = rows.length ? await prisma.finPool.findMany({ where: { id: { in: rows.map((f) => f.poolId).filter((x): x is string => !!x) } } }) : [];
  const openCalls = rows.length ? await prisma.finMarginCall.findMany({ where: { facilityId: { in: rows.map((f) => f.id) }, status: { in: OPEN_CALL } } }) : [];
  const out = [];
  for (const f of rows) {
    const m = await facilityMargin(f);
    const calls = openCalls.filter((c) => c.facilityId === f.id);
    out.push({
      id: f.id,
      ref: f.ref,
      name: f.name,
      type: f.type,
      lender: f.lender,
      portfolioId: f.portfolioId,
      portfolioRef: pf.find((p) => p.id === f.portfolioId)?.ref ?? null,
      portfolioName: pf.find((p) => p.id === f.portfolioId)?.name ?? null,
      poolId: f.poolId,
      poolRef: pools.find((p) => p.id === f.poolId)?.ref ?? null,
      poolName: pools.find((p) => p.id === f.poolId)?.name ?? null,
      currency: f.currency,
      limitAmount: f2(f.limitAmount),
      ratePct: f4(f.ratePct),
      initialRatio: f4(f.initialRatio),
      maintenanceRatio: f4(f.maintenanceRatio),
      callDueDays: f.callDueDays,
      status: f.status,
      makerId: f.makerId,
      makerName: usr.get(f.makerId) ?? null,
      approverName: f.approverId ? (usr.get(f.approverId) ?? null) : null,
      approvedAt: iso(f.approvedAt),
      margin: marginView(m.margin),
      openCalls: calls.length,
      overdueCalls: calls.filter((c) => c.dueAt.getTime() < Date.now()).length,
      version: f.version,
      createdAt: f.createdAt.toISOString(),
    });
  }
  return out;
}

void D;
void isoDay;
