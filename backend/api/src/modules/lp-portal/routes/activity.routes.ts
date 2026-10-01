import { Router, type Request } from 'express';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { LpError, lpOk, lpPaginate, pageOf } from '../lp.http';
import { lpAudit, queryFund, str } from '../services/common';
import { workbook } from '../../../lib/xlsx';
import { ledgerEntries, ledgerEntry, toCsv, type ActivityFilter } from '../services/activity';

/** Domain `activity`: account activity and ledger (WS1). */
export const lpActivityRoutes = Router();

function dateParam(req: Request, key: string) {
  const v = str(req.query[key]);
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw LpError.validation(`${key} must be YYYY-MM-DD`, { [key]: 'Use YYYY-MM-DD' });
  return v;
}

function filter(req: Request): ActivityFilter {
  const ctx = lp(req);
  return { fundId: queryFund(req, ctx), from: dateParam(req, 'from'), to: dateParam(req, 'to'), currency: str(req.query.currency) };
}

lpActivityRoutes.get('/account-activity', requireLp('lp.activity.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  lpOk(req, res, lpPaginate(await ledgerEntries(lp(req), filter(req)), page, pageSize));
});

lpActivityRoutes.get('/account-activity/export', requireLp('lp.activity.export'), async (req, res) => {
  const format = (str(req.query.format) ?? 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'xlsx') throw new LpError(415, 'LP_UNSUPPORTED_MEDIA', 'Export format must be csv or xlsx');
  const ctx = lp(req);
  const f = filter(req);
  const entries = await ledgerEntries(ctx, f);
  await prisma.$transaction((tx) =>
    writeAudit(tx, lpAudit(req), { action: 'lp_activity.exported', objectType: 'client', objectId: ctx.client.id, after: { ...f, rows: entries.length, format } }),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  if (format === 'xlsx') {
    const header = ['entryId', 'transactionDate', 'entryType', 'fundName', 'description', 'amount', 'currency', 'status'];
    const rows = entries.map((e) => [e.entryId, e.transactionDate, e.entryType, e.fundName, e.description, e.amount, e.currency, e.status]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="account-activity-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(workbook('Account activity', [header, ...rows]));
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="account-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(toCsv(entries));
});

lpActivityRoutes.get('/ledger', requireLp('lp.capital_account.view'), async (req, res) => {
  lpOk(req, res, await ledgerEntries(lp(req), filter(req)));
});

lpActivityRoutes.get('/ledger/:entryId', requireLp('lp.capital_account.view'), async (req, res) => {
  lpOk(req, res, await ledgerEntry(lp(req), param(req, 'entryId')));
});
