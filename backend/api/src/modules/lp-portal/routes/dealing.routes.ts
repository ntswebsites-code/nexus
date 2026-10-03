import { Router, type Request } from 'express';
import type { ZodType } from 'zod';
import { lpRedemptionEstimateSchema, lpSubmitDealingSchema, lpSubscriptionEstimateSchema } from '@matanho/shared';
import { idempotent } from '../../../lib/idempotency';
import { requireStepUp } from '../../../middleware/requireAuth';
import { uploadFiles } from '../../../middleware/upload';
import { lp, requireLp, requireLpRole } from '../lp.context';
import { dateQuery } from '../services/common';
import { LpError, lpList, lpOk, pageOf } from '../lp.http';
import {
  bankAccounts,
  estimateRedemption,
  estimateSubscription,
  exportRequests,
  exportRequestsXlsx,
  listRequests,
  overview,
  rules,
  submitRedemption,
  submitSubscription,
} from '../services/dealing';
import { requireFeature } from '../../../middleware/feature';

/** Domain `dealing`: subscriptions and redemptions (WS2, after J3). */
export const lpDealingRoutes = Router();

const str = (v: unknown) => (typeof v === 'string' && v && v !== 'all' ? v : undefined);

/** JSON or multipart (string fields): drop empty strings, coerce booleans, validate. */
function parse<T>(schema: ZodType<T>, req: Request): T {
  const raw = Object.fromEntries(
    Object.entries((req.body ?? {}) as Record<string, unknown>)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined)
      .map(([k, v]) => [k, v === 'true' ? true : v === 'false' ? false : typeof v === 'number' && ['amount', 'units'].includes(k) ? String(v) : v]),
  );
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw LpError.validation('Check the highlighted fields', Object.fromEntries(result.error.issues.map((i) => [i.path.join('.') || '_', i.message])));
  }
  return result.data;
}

lpDealingRoutes.get('/dealing/bank-accounts', requireLp('lp.dealing.view'), async (req, res) => {
  lpOk(req, res, await bankAccounts(lp(req), str(req.query.fundId)));
});

lpDealingRoutes.get('/dealing/overview', requireLp('lp.dealing.view'), async (req, res) => {
  lpOk(req, res, await overview(lp(req), str(req.query.fundId)));
});

lpDealingRoutes.get('/dealing/rules', requireLp('lp.dealing.view'), async (req, res) => {
  lpOk(req, res, await rules(lp(req), str(req.query.fundId)));
});

lpDealingRoutes.get('/dealing/requests', requireLp('lp.dealing.view'), async (req, res) => {
  const { page, pageSize } = pageOf(req);
  const { items, total } = await listRequests(lp(req), { fundId: str(req.query.fundId), type: str(req.query.type), status: str(req.query.status), page, pageSize });
  lpOk(req, res, lpList(items, page, pageSize, total));
});

lpDealingRoutes.get('/dealing/requests/export', requireLp('lp.dealing.view'), async (req, res) => {
  const format = (str(req.query.format) ?? 'csv').toLowerCase();
  const query = { fundId: str(req.query.fundId), type: str(req.query.type) };
  if (format === 'xlsx') {
    const body = await exportRequestsXlsx(req, lp(req), query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="dealing-requests.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
    return;
  }
  if (format !== 'csv') throw new LpError(415, 'LP_UNSUPPORTED_MEDIA', 'Export format must be csv or xlsx');
  const csv = await exportRequests(req, lp(req), query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="dealing-requests.csv"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});

lpDealingRoutes.post('/dealing/subscriptions/estimate', requireLp('lp.dealing.estimate'), async (req, res) => {
  lpOk(req, res, await estimateSubscription(lp(req), parse(lpSubscriptionEstimateSchema, req)));
});

lpDealingRoutes.post(
  '/dealing/subscriptions',
  requireLp('lp.dealing.subscribe'),
  requireFeature('feature.lp_dealing'),
  requireLpRole('SIGNATORY'),
  requireStepUp,
  uploadFiles('files', 5),
  idempotent('lp.dealing.subscribe'),
  async (req, res) => {
    lpOk(req, res, await submitSubscription(req, lp(req), parse(lpSubmitDealingSchema, req)), 'Subscription submitted', 201);
  },
);

lpDealingRoutes.post('/dealing/redemptions/estimate', requireLp('lp.dealing.estimate'), async (req, res) => {
  lpOk(req, res, await estimateRedemption(lp(req), parse(lpRedemptionEstimateSchema, req)));
});

lpDealingRoutes.post(
  '/dealing/redemptions',
  requireLp('lp.dealing.redeem'),
  requireFeature('feature.lp_dealing'),
  requireLpRole('SIGNATORY'),
  requireStepUp,
  idempotent('lp.dealing.redeem'),
  async (req, res) => {
    const body = parse(lpSubmitDealingSchema, req) as Parameters<typeof submitRedemption>[2];
    const extra = req.body as { full?: unknown; earliestDealingDate?: unknown };
    lpOk(
      req,
      res,
      await submitRedemption(req, lp(req), {
        ...body,
        full: extra.full === true || extra.full === 'true',
        earliestDealingDate: dateQuery(extra.earliestDealingDate, 'earliestDealingDate'),
      }),
      'Redemption submitted',
      201,
    );
  },
);
