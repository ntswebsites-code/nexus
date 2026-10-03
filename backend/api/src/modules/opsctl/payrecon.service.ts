import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { HttpError } from '../../lib/errors';
import { audit, notifyPermission, seqRef } from '../ops/ops.common';
import { dayStart, isoDay, todayIso } from '../recon/recon.service';
import {
  DEFAULT_PAY_PARAMS,
  MATERIAL_SEV,
  addDays,
  diffSeverity,
  matchPayments,
  missingSeverity,
  type ExpItem,
  type Sev,
  type StmtLine,
} from './payrecon.engine';

const D = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export interface PayRunInput {
  fundId: string | null;
  from: string;
  to: string;
  tolerance?: string;
  graceDays?: number;
  dateWindowDays?: number;
}

export const payScopeKey = (fundId: string | null, from: string, to: string) => `${fundId ?? '*'}|${from}|${to}`;
const LINE_LOOKBACK = 7;
const LINE_LOOKAHEAD = 14;

interface Desired {
  itemKey: string;
  itemId: string | null;
  lineId: string | null;
  fundId: string | null;
  kind: 'MISSING_PAYMENT' | 'AMOUNT_DIFF' | 'UNPAIRED_LINE';
  label: string;
  expected: Prisma.InputJsonValue | null;
  actual: Prisma.InputJsonValue | null;
  difference: Prisma.Decimal | null;
  currency: string | null;
  severity: Sev;
}

const money = (v: Prisma.Decimal) => v.toFixed(2);
const REASON_TEXT: Record<string, string> = {
  DUPLICATE: 'a second line carries the reference of a payment that is already paired (possible duplicate payment)',
  AMBIGUOUS: 'the line carries a document reference shared by several investors and the payee or amount does not single one out',
  WRONG_DIRECTION: 'the line carries the reference of a payment expected in the other direction',
  WRONG_CURRENCY: 'the line carries the reference of a payment in another currency',
};
const REASON_SEV: Record<string, Sev> = { DUPLICATE: 'HIGH', AMBIGUOUS: 'MEDIUM', WRONG_DIRECTION: 'HIGH', WRONG_CURRENCY: 'MEDIUM' };

/** Expected payments in the window: issued capital calls (money in) and distributions (money out), per investor. */
async function loadExpected(tx: Tx, fundId: string | null, from: Date, to: Date) {
  const [calls, dists] = await Promise.all([
    tx.capitalCallAllocation.findMany({
      where: { status: { not: 'CANCELLED' }, callAmount: { gt: 0 }, call: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, dueDate: { gte: from, lte: to }, ...(fundId ? { fundId } : {}) } },
      include: { call: { select: { id: true, ref: true, fundId: true, currency: true, dueDate: true, wireJson: true } } },
    }),
    tx.distributionAllocation.findMany({
      where: { status: { not: 'CANCELLED' }, shareAmount: { gt: 0 }, distribution: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, distributionDate: { gte: from, lte: to }, ...(fundId ? { fundId } : {}) } },
      include: { distribution: { select: { id: true, ref: true, fundId: true, currency: true, distributionDate: true } } },
    }),
  ]);
  const out: (ExpItem & { kind: string; sourceId: string; fundId: string; documentId: string; clientId: string })[] = [];
  for (const a of calls) {
    const w = a.call.wireJson as { reference?: unknown } | null;
    const tokens = typeof w?.reference === 'string' && w.reference.trim().length >= 4 ? [w.reference.trim()] : [];
    out.push({ key: `CAPITAL_CALL_RECEIPT:${a.id}`, kind: 'CAPITAL_CALL_RECEIPT', sourceId: a.id, fundId: a.call.fundId, documentId: a.call.id, clientId: a.clientId, documentRef: a.call.ref, tokens, payeeName: a.lpLegalNameSnapshot, direction: 'IN', amount: a.callAmount, currency: a.call.currency, dueDate: isoDay(a.call.dueDate), covered: false });
  }
  for (const a of dists) {
    out.push({ key: `DISTRIBUTION_PAYOUT:${a.id}`, kind: 'DISTRIBUTION_PAYOUT', sourceId: a.id, fundId: a.distribution.fundId, documentId: a.distribution.id, clientId: a.clientId, documentRef: a.distribution.ref, tokens: [], payeeName: a.lpLegalNameSnapshot, direction: 'OUT', amount: a.shareAmount, currency: a.distribution.currency, dueDate: isoDay(a.distribution.distributionDate), covered: false });
  }
  return out;
}

export async function executePayRecon(req: Request, input: PayRunInput): Promise<{ runId: string; rerun: boolean }> {
  const actorId = req.user!.id;
  const tolerance = new D(input.tolerance ?? DEFAULT_PAY_PARAMS.tolerance);
  const graceDays = input.graceDays ?? DEFAULT_PAY_PARAMS.graceDays;
  const dateWindowDays = input.dateWindowDays ?? DEFAULT_PAY_PARAMS.dateWindowDays;
  const asOf = input.to < todayIso() ? input.to : todayIso();
  const key = payScopeKey(input.fundId, input.from, input.to);
  const from = dayStart(input.from);
  const to = dayStart(input.to);
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      // The run row is the serialisation point: created or bumped (row lock) before any read.
      let run = await tx.payReconRun.findUnique({ where: { scopeKey: key } });
      let rerun = !!run;
      if (!run) {
        const ref = await seqRef(tx, 'payReconRun', 'PRR-', 5, 1);
        try {
          run = await tx.payReconRun.create({ data: { ref, scopeKey: key, fundId: input.fundId, dateFrom: from, dateTo: to, status: 'CLEAN', runBy: actorId } });
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
          run = await tx.payReconRun.findUniqueOrThrow({ where: { scopeKey: key } });
          rerun = true;
        }
      }
      if (rerun) await tx.payReconRun.update({ where: { id: run.id }, data: { runCount: { increment: 1 }, runBy: actorId } });

      // ------------------------------------------------ inputs
      const expected = await loadExpected(tx, input.fundId, from, to);
      if (expected.length) {
        await tx.payReconItem.createMany({
          data: expected.map((e) => ({ kind: e.kind, sourceId: e.sourceId, fundId: e.fundId, documentId: e.documentId, documentRef: e.documentRef, clientId: e.clientId, payeeName: e.payeeName.slice(0, 255), direction: e.direction, expectedAmount: e.amount, currency: e.currency, dueDate: dayStart(e.dueDate) })),
          skipDuplicates: true,
        });
      }
      const rows = expected.length ? await tx.payReconItem.findMany({ where: { OR: expected.map((e) => ({ kind: e.kind, sourceId: e.sourceId })) } }) : [];
      const rowByKey = new Map(rows.map((r) => [`${r.kind}:${r.sourceId}`, r]));
      // Keep the item's amounts and due date current with the source document.
      for (const e of expected) {
        const r = rowByKey.get(e.key)!;
        if (!r.expectedAmount.equals(e.amount) || isoDay(r.dueDate) !== e.dueDate || r.currency !== e.currency) {
          rowByKey.set(e.key, await tx.payReconItem.update({ where: { id: r.id }, data: { expectedAmount: e.amount, dueDate: dayStart(e.dueDate), currency: e.currency, payeeName: e.payeeName.slice(0, 255) } }));
        }
      }

      const ledgers = await tx.cashLedger.findMany({ where: { kind: 'BANK', status: { not: 'CLOSED' } }, select: { id: true, currency: true } });
      const ledgerCur = new Map(ledgers.map((l) => [l.id, l.currency]));
      const imports = ledgers.length ? await tx.cashStatementImport.findMany({ where: { ledgerId: { in: ledgers.map((l) => l.id) }, status: 'COMMITTED', statementTo: { gte: from } }, select: { statementTo: true } }) : [];
      const lastCovered = imports.reduce<string>((m, i) => (isoDay(i.statementTo)! > m ? isoDay(i.statementTo)! : m), '');
      const rawLines = ledgers.length
        ? await tx.cashStatementLine.findMany({
            where: { ledgerId: { in: ledgers.map((l) => l.id) }, status: { not: 'IGNORED' }, import: { status: 'COMMITTED' }, valueDate: { gte: dayStart(addDays(input.from, -LINE_LOOKBACK)), lte: dayStart(addDays(input.to, LINE_LOOKAHEAD)) } },
            orderBy: [{ valueDate: 'asc' }, { id: 'asc' }],
            take: 20000,
          })
        : [];

      const inScopeIds = new Set(rows.map((r) => r.id));
      const heldElsewhere = rawLines.length ? await tx.payReconItem.findMany({ where: { matchedLineId: { in: rawLines.map((l) => l.id) }, id: { notIn: [...inScopeIds] } }, select: { matchedLineId: true } }) : [];
      const elsewhere = new Set(heldElsewhere.map((h) => h.matchedLineId!));

      // Locked items keep their pairing: accepted differences, manual matches, deferrals not yet due.
      const isLocked = (r: (typeof rows)[number]) => r.status === 'ACCEPTED' || r.matchMethod === 'MANUAL' || (r.status === 'DEFERRED' && !!r.deferredUntil && isoDay(r.deferredUntil)! >= asOf);
      const lockedLines = new Set(rows.filter((r) => isLocked(r) && r.matchedLineId).map((r) => r.matchedLineId!));
      const pool: StmtLine[] = rawLines
        .filter((l) => !elsewhere.has(l.id) && !lockedLines.has(l.id))
        .map((l) => ({ id: l.id, date: isoDay(l.valueDate)!, amount: l.amount, currency: ledgerCur.get(l.ledgerId) ?? 'USD', text: `${l.reference ?? ''} ${l.description ?? ''}` }));
      const lineById = new Map(rawLines.map((l) => [l.id, l]));
      const poolById = new Map(pool.map((l) => [l.id, l]));

      const live = expected.filter((e) => !isLocked(rowByKey.get(e.key)!)).map((e) => ({ ...e, covered: !!lastCovered && lastCovered >= addDays(e.dueDate, graceDays + 1) }));
      const res = matchPayments(live, pool, asOf, { tolerance, graceDays, dateWindowDays });

      // ------------------------------------------------ persist item state
      const unlockedIds = rows.filter((r) => !isLocked(r)).map((r) => r.id);
      if (unlockedIds.length) await tx.payReconItem.updateMany({ where: { id: { in: unlockedIds } }, data: { matchedLineId: null, matchedAmount: null, matchMethod: null, matchedAt: null, deferredUntil: null } });

      const desired: Desired[] = [];
      const itemOf = (k: string) => rowByKey.get(k)!;
      const expOf = (k: string) => expected.find((e) => e.key === k)!;
      const setItem = (k: string, data: Prisma.PayReconItemUncheckedUpdateInput) => tx.payReconItem.update({ where: { id: itemOf(k).id }, data: { ...data, lastRunId: run!.id, version: { increment: 1 } } });

      for (const p of res.pairs) {
        const e = expOf(p.itemKey);
        const it = itemOf(p.itemKey);
        const ok = p.difference.abs().lte(tolerance);
        await setItem(p.itemKey, { status: ok ? 'MATCHED' : 'BREAK', matchedLineId: p.lineId, matchedAmount: p.actual, matchMethod: p.method, matchedAt: now });
        if (!ok) {
          const l = lineById.get(p.lineId)!;
          const verb = e.direction === 'IN' ? 'received' : 'paid';
          desired.push({
            itemKey: `ITEM:${p.itemKey}`,
            itemId: it.id,
            lineId: p.lineId,
            fundId: e.fundId,
            kind: 'AMOUNT_DIFF',
            label: `${e.documentRef} ${e.payeeName}: expected ${money(e.amount)} ${e.currency} ${e.direction === 'IN' ? 'in' : 'out'}, ${verb} ${money(p.actual)} (${p.difference.gt(0) ? 'over' : 'short'} by ${money(p.difference.abs())})`.slice(0, 400),
            expected: { documentRef: e.documentRef, payee: e.payeeName, direction: e.direction, amount: money(e.amount), dueDate: e.dueDate },
            actual: { lineId: p.lineId, valueDate: isoDay(l.valueDate), amount: money(l.amount), reference: l.reference, description: l.description, matchedBy: p.method },
            difference: p.difference,
            currency: e.currency,
            severity: diffSeverity(e.amount, p.actual),
          });
        }
      }
      for (const m of res.missing) {
        const e = expOf(m.itemKey);
        await setItem(m.itemKey, { status: 'BREAK' });
        desired.push({
          itemKey: `ITEM:${m.itemKey}`,
          itemId: itemOf(m.itemKey).id,
          lineId: null,
          fundId: e.fundId,
          kind: 'MISSING_PAYMENT',
          label: `${e.documentRef} ${e.payeeName}: ${e.direction === 'IN' ? 'receipt' : 'payout'} of ${money(e.amount)} ${e.currency} due ${e.dueDate} is not on the bank statement (${m.daysOverdue} day${m.daysOverdue === 1 ? '' : 's'} overdue)`.slice(0, 400),
          expected: { documentRef: e.documentRef, payee: e.payeeName, direction: e.direction, amount: money(e.amount), dueDate: e.dueDate },
          actual: null,
          difference: e.direction === 'IN' ? e.amount.neg() : e.amount,
          currency: e.currency,
          severity: missingSeverity(m.daysOverdue),
        });
      }
      for (const k of [...res.notDue, ...res.awaitingStatement]) await setItem(k, { status: 'NOT_DUE' });
      for (const u of res.unpaired) {
        const l = lineById.get(u.lineId)!;
        const pl = poolById.get(u.lineId)!;
        desired.push({
          itemKey: `LINE:${u.lineId}`,
          itemId: null,
          lineId: u.lineId,
          fundId: input.fundId,
          kind: 'UNPAIRED_LINE',
          label: `Statement line ${pl.date} ${money(l.amount)} "${(l.reference ?? l.description ?? '').slice(0, 80)}" referencing ${u.documentRefs.join(', ')}: ${REASON_TEXT[u.reason]}`.slice(0, 400),
          expected: { documentRefs: u.documentRefs },
          actual: { lineId: u.lineId, valueDate: pl.date, amount: money(l.amount), reference: l.reference, description: l.description, reason: u.reason },
          difference: l.amount,
          currency: pl.currency,
          severity: REASON_SEV[u.reason]!,
        });
      }

      // ------------------------------------------------ breaks: create, refresh, reopen, auto-clear
      const scopeKeys = [...expected.map((e) => `ITEM:${e.key}`), ...pool.map((l) => `LINE:${l.id}`)];
      const existing = scopeKeys.length ? await tx.payReconBreak.findMany({ where: { itemKey: { in: scopeKeys } } }) : [];
      const exByKey = new Map(existing.map((b) => [b.itemKey, b]));
      const want = new Set(desired.map((d) => d.itemKey));
      let created = 0;
      let reopened = 0;
      let cleared = 0;
      const newMaterial: string[] = [];

      for (const d of desired) {
        const ex = exByKey.get(d.itemKey);
        const common = { itemId: d.itemId, lineId: d.lineId, fundId: d.fundId, label: d.label, expected: d.expected ?? Prisma.JsonNull, actual: d.actual ?? Prisma.JsonNull, difference: d.difference, currency: d.currency, severity: d.severity, lastRunId: run!.id, lastSeenAt: now };
        if (!ex) {
          const ref = await seqRef(tx, 'payReconBreak', 'PRB-', 5, 1);
          const b = await tx.payReconBreak.create({ data: { ref, itemKey: d.itemKey, kind: d.kind, ...common } });
          await tx.payReconBreakEvent.create({ data: { breakId: b.id, action: 'detected', toStatus: 'OPEN', actorId, note: d.label.slice(0, 500), detail: { run: run!.ref } } });
          created++;
          if (MATERIAL_SEV.includes(d.severity)) newMaterial.push(ref);
          continue;
        }
        if (ex.status === 'PENDING_CHECKER') {
          await tx.payReconBreak.update({ where: { id: ex.id }, data: { lastRunId: run!.id, lastSeenAt: now } });
          continue;
        }
        const changed = ex.kind !== d.kind || !(ex.difference ?? new D(0)).equals(d.difference ?? new D(0));
        if (ex.status === 'AUTO_CLEARED' || (ex.status === 'RESOLVED' && changed)) {
          await tx.payReconBreak.update({ where: { id: ex.id }, data: { ...common, kind: d.kind, status: 'OPEN', resolution: null, resolvedAt: null, version: { increment: 1 } } });
          await tx.payReconBreakEvent.create({ data: { breakId: ex.id, action: 'reopened', fromStatus: ex.status, toStatus: 'OPEN', actorId, note: 'A re-run found the item differing again', detail: { run: run!.ref } } });
          reopened++;
          if (MATERIAL_SEV.includes(d.severity)) newMaterial.push(ex.ref);
        } else {
          await tx.payReconBreak.update({ where: { id: ex.id }, data: { ...common, kind: d.kind } });
          if (ex.status !== 'RESOLVED') await tx.payReconBreakEvent.create({ data: { breakId: ex.id, action: 'updated', fromStatus: ex.status, toStatus: ex.status, actorId, detail: { run: run!.ref, severity: d.severity } } });
        }
      }
      for (const ex of existing) {
        if (want.has(ex.itemKey) || !['OPEN', 'INVESTIGATING'].includes(ex.status)) continue;
        assertCount((await tx.payReconBreak.updateMany({ where: { id: ex.id, status: ex.status, version: ex.version }, data: { status: 'AUTO_CLEARED', resolvedAt: now, version: { increment: 1 } } })).count);
        await tx.payReconBreakEvent.create({ data: { breakId: ex.id, action: 'auto_cleared', fromStatus: ex.status, toStatus: 'AUTO_CLEARED', actorId, note: 'A re-run found the payment paired', detail: { run: run!.ref } } });
        cleared++;
      }

      // ------------------------------------------------ run summary
      const lockedCount = rows.filter(isLocked).length;
      const lockedDeferred = rows.filter((r) => isLocked(r) && r.status === 'DEFERRED').length;
      const matched = res.pairs.filter((p) => p.difference.abs().lte(tolerance)).length + lockedCount - lockedDeferred;
      const openAfter = await tx.payReconBreak.count({ where: { itemKey: { in: scopeKeys }, status: { in: ['OPEN', 'INVESTIGATING', 'PENDING_CHECKER'] } } });
      const status = !expected.length && !pool.length ? 'NO_STATEMENTS' : openAfter ? 'BREAKS' : !ledgers.length || !imports.length ? 'NO_STATEMENTS' : 'CLEAN';
      const summary = {
        awaitingStatement: res.awaitingStatement.map((k) => ({ documentRef: expOf(k).documentRef, payee: expOf(k).payeeName, dueDate: expOf(k).dueDate })),
        statementsCoverTo: lastCovered || null,
        bankLedgers: ledgers.length,
        created,
        reopened,
        autoCleared: cleared,
        lockedItems: lockedCount,
      };
      const updated = await tx.payReconRun.update({
        where: { id: run.id },
        data: { status, itemCount: expected.length, matchedCount: matched, breakCount: openAfter, notDueCount: res.notDue.length + res.awaitingStatement.length + lockedDeferred, lineCount: pool.length, params: { tolerance: tolerance.toString(), graceDays, dateWindowDays, asOf } as unknown as Prisma.InputJsonValue, summary: summary as unknown as Prisma.InputJsonValue },
      });
      await writeAudit(tx, audit(req), {
        action: rerun ? 'pay_recon.run_rerun' : 'pay_recon.run',
        objectType: 'pay_recon_run',
        objectId: run.id,
        after: { ref: updated.ref, scope: key, status, items: expected.length, matched, openBreaks: openAfter, created, reopened, autoCleared: cleared, awaitingStatement: res.awaitingStatement.length },
      });
      if (newMaterial.length) {
        await notifyPermission(tx, 'recon.manage', { type: 'pay_recon.breaks', title: `${newMaterial.length} Critical or High payment break${newMaterial.length === 1 ? '' : 's'} on ${updated.ref}`, body: newMaterial.slice(0, 5).join(', '), link: '/ops/payments-recon' });
      }
      return { runId: run.id, rerun };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}

function assertCount(n: number) {
  if (n !== 1) throw HttpError.conflict('A break changed while the run was in progress; run again', 'concurrent_change');
}

export type { Tx };
