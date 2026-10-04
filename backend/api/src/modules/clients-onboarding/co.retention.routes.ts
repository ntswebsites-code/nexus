import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { expectVersion, param } from '../../lib/http';
import { enforceSchedules } from '../../lib/retention-schedule';
import { validateBody } from '../../middleware/validate';
import { requirePermission } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { CLASSIFICATIONS } from './co.engine';

/** FR-DOC-017: retention schedules (per type and classification) with legal-hold counts. Mounted under `/client-ops/vault`. */
export const coRetentionRoutes = Router();

const TYPES = ['report', 'statement', 'capital', 'legal', 'tax', 'kyc', 'company', 'research', 'ic', 'clients', 'compliance', 'valuations', 'other'];
const typeField = z.string().trim().refine((v) => v === '*' || TYPES.includes(v), 'Unknown document type');
const classField = z.string().trim().refine((v) => v === '*' || (CLASSIFICATIONS as readonly string[]).includes(v), 'Unknown classification');
const years = z.number().int().min(1).max(50);

const view = (r: { id: string; docType: string; classification: string; retentionYears: number; basis: string | null; active: boolean; version: number; updatedAt: Date }) => ({
  id: r.id,
  docType: r.docType,
  classification: r.classification,
  retentionYears: r.retentionYears,
  basis: r.basis,
  active: r.active,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
});

coRetentionRoutes.get('/vault/retention-schedules', requirePermission('documents.view'), async (_req, res) => {
  const [rows, holds, total] = await Promise.all([
    prisma.documentRetentionSchedule.findMany({ orderBy: [{ docType: 'asc' }, { classification: 'asc' }] }),
    prisma.documentHold.count({ where: { releasedAt: null } }),
    prisma.document.count(),
  ]);
  res.json({ data: rows.map(view), total: rows.length, activeHolds: holds, documents: total, types: TYPES, classifications: CLASSIFICATIONS });
});

const createSchema = z.object({ docType: typeField.default('*'), classification: classField.default('*'), retentionYears: years, basis: z.string().trim().max(300).optional(), reason: z.string().trim().min(5).max(500) }).strict();

coRetentionRoutes.post('/vault/retention-schedules', requirePermission('documents.approve'), validateBody(createSchema), idempotent('co.retention_schedule.create', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof createSchema>;
  if (await prisma.documentRetentionSchedule.findUnique({ where: { docType_classification: { docType: b.docType, classification: b.classification } }, select: { id: true } })) {
    throw HttpError.conflict('A schedule for this type and classification already exists; edit it instead', 'duplicate');
  }
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.documentRetentionSchedule.create({ data: { docType: b.docType, classification: b.classification, retentionYears: b.retentionYears, basis: b.basis ?? null, createdBy: req.user!.id } });
    await writeAudit(tx, audit(req), { action: 'document.retention_schedule_created', objectType: 'retention_schedule', objectId: r.id, after: { docType: b.docType, classification: b.classification, retentionYears: b.retentionYears }, reason: b.reason });
    return r;
  });
  res.status(201).json({ schedule: view(row) });
});

const patchSchema = z.object({ retentionYears: years.optional(), basis: z.string().trim().max(300).nullable().optional(), active: z.boolean().optional(), version: z.number().int().optional(), reason: z.string().trim().min(5).max(500) }).strict();

coRetentionRoutes.patch('/vault/retention-schedules/:id', requirePermission('documents.approve'), validateBody(patchSchema), idempotent('co.retention_schedule.update', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof patchSchema>;
  const cur = await prisma.documentRetentionSchedule.findUnique({ where: { id: param(req, 'id') } });
  if (!cur) throw HttpError.notFound('Schedule not found');
  expectVersion(req, cur.version);
  const data = { retentionYears: b.retentionYears ?? cur.retentionYears, basis: b.basis === undefined ? cur.basis : b.basis, active: b.active ?? cur.active };
  const row = await prisma.$transaction(async (tx) => {
    const n = await tx.documentRetentionSchedule.updateMany({ where: { id: cur.id, version: cur.version }, data: { ...data, updatedBy: req.user!.id, version: { increment: 1 } } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'document.retention_schedule_updated',
      objectType: 'retention_schedule',
      objectId: cur.id,
      before: { retentionYears: cur.retentionYears, basis: cur.basis, active: cur.active },
      after: data,
      reason: b.reason,
    });
    return tx.documentRetentionSchedule.findUniqueOrThrow({ where: { id: cur.id } });
  });
  res.json({ schedule: view(row) });
});

const applySchema = z.object({ dryRun: z.boolean().default(true) }).strict();

/** Runs the enforcement the nightly job runs: a dry run reports counts, otherwise it raises retention on documents below their schedule. */
coRetentionRoutes.post('/vault/retention-schedules/apply', requirePermission('documents.approve'), validateBody(applySchema), idempotent('co.retention_schedule.apply', { required: false }), async (req, res) => {
  const { dryRun } = req.body as z.infer<typeof applySchema>;
  const result = await enforceSchedules(dryRun);
  if (!dryRun) await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'document.retention_schedule_applied', objectType: 'retention_schedule', objectId: 'all', after: result }));
  res.json({ dryRun, ...result });
});
