import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { actorName, ctx, expectVersion, param } from '../../lib/http';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { validateBody } from '../../middleware/validate';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';
import { requireAuth } from '../../middleware/requireAuth';
import { companyContext, periodDetail, periodInclude, questionInclude, questionView, workspace } from './company.service';

/** `/api/v1/company` - portfolio-company reporting portal (SRD 8.4). Access follows CompanyUser membership. */
export const companyRoutes = Router();
companyRoutes.use(requireAuth);

const audit = (req: Request) => ctx(req, 'company');
const EDITABLE = ['open', 'returned'];

async function loadPeriod(companyId: string, period: string) {
  const row = await prisma.reportingPeriod.findUnique({
    where: { companyId_period: { companyId, period } },
    include: periodInclude,
  });
  if (!row) throw HttpError.notFound('Reporting period not found');
  return row;
}

function assertEditable(p: { status: string; label: string }) {
  if (!EDITABLE.includes(p.status)) {
    throw HttpError.conflict(`The ${p.label} pack is ${p.status} and can no longer be changed`, 'invalid_state');
  }
}

companyRoutes.get('/workspace', async (req, res) => {
  const company = await companyContext(req);
  const data = await workspace(company.id, 'company');
  const current = data.periods.find((p) => EDITABLE.includes(p.status)) ?? data.periods[0];
  res.json({
    ...data,
    currentPeriod: current ? periodDetail(await loadPeriod(company.id, current.id)) : null,
    user: { name: req.user!.name, email: req.user!.email },
  });
});

companyRoutes.get('/periods/:period', async (req, res) => {
  const company = await companyContext(req);
  res.json({ period: periodDetail(await loadPeriod(company.id, param(req, 'period'))) });
});

companyRoutes.post('/periods/:period/items/:key/files', uploadFiles('files', 10), async (req, res) => {
  const company = await companyContext(req);
  const period = await loadPeriod(company.id, param(req, 'period'));
  assertEditable(period);
  const item = period.items.find((i) => i.key === param(req, 'key'));
  if (!item) throw HttpError.notFound('Reporting item not found');
  const files = uploadedFiles(req);
  if (!files.length) throw HttpError.badRequest('Attach at least one file');
  const exts = item.accept.split(',').map((e) => e.trim().toLowerCase());
  const bad = files.find((f) => !exts.some((e) => f.originalname.toLowerCase().endsWith(e)));
  if (bad) throw HttpError.badRequest(`${bad.originalname} is not an accepted format (${item.accept})`);

  await prisma.$transaction(async (tx) => {
    for (const f of files) {
      const stored = await storeFile({ name: f.originalname, mime: f.mimetype, data: f.buffer, uploadedById: req.user!.id }, tx);
      await tx.reportingSubmission.create({
        data: { itemId: item.id, fileId: stored.id, name: stored.name, size: stored.size, uploadedById: req.user!.id },
      });
    }
    await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Complete' } });
    await writeAudit(tx, audit(req), {
      action: 'reporting.files.uploaded',
      objectType: 'reporting_period',
      objectId: period.id,
      after: { item: item.key, files: files.map((f) => f.originalname) },
    });
  });
  res.status(201).json({ period: periodDetail(await loadPeriod(company.id, period.period)) });
});

companyRoutes.delete('/periods/:period/items/:key/files/:id', async (req, res) => {
  const company = await companyContext(req);
  const period = await loadPeriod(company.id, param(req, 'period'));
  assertEditable(period);
  const item = period.items.find((i) => i.key === param(req, 'key'));
  const sub = item?.submissions.find((s) => s.id === param(req, 'id'));
  if (!item || !sub) throw HttpError.notFound('File not found');
  if (sub.status === 'Accepted') throw HttpError.conflict('Accepted files cannot be removed', 'invalid_state');
  await prisma.$transaction(async (tx) => {
    await tx.reportingSubmission.delete({ where: { id: sub.id } });
    if (item.submissions.length === 1) await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Due' } });
    await writeAudit(tx, audit(req), {
      action: 'reporting.file.removed',
      objectType: 'reporting_period',
      objectId: period.id,
      before: { item: item.key, file: sub.name },
    });
  });
  res.json({ period: periodDetail(await loadPeriod(company.id, period.period)) });
});

companyRoutes.get('/periods/:period/files/:id/download-url', async (req, res) => {
  const company = await companyContext(req);
  const period = await loadPeriod(company.id, param(req, 'period'));
  const sub = period.items.flatMap((i) => i.submissions).find((s) => s.id === param(req, 'id'));
  if (!sub) throw HttpError.notFound('File not found');
  res.json({ url: signedDownloadUrl(sub.fileId), expiresIn: 300, name: sub.name });
});

const draftSchema = z.object({
  kpis: z.record(z.string().max(32), z.union([z.number().finite(), z.literal('')])).optional(),
  notes: z.string().max(10_000).optional(),
  version: z.number().int().optional(),
});

companyRoutes.put('/periods/:period', validateBody(draftSchema), async (req, res) => {
  const company = await companyContext(req);
  const period = await loadPeriod(company.id, param(req, 'period'));
  assertEditable(period);
  if (req.body.version !== undefined) expectVersion(req, period.version);
  const b = req.body as z.infer<typeof draftSchema>;
  await prisma.$transaction(async (tx) => {
    await tx.reportingPeriod.update({
      where: { id: period.id },
      data: {
        ...(b.kpis ? { kpiValues: { ...((period.kpiValues as object | null) ?? {}), ...b.kpis } } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, audit(req), {
      action: 'reporting.draft.saved',
      objectType: 'reporting_period',
      objectId: period.id,
      after: { kpis: b.kpis ? Object.keys(b.kpis) : undefined, notes: b.notes !== undefined },
    });
  });
  res.json({ period: periodDetail(await loadPeriod(company.id, period.period)) });
});

companyRoutes.post('/periods/:period/submit', validateBody(draftSchema), async (req, res) => {
  const company = await companyContext(req);
  const period = await loadPeriod(company.id, param(req, 'period'));
  assertEditable(period);
  const b = req.body as z.infer<typeof draftSchema>;
  const missing = period.items.filter((i) => i.required && i.submissions.length === 0);
  if (missing.length) {
    throw HttpError.badRequest(`Still needed: ${missing.map((i) => i.title).join(', ')}`, { missing: missing.map((i) => i.key) });
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.reportingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'submitted',
        submittedAt: now,
        submittedById: req.user!.id,
        reviewNote: null,
        reviewedAt: null,
        reviewedById: null,
        reviewerName: null,
        ...(b.kpis ? { kpiValues: { ...((period.kpiValues as object | null) ?? {}), ...b.kpis } } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
        version: { increment: 1 },
      },
    });
    await tx.reportingSubmission.updateMany({
      where: { itemId: { in: period.items.map((i) => i.id) }, status: { in: ['Draft', 'Returned'] } },
      data: { status: 'Submitted' },
    });
    await writeAudit(tx, audit(req), {
      action: 'reporting.pack.submitted',
      objectType: 'reporting_period',
      objectId: period.id,
      before: { status: period.status },
      after: { status: 'submitted', period: period.period },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'research.edit',
      type: 'reporting.submitted',
      title: `${company.name} · ${period.label} pack submitted`,
      body: `${actorName(req)} submitted the ${period.label} reporting pack for review.`,
      link: '/?page=private-markets',
    });
  });
  res.json({ period: periodDetail(await loadPeriod(company.id, period.period)) });
});

// ---------------------------------------------------------------- questions

async function companyQuestion(companyId: string, ref: string) {
  const q = await prisma.reportingQuestion.findFirst({ where: { companyId, ref }, include: questionInclude });
  if (!q) throw HttpError.notFound('Question not found');
  return q;
}

const replySchema = z.object({ text: z.string().trim().min(1).max(5000) });

companyRoutes.post('/questions/:ref/messages', validateBody(replySchema), async (req, res) => {
  const company = await companyContext(req);
  const q = await companyQuestion(company.id, param(req, 'ref'));
  if (q.status === 'resolved') throw HttpError.conflict('This question is resolved', 'invalid_state');
  await prisma.$transaction(async (tx) => {
    await tx.reportingQuestionMessage.create({
      data: { questionId: q.id, authorId: req.user!.id, authorName: actorName(req), fromCompany: true, body: req.body.text },
    });
    await tx.reportingQuestion.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, audit(req), { action: 'reporting.question.replied', objectType: 'reporting_question', objectId: q.id });
    await enqueue(tx, 'notify.permission', {
      permission: 'research.edit',
      type: 'reporting.question.reply',
      title: `${company.name} replied · ${q.ref}`,
      body: q.title,
      link: '/?page=private-markets',
    });
  });
  res.json({ thread: questionView(await companyQuestion(company.id, q.ref), 'company') });
});

companyRoutes.post('/questions/:ref/resolve', async (req, res) => {
  const company = await companyContext(req);
  const q = await companyQuestion(company.id, param(req, 'ref'));
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
  res.json({ thread: questionView(await companyQuestion(company.id, q.ref), 'company') });
});

// ---------------------------------------------------------------- library

companyRoutes.get('/library/:ref/download-url', async (req, res) => {
  const company = await companyContext(req);
  const doc = await prisma.document.findFirst({
    where: { ref: param(req, 'ref'), companyId: company.id, classification: { in: ['Client', 'Public'] }, status: { in: ['Approved', 'Published'] } },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  const version = doc?.versions[0];
  if (!doc || !version) throw HttpError.notFound('Document not found');
  await prisma.$transaction((tx) =>
    writeAudit(tx, audit(req), { action: 'document.downloaded', objectType: 'document', objectId: doc.id, after: { version: version.version } }),
  );
  res.json({ url: signedDownloadUrl(version.fileId), expiresIn: 300, name: doc.name });
});
