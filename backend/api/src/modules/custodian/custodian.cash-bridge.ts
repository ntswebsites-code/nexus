import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { dayFromIso, isoDay, sha256 } from '../../integrations/common';
import { parseStatement } from '../cash/cash.engine';
import { resolveBankLedgerForAccount, stageStatementImport } from '../cash/cash.stage-import';
import { recordCounterpartImport } from '../recon/recon.imports';
import { accountRefs } from './custodian.service';

export type CamtCheckRow = {
  accountRef: string;
  statementDate: string;
  currency: string | null;
  closingCash: string | null;
  holdings: number;
  holdingsMv: string;
  trades: number;
  newTrades: number;
  duplicateTrades: number;
  warnings: string[];
  cashImportLedger?: string;
  cashImportLines?: number;
};

export function isCamtStatement(content: string, format?: string) {
  return format === 'CAMT053' || /camt\.053/i.test(content);
}

export async function checkCamtStatement(counterpartyId: string, accounts: string[], content: string) {
  const parsed = parseStatement('CAMT053', content, {});
  const problems = [...parsed.errors];
  const accountRef = parsed.accountRef?.trim() || null;
  if (!accountRef) problems.push('CAMT statement does not identify an account reference');
  else if (!accounts.includes(accountRef)) problems.push(`Account ${accountRef} is not serviced by your organisation`);
  const ledger = accountRef ? await resolveBankLedgerForAccount(counterpartyId, accountRef) : null;
  if (accountRef && !ledger) problems.push(`Account ${accountRef} is not mapped to a bank ledger; add it in the Reconciliation account map`);
  if (ledger && parsed.currency && parsed.currency !== ledger.currency) problems.push(`Statement currency ${parsed.currency} does not match ledger ${ledger.ref} (${ledger.currency})`);

  const dates = parsed.lines.map((l) => l.valueDate.getTime());
  const statementDate = dates.length ? isoDay(new Date(Math.max(...dates))) : isoDay(new Date());
  const warnings: string[] = [];
  if (ledger) warnings.push(`Will stage cash import on ledger ${ledger.ref} for admin recon`);

  const row: CamtCheckRow = {
    accountRef: accountRef ?? '',
    statementDate,
    currency: parsed.currency,
    closingCash: parsed.closing?.toFixed(2) ?? null,
    holdings: 0,
    holdingsMv: '0.00',
    trades: parsed.lines.length,
    newTrades: parsed.lines.length,
    duplicateTrades: 0,
    warnings,
    ...(ledger ? { cashImportLedger: ledger.ref, cashImportLines: parsed.lines.length } : {}),
  };
  return { format: 'CAMT053' as const, statements: accountRef ? [row] : [], problems };
}

export interface CamtIngestResult {
  fileId: string;
  status: 'Imported';
  format: 'CAMT053';
  cashImportRef: string;
  cashImportId: string;
  statements: CamtCheckRow[];
  warnings: string[];
}

export async function ingestCamtStatement(input: {
  counterpartyId: string;
  filename: string;
  content: string;
  userId: string;
  audit: AuditContext;
  adapter?: string;
}): Promise<CamtIngestResult> {
  const cp = await prisma.counterparty.findUniqueOrThrow({ where: { id: input.counterpartyId }, select: { accounts: true } });
  const checked = await checkCamtStatement(input.counterpartyId, accountRefs(cp.accounts), input.content);
  if (checked.problems.length) throw new HttpError(422, 'statement_rejected', checked.problems.slice(0, 3).join('; '), { problems: checked.problems, statements: checked.statements });

  const accountRef = checked.statements[0]!.accountRef;
  const ledger = await resolveBankLedgerForAccount(input.counterpartyId, accountRef);
  if (!ledger) throw HttpError.conflict(`Account ${accountRef} has no bank ledger mapping`, 'ledger_not_mapped');

  const digest = sha256(input.content);
  const dup = await prisma.custodianFeedFile.findUnique({ where: { counterpartyId_sha256: { counterpartyId: input.counterpartyId, sha256: digest } } });
  if (dup?.status === 'Imported') throw HttpError.conflict(`This file was already imported as ${dup.filename} on ${isoDay(dup.createdAt)}`, 'duplicate_file');

  const imp = await stageStatementImport({ ledgerId: ledger.id, filename: input.filename, format: 'CAMT053', content: input.content, makerId: input.userId, audit: input.audit });
  const parsed = parseStatement('CAMT053', input.content, {});
  const statementDate = checked.statements[0]!.statementDate;

  const result = await prisma.$transaction(async (tx) => {
    const file = await tx.custodianFeedFile.upsert({
      where: { counterpartyId_sha256: { counterpartyId: input.counterpartyId, sha256: digest } },
      create: {
        counterpartyId: input.counterpartyId,
        adapter: input.adapter ?? 'file-drop',
        filename: input.filename,
        format: 'CAMT053',
        sha256: digest,
        status: 'Imported',
        uploadedBy: input.userId,
        accountRef,
        statementDate: dayFromIso(statementDate),
        currency: parsed.currency,
        closingCash: parsed.closing,
        warnings: [`Cash import ${imp.ref} staged for admin recon on ledger ${ledger.ref}`],
      },
      update: { status: 'Imported', error: null, filename: input.filename, format: 'CAMT053', accountRef, statementDate: dayFromIso(statementDate), currency: parsed.currency, closingCash: parsed.closing, warnings: [`Cash import ${imp.ref} staged for admin recon on ledger ${ledger.ref}`] },
    });
    await recordCounterpartImport(tx, {
      source: 'CONNECTOR',
      connector: input.adapter ?? 'file-drop',
      feed: 'STATEMENT',
      counterpartyId: input.counterpartyId,
      accountRef,
      asOfDate: dayFromIso(statementDate),
      filename: input.filename,
      format: 'CAMT053',
      recordCount: parsed.lines.length,
      sha256: digest,
      fileId: file.id,
      note: `CAMT bank statement → ${imp.ref}`,
      createdBy: input.userId,
    });
    await writeAudit(tx, input.audit, {
      action: 'custodian.statement.uploaded',
      objectType: 'custodian_feed_file',
      objectId: file.id,
      after: { filename: input.filename, format: 'CAMT053', cashImportRef: imp.ref, ledger: ledger.ref, accountRef },
    });
    return file;
  });

  return {
    fileId: result.id,
    status: 'Imported',
    format: 'CAMT053',
    cashImportRef: imp.ref,
    cashImportId: imp.id,
    statements: checked.statements,
    warnings: [`Cash import ${imp.ref} staged on ledger ${ledger.ref}`],
  };
}
