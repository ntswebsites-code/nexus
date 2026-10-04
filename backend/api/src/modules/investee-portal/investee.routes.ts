import { Router, type Request, type RequestHandler } from 'express';
import type { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { policy } from '../../lib/policy';
import { actorName, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { requireAuth, requireStepUp } from '../../middleware/requireAuth';
import {
  asProfile,
  assertEditable,
  COMPANY_PROFILES,
  covenantView,
  kpiView,
  loadPeriod,
  profileCan,
  questionInclude,
  questionView,
  saveDraft,
  submitPack,
  uploadItemFiles,
} from '../company/company.service';
import { createInvitation } from '../identity/invitations';
import { saveInviteGrant, INVITE_GRANT_KEY } from '../identity/invite-grant';
import { workbook } from '../../lib/xlsx';
import {
  decline,
  investeeTermSheetView,
  loadCompanyTermSheet,
  loadExtras,
  markViewed,
  sign,
  INVESTEE_VISIBLE,
} from '../term-sheets/term-sheets.service';
import {
  declineTermSheetSchema,
  draftKindSchema,
  draftRequestSchema,
  periodKpisRequestSchema,
  replyThreadSchema,
  saveDraftSchema,
  signTermSheetSchema,
  startThreadSchema,
  submitRequestSchema,
  updateCompanySchema,
  updateLetterheadSchema,
  updateProfileSchema,
  updateSettingsSchema,
  NOTIFICATION_TYPES,
} from './investee.contract';
import { authorityText, capabilities, inv, investeeAudit, investeeContextMiddleware, packActor, requireProfile } from './investee.context';
import { investeeErrorHandler, isoDay, ok } from './investee.http';
import {
  DRAFT_SLOT,
  companyPayload,
  companyPeriods,
  contactsOf,
  dashboardView,
  financialReportView,
  flattenDraft,
  jsonValue,
  letterheadJson,
  letterheadView,
  loadReport,
  mfaEnabled,
  periodKey,
  profileView,
  reportData,
  statementAnnotations,
  statementExtras,
  statementReport,
  deriveKpis,
  flattenReportingKpis,
  reportingRequestView,
  type LetterheadJson,
} from './investee.service';
import {
  addConsent,
  applicationView,
  capTableSchema,
  capTableView,
  roundSchema,
  simulateRound,
  consentSchema,
  createRequisition,
  forecastSchema,
  forecastView,
  governanceView,
  requisitionList,
  requisitionSchema,
  requisitionTranche,
  saveCapTable,
  saveForecast,
  signatureRequests,
  uploadVaultFile,
  assertFileContentMatches,
  vaultDocuments,
} from './investee-workspace';
import { workspaceRoutes } from './workspace/workspace.routes';

/**
 * `/api/v1/investee-portal` - Investee contract facade (SRD 5D; contract: ./investee.contract.ts, D-08).
 * Paths follow the NVCCZ applicant API the company-web runtime was written against, minus the
 * `/applicant` prefix. Every route resolves the caller's active CompanyUser link once
 * (`investeeContextMiddleware`) and scopes all reads/writes to that company; ids from other
 * companies are 404. Envelope: `{ success, message, data, timestamp }`; errors add `code` + `error`.
 *
 * Live
 *   GET    /health
 *   GET    /live                                      full hydration payload for the runtime (WS6)
 *   GET    /profile                     PUT /profile  (own name only; e-mail is read-only)
 *   GET    /company                     PUT /company  (whitelisted fields; workspace administrator)
 *   GET    /letterhead                  PUT /letterhead, DELETE /letterhead, POST /letterhead/logo (administrator)
 *   GET|PUT|DELETE /portfolio-companies/:id/letterhead, POST .../logo   NVCCZ alias; :id must be the caller's company
 *   GET    /dashboard
 *   GET    /reporting/requests                        schedule (all periods, newest first)
 *   GET    /reporting/requests/:period                one period (`YYYY-MM`)
 *   PUT    /reporting/requests/:period/draft          { kpis?, notes?, version? }            edit_draft
 *   POST   /reporting/requests/:period/submit         { kpis?, notes? } pack submit          submit_pack
 *   GET    /reporting/history                         submitted/accepted/returned periods
 *   GET    /financial-reports                         ?page&limit&reportingPeriod&status&reportType
 *   GET    /financial-reports/:id                     report (= pack item) with numeric data
 *   POST   /financial-reports/:kind/draft             income-statement|balance-sheet|cash-flow|operational-kpis   edit_draft
 *   POST   /financial-reports/:id/file                multipart `file` (or `files`, up to 10)                    edit_draft
 *   GET    /financial-reports/:id/files/:fileId/download-url
 *   DELETE /financial-reports/:id/files/:fileId                                                                 edit_draft
 *   POST   /financial-reports/submit/:id              submits the pack the report belongs to                   submit_pack
 *   POST   /financial-reports/period-kpis             { periodStart, periodEnd, totalRevenue?, ... }            submit_kpis
 *   GET    /kpis                                      KPI register, per-period values, covenants
 *   GET    /settings                    PUT /settings (own notification preferences)
 *   GET    /team                                      read-only member list
 *   GET    /threads                     POST /threads { title, text, reportingPeriod? }   POST /threads/:id/messages
 *   GET    /term-sheets/my                            issued term sheets (never drafts)
 *   GET    /term-sheets/:id                           marks ISSUED -> VIEWED
 *   POST   /term-sheets/:id/sign                      sign (signing authority + MFA step-up + Idempotency-Key)
 *   POST   /term-sheets/:id/decline                   { reason } (signing authority + Idempotency-Key)
 *
 * Company workspace (settings JSON + existing documents and term sheets)
 *   GET    /application
 *   GET    /procurement                              POST /procurement                         edit_draft
 *   GET    /cap-table                                PUT  /cap-table                           edit_draft
 *   GET    /governance                               POST /governance/consents                 edit_draft
 *   GET    /forecast                                 PUT  /forecast                            edit_draft
 *   GET    /vault                                    POST /vault (multipart `file`)            edit_draft
 *   GET    /signatures                               term sheets awaiting or holding a signature
 */
export const investeePortalRoutes = Router();

investeePortalRoutes.use(requireAuth);
investeePortalRoutes.get('/health', (_req, res) => {
  res.json({ domain: 'investee-portal', live: true });
});
investeePortalRoutes.use(investeeContextMiddleware);

const notBuilt =
  (what: string): RequestHandler =>
  () => {
    throw new HttpError(501, 'not_implemented', `${what} is not available in Nexus yet`);
  };

const REPORT_TEMPLATES: Record<string, { file: string; headers: string[] }> = {
  INCOME_STATEMENT: { file: 'income-statement-template.xlsx', headers: ['periodStart', 'periodEnd', 'totalRevenue', 'costOfSales', 'grossProfit', 'operatingExpenses', 'netProfit'] },
  BALANCE_SHEET: { file: 'balance-sheet-template.xlsx', headers: ['periodEnd', 'cash', 'receivables', 'inventory', 'totalAssets', 'payables', 'borrowings', 'totalLiabilities', 'equity'] },
  CASHFLOW_STATEMENT: { file: 'cash-flow-template.xlsx', headers: ['periodStart', 'periodEnd', 'operating', 'investing', 'financing', 'cashFlowNet'] },
  OPERATIONAL_KPIS: { file: 'operational-kpis-template.xlsx', headers: ['period', 'customers', 'churnPct', 'transactionVolume', 'headcount'] },
};

investeePortalRoutes.get('/financial-reports/template/:type', requireProfile('edit_draft'), (req, res) => {
  const key = param(req, 'type').toUpperCase().replace(/-/g, '_');
  const template = REPORT_TEMPLATES[key];
  if (!template) throw new HttpError(404, 'not_found', 'Unknown report template');
  const body = workbook(key.slice(0, 31), [template.headers, template.headers.map(() => '')]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${template.file}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(body);
});
// ---------------------------------------------------------------- hydration

investeePortalRoutes.get('/live', async (req, res) => {
  const c = inv(req);
  const envelope = <T>(data: T) => ({ success: true as const, message: 'OK', data, timestamp: new Date().toISOString() });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  const [mfa, company, dashboard, periods, termSheets, application, requisitions, tranche] = await Promise.all([

    mfaEnabled(c.userId),
    companyPayload(c.company),
    dashboardView(c),
    companyPeriods(c.company.id),
    termSheetList(req),
    applicationView(c),
    requisitionList(c.company.id),
    requisitionTranche(c.company.id),
  ]);
  const items = periods.flatMap((p) => p.items.map((i) => statementReport(p, i, c.company, c.profile)));
  res.json({
    profile: envelope(profileView(user, c, mfa)),
    application: envelope(application),
    company: envelope(company),
    termSheets: envelope(termSheets),
    dashboard: envelope(dashboard),
    reportingRequests: envelope(periods.map((p) => reportingRequestView(p, c.company, c.profile))),
    financialReports: envelope({ page: 1, limit: items.length, total: items.length, items }),
    drawdown: envelope({ requisitions, tranche }),
    errors: [],
  });
});

// ---------------------------------------------------------------- profile

investeePortalRoutes.get('/profile', async (req, res) => {
  const c = inv(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  // INO-006: every active workspace the caller belongs to, so the portal can offer a company switcher.
  const [links, fund] = await Promise.all([
    prisma.companyUser.findMany({
      where: { userId: c.userId, status: 'active' },
      include: { company: { select: { ref: true, name: true, fundId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    c.company.fundId ? prisma.fund.findUnique({ where: { id: c.company.fundId }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const base = profileView(user, c, await mfaEnabled(c.userId));
  ok(res, {
    ...base,
    company: { ...base.company, fundName: fund?.name ?? null },
    companies: links.map((l) => ({ id: l.company.ref, name: l.company.name, accessProfile: asProfile(l.profile), current: l.company.ref === c.company.ref })),
  });
});

investeePortalRoutes.put('/profile', validateBody(updateProfileSchema), async (req, res) => {
  const c = inv(req);
  const body = req.body as z.infer<typeof updateProfileSchema>;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
  if (body.email !== undefined && body.email !== user.email.toLowerCase()) {
    throw HttpError.badRequest('E-mail cannot be changed here; ask your workspace administrator or Matanho', [
      { path: 'email', message: 'E-mail is read-only' },
    ]);
  }
  let updated = user;
  if (body.firstName !== undefined || body.lastName !== undefined) {
    const current = (user.name ?? '').trim().split(/\s+/);
    const first = body.firstName ?? current[0] ?? '';
    const last = body.lastName ?? current.slice(1).join(' ');
    const name = `${first} ${last}`.trim().slice(0, 120);
    updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: user.id }, data: { name } });
      await writeAudit(tx, investeeAudit(req), {
        action: 'user.profile.updated',
        objectType: 'user',
        objectId: user.id,
        before: { name: user.name },
        after: { name },
      });
      return u;
    });
  }
  ok(res, profileView(updated, c, await mfaEnabled(c.userId)), 'Profile updated');
});

// ---------------------------------------------------------------- company

investeePortalRoutes.get('/company', async (req, res) => {
  ok(res, await companyPayload(inv(req).company));
});

investeePortalRoutes.put('/company', requireProfile('manage_company'), validateBody(updateCompanySchema), async (req, res) => {
  const c = inv(req);
  const body = req.body as z.infer<typeof updateCompanySchema>;
  const company = await prisma.portfolioCompany.findUniqueOrThrow({ where: { id: c.company.id } });
  if (body.version !== undefined && body.version !== company.version) {
    throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  }
  if (body.name !== undefined && body.name !== company.name) {
    throw HttpError.badRequest('The company name is maintained by the investment team', [{ path: 'name', message: 'Read-only' }]);
  }
  if (body.registrationNumber !== undefined && body.registrationNumber !== (company.registrationNumber ?? '')) {
    throw HttpError.badRequest('The registration number is maintained by the investment team', [
      { path: 'registrationNumber', message: 'Read-only' },
    ]);
  }
  const lh = letterheadJson(company);
  const contacts = contactsOf(company);
  const primary = { ...(contacts[0] ?? {}) };
  const contactChanged = body.contactPerson !== undefined || body.contactEmail !== undefined || body.contactPhone !== undefined;
  if (body.contactPerson !== undefined) primary.name = body.contactPerson;
  if (body.contactEmail !== undefined) primary.email = body.contactEmail;
  if (body.contactPhone !== undefined) primary.phone = body.contactPhone;
  const profileChanged = body.description !== undefined || body.socialMedia !== undefined;
  const nextLh: LetterheadJson = profileChanged
    ? {
        ...lh,
        _profile: {
          ...lh._profile,
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.socialMedia !== undefined ? { socialMedia: body.socialMedia } : {}),
        },
      }
    : lh;
  const data = {
    ...(body.industry !== undefined ? { industry: body.industry || null } : {}),
    ...(body.website !== undefined ? { website: body.website || null } : {}),
    ...(body.address !== undefined ? { address: body.address || null } : {}),
    ...(body.employeeCount !== undefined ? { employees: body.employeeCount } : {}),
    ...(body.fundingStage !== undefined ? { fundingStage: body.fundingStage || null } : {}),
    ...(contactChanged ? { contacts: jsonValue([primary, ...contacts.slice(1)]) } : {}),
    ...(profileChanged ? { letterhead: jsonValue(nextLh) } : {}),
  };
  const updated = await prisma.$transaction(async (tx) => {
    const res2 = await tx.portfolioCompany.updateMany({
      where: { id: company.id, version: company.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res2.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    const after = await tx.portfolioCompany.findUniqueOrThrow({ where: { id: company.id } });
    await writeAudit(tx, investeeAudit(req), {
      action: 'company.profile.updated',
      objectType: 'portfolio_company',
      objectId: company.id,
      before: { industry: company.industry, website: company.website, address: company.address, employees: company.employees, fundingStage: company.fundingStage, contacts: contactChanged ? company.contacts : undefined },
      after: { fields: Object.keys(body).filter((k) => k !== 'version') },
    });
    return after;
  });
  ok(
    res,
    { id: updated.ref, name: updated.name, industry: updated.industry, status: updated.status, updatedAt: updated.updatedAt.toISOString(), version: updated.version },
    'Company updated',
  );
});

// ---------------------------------------------------------------- letterhead (caller's company only)

const letterheadRouter = Router({ mergeParams: true });

letterheadRouter.get('/', (req, res) => {
  ok(res, letterheadView(inv(req).company));
});

async function writeLetterhead(req: Request, next: LetterheadJson | null, action: string) {
  const c = inv(req);
  const company = await prisma.portfolioCompany.findUniqueOrThrow({ where: { id: c.company.id } });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.portfolioCompany.update({
      where: { id: company.id },
      data: { letterhead: next === null ? jsonValue({ _profile: letterheadJson(company)._profile ?? {} }) : jsonValue(next), version: { increment: 1 } },
    });
    await writeAudit(tx, investeeAudit(req), {
      action,
      objectType: 'portfolio_company',
      objectId: company.id,
      before: { letterhead: !!company.letterhead },
      after: next ? { fields: Object.keys(next).filter((k) => !k.startsWith('_')) } : { cleared: true },
    });
    return updated;
  });
}

letterheadRouter.put('/', requireProfile('manage_company'), validateBody(updateLetterheadSchema), async (req, res) => {
  const current = letterheadJson(inv(req).company);
  const now = new Date().toISOString();
  const body = req.body as z.infer<typeof updateLetterheadSchema>;
  const updated = await writeLetterhead(
    req,
    { ...current, ...body, email: body.email || null, createdAt: current.createdAt ?? now, updatedAt: now },
    'company.letterhead.updated',
  );
  ok(res, letterheadView(updated), 'Letterhead saved');
});

letterheadRouter.delete('/', requireProfile('manage_company'), async (req, res) => {
  const updated = await writeLetterhead(req, null, 'company.letterhead.deleted');
  ok(res, letterheadView(updated), 'Letterhead removed');
});

const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

letterheadRouter.post('/logo', requireProfile('manage_company'), uploadFiles('logo', 1), async (req, res) => {
  const file = uploadedFiles(req)[0] ?? null;
  if (!file) throw HttpError.badRequest('Attach a logo image in the `logo` field');
  if (!LOGO_MIMES.has(file.mimetype)) throw HttpError.badRequest('Logo must be a PNG, JPEG or WebP image');
  if (file.size > 2 * 1024 * 1024) throw new HttpError(413, 'payload_too_large', 'Logo must be 2 MB or smaller');
  assertFileContentMatches(file);
  const c = inv(req);
  const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: c.userId });
  const current = letterheadJson(c.company);
  const updated = await writeLetterhead(req, { ...current, logoFileId: stored.id, updatedAt: new Date().toISOString() }, 'company.letterhead.logo');
  ok(res, letterheadView(updated), 'Logo uploaded');
});

/** NVCCZ alias: the path id must be the caller's own company, otherwise 404 (no letterhead IDOR). */
const ownCompanyParam: RequestHandler = (req, _res, next) => {
  const c = inv(req);
  const id = param(req, 'id');
  if (id !== c.company.ref && id !== c.company.id) throw HttpError.notFound('Portfolio company not found');
  next();
};

investeePortalRoutes.use('/letterhead', letterheadRouter);
investeePortalRoutes.use('/portfolio-companies/:id/letterhead', ownCompanyParam, letterheadRouter);
investeePortalRoutes.all('/portfolio-companies/*rest', () => {
  throw HttpError.notFound('Not found');
});

// ---------------------------------------------------------------- dashboard

investeePortalRoutes.get('/dashboard', async (req, res) => {
  ok(res, await dashboardView(inv(req)));
});

// ---------------------------------------------------------------- reporting schedule / history

const PERIOD_RE = /^\d{4}-\d{2}$/;
function periodParam(req: Request) {
  const p = param(req, 'period');
  if (!PERIOD_RE.test(p)) throw HttpError.notFound('Reporting period not found');
  return p;
}

investeePortalRoutes.get('/reporting/requests', async (req, res) => {
  const c = inv(req);
  const periods = await companyPeriods(c.company.id);
  ok(res, periods.map((p) => reportingRequestView(p, c.company, c.profile)));
});

investeePortalRoutes.get('/reporting/requests/:period', async (req, res) => {
  const c = inv(req);
  ok(res, reportingRequestView(await loadPeriod(c.company.id, periodParam(req)), c.company, c.profile));
});

investeePortalRoutes.put('/reporting/requests/:period/draft', requireProfile('edit_draft'), validateBody(saveDraftSchema), async (req, res) => {
  const c = inv(req);
  const period = await loadPeriod(c.company.id, periodParam(req));
  assertEditable(period);
  const body = req.body as z.infer<typeof saveDraftSchema>;
  if (body.version !== undefined && body.version !== period.version) {
    throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
  }
  await saveDraft(packActor(req), period, { kpis: body.kpis, notes: body.notes });
  ok(res, reportingRequestView(await loadPeriod(c.company.id, period.period), c.company, c.profile), 'Draft saved');
});

investeePortalRoutes.post('/reporting/requests/:period/submit', requireProfile('submit_pack'), validateBody(submitRequestSchema), async (req, res) => {
  const c = inv(req);
  const period = await loadPeriod(c.company.id, periodParam(req));
  const body = req.body as z.infer<typeof submitRequestSchema>;
  await submitPack(packActor(req), c.company, period, { kpis: body.kpis, notes: body.notes });
  ok(res, reportingRequestView(await loadPeriod(c.company.id, period.period), c.company, c.profile), 'Reporting pack submitted');
});

investeePortalRoutes.get('/reporting/history', async (req, res) => {
  const c = inv(req);
  const periods = await companyPeriods(c.company.id);
  ok(
    res,
    periods.filter((p) => p.status !== 'open').map((p) => reportingRequestView(p, c.company, c.profile)),
  );
});

// ---------------------------------------------------------------- financial reports (= pack items)

const REPORT_STATUS_FILTER: Record<string, string[]> = {
  DRAFT: ['open'],
  NEEDS_REVISION: ['returned'],
  SUBMITTED: ['submitted'],
  ACCEPTED: ['accepted'],
};

investeePortalRoutes.get('/financial-reports', async (req, res) => {
  const c = inv(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const periodFilter = typeof req.query.reportingPeriod === 'string' ? periodKey(req.query.reportingPeriod) : null;
  const statusFilter = typeof req.query.status === 'string' ? REPORT_STATUS_FILTER[req.query.status] : undefined;
  const typeFilter = typeof req.query.reportType === 'string' ? req.query.reportType : undefined;
  const periods = (await companyPeriods(c.company.id)).filter(
    (p) => (!periodFilter || p.period === periodFilter) && (!statusFilter || statusFilter.includes(p.status)),
  );
  const all = periods
    .flatMap((p) => p.items.map((i) => statementReport(p, i, c.company, c.profile)))
    .filter((r) => !typeFilter || r.reportType === typeFilter);
  ok(res, { page, limit, total: all.length, items: all.slice((page - 1) * limit, page * limit) });
});

investeePortalRoutes.post('/financial-reports/period-kpis', requireProfile('submit_kpis'), validateBody(periodKpisRequestSchema), async (req, res) => {
  const c = inv(req);
  const body = req.body as z.infer<typeof periodKpisRequestSchema>;
  const key = periodKey(body.periodStart);
  if (!key) throw HttpError.badRequest('periodStart must be a date', [{ path: 'periodStart', message: 'Expected YYYY-MM-DD' }]);
  const period = await loadPeriod(c.company.id, key).catch(() => {
    throw HttpError.notFound('There is no reporting request for this period');
  });
  assertEditable(period);
  const kpis: Record<string, number> = { ...(body.kpis ?? {}) };
  if (body.totalRevenue !== undefined) kpis.totalRevenue = body.totalRevenue;
  if (body.netProfit !== undefined) kpis.netProfit = body.netProfit;
  if (body.cashFlowNet !== undefined) kpis.cashFlowNet = body.cashFlowNet;
  await saveDraft(packActor(req), period, { kpis }, { source: 'period-kpis', varianceNote: !!body.varianceExplanationNote });
  const after = await loadPeriod(c.company.id, key);
  const values = (after.kpiValues as Record<string, unknown> | null) ?? {};
  const n = (k: string) => (typeof values[k] === 'number' ? (values[k] as number) : null);
  ok(
    res,
    {
      periodStart: isoDay(after.periodStart) ?? `${key}-01`,
      periodEnd: isoDay(after.periodEnd) ?? `${key}-28`,
      totalRevenue: n('totalRevenue'),
      netProfit: n('netProfit'),
      cashFlowNet: n('cashFlowNet'),
      reportingPeriod: key,
    },
    'Period KPIs saved',
  );
});

investeePortalRoutes.post('/financial-reports/submit/:id', requireProfile('submit_pack'), validateBody(submitRequestSchema), async (req, res) => {
  const c = inv(req);
  const { period } = await loadReport(c.company.id, param(req, 'id'));
  const body = req.body as z.infer<typeof submitRequestSchema>;
  await submitPack(packActor(req), c.company, period, { kpis: body.kpis, notes: body.notes });
  ok(res, reportingRequestView(await loadPeriod(c.company.id, period.period), c.company, c.profile), 'Reporting pack submitted');
});

investeePortalRoutes.post('/financial-reports/:kind/draft', requireProfile('edit_draft'), validateBody(draftRequestSchema), async (req, res) => {
  const c = inv(req);
  const kind = draftKindSchema.safeParse(param(req, 'kind'));
  if (!kind.success) throw HttpError.notFound('Unknown report type');
  const body = req.body as z.infer<typeof draftRequestSchema>;
  const key = periodKey(body.reportingPeriod, body.periodStart);
  if (!key) throw HttpError.badRequest('reportingPeriod is required', [{ path: 'reportingPeriod', message: 'Expected YYYY-MM' }]);
  const period = await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: c.company.id, period: key } } });
  if (!period) throw HttpError.notFound('There is no reporting request for this period');
  const full = await loadPeriod(c.company.id, key);
  assertEditable(full);
  if (body.version !== undefined && body.version !== full.version) {
    throw HttpError.conflict('Someone else saved this report. Reload and try again.', 'version_conflict');
  }
  const values = flattenDraft(kind.data, body.data);
  const extras = statementExtras(kind.data, body.data, values);
  const merged = { ...((full.kpiValues as Record<string, unknown> | null) ?? {}), ...values, ...extras };
  const derived = deriveKpis(merged);
  await saveDraft(
    packActor(req),
    full,
    { kpis: { ...values, ...extras, ...(Object.keys(derived).length ? { AUTO_KPI_FLAT: derived } : {}) } },
    { source: `${kind.data}-draft`, title: body.title },
  );
  const slot = DRAFT_SLOT[kind.data];
  const item = full.items.find((i) => i.key === slot);
  if (!item) throw HttpError.notFound('Report not found');
  const after = await loadPeriod(c.company.id, key);
  const view = financialReportView(after, after.items.find((i) => i.id === item.id)!, c.company, c.profile);
  ok(
    res,
    { id: item.id, status: 'DRAFT' as const, reportType: view.reportType, reportingPeriod: key, reportUrl: null, fileUrl: null, storagePath: null },
    'Draft saved',
    201,
  );
});

investeePortalRoutes.post('/financial-reports/:id/file', requireProfile('edit_draft'), uploadFiles('file', 1), async (req, res) => {
  const c = inv(req);
  const { period, item } = await loadReport(c.company.id, param(req, 'id'));
  for (const f of uploadedFiles(req)) assertFileContentMatches(f);
  await uploadItemFiles(packActor(req), period, item.key, uploadedFiles(req));
  const after = await loadPeriod(c.company.id, period.period);
  const it = after.items.find((i) => i.id === item.id)!;
  ok(
    res,
    { id: it.id, reportUrl: null, fileUrl: null, storagePath: null, files: it.submissions.map((s) => ({ id: s.id, name: s.name, size: s.size, status: s.status })) },
    'File uploaded',
    201,
  );
});

investeePortalRoutes.get('/financial-reports/:id/files/:fileId/download-url', async (req, res) => {
  const c = inv(req);
  const { item } = await loadReport(c.company.id, param(req, 'id'));
  const sub = item.submissions.find((s) => s.id === param(req, 'fileId'));
  if (!sub) throw HttpError.notFound('File not found');
  ok(res, { url: signedDownloadUrl(sub.fileId, 300), expiresIn: 300, name: sub.name });
});

investeePortalRoutes.delete('/financial-reports/:id/files/:fileId', requireProfile('edit_draft'), async (req, res) => {
  const c = inv(req);
  const { period, item } = await loadReport(c.company.id, param(req, 'id'));
  assertEditable(period);
  const sub = item.submissions.find((s) => s.id === param(req, 'fileId'));
  if (!sub) throw HttpError.notFound('File not found');
  if (sub.status === 'Accepted') throw HttpError.conflict('Accepted files cannot be removed', 'invalid_state');
  await prisma.$transaction(async (tx) => {
    await tx.reportingSubmission.delete({ where: { id: sub.id } });
    if (item.submissions.length === 1) await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Due' } });
    await writeAudit(tx, investeeAudit(req), {
      action: 'reporting.file.removed',
      objectType: 'reporting_period',
      objectId: period.id,
      before: { item: item.key, file: sub.name },
    });
  });
  const after = await loadPeriod(c.company.id, period.period);
  ok(res, financialReportView(after, after.items.find((i) => i.id === item.id)!, c.company, c.profile), 'File removed');
});

investeePortalRoutes.get('/financial-reports/:id', async (req, res) => {
  const c = inv(req);
  const { period, item } = await loadReport(c.company.id, param(req, 'id'));
  const notes = statementAnnotations(period.kpiValues);
  ok(res, { ...financialReportView(period, item, c.company, c.profile), data: reportData(period, item.key), lineNotes: notes.lineNotes, narrative: notes.narrative });
});

// ---------------------------------------------------------------- KPIs

investeePortalRoutes.get('/kpis', async (req, res) => {
  const c = inv(req);
  const [defs, covenants, periods] = await Promise.all([
    prisma.companyKpi.findMany({ where: { companyId: c.company.id }, orderBy: { sort: 'asc' } }),
    prisma.covenant.findMany({ where: { companyId: c.company.id }, orderBy: { sort: 'asc' } }),
    prisma.reportingPeriod.findMany({ where: { companyId: c.company.id }, orderBy: { period: 'desc' } }),
  ]);
  const latestFor = (key: string) => {
    for (const p of periods) {
      const v = (p.kpiValues as Record<string, unknown> | null)?.[key];
      if (typeof v === 'number' && p.status !== 'open') return v;
    }
    return null;
  };
  ok(res, {
    definitions: defs.map((d) => ({ ...kpiView(d), latest: latestFor(d.key) })),
    periods: periods.map((p) => ({
      reportingPeriod: p.period,
      label: p.label,
      status: p.status,
      values: flattenReportingKpis(p.kpiValues as Record<string, unknown> | null),
    })),
    covenants: covenants.map(covenantView),
  });
});

// ---------------------------------------------------------------- settings

async function settingsView(req: Request) {
  const c = inv(req);
  const [prefs, mfa, mfaRequired, idle] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: c.userId } }),
    mfaEnabled(c.userId),
    policy('mfa_required'),
    policy('session_idle_minutes'),
  ]);
  const notifications = NOTIFICATION_TYPES.flatMap((type) =>
    (['email', 'in_app'] as const).map((channel) => ({
      type,
      channel,
      enabled: prefs.find((p) => p.type === type && p.channel === channel)?.enabled ?? true,
    })),
  );
  return {
    notifications,
    security: { mfaEnabled: mfa, mfaRequired: !!mfaRequired, sessionTimeoutMinutes: Number(idle) },
    accessProfile: c.profile,
    capabilities: capabilities(c.profile),
  };
}

investeePortalRoutes.get('/settings', async (req, res) => {
  ok(res, await settingsView(req));
});

investeePortalRoutes.put('/settings', validateBody(updateSettingsSchema), async (req, res) => {
  const c = inv(req);
  const body = req.body as z.infer<typeof updateSettingsSchema>;
  await prisma.$transaction(async (tx) => {
    for (const n of body.notifications) {
      await tx.notificationPreference.upsert({
        where: { userId_channel_type: { userId: c.userId, channel: n.channel, type: n.type } },
        create: { userId: c.userId, channel: n.channel, type: n.type, enabled: n.enabled },
        update: { enabled: n.enabled },
      });
    }
    await writeAudit(tx, investeeAudit(req), {
      action: 'user.notification_preferences.updated',
      objectType: 'user',
      objectId: c.userId,
      after: { notifications: body.notifications },
    });
  });
  ok(res, await settingsView(req), 'Settings saved');
});

// ---------------------------------------------------------------- team (read-only)

investeePortalRoutes.get('/team', async (req, res) => {
  const c = inv(req);
  const links = await prisma.companyUser.findMany({
    where: { companyId: c.company.id },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  const pending = await prisma.invitation.findMany({
    where: { companyId: c.company.id, portal: 'company', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  const activeEmails = new Set(links.map((l) => l.user.email.toLowerCase()));
  const grantRows = pending.length
    ? await prisma.setting.findMany({ where: { key: INVITE_GRANT_KEY, ownerId: { in: pending.map((p) => p.id) } } })
    : [];
  const grantByInvite = new Map<string, { profile?: string; title?: string | null }>();
  for (const g of grantRows) {
    const v = g.value as { kind?: string; profile?: string; title?: string | null } | null;
    if (v && v.kind === 'company') grantByInvite.set(g.ownerId, v);
  }
  ok(
    res,
    [
    ...links.map((l) => ({
      id: l.userId,
      name: l.user.name ?? l.user.email,
      email: l.user.email,
      title: l.title,
      accessProfile: asProfile(l.profile),
      status: l.status,
      lastActiveAt: (l.lastActiveAt ?? l.user.lastLoginAt)?.toISOString() ?? null,
      mfaEnabled: l.user.mfaFactors.length > 0,
      signingAuthority: authorityText(l.signingAuthority, l.title) !== null,
      isYou: l.userId === c.userId,
    })),
    // INO-020: pending invitations are visible to the team.
    ...pending
      .filter((p) => !activeEmails.has(p.email.toLowerCase()))
      .map((p) => ({
        id: p.id,
        name: p.name ?? p.email,
        email: p.email,
        title: grantByInvite.get(p.id)?.title ?? null,
        accessProfile: asProfile(grantByInvite.get(p.id)?.profile ?? 'read_only'),
        invitationId: p.id,
        status: 'invited',
        lastActiveAt: null,
        mfaEnabled: false,
        signingAuthority: false,
        isYou: false,
      })),
    ],
  );
});
const PROFILE_LABELS: Record<string, (typeof COMPANY_PROFILES)[number]> = {
  'workspace administrator': 'workspace_administrator',
  'executive approver': 'executive_approver',
  'report contributor': 'report_contributor',
  'kpi owner': 'kpi_owner',
  'finance editor': 'finance_editor',
  'read only': 'read_only',
};

function companyProfile(raw: unknown) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/_/g, ' ') : '';
  const mapped = PROFILE_LABELS[text] ?? (COMPANY_PROFILES as readonly string[]).find((p) => p === (typeof raw === 'string' ? raw.trim() : ''));
  if (!mapped) throw HttpError.badRequest('Choose an access profile', { profile: 'Unknown access profile' });
  return mapped;
}

investeePortalRoutes.post('/team', requireProfile('manage_company'), idempotent('investee.team.invite'), async (req, res) => {
  const c = inv(req);
  const body = (req.body ?? {}) as { email?: unknown; name?: unknown; profile?: unknown; accessProfile?: unknown; title?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw HttpError.badRequest('Enter a work email address', { email: 'Invalid email' });
  const profile = companyProfile(body.profile ?? body.accessProfile ?? 'report_contributor');
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : null;
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : null;
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const link = await prisma.companyUser.findUnique({ where: { companyId_userId: { companyId: c.company.id, userId: existing.id } } });
    if (link?.status === 'active') throw HttpError.conflict('This person already has access to the company', 'already_member');
  }
  const invitation = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { companyId: c.company.id, portal: 'company', email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const { invitation: row } = await createInvitation(tx, {
      email,
      name,
      portal: 'company',
      roleKeys: [],
      companyId: c.company.id,
      invitedById: c.userId,
      context: `${c.company.name}'s investee portal`,
    });
    await saveInviteGrant(tx, row.id, { kind: 'company', profile, title, invitedById: c.userId });
    await writeAudit(tx, investeeAudit(req), {
      action: 'company_user.invited',
      objectType: 'invitation',
      objectId: row.id,
      after: { email, profile, title },
    });
    return row;
  });
  ok(res, { id: invitation.id, email, profile, status: 'invited', expiresAt: invitation.expiresAt.toISOString() }, 'Invitation sent', 201);
});

investeePortalRoutes.patch('/team/:userId', requireProfile('manage_company'), async (req, res) => {
  const c = inv(req);
  const userId = param(req, 'userId');
  const link = await prisma.companyUser.findUnique({ where: { companyId_userId: { companyId: c.company.id, userId } } });
  if (!link) throw HttpError.notFound('Team member not found');
  const body = (req.body ?? {}) as { profile?: unknown; accessProfile?: unknown; title?: unknown; status?: unknown };
  const data: { profile?: string; title?: string | null; status?: string } = {};
  if (body.profile !== undefined || body.accessProfile !== undefined) data.profile = companyProfile(body.profile ?? body.accessProfile);
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120) || null;
  if (body.status !== undefined) {
    const status = body.status === 'disabled' || body.status === 'active' ? body.status : null;
    if (!status) throw HttpError.badRequest('Status must be active or disabled');
    if (status === 'disabled' && userId === c.userId) throw HttpError.badRequest('You cannot disable your own access');
    data.status = status;
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.companyUser.update({ where: { companyId_userId: { companyId: c.company.id, userId } }, data });
    if (data.status === 'disabled') await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, investeeAudit(req), { action: 'company_user.updated', objectType: 'company_user', objectId: userId, after: data });
    return row;
  });
  ok(res, { id: userId, accessProfile: updated.profile, title: updated.title, status: updated.status });
});

investeePortalRoutes.delete('/team/:userId', requireProfile('manage_company'), async (req, res) => {
  const c = inv(req);
  const userId = param(req, 'userId');
  if (userId === c.userId) throw HttpError.badRequest('You cannot disable your own access');
  const link = await prisma.companyUser.findUnique({ where: { companyId_userId: { companyId: c.company.id, userId } } });
  if (!link) throw HttpError.notFound('Team member not found');
  await prisma.$transaction(async (tx) => {
    await tx.companyUser.update({ where: { companyId_userId: { companyId: c.company.id, userId } }, data: { status: 'disabled' } });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, investeeAudit(req), { action: 'company_user.disabled', objectType: 'company_user', objectId: userId });
  });
  ok(res, { id: userId, status: 'disabled' });
});

// ---------------------------------------------------------------- threads (reporting questions)

async function companyThread(companyId: string, ref: string) {
  const q = await prisma.reportingQuestion.findFirst({ where: { companyId, ref }, include: questionInclude });
  if (!q) throw HttpError.notFound('Thread not found');
  return q;
}

investeePortalRoutes.get('/threads', async (req, res) => {
  const c = inv(req);
  const rows = await prisma.reportingQuestion.findMany({ where: { companyId: c.company.id }, include: questionInclude, orderBy: { updatedAt: 'desc' } });
  ok(res, rows.map((q) => questionView(q, 'company')));
});

investeePortalRoutes.post('/threads', requireProfile('post_messages'), validateBody(startThreadSchema), async (req, res) => {
  const c = inv(req);
  const body = req.body as z.infer<typeof startThreadSchema>;
  const period = body.reportingPeriod
    ? await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: c.company.id, period: body.reportingPeriod } } })
    : null;
  if (body.reportingPeriod && !period) throw HttpError.notFound('Reporting period not found');
  const name = actorName(req);
  const q = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'question');
    const row = await tx.reportingQuestion.create({
      data: {
        ref,
        companyId: c.company.id,
        periodId: period?.id ?? null,
        title: body.title,
        fromName: name,
        fromRole: c.title ?? c.company.name,
        messages: { create: { authorId: c.userId, authorName: name, fromCompany: true, body: body.text } },
      },
    });
    await writeAudit(tx, investeeAudit(req), {
      action: 'reporting.question.raised',
      objectType: 'reporting_question',
      objectId: row.id,
      after: { ref, title: body.title, fromCompany: true },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'research.edit',
      type: 'reporting.question.raised',
      title: `${c.company.name} · ${ref}`,
      body: body.title,
      link: '/?page=private-markets',
    });
    return row;
  });
  ok(res, questionView(await companyThread(c.company.id, q.ref), 'company'), 'Thread started', 201);
});

investeePortalRoutes.post('/threads/:id/messages', requireProfile('post_messages'), validateBody(replyThreadSchema), async (req, res) => {
  const c = inv(req);
  const q = await companyThread(c.company.id, param(req, 'id'));
  if (q.status === 'resolved') throw HttpError.conflict('This thread is resolved', 'invalid_state');
  const body = req.body as z.infer<typeof replyThreadSchema>;
  await prisma.$transaction(async (tx) => {
    await tx.reportingQuestionMessage.create({
      data: { questionId: q.id, authorId: c.userId, authorName: actorName(req), fromCompany: true, body: body.text },
    });
    await tx.reportingQuestion.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, investeeAudit(req), { action: 'reporting.question.replied', objectType: 'reporting_question', objectId: q.id });
    await enqueue(tx, 'notify.permission', {
      permission: 'research.edit',
      type: 'reporting.question.reply',
      title: `${c.company.name} replied · ${q.ref}`,
      body: q.title,
      link: '/?page=private-markets',
    });
  });
  ok(res, questionView(await companyThread(c.company.id, q.ref), 'company'), 'Reply sent');
});

// ---------------------------------------------------------------- term sheets

async function termSheetList(req: Request) {
  const c = inv(req);
  const rows = await prisma.termSheet.findMany({
    where: { companyId: c.company.id, status: { in: INVESTEE_VISIBLE } },
    orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const extras = await loadExtras(rows);
  const canSign = profileCan(c.profile, 'sign') && c.signingAuthority !== null;
  const termSheets = rows.map((r) => investeeTermSheetView(r, extras.get(r.id), { canSign }));
  return { termSheets, total: termSheets.length, page: 1, totalPages: 1 };
}

investeePortalRoutes.get('/term-sheets/my', async (req, res) => {
  ok(res, await termSheetList(req));
});

investeePortalRoutes.get('/term-sheets/:id', async (req, res) => {
  const c = inv(req);
  const ts = await loadCompanyTermSheet(c.company.id, param(req, 'id'));
  const viewed = await markViewed(ts, investeeAudit(req));
  const extras = await loadExtras([viewed]);
  const canSign = profileCan(c.profile, 'sign') && c.signingAuthority !== null;
  ok(res, investeeTermSheetView(viewed, extras.get(viewed.id), { canSign }));
});

/** Signing needs the `sign` capability and a recorded signing authority on the member's company link. */
const requireSigningAuthority: RequestHandler = (req, _res, next) => {
  const c = inv(req);
  if (!profileCan(c.profile, 'sign')) {
    throw HttpError.forbidden('Your access profile does not allow you to sign documents', 'permission_denied');
  }
  if (!c.signingAuthority) {
    throw HttpError.forbidden('You do not have signing authority for this company', 'signing_authority_required');
  }
  next();
};

/** E-signature evidence must include a verified second factor: enrolment is mandatory for signers. */
const requireEnrolledFactor: RequestHandler = async (req, _res, next) => {
  if (!(await mfaEnabled(inv(req).userId))) {
    throw new HttpError(401, 'mfa_enrolment_required', 'Set up two-factor authentication before signing');
  }
  next();
};

investeePortalRoutes.post(
  '/term-sheets/:id/sign',
  requireSigningAuthority,
  requireEnrolledFactor,
  requireStepUp,
  uploadFiles('signature', 1),
  validateBody(signTermSheetSchema),
  idempotent('term_sheet.sign', { required: true }),
  async (req, res) => {
    const c = inv(req);
    const ts = await loadCompanyTermSheet(c.company.id, param(req, 'id'));
    const body = req.body as z.infer<typeof signTermSheetSchema>;
    const image = uploadedFiles(req)[0];
    if (image && !LOGO_MIMES.has(image.mimetype)) throw HttpError.badRequest('Signature image must be PNG, JPEG or WebP');
    if (image) assertFileContentMatches(image);
    const result = await sign(ts, {
      userId: c.userId,
      typedName: body.name,
      authority: c.signingAuthority!,
      consentTextVersion: body.consentTextVersion,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      sessionId: req.authSession?.id ?? null,
      mfaAt: req.authSession?.mfaVerifiedAt ?? null,
      signatureImage: image ? { name: image.originalname, mime: image.mimetype, data: image.buffer } : null,
      audit: investeeAudit(req),
    });
    const extras = await loadExtras([result.termSheet]);
    const view = investeeTermSheetView(result.termSheet, extras.get(result.termSheet.id), { canSign: true });
    ok(
      res,
      {
        id: view.id,
        applicationId: null,
        status: view.status,
        isSigned: view.isSigned,
        signedAt: view.signedAt,
        investmentAmount: view.investmentAmount,
        equityPercentage: view.equityPercentage,
        valuation: view.valuation,
        signature: view.signature!,
      },
      'Term sheet signed',
    );
  },
);

investeePortalRoutes.post(
  '/term-sheets/:id/decline',
  requireSigningAuthority,
  validateBody(declineTermSheetSchema),
  idempotent('term_sheet.decline', { required: true }),
  async (req, res) => {
    const c = inv(req);
    const ts = await loadCompanyTermSheet(c.company.id, param(req, 'id'));
    const body = req.body as z.infer<typeof declineTermSheetSchema>;
    const next = await decline(ts, { userId: c.userId, name: actorName(req), reason: body.reason, audit: investeeAudit(req) });
    const extras = await loadExtras([next]);
    ok(res, investeeTermSheetView(next, extras.get(next.id), { canSign: true }), 'Term sheet declined');
  },
);

// ---------------------------------------------------------------- application, procurement, cap table, governance, forecast, vault

investeePortalRoutes.get('/application', async (req, res) => {
  ok(res, await applicationView(inv(req)));
});

investeePortalRoutes.get('/procurement', async (req, res) => {
  const companyId = inv(req).company.id;
  const [requisitions, tranche] = await Promise.all([requisitionList(companyId), requisitionTranche(companyId)]);
  ok(res, { requisitions, tranche });
});

investeePortalRoutes.post('/procurement', requireProfile('edit_draft'), validateBody(requisitionSchema), idempotent('investee.procurement.create'), async (req, res) => {
  const c = inv(req);
  const row = await createRequisition(c, req.body, actorName(req), investeeAudit(req));
  ok(res, row, 'Request submitted', 201);
});

investeePortalRoutes.get('/cap-table', async (req, res) => {
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : undefined;
  ok(res, await capTableView(inv(req).company, asOf));
});

investeePortalRoutes.put('/cap-table', requireProfile('edit_draft'), validateBody(capTableSchema), async (req, res) => {
  ok(res, await saveCapTable(inv(req), req.body, investeeAudit(req)), 'Cap table saved');
});

investeePortalRoutes.post('/cap-table/simulate', requireProfile('edit_draft'), validateBody(roundSchema), async (req, res) => {
  const body = req.body as z.infer<typeof roundSchema>;
  const view = await capTableView(inv(req).company);
  ok(res, simulateRound(view.shareholders, body.amount, body.preMoney));
});

investeePortalRoutes.get('/governance', async (req, res) => {
  ok(res, await governanceView(inv(req)));
});

investeePortalRoutes.post('/governance/consents', requireProfile('edit_draft'), validateBody(consentSchema), idempotent('investee.governance.consent'), async (req, res) => {
  const c = inv(req);
  ok(res, await addConsent(c, req.body, actorName(req), investeeAudit(req)), 'Consent requested', 201);
});

investeePortalRoutes.get('/forecast', async (req, res) => {
  ok(res, await forecastView(inv(req).company.id));
});

investeePortalRoutes.put('/forecast', requireProfile('edit_draft'), validateBody(forecastSchema), async (req, res) => {
  ok(res, await saveForecast(inv(req), req.body, investeeAudit(req)), 'Forecast saved');
});

investeePortalRoutes.get('/vault', async (req, res) => {
  ok(res, { documents: await vaultDocuments(inv(req).company.id) });
});

investeePortalRoutes.post('/vault', requireProfile('edit_draft'), uploadFiles('file'), idempotent('investee.vault.upload'), async (req, res) => {
  const file = uploadedFiles(req)[0];
  if (!file) throw new HttpError(400, 'bad_request', 'Attach a file');
  const body = (req.body ?? {}) as { name?: unknown; type?: unknown };
  const saved = await uploadVaultFile(
    inv(req),
    file,
    { name: typeof body.name === 'string' ? body.name : undefined, type: typeof body.type === 'string' ? body.type : undefined },
    investeeAudit(req),
  );
  ok(res, saved, 'Document stored', 201);
});

investeePortalRoutes.get('/signatures', async (req, res) => {
  ok(res, await signatureRequests(inv(req).company.id));
});

// ---------------------------------------------------------------- fallback + errors

// Workspace tables: cap-table transactions, certificates, waterfall, board, signature requests, share links, search, access.
investeePortalRoutes.use(workspaceRoutes);

investeePortalRoutes.use(notBuilt('This Investee endpoint'));
investeePortalRoutes.use(investeeErrorHandler);
