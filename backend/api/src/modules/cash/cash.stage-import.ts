import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { nextRef } from '../../lib/refs';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { notifyPermission } from '../ops/ops.common';
import { lineFingerprint, parseStatement, statementVariance, sha256, type StatementFormat } from './cash.engine';
import { isoDay, loadLedger, type LedgerRow } from './cash.service';

const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Counterparty account → portfolio (recon map) → first active bank ledger. */
export async function resolveBankLedgerForAccount(counterpartyId: string, accountRef: string, db: typeof prisma = prisma): Promise<LedgerRow | null> {
  const map = await db.reconAccountMap.findUnique({ where: { counterpartyId_accountRef: { counterpartyId, accountRef } } });
  if (!map) return null;
  return db.cashLedger.findFirst({ where: { portfolioId: map.portfolioId, kind: 'BANK', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
}

/** Parse and stage a bank statement import (maker-checker; no ledger movement until commit). */
export async function stageStatementImport(input: {
  ledgerId: string;
  filename: string;
  format: StatementFormat;
  content: string;
  makerId: string;
  audit?: AuditContext;
  openingBalance?: string | null;
  closingBalance?: string | null;
  statementFrom?: string;
  statementTo?: string;
}) {
  const ledger = await loadLedger(input.ledgerId);
  if (ledger.kind !== 'BANK') throw HttpError.badRequest('Validation failed', [{ path: 'ledgerId', message: 'Statements are imported against a bank ledger' }]);
  if (ledger.status !== 'ACTIVE') throw HttpError.conflict(`Ledger ${ledger.ref} is ${ledger.status.toLowerCase()}; imports are blocked`, 'ledger_not_active');

  const parsed = parseStatement(input.format, input.content, { opening: input.openingBalance ?? null, closing: input.closingBalance ?? null });
  if (parsed.errors.length) throw HttpError.badRequest('The statement could not be read', parsed.errors.slice(0, 50));
  if (parsed.currency && parsed.currency !== ledger.currency) {
    throw HttpError.badRequest('Validation failed', [{ path: 'content', message: `The statement is in ${parsed.currency} but ledger ${ledger.ref} is ${ledger.currency}` }]);
  }
  const opening = parsed.opening!;
  const closing = parsed.closing!;
  const variance = statementVariance(opening, closing, parsed.lines);
  if (variance.abs().gt(ledger.tolerance)) {
    throw new HttpError(400, 'statement_does_not_foot', `Opening ${opening.toFixed(2)} plus movements does not equal closing ${closing.toFixed(2)}: out by ${variance.toFixed(2)} (tolerance ${ledger.tolerance.toFixed(2)})`, { variance: variance.toFixed(2), tolerance: ledger.tolerance.toFixed(2) });
  }
  const dates = parsed.lines.map((l) => l.valueDate.getTime());
  const from = input.statementFrom ? toDate(input.statementFrom) : new Date(Math.min(...dates));
  const to = input.statementTo ? toDate(input.statementTo) : new Date(Math.max(...dates));
  if (from.getTime() > to.getTime()) throw HttpError.badRequest('Validation failed', [{ path: 'statementTo', message: 'The statement end is before its start' }]);
  if (parsed.lines.some((l) => l.valueDate < from || l.valueDate > to)) throw HttpError.badRequest('Validation failed', [{ path: 'statementFrom', message: 'Some lines fall outside the statement dates' }]);

  const fileHash = sha256(`${ledger.id}|${input.format}|${input.content}`);
  if (await prisma.cashStatementImport.findUnique({ where: { ledgerId_fileHash: { ledgerId: ledger.id, fileHash } }, select: { id: true } })) {
    throw HttpError.conflict('This file was already imported for this ledger', 'duplicate_file');
  }
  if (await prisma.cashStatementImport.findFirst({ where: { ledgerId: ledger.id, status: { in: ['STAGED', 'COMMITTED'] }, statementFrom: from, statementTo: to }, select: { id: true } })) {
    throw HttpError.conflict(`A statement for ${isoDay(from)} to ${isoDay(to)} already exists for this ledger`, 'duplicate_statement');
  }

  const prints = parsed.lines.map((l) => lineFingerprint(ledger.id, l));
  const dup = await prisma.cashStatementLine.findMany({ where: { ledgerId: ledger.id, fingerprint: { in: prints }, import: { status: { in: ['STAGED', 'COMMITTED'] } } }, select: { fingerprint: true } });
  if (dup.length) throw new HttpError(409, 'duplicate_lines', `${dup.length} line${dup.length === 1 ? '' : 's'} in this file already exist in an earlier statement for this ledger`, { duplicates: dup.length });

  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashImport');
    const imp = await tx.cashStatementImport.create({
      data: {
        ref,
        ledgerId: ledger.id,
        portfolioId: ledger.portfolioId,
        filename: input.filename,
        fileHash,
        format: input.format,
        statementFrom: from,
        statementTo: to,
        openingBalance: opening,
        closingBalance: closing,
        lineCount: parsed.lines.length,
        variance,
        makerId: input.makerId,
        lines: { create: parsed.lines.map((l, i) => ({ lineNo: i + 1, ledgerId: ledger.id, valueDate: l.valueDate, amount: l.amount, reference: l.reference, description: l.description, fingerprint: prints[i]! })) },
      },
    });
    if (input.audit) {
      await writeAudit(tx, input.audit, {
        action: 'cash.import_staged',
        objectType: 'cash_statement_import',
        objectId: imp.id,
        after: { ref, ledger: ledger.ref, filename: input.filename, lines: parsed.lines.length, opening: opening.toFixed(2), closing: closing.toFixed(2), from: isoDay(from), to: isoDay(to), source: 'custodian' },
      });
      await notifyPermission(tx, 'cash.journal.approve', { type: 'cash.import_staged', title: `Statement ${ref} awaits commit`, body: `${ledger.name} ${isoDay(from)} to ${isoDay(to)}`, link: `/ops/cash?import=${imp.id}` });
    }
    return imp;
  });
}
