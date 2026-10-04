import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { param } from '../../../lib/http';
import { lp, requireLp } from '../lp.context';
import { lpOk } from '../lp.http';
import { asRecord, dateQuery, enumQuery, queryFund, str } from '../services/common';
import { assertFund } from '../lp.context';
import { cancelPerformanceJob, createPerformanceJob, getBenchmarks, getByFund, getHistory, getJob, getPerformance } from '../services/performance';
import { latestAsOf, loadPositions } from '../services/positions';

/** Domain `performance` (+ report jobs) (WS1). */
export const lpPerformanceRoutes = Router();

const PERIODS = ['SI', '1Y', '3Y', '5Y', '10Y', 'MAX', 'YTD'] as const;
const periodOf = (v: unknown, field = 'period') => enumQuery(v, field, PERIODS) ?? 'SI';

lpPerformanceRoutes.get('/performance', requireLp('lp.performance.view'), async (req, res) => {
  const ctx = lp(req);
  lpOk(req, res, await getPerformance(ctx, queryFund(req, ctx), periodOf(req.query.period)));
});

lpPerformanceRoutes.get('/performance/history', requireLp('lp.performance.view'), async (req, res) => {
  const ctx = lp(req);
  lpOk(req, res, await getHistory(ctx, queryFund(req, ctx), periodOf(req.query.range ?? req.query.period, req.query.range !== undefined ? 'range' : 'period')));
});

lpPerformanceRoutes.get('/performance/by-fund', requireLp('lp.performance.view'), async (req, res) => {
  lpOk(req, res, await getByFund(lp(req)));
});

lpPerformanceRoutes.get('/performance/benchmarks', requireLp('lp.performance.view'), async (req, res) => {
  const ctx = lp(req);
  dateQuery(req.query.asOfDate, 'asOfDate');
  const { asOfDate } = latestAsOf(await loadPositions(ctx));
  lpOk(req, res, await getBenchmarks((str(req.query.metric) ?? 'NET_IRR').toUpperCase().slice(0, 32), (str(req.query.benchmarkId) ?? 'CAMBRIDGE').toUpperCase().slice(0, 32), asOfDate));
});

lpPerformanceRoutes.get('/performance/report/download', requireLp('lp.performance.download_report'), async (req, res) => {
  const ctx = lp(req);
  lpOk(req, res, await createPerformanceJob(req, ctx, { fundId: queryFund(req, ctx), period: periodOf(req.query.period), benchmarkId: str(req.query.benchmarkId)?.toUpperCase().slice(0, 32), asOfDate: dateQuery(req.query.asOfDate, 'asOfDate') }));
});

lpPerformanceRoutes.post(
  '/jobs/performance-report',
  requireLp('lp.performance.download_report'),
  idempotent('lp.performance.report', { required: false }),
  async (req, res) => {
    const ctx = lp(req);
    const b = asRecord(req.body);
    const fundId = str(b.fundId);
    if (fundId && fundId !== 'all') assertFund(ctx, fundId);
    lpOk(req, res, await createPerformanceJob(req, ctx, { fundId: fundId === 'all' ? undefined : fundId, period: periodOf(b.period), benchmarkId: str(b.benchmarkId)?.toUpperCase().slice(0, 32), asOfDate: dateQuery(b.asOfDate, 'asOfDate') }), undefined, 202);
  },
);

lpPerformanceRoutes.get('/jobs/:jobId', requireLp('lp.performance.view'), async (req, res) => {
  lpOk(req, res, await getJob(lp(req), param(req, 'jobId')));
});

lpPerformanceRoutes.post('/jobs/:jobId/cancel', requireLp('lp.performance.download_report'), async (req, res) => {
  lpOk(req, res, await cancelPerformanceJob(req, lp(req), param(req, 'jobId')), 'Report cancelled');
});
