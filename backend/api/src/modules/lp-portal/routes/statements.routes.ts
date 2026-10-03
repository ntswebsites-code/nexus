import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { LpError, lpOk } from '../lp.http';
import { asRecord, jsonDec, lpAudit, queryFund, VISIBLE_CALL_STATUSES, VISIBLE_DISTRIBUTION_STATUSES } from '../services/common';
import { fixed, latestAsOf, loadPositions } from '../services/positions';
import { renderStatementPdf } from '../services/statement-pdf';

/**
 * Investor statements (GAP-017). `GET /statements` lists the quarters that can be produced (the last eight quarter
 * ends up to the latest published as-of date) and `GET /statements/:period/download` renders the PDF on demand from
 * platform records: capital called and distributed inside the quarter, plus the closing position (taken from the
 * stored history when it holds a point on or before the quarter end, otherwise the latest published position).
 * Every download is audited with user, client, fund and period.
 */
export const lpStatementsRoutes = Router();

const ZERO = new Prisma.Decimal(0);

export interface QuarterRange {
  period: string;
  start: string;
  end: string;
}

export function parseQuarter(period: string): QuarterRange | null {
  const m = period.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const y = Number(m[1]);
  const q = Number(m[2]);
  return { period, start: new Date(Date.UTC(y, q * 3 - 3, 1)).toISOString().slice(0, 10), end: new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10) };
}

/** The `count` quarters ending with the one that contains `date` (ISO), newest first. */
export function quartersUpTo(date: string, count = 8): QuarterRange[] {
  const m = date.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return [];
  let y = Number(m[1]);
  let q = Math.floor((Number(m[2]) - 1) / 3) + 1;
  const out: QuarterRange[] = [];
  for (let i = 0; i < count; i++) {
    out.push(parseQuarter(`${y}-Q${q}`)!);
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

const grouped = (v: string) => {
  const [int, frac] = v.replace(/^-/, '').split('.');
  return `${v.startsWith('-') ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
};

lpStatementsRoutes.get('/statements', requireLp('lp.documents.view'), async (req, res) => {
  const ctx = lp(req);
  const positions = await loadPositions(ctx, queryFund(req, ctx));
  const { asOfDate } = latestAsOf(positions);
  const items = quartersUpTo(asOfDate).map((q) => ({
    period: q.period,
    periodStart: q.start,
    periodEnd: q.end,
    downloadUrl: `/api/v1/lp-portal/statements/${q.period}/download`,
    format: 'PDF',
  }));
  lpOk(req, res, { asOfDate, items });
});

lpStatementsRoutes.get('/statements/:period/download', requireLp('lp.documents.download'), async (req, res) => {
  const ctx = lp(req);
  const range = parseQuarter(param(req, 'period').toUpperCase());
  if (!range) throw LpError.validation('Period must look like 2026-Q2', { period: 'Use YYYY-Qn' });
  const fundId = queryFund(req, ctx);
  const positions = await loadPositions(ctx, fundId);
  const { asOfDate } = latestAsOf(positions);
  if (asOfDate && range.start > asOfDate) throw LpError.validation('No published valuation covers that period yet', { period: 'Later than the latest as-of date' });
  const from = new Date(`${range.start}T00:00:00.000Z`);
  const to = new Date(`${range.end}T23:59:59.999Z`);
  const ids = positions.map((p) => p.fund.id);

  const [calls, dists] = await Promise.all([
    ids.length
      ? prisma.capitalCallAllocation.findMany({
          where: { clientId: ctx.client.id, status: { not: 'CANCELLED' }, call: { fundId: { in: ids }, status: { in: VISIBLE_CALL_STATUSES }, issuedAt: { gte: from, lte: to } } },
          select: { callAmount: true, call: { select: { fundId: true } } },
        })
      : [],
    ids.length
      ? prisma.distributionAllocation.findMany({
          where: { clientId: ctx.client.id, status: { not: 'CANCELLED' }, distribution: { fundId: { in: ids }, status: { in: VISIBLE_DISTRIBUTION_STATUSES }, distributionDate: { gte: from, lte: to } } },
          select: { amountPaid: true, distribution: { select: { fundId: true } } },
        })
      : [],
  ]);

  const rows = positions.map((p) => {
    const called = calls.filter((c) => c.call.fundId === p.fund.id).reduce((a, c) => a.add(c.callAmount), ZERO);
    const distributed = dists.filter((d) => d.distribution.fundId === p.fund.id).reduce((a, d) => a.add(d.amountPaid), ZERO);
    const hist = (Array.isArray(p.metrics.history) ? p.metrics.history : [])
      .map((h) => asRecord(h))
      .filter((h) => typeof h.date === 'string' && (h.date as string).slice(0, 10) <= range.end)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .at(-1);
    const nav = hist ? (jsonDec(hist.nav) ?? fixed(p.nav)) : fixed(p.nav);
    const paidIn = hist ? (jsonDec(hist.paidIn) ?? fixed(p.paidIn)) : fixed(p.paidIn);
    return { p, called, distributed, nav: new Prisma.Decimal(nav), paidIn: new Prisma.Decimal(paidIn) };
  });
  const currencies = new Set(rows.map((r) => r.p.fund.currency));
  const ccy = currencies.size === 1 ? [...currencies][0]! : '';
  const sum = (f: (r: (typeof rows)[number]) => Prisma.Decimal) => (ccy ? `${ccy} ${grouped(rows.reduce((a, r) => a.add(f(r)), ZERO).toFixed(2))}` : 'Multiple currencies');

  const pdf = renderStatementPdf({
    clientName: ctx.client.name,
    title: 'Investor statement',
    subtitle: `${range.period.replace('-', ' ')}  |  ${range.start} to ${range.end}`,
    currency: ccy,
    kpis: [
      { label: 'Called in period', value: sum((r) => r.called) },
      { label: 'Distributed', value: sum((r) => r.distributed) },
      { label: 'Closing NAV', value: sum((r) => r.nav) },
    ],
    summary: [
      { label: 'Investor', value: ctx.client.name },
      { label: 'Statement period', value: `${range.start} to ${range.end}` },
      { label: 'Funds included', value: String(rows.length) },
      { label: 'Latest published valuation date', value: asOfDate || '-' },
    ],
    table: {
      heading: 'Funds',
      columns: [
        { label: 'Fund', width: 150 },
        { label: 'Called', align: 'right', width: 80 },
        { label: 'Distributed', align: 'right', width: 80 },
        { label: 'Paid in', align: 'right', width: 90 },
        { label: 'NAV', align: 'right', width: 93 },
      ],
      rows: rows.map((r) => [`${r.p.fund.name} (${r.p.fund.currency})`, grouped(r.called.toFixed(2)), grouped(r.distributed.toFixed(2)), grouped(r.paidIn.toFixed(2)), grouped(r.nav.toFixed(2))]),
    },
    footnote: 'Called and distributed amounts fall inside the period; paid-in and NAV are the closing position. This statement does not create a new valuation.',
  });

  const label = fundId ? (positions[0]?.fund.shortName ?? positions[0]?.fund.ref ?? 'fund') : 'all-funds';
  const filename = `statement-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${range.period.toLowerCase()}.pdf`;
  await prisma.$transaction((tx) =>
    writeAudit(tx, lpAudit(req), {
      action: 'lp_statement.downloaded',
      objectType: 'client',
      objectId: ctx.client.id,
      after: { period: range.period, fundId: fundId ?? null, clientId: ctx.client.id, userId: ctx.userId },
    }),
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.length));
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(pdf);
});
