import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextCustodianRef } from '../../modules/custodian/custodian.service';
import { recordCounterpartImport } from '../../modules/recon/recon.imports';
import { dayFromIso, isoDay, sha256 } from '../common';
import { StatementParseError, parseStatements } from './parsers';
import type { CustodianFeedAdapter, FeedHolding, FeedStatement, FeedTransaction, ListStatementsQuery, ParsedStatement } from './types';

/**
 * File-drop custodian feed: staff upload a statement file (CSV, MT940-like or JSON); it is parsed strictly and loaded
 * into the tables the Reconciliation module already reads:
 *   trades    -> counterparty_executions (status Received, ref CEX-, unique per counterparty + trade reference)
 *   cash/MV   -> counterparty_day_end_packages (ref CDE-; an earlier package for the same account and date is Superseded)
 *   holdings  -> custodian_feed_holdings (line detail; the day-end package only keeps the total)
 * Re-uploading identical content is refused (sha-256 per counterparty); re-sent trade references are skipped.
 */

export interface IngestResult {
  fileId: string;
  status: 'Imported';
  format: string;
  statements: { accountRef: string; statementDate: string; tradesImported: number; tradesSkipped: number; holdings: number; dayEndRef: string | null; warnings: string[] }[];
  warnings: string[];
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function ingestStatementFile(input: { counterpartyId: string; filename: string; content: string; format?: 'CSV' | 'MT940' | 'JSON'; userId: string; audit: AuditContext; adapter?: string }): Promise<IngestResult> {
  const cp = await prisma.counterparty.findUnique({ where: { id: input.counterpartyId } });
  if (!cp) throw HttpError.notFound('Counterparty not found');
  if (cp.status !== 'ACTIVE') throw HttpError.conflict('Counterparty is not active', 'counterparty_inactive');
  const filename = trunc(input.filename.replace(/[^\w.\- ]/g, '_'), 200) || 'statement';
  const digest = sha256(input.content);
  const dup = await prisma.custodianFeedFile.findUnique({ where: { counterpartyId_sha256: { counterpartyId: cp.id, sha256: digest } } });
  if (dup?.status === 'Imported') throw HttpError.conflict(`This file was already imported as ${dup.filename} on ${isoDay(dup.createdAt)}`, 'duplicate_file');

  let statements: ParsedStatement[];
  try {
    statements = parseStatements(input.content, input.format);
  } catch (e) {
    if (!(e instanceof StatementParseError)) throw e;
    const data = { counterpartyId: cp.id, adapter: input.adapter ?? 'file-drop', filename, format: input.format ?? 'CSV', sha256: digest, status: 'Failed', error: trunc(e.message, 500), uploadedBy: input.userId };
    await prisma.custodianFeedFile.upsert({ where: { counterpartyId_sha256: { counterpartyId: cp.id, sha256: digest } }, create: data, update: { error: data.error, filename } });
    throw new HttpError(422, 'statement_rejected', e.message, { problems: e.problems });
  }

  const accounts = new Set(statements.map((s) => s.accountRef));
  const mapped = new Set((await prisma.reconAccountMap.findMany({ where: { counterpartyId: cp.id, accountRef: { in: [...accounts] } }, select: { accountRef: true } })).map((m) => m.accountRef));
  const fileWarnings = [...accounts].filter((a) => !mapped.has(a)).map((a) => `Account ${a} is not mapped to a portfolio yet; add it in the Reconciliation account map or it will show as unmapped`);

  const result = await prisma.$transaction(
    async (tx) => {
      const file = await tx.custodianFeedFile.upsert({
        where: { counterpartyId_sha256: { counterpartyId: cp.id, sha256: digest } },
        create: { counterpartyId: cp.id, adapter: input.adapter ?? 'file-drop', filename, format: statements[0]!.format, sha256: digest, status: 'Imported', uploadedBy: input.userId },
        update: { status: 'Imported', error: null, filename, format: statements[0]!.format },
      });
      const out: IngestResult['statements'] = [];
      let tradesImported = 0;
      let tradesSkipped = 0;
      let holdingsCount = 0;
      let lastDayEnd: string | null = null;
      for (const s of statements) {
        const date = dayFromIso(s.statementDate);
        let imported = 0;
        let skipped = 0;
        for (const t of s.transactions) {
          const exists = await tx.counterpartyExecution.findUnique({ where: { counterpartyId_tradeRef: { counterpartyId: cp.id, tradeRef: t.tradeRef } }, select: { id: true } });
          if (exists) {
            skipped++;
            continue;
          }
          await tx.counterpartyExecution.create({
            data: {
              ref: await nextCustodianRef(tx, 'custodianExecution'),
              counterpartyId: cp.id,
              tradeRef: t.tradeRef,
              executionAt: new Date(t.executionAt),
              accountRef: s.accountRef,
              ticker: t.ticker,
              isin: t.isin ?? null,
              side: t.side,
              quantity: new Prisma.Decimal(t.quantity),
              price: new Prisma.Decimal(t.price),
              currency: t.currency,
              settlementDate: t.settlementDate ? dayFromIso(t.settlementDate) : null,
              note: trunc(t.note ?? `Imported from ${filename}`, 255),
              status: 'Received',
              submittedById: input.userId,
            },
          });
          imported++;
        }
        for (const h of s.holdings) {
          const data = { fileId: file.id, isin: h.isin ?? null, quantity: new Prisma.Decimal(h.quantity), price: h.price ? new Prisma.Decimal(h.price) : null, marketValue: h.marketValue ? new Prisma.Decimal(h.marketValue) : null, currency: h.currency };
          await tx.custodianFeedHolding.upsert({
            where: { counterpartyId_accountRef_statementDate_ticker: { counterpartyId: cp.id, accountRef: s.accountRef, statementDate: date, ticker: h.ticker } },
            create: { counterpartyId: cp.id, accountRef: s.accountRef, statementDate: date, ticker: h.ticker, ...data },
            update: data,
          });
        }
        let dayEndRef: string | null = null;
        const warnings = [...s.warnings];
        if (s.closingCash !== null && s.currency) {
          const mv = s.holdings.reduce((n, h) => n.add(h.marketValue ?? 0), new Prisma.Decimal(0)).toDecimalPlaces(2);
          const cash = new Prisma.Decimal(s.closingCash).toDecimalPlaces(2);
          const tradeCount = imported + skipped;
          const current = await tx.counterpartyDayEndPackage.findFirst({ where: { counterpartyId: cp.id, accountRef: s.accountRef, statementDate: date, status: { not: 'Superseded' } }, orderBy: { submittedAt: 'desc' } });
          if (current && current.closingCash.eq(cash) && current.holdingsMv.eq(mv) && current.tradeCount === tradeCount && current.currency === s.currency) {
            dayEndRef = current.ref;
          } else {
            dayEndRef = await nextCustodianRef(tx, 'custodianDayEnd');
            const created = await tx.counterpartyDayEndPackage.create({
              data: {
                ref: dayEndRef,
                counterpartyId: cp.id,
                accountRef: s.accountRef,
                statementDate: date,
                currency: s.currency,
                closingCash: cash,
                holdingsMv: mv,
                tradeCount,
                sha256: sha256(JSON.stringify({ s: s.accountRef, d: s.statementDate, cash: cash.toFixed(2), mv: mv.toFixed(2), n: tradeCount, file: digest })),
                note: `Imported from ${filename} (custodian feed)`,
                status: 'Received',
                supersedesId: current?.id ?? null,
                supersedeReason: current ? trunc(`Replaced by custodian feed file ${filename}`, 255) : null,
                submittedById: input.userId,
              },
            });
            if (current) await tx.counterpartyDayEndPackage.update({ where: { id: current.id }, data: { status: 'Superseded' } });
            void created;
          }
        }
        if (s.closingCash !== null && !s.holdings.length) warnings.push('Holdings value recorded as 0.00 because the file has no holdings lines');
        // FR-REC-017: every received statement is a counterpart_imports batch, whether staff uploaded it or a connector delivered it.
        await recordCounterpartImport(tx, {
          source: input.adapter && input.adapter !== 'file-drop' ? 'CONNECTOR' : 'MANUAL',
          connector: input.adapter ?? null,
          feed: 'STATEMENT',
          counterpartyId: cp.id,
          accountRef: s.accountRef,
          asOfDate: date,
          filename,
          format: s.format,
          recordCount: s.transactions.length + s.holdings.length,
          sha256: digest,
          createdBy: input.userId,
        });
        tradesImported += imported;
        tradesSkipped += skipped;
        holdingsCount += s.holdings.length;
        lastDayEnd = dayEndRef ?? lastDayEnd;
        out.push({ accountRef: s.accountRef, statementDate: s.statementDate, tradesImported: imported, tradesSkipped: skipped, holdings: s.holdings.length, dayEndRef, warnings });
      }
      const first = statements[0]!;
      const closing = statements.length === 1 ? first.closingCash : null;
      await tx.custodianFeedFile.update({
        where: { id: file.id },
        data: {
          accountRef: statements.length === 1 ? first.accountRef : `${statements.length} accounts`,
          statementDate: dayFromIso(first.statementDate),
          currency: first.currency,
          closingCash: closing !== null ? new Prisma.Decimal(closing) : null,
          holdingsMv: statements.length === 1 ? first.holdings.reduce((n, h) => n.add(h.marketValue ?? 0), new Prisma.Decimal(0)) : null,
          tradesImported,
          tradesSkipped,
          holdingsCount,
          dayEndRef: lastDayEnd,
          warnings: [...fileWarnings, ...out.flatMap((o) => o.warnings)] as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit(tx, input.audit, {
        action: 'custodian_feed.file.imported',
        objectType: 'custodian_feed_file',
        objectId: file.id,
        after: { counterparty: cp.ref, filename, format: first.format, sha256: digest, statements: out.map((o) => ({ account: o.accountRef, date: o.statementDate, trades: o.tradesImported, skipped: o.tradesSkipped, holdings: o.holdings, dayEnd: o.dayEndRef })) },
      });
      return { fileId: file.id, status: 'Imported' as const, format: first.format, statements: out, warnings: fileWarnings };
    },
    { timeout: 60_000 },
  );
  return result;
}

/** Adapter view over what has been uploaded so far (statement = one account and date from an imported file). */
export class FileDropCustodianFeed implements CustodianFeedAdapter {
  readonly name = 'file-drop' as const;

  async listStatements(q: ListStatementsQuery = {}): Promise<FeedStatement[]> {
    const rows = await prisma.counterpartyDayEndPackage.findMany({
      where: {
        status: { not: 'Superseded' },
        note: { startsWith: 'Imported from' },
        ...(q.counterpartyId ? { counterpartyId: q.counterpartyId } : {}),
        ...(q.accountRef ? { accountRef: q.accountRef } : {}),
        ...(q.from || q.to ? { statementDate: { gte: q.from ? dayFromIso(q.from) : undefined, lte: q.to ? dayFromIso(q.to) : undefined } } : {}),
      },
      orderBy: [{ statementDate: 'desc' }, { submittedAt: 'desc' }],
      take: q.limit ?? 50,
    });
    return rows.map((p) => ({ id: p.id, counterpartyId: p.counterpartyId, accountRef: p.accountRef, statementDate: isoDay(p.statementDate), currency: p.currency, closingCash: p.closingCash.toFixed(2), holdingsMv: p.holdingsMv.toFixed(2), tradeCount: p.tradeCount, source: 'file-drop' }));
  }

  async fetchStatement(id: string): Promise<FeedStatement | null> {
    const p = await prisma.counterpartyDayEndPackage.findUnique({ where: { id } });
    return p ? { id: p.id, counterpartyId: p.counterpartyId, accountRef: p.accountRef, statementDate: isoDay(p.statementDate), currency: p.currency, closingCash: p.closingCash.toFixed(2), holdingsMv: p.holdingsMv.toFixed(2), tradeCount: p.tradeCount, source: 'file-drop' } : null;
  }

  async fetchHoldings(id: string): Promise<FeedHolding[]> {
    const p = await prisma.counterpartyDayEndPackage.findUnique({ where: { id } });
    if (!p) return [];
    const rows = await prisma.custodianFeedHolding.findMany({ where: { counterpartyId: p.counterpartyId, accountRef: p.accountRef, statementDate: p.statementDate }, orderBy: { ticker: 'asc' } });
    return rows.map((h) => ({ accountRef: h.accountRef, statementDate: isoDay(h.statementDate), ticker: h.ticker, isin: h.isin, quantity: h.quantity.toString(), price: h.price?.toString() ?? null, marketValue: h.marketValue?.toFixed(2) ?? null, currency: h.currency }));
  }

  async fetchTransactions(id: string): Promise<FeedTransaction[]> {
    const p = await prisma.counterpartyDayEndPackage.findUnique({ where: { id } });
    if (!p) return [];
    const start = p.statementDate;
    const rows = await prisma.counterpartyExecution.findMany({
      where: { counterpartyId: p.counterpartyId, accountRef: p.accountRef, executionAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) }, status: { not: 'Superseded' } },
      orderBy: { executionAt: 'asc' },
    });
    return rows.map((e) => ({ tradeRef: e.tradeRef, executionAt: e.executionAt.toISOString(), accountRef: e.accountRef, ticker: e.ticker, isin: e.isin, side: e.side as 'BUY' | 'SELL', quantity: e.quantity.toString(), price: e.price.toString(), currency: e.currency, settlementDate: e.settlementDate ? isoDay(e.settlementDate) : null, note: e.note }));
  }
}
