import { Router, type Request } from 'express';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { LpError, lpOk, lpPaginate, pageOf } from '../lp.http';
import { lpAudit, queryFund, str } from '../services/common';
import { workbook } from '../../../lib/xlsx';
import { ACTIVITY_EXPORT_HEADER, ACTIVITY_SORTS, activityExportRow, ledgerEntries, ledgerEntry, toCsv, withFx, type ActivityFilter } from '../services/activity';
import { enumQuery } from '../services/common';
import { presentationCurrencyOf } from '../services/fx';
import { renderStatementPdf } from '../services/statement-pdf';

/** Domain `activity`: account activity and ledger (WS1). */
export const lpActivityRoutes = Router();

function dateParam(req: Request, key: string) {
  const v = str(req.query[key]);
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw LpError.validation(`${key} must be YYYY-MM-DD`, { [key]: 'Use YYYY-MM-DD' });
  return v;
}

function filter(req: Request): ActivityFilter {
  const ctx = lp(req);
  const sortBy = str(req.query.sortBy);
  const sortKey = sortBy ? ACTIVITY_SORTS.find((k) => k.toLowerCase() === sortBy.toLowerCase()) : undefined;
  if (sortBy && !sortKey) throw LpError.validation('sortBy is not valid', { sortBy: `Use one of ${ACTIVITY_SORTS.join(', ')}` });
  const sortDirection = enumQuery(req.query.sortDirection, 'sortDirection', ['ASC', 'DESC'] as const);
  return {
    fundId: queryFund(req, ctx),
    from: dateParam(req, 'from'),
    to: dateParam(req, 'to'),
    currency: str(req.query.currency),
    sortBy: sortKey,
    ...(sortDirection ? { sortDirection: sortDirection.toLowerCase() as 'asc' | 'desc' } : {}),
  };
}

lpActivityRoutes.get('/account-activity', requireLp('lp.activity.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  lpOk(req, res, lpPaginate(await withFx(lp(req), await ledgerEntries(lp(req), filter(req))), page, pageSize));
});

lpActivityRoutes.get('/account-activity/export', requireLp('lp.activity.export'), async (req, res) => {
  const format = (str(req.query.format) ?? 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') throw new LpError(415, 'LP_UNSUPPORTED_MEDIA', 'Export format must be csv, xlsx or pdf');
  const ctx = lp(req);
  const f = filter(req);
  const entries = await withFx(ctx, await ledgerEntries(ctx, f));
  await prisma.$transaction((tx) =>
    writeAudit(tx, lpAudit(req), { action: 'lp_activity.exported', objectType: 'client', objectId: ctx.client.id, after: { ...f, rows: entries.length, format } }),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  if (format === 'xlsx') {
    const header = ACTIVITY_EXPORT_HEADER;
    const rows = entries.map(activityExportRow);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="account-activity-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(workbook('Account activity', [header, ...rows]));
    return;
  }
  if (format === 'pdf') {
    const target = await presentationCurrencyOf(ctx);
    const pdf = renderStatementPdf({
      clientName: ctx.client.name,
      title: 'Account activity',
      subtitle: `${f.from ?? 'Start'} to ${f.to ?? new Date().toISOString().slice(0, 10)}  |  ${entries.length} entries`,
      currency: target,
      kpis: [],
      summary: [],
      table: {
        heading: 'Entries',
        columns: [
          { label: 'Date', width: 62 },
          { label: 'Type', width: 92 },
          { label: 'Fund', width: 120 },
          { label: 'Amount', align: 'right', width: 76 },
          { label: 'Ccy', width: 30 },
          { label: 'Status', width: 60 },
          { label: `In ${target}`, align: 'right', width: 71 },
        ],
        rows: entries.slice(0, 500).map((e) => [e.transactionDate, e.entryType.replace(/_/g, ' ').toLowerCase(), e.fundName, e.amount, e.currency, e.status.toLowerCase(), e.reportingAmount ?? '-']),
      },
      footnote: 'Original amounts keep their currency. Converted amounts use the FX rate stamped on each record at its transaction date.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Content-Disposition', `attachment; filename="account-activity-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.status(200).send(pdf);
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="account-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(toCsv(entries));
});

lpActivityRoutes.get('/ledger', requireLp('lp.capital_account.view'), async (req, res) => {
  lpOk(req, res, await withFx(lp(req), await ledgerEntries(lp(req), filter(req))));
});

lpActivityRoutes.get('/ledger/:entryId', requireLp('lp.capital_account.view'), async (req, res) => {
  lpOk(req, res, await ledgerEntry(lp(req), param(req, 'entryId')));
});
