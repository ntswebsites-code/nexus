import { Prisma } from '@prisma/client';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { LIVE_RESERVATION } from '../cash/cash.engine';
import { resolveFxRate } from '../portfolio/portfolio.service';
import { autoAccountingJournal, autoCashJournal, type AutoResult } from '../wiring/autojournals';
import { today, type OrderRow } from './orders.service';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);

/**
 * Settlement of a filled order: the trade journals, created PENDING_APPROVAL by the system actor and idempotent per
 * order (source ORDER:<ref>:SETTLE). The cash journal is linked to the order's cash hold, which it consumes when posted.
 *   BUY   cash:  Dr settlement clearing, Cr bank (cost + fees)       accounting: Dr investments, Cr cash at bank
 *   SELL  cash:  Dr bank (net), Dr fees, Cr settlement clearing      accounting: Dr cash, Dr trade costs, Cr investments
 * Realised gains are not split out of the investments credit; that is left to the period-end valuation journals.
 */
export async function settleOrder(tx: Prisma.TransactionClient, ctx: AuditContext, o: OrderRow): Promise<{ accounting: AutoResult; cash: AutoResult }> {
  const fills = await tx.orderFill.findMany({ where: { orderId: o.id }, select: { quantity: true, price: true, fees: true } });
  const gross = fills.reduce((s, f) => s.add(f.quantity.mul(f.price)), ZERO).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const fees = fills.reduce((s, f) => s.add(f.fees), ZERO).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const buy = o.side === 'BUY';
  const sourceRef = `ORDER:${o.ref}:SETTLE`;
  const entryDate = today();
  const desc = `${buy ? 'Buy' : 'Sell'} settlement for order ${o.ref}`;

  // ---- cash ledger
  const ledgers = await tx.cashLedger.findMany({ where: { portfolioId: o.portfolioId, currency: o.currency, status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const bank = ledgers.find((l) => l.kind === 'BANK');
  const clearing = ledgers.find((l) => l.kind === 'CLEARING');
  const expense = ledgers.find((l) => l.kind === 'EXPENSE');
  let cash: AutoResult;
  if (!bank || !clearing) cash = { created: false, skipped: 'no_ledger', detail: `No active bank and clearing ledger in ${o.currency}` };
  else {
    const rsv = buy ? await tx.cashReservation.findFirst({ where: { orderId: o.id, status: { in: LIVE_RESERVATION } }, orderBy: { createdAt: 'asc' } }) : null;
    const lines = buy
      ? [
          { ledgerId: clearing.id, debit: gross.add(fees), memo: o.ref },
          { ledgerId: bank.id, credit: gross.add(fees), memo: o.ref },
        ]
      : expense && fees.gt(0)
        ? [
            { ledgerId: bank.id, debit: gross.sub(fees), memo: o.ref },
            { ledgerId: expense.id, debit: fees, memo: `${o.ref} fees` },
            { ledgerId: clearing.id, credit: gross, memo: o.ref },
          ]
        : [
            { ledgerId: bank.id, debit: gross.sub(fees), memo: o.ref },
            { ledgerId: clearing.id, credit: gross.sub(fees), memo: o.ref },
          ];
    cash = await autoCashJournal(tx, { portfolioId: o.portfolioId, currency: o.currency, entryDate, description: desc, purpose: buy ? 'BUY_SETTLEMENT' : 'SELL_SETTLEMENT', sourceRef, reservationId: rsv?.id ?? null, lines });
  }

  // ---- accounting (base currency)
  const base = (await tx.portfolio.findUnique({ where: { id: o.portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? o.currency;
  const rate: Dec | null = base === o.currency ? new D(1) : await resolveFxRate(o.currency, base, entryDate);
  let accounting: AutoResult;
  if (!rate) accounting = { created: false, skipped: 'no_chart', detail: `No ${o.currency}/${base} rate to book the journal` };
  else {
    const c = (v: Dec) => v.mul(rate).toDecimalPlaces(4, D.ROUND_HALF_UP);
    const cost = c(gross.add(fees));
    const g = c(gross);
    const f = c(fees);
    const lines = buy
      ? [
          { code: '1100', debit: cost, memo: `${o.ref} investments purchased` },
          { code: '1000', credit: cost, memo: `${o.ref} cash paid` },
        ]
      : [
          { code: '1000', debit: g.sub(f), memo: `${o.ref} cash received` },
          { code: '5100', debit: f, memo: `${o.ref} trade costs` },
          { code: '1100', credit: g, memo: `${o.ref} investments sold` },
        ];
    accounting = await autoAccountingJournal(tx, { portfolioId: o.portfolioId, entryDate, description: desc, sourceRef, lines, approvalLink: `/ops/orders/${o.id}` });
  }
  await writeAudit(tx, ctx, {
    action: 'order.settlement_journals',
    objectType: 'order',
    objectId: o.id,
    after: { sourceRef, accounting: accounting.ref ?? accounting.skipped ?? null, cash: cash.ref ?? cash.skipped ?? null, gross: gross.toFixed(2), fees: fees.toFixed(2), currency: o.currency },
  });
  return { accounting, cash };
}
