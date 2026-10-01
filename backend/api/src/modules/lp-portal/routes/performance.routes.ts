import { Router } from 'express';
import { idempotent } from '../../../lib/idempotency';
import { requireLp } from '../lp.context';
import { lpStubNotLive } from '../lp.http';

/** Domain `performance` (+ report jobs) (WS1). */
export const lpPerformanceRoutes = Router();

lpPerformanceRoutes.get('/performance', requireLp('lp.performance.view'), lpStubNotLive);
lpPerformanceRoutes.get('/performance/history', requireLp('lp.performance.view'), lpStubNotLive);
lpPerformanceRoutes.get('/performance/by-fund', requireLp('lp.performance.view'), lpStubNotLive);
lpPerformanceRoutes.get('/performance/benchmarks', requireLp('lp.performance.view'), lpStubNotLive);
lpPerformanceRoutes.get('/performance/report/download', requireLp('lp.performance.download_report'), lpStubNotLive);
lpPerformanceRoutes.post(
  '/jobs/performance-report',
  requireLp('lp.performance.download_report'),
  idempotent('lp.performance.report', { required: false }),
  lpStubNotLive,
);
lpPerformanceRoutes.get('/jobs/:jobId', requireLp('lp.performance.view'), lpStubNotLive);
