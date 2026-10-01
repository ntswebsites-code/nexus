import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { actorName, ctx, param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requirePermission, requireStepUp } from '../../middleware/requireAuth';
import {
  TERM_SHEET_STATUSES,
  approve,
  createTermSheet,
  createTermSheetSchema,
  countersign,
  executeTermSheet,
  issue,
  loadExtras,
  loadTermSheet,
  returnToDraft,
  staffTermSheetView,
  submitForApproval,
  updateDraft,
  updateTermSheetSchema,
  withdraw,
} from '../term-sheets/term-sheets.service';

/**
 * `/api/v1/ops/term-sheets` - staff term sheet lifecycle (SRD 5D J6). Mounted under `opsRoutes`
 * (requireAuth + admin portal). Responses use `{ data }`.
 *
 *   GET    /                ?status=&company=   term_sheets.view
 *   POST   /                create draft         term_sheets.create
 *   GET    /:id                                  term_sheets.view
 *   PATCH  /:id             edit draft           term_sheets.create      (body.version)
 *   POST   /:id/submit      DRAFT -> PENDING_APPROVAL (author only)      term_sheets.create
 *   POST   /:id/approve     -> APPROVED          term_sheets.approve + step-up + Idempotency-Key; approver != author (403 segregation_of_duties)
 *   POST   /:id/return      -> DRAFT             term_sheets.approve, reason
 *   POST   /:id/issue       APPROVED -> ISSUED   term_sheets.create|approve + step-up + Idempotency-Key (generates PDF + signature request)
 *   POST   /:id/withdraw    -> WITHDRAWN         term_sheets.create|approve + step-up, reason
 */
export const opsTermSheetRoutes = Router();

const audit = (req: Request) => ctx(req, 'admin');
const actor = (req: Request) => ({ userId: req.user!.id, name: actorName(req), audit: audit(req) });
const VIEW = requirePermission('term_sheets.view');
const CREATE = requirePermission('term_sheets.create');
const APPROVE = requirePermission('term_sheets.approve');
const ISSUE = requireAnyPermission('term_sheets.create', 'term_sheets.approve');

async function view(id: string) {
  const ts = await loadTermSheet(id);
  const extras = await loadExtras([ts]);
  return staffTermSheetView(ts, extras.get(ts.id));
}

const listQuery = z.object({
  status: z.enum(TERM_SHEET_STATUSES).optional(),
  company: z.string().trim().max(36).optional(),
});

opsTermSheetRoutes.get('/', VIEW, async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) throw HttpError.badRequest('Invalid filter', q.error.issues);
  const rows = await prisma.termSheet.findMany({
    where: {
      ...(q.data.status ? { status: q.data.status } : {}),
      ...(q.data.company ? { company: { OR: [{ id: q.data.company }, { ref: q.data.company }] } } : {}),
    },
    include: { company: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const extras = await loadExtras(rows);
  res.json({ data: rows.map((r) => staffTermSheetView(r, extras.get(r.id))) });
});

opsTermSheetRoutes.post('/', CREATE, validateBody(createTermSheetSchema), async (req, res) => {
  const ts = await createTermSheet(actor(req), req.body as z.infer<typeof createTermSheetSchema>);
  res.status(201).json({ data: await view(ts.id) });
});

opsTermSheetRoutes.get('/:id', VIEW, async (req, res) => {
  res.json({ data: await view(param(req, 'id')) });
});

opsTermSheetRoutes.patch('/:id', CREATE, validateBody(updateTermSheetSchema), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await updateDraft(actor(req), ts, req.body as z.infer<typeof updateTermSheetSchema>);
  res.json({ data: await view(ts.id) });
});

opsTermSheetRoutes.post('/:id/submit', CREATE, async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await submitForApproval(actor(req), ts);
  res.json({ data: await view(ts.id) });
});

const noteSchema = z.object({ note: z.string().trim().max(2000).optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

opsTermSheetRoutes.post(
  '/:id/approve',
  APPROVE,
  requireStepUp,
  validateBody(noteSchema),
  idempotent('term_sheet.approve', { required: true }),
  async (req, res) => {
    const ts = await loadTermSheet(param(req, 'id'));
    await approve(actor(req), ts, (req.body as z.infer<typeof noteSchema>).note);
    res.json({ data: await view(ts.id) });
  },
);

opsTermSheetRoutes.post('/:id/return', APPROVE, validateBody(reasonSchema), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await returnToDraft(actor(req), ts, (req.body as z.infer<typeof reasonSchema>).reason);
  res.json({ data: await view(ts.id) });
});

opsTermSheetRoutes.post('/:id/issue', ISSUE, requireStepUp, idempotent('term_sheet.issue', { required: true }), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await issue(actor(req), ts);
  res.json({ data: await view(ts.id) });
});

opsTermSheetRoutes.post('/:id/countersign', APPROVE, requireStepUp, idempotent('term_sheet.countersign'), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await countersign(actor(req), ts);
  res.json({ data: await view(ts.id) });
});

opsTermSheetRoutes.post('/:id/execute', APPROVE, requireStepUp, idempotent('term_sheet.execute'), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await executeTermSheet(actor(req), ts);
  res.json({ data: await view(ts.id) });
});

opsTermSheetRoutes.post('/:id/withdraw', ISSUE, requireStepUp, validateBody(reasonSchema), async (req, res) => {
  const ts = await loadTermSheet(param(req, 'id'));
  await withdraw(actor(req), ts, (req.body as z.infer<typeof reasonSchema>).reason);
  res.json({ data: await view(ts.id) });
});
