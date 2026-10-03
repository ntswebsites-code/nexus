/**
 * Operations and finance controls demo data (R4-2). Idempotent.
 * Builds one committed bank statement (file-drop style import on the first USD bank ledger) from the issued capital
 * calls and distributions already in the database, so "Run matching" on /ops/payments-recon shows every outcome:
 *   - a capital-call receipt that matches on its reference,
 *   - a receipt that is short by 5% (AMOUNT_DIFF),
 *   - a receipt that never arrived (MISSING_PAYMENT, when the statement runs past its due date),
 *   - a distribution payout matched on reference, one matched on amount alone, and a duplicate payout line (UNPAIRED_LINE).
 * Run matching with a window that contains the due dates of those documents.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-opsctl.ts     (standalone, after seed-uat and seed-cash)
 *   also called by seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { sha256Hex } from '../src/lib/crypto';
import { nextRef } from '../src/lib/refs';
import { lineFingerprint } from '../src/modules/cash/cash.engine';

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const log = (m: string) => console.log(`[seed:opsctl] ${m}`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export async function seedOpsctl() {
  const actor = await prisma.userRole.findFirst({ where: { role: { portal: 'admin', key: { in: ['operations', 'fund_accountant', 'system_admin'] } }, user: { isActive: true } }, select: { userId: true } });
  if (!actor) return log('no staff user; skipped');
  const ledger = await prisma.cashLedger.findFirst({ where: { kind: 'BANK', currency: 'USD', status: { not: 'CLOSED' } }, orderBy: { ref: 'asc' } });
  if (!ledger) return log('no USD bank ledger (run seed-cash first); skipped');

  const calls = await prisma.capitalCallAllocation.findMany({
    where: { status: { not: 'CANCELLED' }, callAmount: { gt: 0 }, call: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, currency: 'USD' } },
    include: { call: { select: { ref: true, dueDate: true } } },
    orderBy: [{ call: { dueDate: 'asc' } }, { id: 'asc' }],
    take: 3,
  });
  const dists = await prisma.distributionAllocation.findMany({
    where: { status: { not: 'CANCELLED' }, shareAmount: { gt: 0 }, distribution: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, currency: 'USD' } },
    include: { distribution: { select: { ref: true, distributionDate: true } } },
    orderBy: [{ distribution: { distributionDate: 'asc' } }, { id: 'asc' }],
    take: 2,
  });
  if (!calls.length && !dists.length) return log('no issued capital calls or distributions; skipped');

  const lines: { date: Date; amount: Prisma.Decimal; reference: string | null; description: string }[] = [];
  const name = (s: string) => s.slice(0, 40);
  calls.forEach((a, i) => {
    const due = a.call.dueDate;
    if (i === 0) lines.push({ date: addDays(due, -1), amount: a.callAmount, reference: a.call.ref, description: `Subscription ${name(a.lpLegalNameSnapshot)}` });
    else if (i === 1) lines.push({ date: due, amount: a.callAmount.mul('0.95').toDecimalPlaces(2), reference: a.call.ref, description: `Capital call ${name(a.lpLegalNameSnapshot)}` });
    // the third receipt never arrives
  });
  dists.forEach((a, i) => {
    const date = a.distribution.distributionDate;
    if (i === 0) {
      lines.push({ date, amount: a.shareAmount.neg(), reference: a.distribution.ref, description: `Distribution ${name(a.lpLegalNameSnapshot)}` });
      lines.push({ date: addDays(date, 1), amount: a.shareAmount.neg(), reference: a.distribution.ref, description: `Distribution ${name(a.lpLegalNameSnapshot)} (second payment)` });
    } else lines.push({ date: addDays(date, 1), amount: a.shareAmount.neg(), reference: null, description: 'Outgoing wire' });
  });
  if (!lines.length) return log('nothing to put on the statement; skipped');

  const dates = [...calls.map((c) => c.call.dueDate), ...dists.map((d) => d.distribution.distributionDate), ...lines.map((l) => l.date)];
  const from = dates.reduce((m, d) => (d < m ? d : m)).getTime();
  const lastDue = dates.reduce((m, d) => (d > m ? d : m)).getTime();
  const statementFrom = new Date(from - 2 * 86_400_000);
  // Runs well past the last due date, so a receipt that never arrived is a break rather than "awaiting a statement".
  const statementTo = new Date(lastDue + 14 * 86_400_000);
  const fileHash = sha256Hex(`${ledger.id}|seed-opsctl|${lines.map((l) => `${iso(l.date)}${l.amount}${l.reference}`).join(';')}`);
  if (await prisma.cashStatementImport.findUnique({ where: { ledgerId_fileHash: { ledgerId: ledger.id, fileHash } }, select: { id: true } })) return log('statement already present');
  const overlap = await prisma.cashStatementImport.findFirst({ where: { ledgerId: ledger.id, status: { in: ['STAGED', 'COMMITTED'] }, statementFrom, statementTo }, select: { id: true } });
  if (overlap) return log('a statement for these dates already exists; skipped');

  const prints = lines.map((l) => lineFingerprint(ledger.id, { valueDate: l.date, amount: l.amount, reference: l.reference, description: l.description }));
  const dup = await prisma.cashStatementLine.count({ where: { ledgerId: ledger.id, fingerprint: { in: prints } } });
  if (dup) return log('statement lines already exist; skipped');
  const sum = lines.reduce((s, l) => s.add(l.amount), D(0));
  await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashImport');
    await tx.cashStatementImport.create({
      data: {
        ref,
        ledgerId: ledger.id,
        portfolioId: ledger.portfolioId,
        filename: 'bank-statement-demo.csv',
        fileHash,
        format: 'CSV',
        statementFrom,
        statementTo,
        openingBalance: D(0),
        closingBalance: sum,
        lineCount: lines.length,
        variance: D(0),
        status: 'COMMITTED',
        makerId: actor.userId,
        checkerId: actor.userId,
        committedAt: new Date(),
        lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ledgerId: ledger.id, valueDate: l.date, amount: l.amount, reference: l.reference, description: l.description, fingerprint: prints[i]! })) },
      },
    });
    log(`statement ${ref} with ${lines.length} lines for ${iso(statementFrom)} to ${iso(statementTo)}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedOpsctl()
    .catch((err) => {
      console.error('[seed:opsctl] FAILED:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
