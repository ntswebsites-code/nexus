import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { assertTicketSize, createDraftOrder, latestPrice } from '../orders/orders.routes';
import { D, RowCheck, parseDecimal, type ImportKind, type MappedRow, type ValidRow, type Validation } from './imports.core';

/**
 * Orders CSV/JSON/XLSX import (FR-OMS-010). Each valid row becomes a DRAFT order owned by the importer, exactly as if the
 * ticket had been typed: it still has to be validated, submitted and approved by a second person before it can route.
 * Rows run the same field rules as the ticket (board lot, volume sanity, a price on file, active security and broker).
 */
interface OrderRow {
  portfolioId: string;
  portfolioRef: string;
  security: { id: string; ticker: string; currency: string };
  side: 'BUY' | 'SELL';
  quantity: string;
  orderType: 'MARKET' | 'LIMIT';
  limitPrice: string | null;
  tif: 'DAY' | 'GTC' | 'IOC';
  urgency: 'Low' | 'Normal' | 'High';
  brokerId: string | null;
  rationale: string | null;
  decision: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validate(rows: MappedRow[]): Promise<Validation<OrderRow>> {
  const out: Validation<OrderRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const portfolios = new Map<string, Awaited<ReturnType<typeof loadPortfolio>> | null>();
  const securities = new Map<string, Awaited<ReturnType<typeof prisma.security.findFirst>>>();
  const prices = new Map<string, Awaited<ReturnType<typeof latestPrice>>>();
  const brokers = new Map<string, Awaited<ReturnType<typeof prisma.broker.findFirst>>>();
  const seen = new Map<string, number>();

  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;

    const pKey = x.portfolio ?? '';
    if (!pKey) c.fail('portfolio', 'is required');
    let portfolio: Awaited<ReturnType<typeof loadPortfolio>> | null = null;
    if (pKey) {
      if (!portfolios.has(pKey)) portfolios.set(pKey, await loadPortfolio(pKey).catch(() => null));
      portfolio = portfolios.get(pKey) ?? null;
      if (!portfolio) c.fail('portfolio', `unknown portfolio "${pKey}"`);
      else if (portfolio.status !== 'Active') c.fail('portfolio', `${portfolio.ref} is ${portfolio.status}`);
    }

    const tKey = x.security ?? '';
    if (!tKey) c.fail('security', 'is required');
    let security: Awaited<ReturnType<typeof prisma.security.findFirst>> = null;
    if (tKey) {
      if (!securities.has(tKey)) securities.set(tKey, await prisma.security.findFirst({ where: UUID.test(tKey) ? { id: tKey } : { ticker: tKey.toUpperCase() } }));
      security = securities.get(tKey) ?? null;
      if (!security) c.fail('security', `unknown security "${tKey}"`);
      else if (security.status !== 'Active') c.fail('security', `${security.ticker} is ${security.status} and cannot be ordered`);
    }

    const side = (x.side ?? '').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') c.fail('side', 'must be BUY or SELL');

    const qty = parseDecimal(x.quantity, { positive: true, scale: 0, max: '999999999999999' });
    if (!qty.ok) c.fail('quantity', qty.message === 'has more than 0 decimal places' ? 'must be a whole number' : qty.message);

    const lp = x.limitPrice ? parseDecimal(x.limitPrice, { positive: true, scale: 6, max: '99999999999999' }) : null;
    if (lp && !lp.ok) c.fail('limitPrice', lp.message);
    const typeRaw = (x.orderType ?? '').toUpperCase();
    if (typeRaw && typeRaw !== 'MARKET' && typeRaw !== 'LIMIT') c.fail('orderType', 'must be MARKET or LIMIT');
    const orderType = (typeRaw || (x.limitPrice ? 'LIMIT' : 'MARKET')) as 'MARKET' | 'LIMIT';
    if (orderType === 'LIMIT' && !x.limitPrice) c.fail('limitPrice', 'is required for a LIMIT order');
    if (orderType === 'MARKET' && x.limitPrice) c.fail('limitPrice', 'is not allowed on a MARKET order');

    const tifRaw = (x.tif ?? '').toUpperCase() || 'DAY';
    if (!['DAY', 'GTC', 'IOC'].includes(tifRaw)) c.fail('tif', 'must be DAY, GTC or IOC');
    const urgRaw = (x.urgency ?? '').toLowerCase() || 'normal';
    const urgency = ({ low: 'Low', normal: 'Normal', high: 'High' } as const)[urgRaw as 'low'];
    if (!urgency) c.fail('urgency', 'must be Low, Normal or High');
    const rationale = x.rationale ? x.rationale.slice(0, 2000) : null;
    if (x.rationale && x.rationale.length > 2000) c.fail('rationale', 'is longer than 2000 characters');

    let brokerId: string | null = null;
    if (x.broker) {
      if (!brokers.has(x.broker)) brokers.set(x.broker, await prisma.broker.findFirst({ where: UUID.test(x.broker) ? { id: x.broker } : { name: x.broker } }));
      const b = brokers.get(x.broker);
      if (!b || b.status !== 'Active') c.fail('broker', `unknown or inactive broker "${x.broker}"`);
      else brokerId = b.id;
    }

    let decision = '';
    if (security && security.status === 'Active') {
      if (!prices.has(security.id)) prices.set(security.id, await latestPrice(security.id));
      const px = prices.get(security.id);
      if (!px) c.fail('security', `${security.ticker} has no price on file`);
      else decision = px.toString();
    }
    if (security && qty.ok) {
      try {
        assertTicketSize(security, qty.value);
      } catch (e) {
        if (e instanceof HttpError) {
          const d = (e.details as { message?: string }[] | undefined)?.[0];
          c.fail('quantity', d?.message ?? e.message);
        } else throw e;
      }
    }

    if (!c.ok || !portfolio || !security || !qty.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    const key = [portfolio.id, security.id, side, qty.value.toString(), orderType, x.limitPrice ?? ''].join('|');
    const warnings: string[] = [];
    if (seen.has(key)) warnings.push(`Same ticket as line ${seen.get(key)}; check it is not a duplicate`);
    else seen.set(key, r.line);
    const value: OrderRow = {
      portfolioId: portfolio.id,
      portfolioRef: portfolio.ref,
      security: { id: security.id, ticker: security.ticker, currency: security.currency },
      side: side as 'BUY' | 'SELL',
      quantity: qty.value.toString(),
      orderType,
      limitPrice: lp && lp.ok ? lp.value.toString() : null,
      tif: tifRaw as OrderRow['tif'],
      urgency: urgency!,
      brokerId,
      rationale,
      decision,
    };
    out.valid.push({
      line: r.line,
      value,
      warnings,
      display: { portfolio: portfolio.ref, security: security.ticker, side: value.side, quantity: value.quantity, orderType, limitPrice: value.limitPrice ?? '', tif: value.tif, decisionPrice: decision },
    });
  }
  return out;
}

export const ordersImport: ImportKind<OrderRow> = {
  kind: 'orders',
  title: 'Orders',
  permissions: ['orders.create'],
  columns: [
    { key: 'portfolio', label: 'Portfolio', required: true, aliases: ['portfolio ref', 'portfolio id', 'portfolioId'], example: 'PF-1001', hint: 'Portfolio reference or id' },
    { key: 'security', label: 'Ticker', required: true, aliases: ['security', 'securityId', 'symbol'], example: 'DLTA.ZW', hint: 'Ticker or security id' },
    { key: 'side', label: 'Side', required: true, example: 'BUY', hint: 'BUY or SELL' },
    { key: 'quantity', label: 'Quantity', required: true, aliases: ['qty', 'shares'], example: '1000', hint: 'Whole shares, a multiple of the board lot' },
    { key: 'orderType', label: 'Order type', aliases: ['type'], example: 'LIMIT', hint: 'MARKET or LIMIT (LIMIT when a limit price is given)' },
    { key: 'limitPrice', label: 'Limit price', aliases: ['price', 'limit'], example: '1.25' },
    { key: 'tif', label: 'TIF', aliases: ['time in force'], example: 'DAY', hint: 'DAY, GTC or IOC (default DAY)' },
    { key: 'urgency', label: 'Urgency', example: 'Normal', hint: 'Low, Normal or High' },
    { key: 'broker', label: 'Broker', aliases: ['brokerId', 'broker name'], example: '' },
    { key: 'rationale', label: 'Rationale', aliases: ['note', 'notes'], example: 'Rebalance to model' },
  ],
  validate: (rows) => validate(rows),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows as ValidRow<OrderRow>[]) {
      const v = r.value;
      const o = await createDraftOrder(
        tx,
        ctx.req,
        { side: v.side, quantity: v.quantity, orderType: v.orderType, limitPrice: v.limitPrice, tif: v.tif, urgency: v.urgency, brokerId: v.brokerId, rationale: v.rationale },
        { id: v.portfolioId, ref: v.portfolioRef },
        v.security,
        new D(v.decision),
        { importBatch: batch.ref, importLine: r.line },
      );
      refs.push(o.ref);
    }
    return { created: refs.length, refs: refs.slice(0, 50), firstRef: refs[0], lastRef: refs[refs.length - 1] };
  },
};
