import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { audit } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { METRIC_LABEL, RISK_METRICS } from '../risk/risk.engine';
import { D, RowCheck, parseDay, parseDecimal, toDay, type ImportKind, type MappedRow, type Validation } from './imports.core';

/**
 * Risk imports (FR-RSK-012): positions and limits files.
 *
 * Positions: one row per portfolio, security and as-of date. Columns are validated, invalid rows are rejected with their
 * line, and a committed file changes the position rows the risk numbers are measured from (a quantity of 0 closes the
 * holding). Commit needs a step-up because it overwrites holdings. History is append-by-date: the file writes the
 * as-of day's row and never edits an earlier day.
 *
 * Limits: each row becomes a DRAFT limit (it still goes through submit and a different approver before it is ACTIVE).
 * A duplicate (same metric and scope twice in the file, or the same as a live limit) is rejected.
 */
const todayIso = () => new Date().toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- positions

interface PosRow { portfolioId: string; portfolioRef: string; securityId: string; ticker: string; quantity: string; avgCost: string; asOf: string }

async function validatePositions(rows: MappedRow[], fields: Record<string, string>): Promise<Validation<PosRow>> {
  const out: Validation<PosRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const defaultAsOf = fields.asOf ? parseDay(fields.asOf) : null;
  if (fields.asOf && defaultAsOf && !defaultAsOf.ok) out.fileErrors.push(`As-of date ${defaultAsOf.message}`);
  const portfolios = new Map<string, Awaited<ReturnType<typeof loadPortfolio>> | null>();
  const securities = new Map<string, Awaited<ReturnType<typeof prisma.security.findFirst>>>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const pk = x.portfolio ?? '';
    if (!pk) c.fail('portfolio', 'is required');
    let portfolio: Awaited<ReturnType<typeof loadPortfolio>> | null = null;
    if (pk) {
      if (!portfolios.has(pk)) portfolios.set(pk, await loadPortfolio(pk).catch(() => null));
      portfolio = portfolios.get(pk) ?? null;
      if (!portfolio) c.fail('portfolio', `unknown portfolio "${pk}"`);
    }
    const tk = x.security ?? '';
    if (!tk) c.fail('security', 'is required');
    let security: Awaited<ReturnType<typeof prisma.security.findFirst>> = null;
    if (tk) {
      if (!securities.has(tk)) securities.set(tk, await prisma.security.findFirst({ where: UUID.test(tk) ? { id: tk } : { ticker: tk.toUpperCase() } }));
      security = securities.get(tk) ?? null;
      if (!security) c.fail('security', `unknown security "${tk}"`);
    }
    const qty = parseDecimal(x.quantity, { nonNegative: true, scale: 6, max: '999999999999999999' });
    if (!qty.ok) c.fail('quantity', qty.message);
    const cost = parseDecimal(x.avgCost, { nonNegative: true, scale: 6, max: '99999999999999' });
    if (!cost.ok) c.fail('avgCost', cost.message);
    const day = x.asOf ? parseDay(x.asOf) : defaultAsOf && defaultAsOf.ok ? defaultAsOf : ({ ok: true, value: todayIso() } as const);
    if (!day.ok) c.fail('asOf', day.message);
    else if (day.value > todayIso()) c.fail('asOf', 'cannot be in the future');
    if (c.ok && portfolio && security && day.ok) {
      const key = `${portfolio.id}|${security.id}|${day.value}`;
      if (seen.has(key)) c.fail('security', `duplicate of line ${seen.get(key)} (same portfolio, security and date)`);
      else seen.set(key, r.line);
    }
    if (!c.ok || !portfolio || !security || !qty.ok || !cost.ok || !day.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    const current = await prisma.portfolioPosition.findFirst({ where: { portfolioId: portfolio.id, securityId: security.id, asOf: { lte: toDay(day.value) } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
    out.valid.push({
      line: r.line,
      value: { portfolioId: portfolio.id, portfolioRef: portfolio.ref, securityId: security.id, ticker: security.ticker, quantity: qty.value.toString(), avgCost: cost.value.toString(), asOf: day.value },
      display: { portfolio: portfolio.ref, security: security.ticker, quantity: qty.value.toString(), avgCost: cost.value.toString(), asOf: day.value, currentQuantity: current ? current.quantity.toString() : '0' },
      warnings: qty.value.isZero() ? ['Quantity 0 closes this holding'] : [],
    });
  }
  return out;
}

export const riskPositionsImport: ImportKind<PosRow> = {
  kind: 'risk-positions',
  title: 'Positions',
  permissions: ['risk.view', 'risk.manage'],
  stepUp: true,
  fields: [{ key: 'asOf', label: 'As of (default for rows without one)', hint: 'YYYY-MM-DD; today when blank' }],
  columns: [
    { key: 'portfolio', label: 'Portfolio', required: true, aliases: ['portfolio ref', 'portfolio id'], example: 'PF-1001' },
    { key: 'security', label: 'Ticker', required: true, aliases: ['security', 'symbol', 'securityId'], example: 'DLTA.ZW' },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['qty', 'units', 'shares'], example: '25000' },
    { key: 'avgCost', label: 'Average cost', required: true, aliases: ['avg cost', 'cost', 'cost price'], example: '1.2' },
    { key: 'asOf', label: 'As of', aliases: ['date', 'as of date'], example: '2026-10-01' },
  ],
  validate: (rows, ctx) => validatePositions(rows, ctx.fields),
  async apply(tx, rows, ctx, batch) {
    const touched = new Map<string, { ref: string; before: number; after: number }>();
    const heldCount = async (portfolioId: string) => {
      const all = await tx.portfolioPosition.findMany({ where: { portfolioId }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
      const latest = new Map<string, boolean>();
      for (const p of all) if (!latest.has(p.securityId)) latest.set(p.securityId, p.quantity.gt(0));
      return [...latest.values()].filter(Boolean).length;
    };
    for (const r of rows) {
      const v = r.value;
      if (!touched.has(v.portfolioId)) touched.set(v.portfolioId, { ref: v.portfolioRef, before: await heldCount(v.portfolioId), after: 0 });
      const prev = await tx.portfolioPosition.findFirst({ where: { portfolioId: v.portfolioId, securityId: v.securityId, asOf: { lte: toDay(v.asOf) } }, orderBy: [{ asOf: 'desc' }, { createdAt: 'desc' }] });
      const saved = await tx.portfolioPosition.upsert({
        where: { portfolioId_securityId_asOf: { portfolioId: v.portfolioId, securityId: v.securityId, asOf: toDay(v.asOf) } },
        create: { portfolioId: v.portfolioId, securityId: v.securityId, quantity: new D(v.quantity), avgCost: new D(v.avgCost), asOf: toDay(v.asOf) },
        update: { quantity: new D(v.quantity), avgCost: new D(v.avgCost) },
      });
      await writeAudit(tx, audit(ctx.req), {
        action: 'risk.position_imported',
        objectType: 'portfolio_position',
        objectId: saved.id, // audit_events.object_id is VARCHAR(64): the row id, not a composite key
        before: prev ? { quantity: prev.quantity.toString(), avgCost: prev.avgCost.toString(), asOf: prev.asOf.toISOString().slice(0, 10) } : null,
        after: { portfolioId: v.portfolioId, portfolio: v.portfolioRef, ticker: v.ticker, quantity: v.quantity, avgCost: v.avgCost, asOf: v.asOf, importBatch: batch.ref, importLine: r.line },
      });
    }
    for (const [id, t] of touched) t.after = await heldCount(id);
    const portfolios = [...touched.values()].map((t) => ({ portfolio: t.ref, positionsBefore: t.before, positionsAfter: t.after }));
    return { upserted: rows.length, portfolios };
  },
};

// ---------------------------------------------------------------- limits

interface LimitRow { metric: string; scopeType: 'PORTFOLIO' | 'FIRM'; scopeId: string | null; scopeRef: string; threshold: string; breachAction: string; description: string | null; ownerUserId: string }

async function validateLimits(rows: MappedRow[], userId: string): Promise<Validation<LimitRow>> {
  const out: Validation<LimitRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const portfolios = new Map<string, Awaited<ReturnType<typeof loadPortfolio>> | null>();
  const owners = new Map<string, string | null>();
  const live = await prisma.riskLimit.findMany({ where: { status: { not: 'RETIRED' } }, select: { metric: true, scopeType: true, scopeId: true, ref: true } });
  const liveKeys = new Map(live.map((l) => [`${l.metric}|${l.scopeType}|${l.scopeId ?? ''}`, l.ref]));
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const metric = (x.metric ?? '').toUpperCase().replace(/[ -]/g, '_');
    if (!(RISK_METRICS as readonly string[]).includes(metric)) c.fail('metric', `must be one of ${RISK_METRICS.join(', ')}`);
    const scopeType = ((x.scope ?? '').toUpperCase() || (x.portfolio ? 'PORTFOLIO' : 'FIRM')) as 'PORTFOLIO' | 'FIRM';
    if (scopeType !== 'PORTFOLIO' && scopeType !== 'FIRM') c.fail('scope', 'must be PORTFOLIO or FIRM');
    let scopeId: string | null = null;
    let scopeRef = 'FIRM';
    if (scopeType === 'PORTFOLIO') {
      if (!x.portfolio) c.fail('portfolio', 'is required for a PORTFOLIO limit');
      else {
        if (!portfolios.has(x.portfolio)) portfolios.set(x.portfolio, await loadPortfolio(x.portfolio).catch(() => null));
        const p = portfolios.get(x.portfolio);
        if (!p) c.fail('portfolio', `unknown portfolio "${x.portfolio}"`);
        else {
          scopeId = p.id;
          scopeRef = p.ref;
        }
      }
    } else if (x.portfolio) c.fail('portfolio', 'a FIRM limit has no portfolio');
    const th = parseDecimal(x.threshold, { positive: true, scale: 4, max: '100' });
    if (!th.ok) c.fail('threshold', th.message === 'is too large' ? 'must be at most 100 (a percentage)' : th.message);
    const action = (x.breachAction ?? '').toUpperCase() || 'ALERT';
    if (!['ALERT', 'ESCALATE', 'BLOCK'].includes(action)) c.fail('breachAction', 'must be ALERT, ESCALATE or BLOCK');
    if ((x.description ?? '').length > 500) c.fail('description', 'is longer than 500 characters');
    let ownerUserId = userId;
    if (x.owner) {
      if (!owners.has(x.owner)) owners.set(x.owner, (await prisma.user.findFirst({ where: { email: x.owner.toLowerCase(), isActive: true }, select: { id: true } }))?.id ?? null);
      const o = owners.get(x.owner);
      if (!o) c.fail('owner', `no active user with e-mail "${x.owner}"`);
      else ownerUserId = o;
    }
    if (c.ok) {
      const key = `${metric}|${scopeType}|${scopeId ?? ''}`;
      if (seen.has(key)) c.fail('metric', `duplicate of line ${seen.get(key)}: ${metric} for ${scopeRef} appears twice in the file`);
      else if (liveKeys.has(key)) c.fail('metric', `${liveKeys.get(key)} already covers ${metric} for ${scopeRef}`);
      else seen.set(key, r.line);
    }
    if (!c.ok || !th.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    out.valid.push({
      line: r.line,
      value: { metric, scopeType, scopeId, scopeRef, threshold: th.value.toString(), breachAction: action, description: x.description || null, ownerUserId },
      display: { metric: METRIC_LABEL[metric as keyof typeof METRIC_LABEL] ?? metric, scope: scopeRef, threshold: th.value.toString(), breachAction: action },
      warnings: ['Imported as a DRAFT limit: submit it and have a different person approve it'],
    });
  }
  return out;
}

export const riskLimitsImport: ImportKind<LimitRow> = {
  kind: 'risk-limits',
  title: 'Limits',
  permissions: ['risk.view', 'risk.manage'],
  columns: [
    { key: 'metric', label: 'Metric', required: true, example: 'SINGLE_NAME_PCT', hint: RISK_METRICS.join(', ') },
    { key: 'scope', label: 'Scope', example: 'PORTFOLIO', hint: 'PORTFOLIO or FIRM (PORTFOLIO when a portfolio is given)' },
    { key: 'portfolio', label: 'Portfolio', aliases: ['portfolio ref'], example: 'PF-1001' },
    { key: 'threshold', label: 'Threshold %', required: true, aliases: ['threshold', 'limit', 'percent'], example: '10' },
    { key: 'breachAction', label: 'Breach action', aliases: ['action'], example: 'ALERT', hint: 'ALERT, ESCALATE or BLOCK' },
    { key: 'owner', label: 'Owner e-mail', aliases: ['owner'], example: '' },
    { key: 'description', label: 'Description', example: '' },
  ],
  validate: (rows, ctx) => validateLimits(rows, ctx.userId),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows) {
      const v = r.value;
      const ref = await nextRef(tx, 'riskLimit');
      const l = await tx.riskLimit.create({ data: { ref, metric: v.metric, scopeType: v.scopeType, scopeId: v.scopeId, threshold: new D(v.threshold), breachAction: v.breachAction, description: v.description, ownerUserId: v.ownerUserId, makerId: ctx.userId } });
      await writeAudit(tx, audit(ctx.req), { action: 'risk.limit_created', objectType: 'risk_limit', objectId: l.id, after: { ref, metric: v.metric, scopeType: v.scopeType, scopeId: v.scopeId, threshold: v.threshold, breachAction: v.breachAction, owner: v.ownerUserId, importBatch: batch.ref, importLine: r.line } });
      refs.push(ref);
    }
    return { created: refs.length, status: 'DRAFT', refs: refs.slice(0, 50) };
  },
};
