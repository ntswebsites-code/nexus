import { Router, type Request } from 'express';
import { z } from 'zod';
import { emailSchema } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { actorName, ctx, param } from '../../lib/http';
import { signedDownloadUrl } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess } from '../../middleware/requireAuth';
import { createInvitation } from '../identity/invitations';
import {
  covenantView,
  openPeriod,
  periodDetail,
  periodInclude,
  questionInclude,
  questionView,
  workspace,
} from './company.service';

/** `/api/v1/private-markets` - investment-team review of portfolio-company reporting (SRD 8.1 / 8.4). */
export const companyStaffRoutes = Router();
companyStaffRoutes.use(requireAuth, requirePortalAccess('admin'));

const audit = (req: Request) => ctx(req, 'admin');
const VIEW = requirePermission('portfolio.view');
const REVIEW = requirePermission('research.edit');

async function companyByRef(ref: string) {
  const c = await prisma.portfolioCompany.findUnique({ where: { ref } });
  if (!c) throw HttpError.notFound('Portfolio company not found');
  return c;
}

function notifyCompany(companyId: string, title: string, body: string, link: string) {
  return async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
    const users = await tx.companyUser.findMany({ where: { companyId, status: 'active' }, select: { userId: true } });
    if (users.length) await enqueue(tx, 'notify.users', { userIds: users.map((u) => u.userId), type: 'reporting.review', title, body, link });
  };
}

companyStaffRoutes.get('/companies', VIEW, async (_req, res) => {
  const rows = await prisma.portfolioCompany.findMany({
    orderBy: { name: 'asc' },
    include: {
      periods: { orderBy: { period: 'desc' }, take: 1 },
      questions: { where: { status: 'open' }, select: { id: true } },
      covenants: true,
    },
  });
  res.json({
    data: rows.map((c) => ({
      id: c.ref,
      name: c.name,
      sector: c.sector,
      country: c.country,
      relationship: c.relationship,
      latestPeriod: c.periods[0] ? { id: c.periods[0].period, label: c.periods[0].label, status: c.periods[0].status, submittedAt: c.periods[0].submittedAt } : null,
      openQuestions: c.questions.length,
      covenantAlerts: c.covenants.filter((v) => v.evidence === 'expiring').length,
    })),
  });
});

/** Review queue: every pack waiting for the investment team. */
companyStaffRoutes.get('/reporting-packs', VIEW, async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'submitted';
  const rows = await prisma.reportingPeriod.findMany({
    where: status === 'all' ? {} : { status },
    include: { ...periodInclude, company: true },
    orderBy: [{ submittedAt: 'desc' }, { period: 'desc' }],
    take: 200,
  });
  res.json({ data: rows.map((p) => ({ ...periodDetail(p), company: { id: p.company.ref, name: p.company.name } })) });
});

companyStaffRoutes.get('/companies/:ref', VIEW, async (req, res) => {
  const company = await companyByRef(param(req, 'ref'));
  const periods = await prisma.reportingPeriod.findMany({ where: { companyId: company.id }, include: periodInclude, orderBy: { period: 'desc' } });
  res.json({ ...(await workspace(company.id, 'staff')), periodDetails: periods.map(periodDetail) });
});

const openSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  due: z.coerce.date(),
  periodType: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
});

companyStaffRoutes.post('/companies/:ref/periods', REVIEW, validateBody(openSchema), async (req, res) => {
  const company = await companyByRef(param(req, 'ref'));
  const b = req.body as z.infer<typeof openSchema>;
  const exists = await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: company.id, period: b.period } } });
  if (exists) throw HttpError.conflict('That period is already open', 'duplicate');
  const row = await prisma.$transaction(async (tx) => {
    const p = await openPeriod(tx, company.id, b.period, b.due, b.periodType);
    await writeAudit(tx, audit(req), { action: 'reporting.period.opened', objectType: 'reporting_period', objectId: p.id, after: { period: b.period, due: b.due } });
    await notifyCompany(company.id, `${p.label} reporting pack opened`, `Due ${b.due.toISOString().slice(0, 10)}.`, '/reporting')(tx);
    return p;
  });
  res.status(201).json({ period: periodDetail(await prisma.reportingPeriod.findUniqueOrThrow({ where: { id: row.id }, include: periodInclude })) });
});

const reviewSchema = z.object({ note: z.string().trim().max(5000).optional() });

async function reviewPack(req: Request, outcome: 'accepted' | 'returned') {
  const p = await prisma.reportingPeriod.findUnique({ where: { id: param(req, 'id') }, include: { ...periodInclude, company: true } });
  if (!p) throw HttpError.notFound('Reporting pack not found');
  if (p.status !== 'submitted') throw HttpError.conflict(`The ${p.label} pack is ${p.status}, not awaiting review`, 'invalid_state');
  const note: string | undefined = req.body?.note;
  if (outcome === 'returned' && !note) throw HttpError.badRequest('Explain what the company needs to fix');
  if (p.submittedById === req.user!.id) throw HttpError.forbidden('You cannot review a pack you submitted', 'sod_violation');
  await prisma.$transaction(async (tx) => {
    await tx.reportingPeriod.update({
      where: { id: p.id },
      data: {
        status: outcome,
        reviewedAt: new Date(),
        reviewedById: req.user!.id,
        reviewerName: actorName(req),
        reviewNote: note || (outcome === 'accepted' ? 'Accepted.' : null),
        version: { increment: 1 },
      },
    });
    await tx.reportingSubmission.updateMany({
      where: { itemId: { in: p.items.map((i) => i.id) }, status: 'Submitted' },
      data: { status: outcome === 'accepted' ? 'Accepted' : 'Returned' },
    });
    await writeAudit(tx, audit(req), {
      action: `reporting.pack.${outcome}`,
      objectType: 'reporting_period',
      objectId: p.id,
      before: { status: p.status },
      after: { status: outcome, note },
      reason: note,
    });
    await notifyCompany(
      p.companyId,
      `${p.label} pack ${outcome === 'accepted' ? 'accepted' : 'returned'}`,
      note || 'The investment team accepted your pack.',
      outcome === 'accepted' ? '/history' : '/reporting',
    )(tx);
  });
  return prisma.reportingPeriod.findUniqueOrThrow({ where: { id: p.id }, include: periodInclude });
}

companyStaffRoutes.post('/reporting-packs/:id/accept', REVIEW, validateBody(reviewSchema), async (req, res) => {
  res.json({ period: periodDetail(await reviewPack(req, 'accepted')) });
});

companyStaffRoutes.post('/reporting-packs/:id/return', REVIEW, validateBody(reviewSchema), async (req, res) => {
  res.json({ period: periodDetail(await reviewPack(req, 'returned')) });
});

companyStaffRoutes.get('/reporting-packs/:id/files/:fileId/download-url', VIEW, async (req, res) => {
  const sub = await prisma.reportingSubmission.findFirst({
    where: { id: param(req, 'fileId'), item: { periodId: param(req, 'id') } },
  });
  if (!sub) throw HttpError.notFound('File not found');
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), { action: 'reporting.file.downloaded', objectType: 'reporting_submission', objectId: sub.id }),
  );
  res.json({ url: signedDownloadUrl(sub.fileId), expiresIn: 300, name: sub.name });
});

// ---------------------------------------------------------------- questions

const questionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(5000),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  role: z.string().trim().max(120).optional(),
});

companyStaffRoutes.post('/companies/:ref/questions', REVIEW, validateBody(questionSchema), async (req, res) => {
  const company = await companyByRef(param(req, 'ref'));
  const b = req.body as z.infer<typeof questionSchema>;
  const period = b.period ? await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: company.id, period: b.period } } }) : null;
  const q = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'question');
    const row = await tx.reportingQuestion.create({
      data: {
        ref,
        companyId: company.id,
        periodId: period?.id ?? null,
        title: b.title,
        fromName: actorName(req),
        fromRole: b.role ?? req.user!.roles.find((r) => r.portal === 'admin')?.label ?? 'Investment team',
        messages: { create: { authorId: req.user!.id, authorName: actorName(req), fromCompany: false, body: b.text } },
      },
    });
    await writeAudit(tx, audit(req), { action: 'reporting.question.raised', objectType: 'reporting_question', objectId: row.id, after: { ref, title: b.title } });
    await notifyCompany(company.id, `New question · ${ref}`, b.title, '/questions')(tx);
    return row;
  });
  res.status(201).json({ thread: questionView(await prisma.reportingQuestion.findUniqueOrThrow({ where: { id: q.id }, include: questionInclude }), 'staff') });
});

async function questionByRef(ref: string) {
  const q = await prisma.reportingQuestion.findUnique({ where: { ref }, include: questionInclude });
  if (!q) throw HttpError.notFound('Question not found');
  return q;
}

companyStaffRoutes.post('/questions/:ref/messages', REVIEW, validateBody(z.object({ text: z.string().trim().min(1).max(5000) })), async (req, res) => {
  const q = await questionByRef(param(req, 'ref'));
  if (q.status === 'resolved') throw HttpError.conflict('This question is resolved', 'invalid_state');
  await prisma.$transaction(async (tx) => {
    await tx.reportingQuestionMessage.create({
      data: { questionId: q.id, authorId: req.user!.id, authorName: actorName(req), fromCompany: false, body: req.body.text },
    });
    await tx.reportingQuestion.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, audit(req), { action: 'reporting.question.replied', objectType: 'reporting_question', objectId: q.id });
    await notifyCompany(q.companyId, `Reply on ${q.ref}`, q.title, '/questions')(tx);
  });
  res.json({ thread: questionView(await questionByRef(q.ref), 'staff') });
});

companyStaffRoutes.post('/questions/:ref/resolve', REVIEW, async (req, res) => {
  const q = await questionByRef(param(req, 'ref'));
  await prisma.$transaction(async (tx) => {
    await tx.reportingQuestion.update({ where: { id: q.id }, data: { status: 'resolved' } });
    await writeAudit(tx, audit(req), {
      action: 'reporting.question.resolved',
      objectType: 'reporting_question',
      objectId: q.id,
      before: { status: q.status },
      after: { status: 'resolved' },
    });
  });
  res.json({ thread: questionView(await questionByRef(q.ref), 'staff') });
});

// ---------------------------------------------------------------- covenants & users

const covenantSchema = z.object({
  actual: z.number().finite().optional(),
  headroom: z.string().trim().max(40).optional(),
  evidence: z.enum(['current', 'expiring']).optional(),
  note: z.string().trim().max(255).nullable().optional(),
});

companyStaffRoutes.patch('/companies/:ref/covenants/:key', REVIEW, validateBody(covenantSchema), async (req, res) => {
  const company = await companyByRef(param(req, 'ref'));
  const cov = await prisma.covenant.findUnique({ where: { companyId_key: { companyId: company.id, key: param(req, 'key') } } });
  if (!cov) throw HttpError.notFound('Covenant not found');
  const b = req.body as z.infer<typeof covenantSchema>;
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.covenant.update({ where: { id: cov.id }, data: b });
    await writeAudit(tx, audit(req), { action: 'covenant.updated', objectType: 'covenant', objectId: cov.id, before: covenantView(cov), after: covenantView(updated) });
    return updated;
  });
  res.json({ covenant: covenantView(row) });
});

const companyInviteSchema = z.object({ name: z.string().trim().min(1).max(120), email: emailSchema });

companyStaffRoutes.post('/companies/:ref/users', REVIEW, validateBody(companyInviteSchema), async (req, res) => {
  const company = await companyByRef(param(req, 'ref'));
  const b = req.body as z.infer<typeof companyInviteSchema>;
  const existing = await prisma.companyUser.findFirst({ where: { companyId: company.id, user: { email: b.email } } });
  if (existing) throw HttpError.conflict('This person already has access to the company portal', 'already_member');
  await prisma.$transaction(async (tx) => {
    const { invitation } = await createInvitation(tx, {
      email: b.email,
      name: b.name,
      portal: 'company',
      roleKeys: [],
      companyId: company.id,
      invitedById: req.user!.id,
      context: `the Matanho company reporting portal for ${company.name}`,
    });
    await writeAudit(tx, audit(req), { action: 'company_user.invited', objectType: 'portfolio_company', objectId: company.id, after: { invitationId: invitation.id, email: b.email } });
  });
  res.status(201).json({ ok: true });
});
