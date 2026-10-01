import { Router } from 'express';
import type { LpReport } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { day, lpOk } from '../lp.http';
import { queryFund } from '../services/common';
import { docCategory, lpDocInclude, lpDocWhere, sendDocument } from '../services/documents';
import { loadPositions } from '../services/positions';

/** Domain `reports`: legacy thin reports list (WS1), backed by published report/statement documents. */
export const lpReportsRoutes = Router();

const REPORT_CATEGORIES = new Set(['PERFORMANCE_REPORT', 'QUARTERLY_STATEMENT']);

function periodBounds(period: string | null, year: number | null) {
  const q = period?.match(/^(\d{4})-Q([1-4])$/);
  if (q) {
    const y = Number(q[1]);
    const n = Number(q[2]);
    return { start: `${y}-${String(n * 3 - 2).padStart(2, '0')}-01`, end: day(new Date(Date.UTC(y, n * 3, 0))) };
  }
  const y = year ?? (period && /^\d{4}$/.test(period) ? Number(period) : null);
  return y ? { start: `${y}-01-01`, end: `${y}-12-31` } : { start: '', end: '' };
}

lpReportsRoutes.get('/reports', requireLp('lp.documents.view'), async (req, res) => {
  const ctx = lp(req);
  const fundId = queryFund(req, ctx);
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const docs = (await prisma.document.findMany({ where: lpDocWhere(ctx, fundId), include: lpDocInclude(ctx), orderBy: { createdAt: 'desc' } })).filter((d) =>
    REPORT_CATEGORIES.has(docCategory(d)),
  );
  const positions = await loadPositions(ctx);
  const byFund = new Map(positions.map((p) => [p.fund.id, p]));
  const n = (v: string | null) => (v === null ? 0 : Number(v));
  const all: LpReport[] = docs.map((d) => {
    const p = d.fundId ? byFund.get(d.fundId) : undefined;
    const { start, end } = periodBounds(d.period, d.year);
    const delivered = d.publications[0]?.publishedAt ?? d.createdAt;
    return {
      jobId: d.id,
      runId: d.ref,
      fundName: p?.fund.name ?? d.relatedLabel ?? '',
      templateName: docCategory(d) === 'PERFORMANCE_REPORT' ? 'Fund performance report' : 'Quarterly statement',
      reportLevel: d.fundId ? 'FUND' : 'CLIENT',
      periodStart: start,
      periodEnd: end,
      status: 'DELIVERED',
      deliveredAt: delivered.toISOString(),
      transportMethod: 'PORTAL',
      metrics: {
        dpi: n(p?.dpi ?? null),
        nav: p ? Number(p.nav.toFixed(2)) : 0,
        rvpi: n(p?.rvpi ?? null),
        tvpi: n(p?.tvpi ?? null),
        fundId: d.fundId ?? '',
        netIrr: n(p?.netIrr ?? null),
        clientId: ctx.client.id,
        fundName: p?.fund.name ?? '',
        periodEnd: end,
        lpLegalName: ctx.client.name,
        periodStart: start,
        totalPaidIn: p ? Number(p.paidIn.toFixed(2)) : 0,
        currencyCode: p?.fund.currency ?? ctx.client.baseCurrency,
        holdingsSummary: '',
        totalCommitment: p ? Number(p.committed.toFixed(2)) : 0,
        totalDistributions: p ? Number(p.distributions.toFixed(2)) : 0,
        unfundedCommitment: p ? Math.max(0, Number(p.committed.sub(p.called).toFixed(2))) : 0,
      },
    };
  });
  const total = all.length;
  lpOk(req, res, {
    data: all.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  });
});

lpReportsRoutes.get('/reports/:jobId/download', requireLp('lp.documents.download'), async (req, res) => {
  await sendDocument(req, res, lp(req), param(req, 'jobId'), 'download', (data) => lpOk(req, res, data));
});
