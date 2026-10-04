import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { idempotent } from '../../lib/idempotency';
import { param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { uploadFiles } from '../../middleware/upload';
import { requireAuth, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { batchView, commitImport, previewImport, templateCsv, type ImportKind } from './imports.core';
import { ordersImport } from './imports.orders';
import { marginStatementImport } from './imports.fin';
import { riskLimitsImport, riskPositionsImport } from './imports.risk';
import { pmCommitmentsImport, pmFundsImport, pmValuationsImport } from './imports.pm';

/**
 * Import framework API (build-plan S3), mounted at `/api/v1/imports`. Each kind brings its own permissions; the same
 * ones are needed to preview, commit and read its batches.
 *
 *   GET  /kinds                         the kinds the caller may use, with their columns
 *   GET  /:kind/template                header and example row as CSV
 *   POST /:kind/preview                 multipart `file` (CSV, XLSX or JSON) plus the kind's fields: the dry run
 *   POST /:kind/:batchId/commit         applies a previewed batch (Idempotency-Key; step-up where the kind needs it)
 *   GET  /batches?kind=                 recent batches
 *   GET  /batches/:id                   one batch with its row errors
 */
export const importsRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];

export const IMPORT_KINDS: ImportKind<never>[] = [ordersImport, marginStatementImport, riskPositionsImport, riskLimitsImport, pmFundsImport, pmCommitmentsImport, pmValuationsImport] as unknown as ImportKind<never>[];

const kindOf = (name: string) => {
  const k = IMPORT_KINDS.find((x) => x.kind === name);
  if (!k) throw HttpError.notFound('Unknown import kind');
  return k;
};
const may = (req: Request, k: ImportKind<never>) => k.permissions.every((p) => req.user!.permissions.includes(p));
const need = (req: Request, k: ImportKind<never>) => {
  if (!may(req, k)) throw HttpError.forbidden('You do not have permission to import this kind of file', 'permission_denied');
};

/** Form fields arrive as strings in the multipart body; only the kind's declared fields are kept. */
const fieldsOf = (req: Request, k: ImportKind<never>) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const keys = [...(k.fields ?? []).map((f) => f.key), ...(k.controlTotalKey ? ['controlCount', 'controlTotal'] : [])];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 40);
  }
  return out;
};

importsRoutes.get('/kinds', ...staff, (req, res) => {
  res.json({
    data: IMPORT_KINDS.filter((k) => may(req, k)).map((k) => ({
      kind: k.kind,
      title: k.title,
      stepUp: !!k.stepUp,
      controlTotals: k.controlTotalKey ? { column: k.controlTotalKey, required: !!k.controlRequired } : null,
      fields: k.fields ?? [],
      columns: k.columns.map((c) => ({ key: c.key, label: c.label, required: !!c.required, example: c.example ?? '', hint: c.hint ?? '' })),
    })),
  });
});

const batchesQuery = z.object({ kind: z.string().trim().max(24).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

importsRoutes.get('/batches', ...staff, validateQuery(batchesQuery), async (req, res) => {
  const f = query<z.infer<typeof batchesQuery>>(req);
  const allowed = IMPORT_KINDS.filter((k) => may(req, k)).map((k) => k.kind);
  if (f.kind && !allowed.includes(f.kind)) throw HttpError.forbidden('You do not have permission to see these imports', 'permission_denied');
  const rows = await prisma.importBatch.findMany({ where: { kind: f.kind ? f.kind : { in: allowed } }, orderBy: { createdAt: 'desc' }, take: f.limit });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, name: true, email: true } });
  const nm = new Map(users.map((u) => [u.id, u.name || u.email]));
  res.json({ data: rows.map((r) => ({ ...batchView(r), createdByName: nm.get(r.createdBy) ?? null })), total: rows.length });
});

importsRoutes.get('/batches/:id', ...staff, async (req, res) => {
  const b = await prisma.importBatch.findUnique({ where: { id: param(req, 'id') } });
  if (!b) throw HttpError.notFound('Import batch not found');
  need(req, kindOf(b.kind));
  res.json({ data: batchView(b) });
});

importsRoutes.get('/:kind/template', ...staff, (req, res) => {
  const k = kindOf(param(req, 'kind'));
  need(req, k);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${k.kind}-template.csv"`);
  res.send(templateCsv(k));
});

importsRoutes.post('/:kind/preview', ...staff, uploadFiles('file'), idempotent('imports.preview', { required: false }), async (req, res) => {
  const k = kindOf(param(req, 'kind'));
  need(req, k);
  if (!req.file) throw HttpError.badRequest('Choose a CSV, XLSX or JSON file to upload');
  res.status(201).json({ data: await previewImport(k, req, req.file, fieldsOf(req, k)) });
});

const commitBody = z.object({ skipInvalid: z.boolean().optional(), allowDuplicate: z.boolean().optional() }).strict();

/** Step-up only where the kind asks for it (sensitive writes such as holdings). */
const stepUpIfNeeded: RequestHandler = (req, res, next) => {
  const k = IMPORT_KINDS.find((x) => x.kind === req.params.kind);
  // requireStepUp is async: a rejection must reach the error handler, not escape as an unhandled rejection
  if (k?.stepUp) return void Promise.resolve(requireStepUp(req, res, next)).catch(next);
  next();
};

importsRoutes.post('/:kind/:batchId/commit', ...staff, validateBody(commitBody), stepUpIfNeeded, idempotent('imports.commit', { required: false }), async (req, res) => {
  const k = kindOf(param(req, 'kind'));
  need(req, k);
  const b = req.body as z.infer<typeof commitBody>;
  res.json({ data: await commitImport(k, req, param(req, 'batchId'), { skipInvalid: b.skipInvalid, allowDuplicate: b.allowDuplicate }) });
});
