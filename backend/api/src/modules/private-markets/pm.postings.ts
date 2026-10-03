import { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { resolveFxRate } from '../portfolio/portfolio.service';
import { autoAccountingJournal, autoCashJournal, type AutoLine, type AutoResult } from '../wiring/autojournals';

/**
 * Private-market flows posted to the books (GAP-005). A settled capital call or distribution and an approved NAV mark each
 * create PENDING_APPROVAL system journals (accounting in the portfolio base currency, cash ledger in the fund currency) and
 * one `pm_postings` row per source, which makes the call idempotent and carries the fund-currency carrying value:
 *   carrying value of a commitment = sum(pm_postings.carrying_delta)
 *   call paid         Dr 1150 Private fund investments, Cr 1000 Cash at bank        carrying +amount
 *   distribution      Dr 1000 Cash at bank, Cr 1150 (return of capital), Cr 4400 (income / gain)   carrying -return of capital
 *   approved mark     Dr/Cr 1150, Cr/Dr 4200 Unrealised gains and losses            carrying + (nav - carrying)
 * Cash: call Cr bank / Dr clearing; distribution Dr bank / Cr clearing (skipped, and recorded as skipped, with no ledger).
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
type Tx = Prisma.TransactionClient;

const r4 = (v: Dec) => v.toDecimalPlaces(4, D.ROUND_HALF_UP);

/** fund currency -> portfolio base currency. Throws 409 when a rate is needed and missing, so nothing is booked at a wrong rate. */
export async function fxToBase(fundCcy: string, base: string, asOf: Date): Promise<Dec> {
  if (fundCcy === base) return new D(1);
  const r = await resolveFxRate(fundCcy, base, asOf);
  if (!r) throw new HttpError(409, 'no_fx_rate', `No ${fundCcy}/${base} rate on file for ${asOf.toISOString().slice(0, 10)}; add one under Portfolio > FX rates before booking this`);
  return r;
}

export async function carryingValue(tx: Tx, commitmentId: string): Promise<Dec> {
  const g = await tx.pmPosting.aggregate({ where: { commitmentId }, _sum: { carryingDelta: true } });
  return g._sum.carryingDelta ?? ZERO;
}

interface FlowCtx {
  commitment: { id: string; ref: string; portfolioId: string };
  fund: { ref: string; name: string; currency: string };
}

async function baseOf(tx: Tx, portfolioId: string) {
  return (await tx.portfolio.findUnique({ where: { id: portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD';
}

/** Books a PAID capital call or distribution. Idempotent per cashflow. */
export async function postPmCashflow(
  tx: Tx,
  ctx: AuditContext,
  c: FlowCtx,
  f: { id: string; ref: string; kind: string; amount: Dec; returnOfCapital: Dec | null; paidOn: Date },
) {
  const sourceRef = `PMX:${f.ref}`;
  const existing = await tx.pmPosting.findUnique({ where: { sourceRef } });
  if (existing) return existing;
  const base = await baseOf(tx, c.commitment.portfolioId);
  const rate = await fxToBase(c.fund.currency, base, f.paidOn);
  const conv = (v: Dec) => r4(v.mul(rate));
  const isCall = f.kind === 'CALL';
  const roc = isCall ? ZERO : (f.returnOfCapital ?? ZERO).gt(f.amount) ? f.amount : (f.returnOfCapital ?? ZERO);
  const income = f.amount.sub(roc);
  const lines: AutoLine[] = isCall
    ? [
        { code: '1150', debit: conv(f.amount), memo: `${f.ref} capital call ${c.fund.ref}` },
        { code: '1000', credit: conv(f.amount), memo: `${f.ref} cash paid` },
      ]
    : [{ code: '1000', debit: conv(f.amount), memo: `${f.ref} distribution ${c.fund.ref}` }];
  if (!isCall) {
    // Credit side from the converted total so the journal always balances after rounding.
    const total = conv(f.amount);
    const rocBase = roc.gt(0) ? (roc.eq(f.amount) ? total : conv(roc)) : ZERO;
    if (rocBase.gt(0)) lines.push({ code: '1150', credit: rocBase, memo: `${f.ref} return of capital` });
    const incBase = total.sub(rocBase);
    if (incBase.gt(0)) lines.push({ code: '4400', credit: incBase, memo: `${f.ref} income and gains` });
  }
  const desc = `${c.fund.name}: ${isCall ? 'capital call' : 'distribution'} ${f.ref}`;
  const accounting = await autoAccountingJournal(tx, { portfolioId: c.commitment.portfolioId, entryDate: f.paidOn, description: desc, sourceRef, lines, approvalLink: `/ops/private-markets?commitment=${c.commitment.id}` });
  const bank = await tx.cashLedger.findFirst({ where: { portfolioId: c.commitment.portfolioId, currency: c.fund.currency, kind: 'BANK', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const clearing = await tx.cashLedger.findFirst({ where: { portfolioId: c.commitment.portfolioId, currency: c.fund.currency, kind: 'CLEARING', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  let cash: AutoResult | null = null;
  if (bank && clearing) {
    cash = await autoCashJournal(tx, {
      portfolioId: c.commitment.portfolioId,
      currency: c.fund.currency,
      entryDate: f.paidOn,
      description: desc,
      purpose: isCall ? 'PM_CALL' : 'PM_DISTRIBUTION',
      sourceRef,
      lines: isCall ? [{ ledgerId: clearing.id, debit: f.amount, memo: f.ref }, { ledgerId: bank.id, credit: f.amount, memo: f.ref }] : [{ ledgerId: bank.id, debit: f.amount, memo: f.ref }, { ledgerId: clearing.id, credit: f.amount, memo: f.ref }],
    });
  } else cash = { created: false, skipped: 'no_ledger', detail: `No active bank and clearing ledger in ${c.fund.currency}` };
  const skipped = [accounting.skipped ? `accounting:${accounting.skipped}` : null, cash.skipped ? `cash:${cash.skipped}` : null].filter(Boolean).join(',') || null;
  const row = await tx.pmPosting.create({
    data: {
      sourceRef,
      kind: f.kind,
      commitmentId: c.commitment.id,
      portfolioId: c.commitment.portfolioId,
      cashflowId: f.id,
      currency: c.fund.currency,
      amount: f.amount,
      fxRate: rate,
      baseCurrency: base,
      baseAmount: conv(f.amount),
      carryingDelta: isCall ? f.amount : roc.neg(),
      accountingRef: accounting.ref ?? null,
      cashRef: cash.ref ?? null,
      skipped,
    },
  });
  await writeAudit(tx, ctx, { action: 'pm.cashflow_posted', objectType: 'pm_cashflow', objectId: f.id, after: { sourceRef, accounting: accounting.ref ?? accounting.skipped ?? null, cash: cash.ref ?? cash.skipped ?? null, fxRate: rate.toString(), baseAmount: conv(f.amount).toFixed(2), returnOfCapital: roc.toFixed(2), income: income.toFixed(2) } });
  return row;
}

/** Books an APPROVED NAV mark: the move from carrying value to NAV is an unrealised gain or loss. Idempotent per mark. */
export async function postPmMark(tx: Tx, ctx: AuditContext, c: FlowCtx, m: { id: string; ref: string; nav: Dec; asOf: Date }) {
  const sourceRef = `PMM:${m.ref}`;
  const existing = await tx.pmPosting.findUnique({ where: { sourceRef } });
  if (existing) return existing;
  const base = await baseOf(tx, c.commitment.portfolioId);
  const rate = await fxToBase(c.fund.currency, base, m.asOf);
  const carrying = await carryingValue(tx, c.commitment.id);
  const adj = r4(m.nav.sub(carrying));
  const adjBase = r4(adj.abs().mul(rate));
  let accounting: AutoResult = { created: false, skipped: 'nothing_to_post' };
  if (!adj.isZero() && adjBase.gt(0)) {
    const lines: AutoLine[] = adj.gt(0)
      ? [
          { code: '1150', debit: adjBase, memo: `${m.ref} mark up` },
          { code: '4200', credit: adjBase, memo: `${m.ref} unrealised gain` },
        ]
      : [
          { code: '4200', debit: adjBase, memo: `${m.ref} unrealised loss` },
          { code: '1150', credit: adjBase, memo: `${m.ref} mark down` },
        ];
    accounting = await autoAccountingJournal(tx, { portfolioId: c.commitment.portfolioId, entryDate: m.asOf, description: `${c.fund.name}: NAV mark ${m.ref} as of ${m.asOf.toISOString().slice(0, 10)}`, sourceRef, lines, approvalLink: `/ops/private-markets?mark=${m.id}` });
  }
  const row = await tx.pmPosting.create({
    data: {
      sourceRef,
      kind: 'MARK',
      commitmentId: c.commitment.id,
      portfolioId: c.commitment.portfolioId,
      markId: m.id,
      currency: c.fund.currency,
      amount: adj,
      fxRate: rate,
      baseCurrency: base,
      baseAmount: adj.gt(0) ? adjBase : adjBase.neg(),
      carryingDelta: adj,
      accountingRef: accounting.ref ?? null,
      skipped: accounting.skipped && !accounting.created ? `accounting:${accounting.skipped}` : null,
    },
  });
  await writeAudit(tx, ctx, { action: 'pm.mark_posted', objectType: 'pm_mark', objectId: m.id, after: { sourceRef, carryingBefore: carrying.toFixed(2), nav: m.nav.toFixed(2), adjustment: adj.toFixed(2), journal: accounting.ref ?? accounting.skipped ?? null, fxRate: rate.toString() } });
  return row;
}
