import { Prisma } from '@prisma/client';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { SYSTEM_ACTOR_ID, systemCtx } from '../../lib/system';
import { DEFAULT_COA, totals, validateLines } from '../accounting/accounting.engine';
import { periodFor } from '../accounting/accounting.service';
import { assertCashPeriodOpen } from '../cash/cash.service';
import { notifyPermission } from '../ops/ops.common';
import { ensureTask } from './tasks';

/**
 * Automatic journals. Every journal here is created by the system actor straight into PENDING_APPROVAL, so a human with
 * the posting permission still has to post it (maker-checker is preserved: the system is the maker). Each carries a
 * `sourceRef`; calling again for the same source returns the existing journal and creates nothing (idempotent).
 * A closed period is never written into: the call is skipped and reported so the caller can raise a work item.
 *
 * Source refs:  NAV:<navRef>            fee and accrual journal for a released NAV
 *               CA:<caRef>:<portfolio>  corporate-action cash (accounting + cash ledger)
 *               ORDER:<orderRef>:SETTLE trade settlement (accounting + cash ledger)
 *               PMX:<cashflowRef>       private-market capital call / distribution (accounting + cash ledger)
 *               PMM:<markRef>           approved private-market NAV mark (unrealised gain or loss)
 *               CA:<caRef>:<portfolio>:REV  adjusting entry that reverses a processed corporate action
 */
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = new D(0);
type Tx = Prisma.TransactionClient;

/** Accounts the automatic journals use, on top of the default chart (added to the portfolio chart when missing). */
const EXTRA_COA = [
  { code: '5300', name: 'Withholding tax', type: 'EXPENSE' },
  { code: '1150', name: 'Private fund investments', type: 'ASSET' },
  { code: '4300', name: 'Realised gains and losses', type: 'INCOME' },
  { code: '4400', name: 'Private fund distribution income', type: 'INCOME' },
];
const COA = [...DEFAULT_COA, ...EXTRA_COA];

export interface AutoLine {
  code: string;
  debit?: Dec;
  credit?: Dec;
  memo?: string;
}
export interface AutoResult {
  created: boolean;
  skipped?: 'period_closed' | 'no_chart' | 'nothing_to_post' | 'no_ledger';
  id?: string;
  ref?: string;
  detail?: string;
}

async function accountIds(tx: Tx, portfolioId: string, codes: string[]) {
  const have = await tx.accAccount.findMany({ where: { portfolioId, code: { in: codes } } });
  const map = new Map(have.map((a) => [a.code, a.id]));
  for (const code of codes) {
    if (map.has(code)) continue;
    const def = COA.find((a) => a.code === code);
    if (!def) continue;
    const a = await tx.accAccount.create({ data: { portfolioId, code: def.code, name: def.name, type: def.type, createdBy: SYSTEM_ACTOR_ID } });
    map.set(code, a.id);
  }
  return map;
}

/** One accounting journal for a source, PENDING_APPROVAL, made by the system. */
export async function autoAccountingJournal(tx: Tx, a: { portfolioId: string; entryDate: Date; description: string; sourceRef: string; lines: AutoLine[]; approvalLink?: string }): Promise<AutoResult> {
  const existing = await tx.accJournal.findUnique({ where: { sourceRef: a.sourceRef }, select: { id: true, ref: true } });
  if (existing) return { created: false, id: existing.id, ref: existing.ref };
  const lines = a.lines.filter((l) => (l.debit ?? ZERO).gt(0) || (l.credit ?? ZERO).gt(0));
  if (!lines.length) return { created: false, skipped: 'nothing_to_post' };
  const p = await periodFor(a.portfolioId, a.entryDate, tx);
  if (p?.status === 'CLOSED') return { created: false, skipped: 'period_closed', detail: `Accounting period ${p.periodStart.toISOString().slice(0, 10)} to ${p.periodEnd.toISOString().slice(0, 10)} is closed` };
  const ids = await accountIds(tx, a.portfolioId, [...new Set(lines.map((l) => l.code))]);
  if (lines.some((l) => !ids.has(l.code))) return { created: false, skipped: 'no_chart', detail: 'Chart of accounts is missing a required account' };
  const rows = lines.map((l, i) => ({ lineNo: i + 1, accountId: ids.get(l.code)!, debit: l.debit ?? ZERO, credit: l.credit ?? ZERO, memo: l.memo?.slice(0, 255) ?? null }));
  const errors = validateLines(rows);
  if (errors.length) return { created: false, skipped: 'nothing_to_post', detail: errors.map((e) => e.message).join('; ') };
  const t = totals(rows);
  const base = (await tx.portfolio.findUnique({ where: { id: a.portfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? 'USD';
  const ref = await nextRef(tx, 'journal');
  const now = new Date();
  const j = await tx.accJournal.create({
    data: { ref, portfolioId: a.portfolioId, entryDate: a.entryDate, description: a.description.slice(0, 500), currency: base, status: 'PENDING_APPROVAL', totalDebit: t.debit, totalCredit: t.credit, makerId: SYSTEM_ACTOR_ID, submittedAt: now, sourceRef: a.sourceRef, lines: { create: rows } },
  });
  const ctx: AuditContext = systemCtx();
  await writeAudit(tx, ctx, { action: 'accounting.journal_created', objectType: 'acc_journal', objectId: j.id, after: { ref, portfolioId: a.portfolioId, entryDate: a.entryDate.toISOString().slice(0, 10), totalDebit: t.debit.toFixed(2), lines: rows.length, sourceRef: a.sourceRef, system: true } });
  await writeAudit(tx, ctx, { action: 'accounting.journal_submitted', objectType: 'acc_journal', objectId: j.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', sourceRef: a.sourceRef } });
  await notifyPermission(tx, 'accounting.post', { type: 'accounting.journal_pending', title: `System journal ${ref} awaits approval`, body: `${a.description.slice(0, 160)} (${a.sourceRef})`, link: a.approvalLink ?? `/ops/accounting/journals/${j.id}` });
  return { created: true, id: j.id, ref };
}

/** One cash-ledger journal for a source, PENDING_APPROVAL, made by the system. Lines are debit/credit on named ledgers. */
export async function autoCashJournal(
  tx: Tx,
  a: { portfolioId: string; currency: string; entryDate: Date; description: string; purpose: string; sourceRef: string; reservationId?: string | null; lines: { ledgerId: string; debit?: Dec; credit?: Dec; memo?: string }[] },
): Promise<AutoResult> {
  const existing = await tx.cashJournal.findFirst({ where: { sourceRef: a.sourceRef, reversalOfId: null }, select: { id: true, ref: true } });
  if (existing) return { created: false, id: existing.id, ref: existing.ref };
  const lines = a.lines.filter((l) => (l.debit ?? ZERO).gt(0) || (l.credit ?? ZERO).gt(0));
  if (!lines.length) return { created: false, skipped: 'nothing_to_post' };
  try {
    await assertCashPeriodOpen(a.portfolioId, a.entryDate, tx);
  } catch {
    return { created: false, skipped: 'period_closed', detail: 'The cash period is closed' };
  }
  const rows = lines.map((l, i) => ({ lineNo: i + 1, ledgerId: l.ledgerId, debit: l.debit ?? ZERO, credit: l.credit ?? ZERO, memo: l.memo?.slice(0, 255) ?? null }));
  const t = rows.reduce((s, r) => ({ d: s.d.add(r.debit), c: s.c.add(r.credit) }), { d: ZERO, c: ZERO });
  if (!t.d.eq(t.c)) return { created: false, skipped: 'nothing_to_post', detail: 'Cash journal is not balanced' };
  const ref = await nextRef(tx, 'cashJournal');
  const now = new Date();
  const j = await tx.cashJournal.create({
    data: {
      ref,
      portfolioId: a.portfolioId,
      entryDate: a.entryDate,
      description: a.description.slice(0, 500),
      purpose: a.purpose,
      sourceRef: a.sourceRef,
      currency: a.currency,
      status: 'PENDING_APPROVAL',
      totalDebit: t.d,
      totalCredit: t.c,
      makerId: SYSTEM_ACTOR_ID,
      submittedAt: now,
      reservationId: a.reservationId ?? null,
      lines: { create: rows },
    },
  });
  const ctx = systemCtx();
  await writeAudit(tx, ctx, { action: 'cash.journal_created', objectType: 'cash_journal', objectId: j.id, after: { ref, portfolioId: a.portfolioId, purpose: a.purpose, entryDate: a.entryDate.toISOString().slice(0, 10), totalDebit: t.d.toFixed(2), sourceRef: a.sourceRef, system: true } });
  await writeAudit(tx, ctx, { action: 'cash.journal_submitted', objectType: 'cash_journal', objectId: j.id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', sourceRef: a.sourceRef } });
  await notifyPermission(tx, 'cash.journal.approve', { type: 'cash.journal_pending', title: `System cash journal ${ref} awaits approval`, body: `${a.description.slice(0, 160)} (${a.sourceRef})`, link: `/ops/cash/journals/${j.id}` });
  return { created: true, id: j.id, ref };
}

/**
 * A released NAV run books its fee and income accruals for the period. If the NAV supersedes a run whose journal is still
 * pending, that journal is discarded; if it was already posted, only the difference is booked (reversed sides when lower).
 */
export async function postNavJournals(tx: Tx, run: { id: string; ref: string; portfolioId: string; navDate: Date; fees: Dec; accruals: Dec }, superseded: { ref: string; fees: Dec; accruals: Dec }[]): Promise<AutoResult | null> {
  let fees = run.fees;
  let accruals = run.accruals;
  for (const old of superseded) {
    const j = await tx.accJournal.findUnique({ where: { sourceRef: `NAV:${old.ref}` } });
    if (!j) continue;
    if (['DRAFT', 'PENDING_APPROVAL'].includes(j.status)) {
      await tx.accJournal.updateMany({ where: { id: j.id, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, data: { status: 'DISCARDED', version: { increment: 1 } } });
      await writeAudit(tx, systemCtx(), { action: 'accounting.journal_discarded', objectType: 'acc_journal', objectId: j.id, before: { status: j.status }, after: { status: 'DISCARDED', supersededBy: run.ref }, reason: `NAV ${old.ref} was superseded by ${run.ref}` });
    } else if (j.status === 'POSTED') {
      fees = fees.sub(old.fees);
      accruals = accruals.sub(old.accruals);
    }
  }
  const lines: AutoLine[] = [];
  const side = (code: string, other: string, v: Dec, memo: string) => {
    if (v.gt(0)) lines.push({ code, debit: v, memo }, { code: other, credit: v, memo });
    else if (v.lt(0)) lines.push({ code, credit: v.neg(), memo }, { code: other, debit: v.neg(), memo });
  };
  side('5000', '2000', fees, `Management fee ${run.ref}`);
  side('1200', '4100', accruals, `Accrued income ${run.ref}`);
  return autoAccountingJournal(tx, { portfolioId: run.portfolioId, entryDate: run.navDate, description: `NAV ${run.ref}: fee and accrual for ${run.navDate.toISOString().slice(0, 10)}`, sourceRef: `NAV:${run.ref}`, lines, approvalLink: `/ops/nav/${run.id}` });
}

/** One entitlement as the journal builder sees it. cashInLieu is already part of cashAmount; cilCost is the book cost of the fraction sold. */
export interface CaJournalEnt {
  portfolioId: string;
  grossAmount: Dec;
  taxAmount: Dec;
  cashAmount: Dec;
  cashInLieu?: Dec;
  cilCost?: Dec;
}

/** Collapses lines on the same account and side into one so the journal stays compact. */
function mergeLines(lines: AutoLine[]): AutoLine[] {
  const out: AutoLine[] = [];
  for (const l of lines) {
    const hit = out.find((o) => o.code === l.code && !!o.debit === !!l.debit && !!o.credit === !!l.credit);
    if (hit) {
      if (l.debit) hit.debit = (hit.debit ?? ZERO).add(l.debit);
      if (l.credit) hit.credit = (hit.credit ?? ZERO).add(l.credit);
    } else out.push({ ...l });
  }
  return out;
}

/** Corporate-action processing: cash legs per portfolio, accounting and cash-ledger journals, plus a runbook task to approve them. */
export async function postCorporateActionJournals(tx: Tx, e: { id: string; ref: string; ticker: string; type: string; currency: string; payDate: Date }, ents: CaJournalEnt[]) {
  const out: { portfolioId: string; accounting: AutoResult; cash: AutoResult | null }[] = [];
  const entryDate = e.payDate;
  for (const en of ents) {
    if (en.cashAmount.isZero()) continue;
    const sourceRef = `CA:${e.ref}:${en.portfolioId}`.slice(0, 80);
    const inflow = en.cashAmount.gt(0);
    const abs = en.cashAmount.abs();
    const cil = en.cashInLieu ?? ZERO;
    // Cash that is not cash in lieu: dividend, subscription or merger consideration.
    const main = en.cashAmount.sub(cil);
    const lines: AutoLine[] = [];
    if ((e.type === 'CASH_DIVIDEND' || e.type === 'SCRIP_DIVIDEND') && main.gt(0)) {
      lines.push({ code: '1000', debit: main, memo: `${e.ref} net cash` });
      if (en.taxAmount.gt(0)) lines.push({ code: '5300', debit: en.taxAmount, memo: `${e.ref} withholding` });
      lines.push({ code: '4000', credit: main.add(en.taxAmount), memo: `${e.ticker} dividend income` });
    } else if (main.gt(0)) {
      lines.push({ code: '1000', debit: main, memo: `${e.ref} cash received` }, { code: '1100', credit: main, memo: `${e.ticker} ${e.type.toLowerCase()} proceeds` });
    } else if (main.lt(0)) {
      lines.push({ code: '1100', debit: main.abs(), memo: `${e.ticker} ${e.type.toLowerCase()} subscription` }, { code: '1000', credit: main.abs(), memo: `${e.ref} cash paid` });
    }
    if (cil.gt(0)) {
      // The fraction is sold for cash: its book cost leaves investments and the difference is a realised gain or loss.
      const cost = en.cilCost ?? ZERO;
      const gain = cil.sub(cost);
      lines.push({ code: '1000', debit: cil, memo: `${e.ref} cash in lieu` });
      if (cost.gt(0)) lines.push({ code: '1100', credit: cost, memo: `${e.ticker} fractional entitlement cost` });
      if (gain.gt(0)) lines.push({ code: '4300', credit: gain, memo: `${e.ref} gain on cash in lieu` });
      else if (gain.lt(0)) lines.push({ code: '4300', debit: gain.abs(), memo: `${e.ref} loss on cash in lieu` });
    }
    const accounting = await autoAccountingJournal(tx, { portfolioId: en.portfolioId, entryDate, description: `${e.ref} ${e.ticker} ${e.type.replace(/_/g, ' ').toLowerCase()}: cash ${inflow ? 'received' : 'paid'}${cil.gt(0) ? ' incl. cash in lieu' : ''}`, sourceRef, lines: mergeLines(lines), approvalLink: `/ops/corporate-actions/${e.id}` });
    const bank = await tx.cashLedger.findFirst({ where: { portfolioId: en.portfolioId, currency: e.currency, kind: 'BANK', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
    const clearing = await tx.cashLedger.findFirst({ where: { portfolioId: en.portfolioId, currency: e.currency, kind: 'CLEARING', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
    let cash: AutoResult | null = null;
    if (bank && clearing) {
      cash = await autoCashJournal(tx, {
        portfolioId: en.portfolioId,
        currency: e.currency,
        entryDate,
        description: `${e.ref} ${e.ticker} ${e.type.replace(/_/g, ' ').toLowerCase()}: ${inflow ? 'receipt' : 'payment'}`,
        purpose: 'CORPORATE_ACTION',
        sourceRef,
        lines: inflow ? [{ ledgerId: bank.id, debit: abs, memo: e.ref }, { ledgerId: clearing.id, credit: abs, memo: e.ref }] : [{ ledgerId: clearing.id, debit: abs, memo: e.ref }, { ledgerId: bank.id, credit: abs, memo: e.ref }],
      });
    } else cash = { created: false, skipped: 'no_ledger', detail: 'No bank and clearing ledger in the currency' };
    out.push({ portfolioId: en.portfolioId, accounting, cash });
  }
  const created = out.filter((o) => o.accounting.created || o.cash?.created).length;
  if (created) {
    await ensureTask(tx, { area: 'CORPORATE_ACTIONS', title: `Approve ${e.ref} ${e.ticker} journals`, detail: `${created} portfolio(s) have system journals pending approval (accounting and cash).`, dueAt: e.payDate, sourceRef: `CA:${e.ref}:JOURNALS`, link: `/ops/corporate-actions/${e.id}` });
    await notifyPermission(tx, 'operations.view', { type: 'corp_action.processed', title: `${e.ref} ${e.ticker} processed`, body: `${created} portfolio${created === 1 ? '' : 's'} have cash journals awaiting approval.`, link: `/ops/corporate-actions/${e.id}` });
  }
  return out;
}

/**
 * Reversal of a processed corporate action by adjustment. Each portfolio's system journals for the action are handled by
 * state: DRAFT or PENDING is discarded; POSTED gets an inverse journal (source CA:<ref>:<portfolio>:REV) that again needs a
 * human to post it. Nothing is edited in place. Returns one line per portfolio for the audit trail.
 */
export async function reverseCorporateActionJournals(tx: Tx, e: { ref: string }, portfolioIds: string[], reason: string, entryDate: Date) {
  const out: { portfolioId: string; accounting: string; cash: string }[] = [];
  for (const portfolioId of portfolioIds) {
    const sourceRef = `CA:${e.ref}:${portfolioId}`.slice(0, 80);
    const revRef = `${sourceRef}:REV`.slice(0, 80);
    let accounting = 'none';
    let cash = 'none';
    const aj = await tx.accJournal.findUnique({ where: { sourceRef }, include: { lines: { include: { account: true }, orderBy: { lineNo: 'asc' } } } });
    if (aj) {
      if (['DRAFT', 'PENDING_APPROVAL'].includes(aj.status)) {
        await tx.accJournal.updateMany({ where: { id: aj.id, status: aj.status }, data: { status: 'DISCARDED', version: { increment: 1 } } });
        await writeAudit(tx, systemCtx(), { action: 'accounting.journal_discarded', objectType: 'acc_journal', objectId: aj.id, before: { status: aj.status }, after: { status: 'DISCARDED', sourceRef }, reason: `Corporate action ${e.ref} reversed: ${reason}`.slice(0, 500) });
        accounting = `discarded ${aj.ref}`;
      } else if (aj.status === 'POSTED') {
        const r = await autoAccountingJournal(tx, {
          portfolioId,
          entryDate,
          description: `Reversal of ${aj.ref} (${e.ref} reversed)`,
          sourceRef: revRef,
          lines: aj.lines.map((l) => ({ code: l.account.code, debit: l.credit, credit: l.debit, memo: `reversal ${l.memo ?? ''}`.trim() })),
          approvalLink: `/ops/accounting/journals/${aj.id}`,
        });
        accounting = r.ref ? `reversing ${r.ref}` : `skipped ${r.skipped ?? ''}`;
      }
    }
    const cj = await tx.cashJournal.findFirst({ where: { sourceRef, reversalOfId: null }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (cj) {
      if (['DRAFT', 'PENDING_APPROVAL'].includes(cj.status)) {
        await tx.cashJournal.updateMany({ where: { id: cj.id, status: cj.status }, data: { status: 'DISCARDED' } });
        await writeAudit(tx, systemCtx(), { action: 'cash.journal_discarded', objectType: 'cash_journal', objectId: cj.id, before: { status: cj.status }, after: { status: 'DISCARDED', sourceRef }, reason: `Corporate action ${e.ref} reversed: ${reason}`.slice(0, 500) });
        cash = `discarded ${cj.ref}`;
      } else if (cj.status === 'POSTED') {
        const r = await autoCashJournal(tx, {
          portfolioId,
          currency: cj.currency,
          entryDate,
          description: `Reversal of ${cj.ref} (${e.ref} reversed)`,
          purpose: 'REVERSAL',
          sourceRef: revRef,
          lines: cj.lines.map((l) => ({ ledgerId: l.ledgerId, debit: l.credit, credit: l.debit, memo: `reversal ${l.memo ?? ''}`.trim() })),
        });
        cash = r.ref ? `reversing ${r.ref}` : `skipped ${r.skipped ?? ''}`;
      }
    }
    out.push({ portfolioId, accounting, cash });
  }
  return out;
}
