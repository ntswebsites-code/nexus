import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { createRequest, resendRequest, type EsignActor, type FieldInput, type SignerInput } from './esign.service';

/**
 * Bulk send: the same PDF to many recipients, one signature request each (each signer signs their own copy).
 * Idempotent on `idempotencyKey`: replaying a submit returns the existing batch instead of creating duplicates.
 */

export interface BulkInput {
  title: string;
  message?: string;
  documentId?: string;
  fileId?: string;
  recipients: SignerInput[];
  expiresInDays?: number;
  reminderIntervalDays?: number;
  reminderMax?: number;
  /** Field boxes for each recipient; `signerEmail` is ignored (each request has one signer). */
  fieldTemplate?: Omit<FieldInput, 'signerEmail'>[];
  send?: boolean;
  idempotencyKey: string;
}

export const MAX_BULK = 100;

const ctx = (a: EsignActor) => ({ actorId: a.userId, actorRole: a.role, portal: a.portal, ip: a.ip, requestId: a.requestId ?? null });

export async function batchSummary(id: string) {
  const batch = await prisma.esignBatch.findUnique({ where: { id } });
  if (!batch) throw HttpError.notFound('Batch not found');
  const reqs = await prisma.esignRequest.findMany({
    where: { bulkBatchId: id },
    select: { id: true, ref: true, title: true, status: true, signers: { select: { name: true, email: true, status: true, reminderCount: true } } },
    orderBy: { ref: 'asc' },
  });
  const counts: Record<string, number> = {};
  for (const r of reqs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    id: batch.id,
    title: batch.title,
    total: batch.total,
    created: batch.created,
    failed: batch.failed,
    failures: (batch.failures ?? []) as { name: string; email: string; error: string }[],
    createdAt: batch.createdAt,
    counts,
    requests: reqs.map((r) => ({ id: r.id, ref: r.ref, status: r.status, signer: r.signers[0] ? { name: r.signers[0].name, email: r.signers[0].email, status: r.signers[0].status, reminders: r.signers[0].reminderCount } : null })),
  };
}

export async function listBatches() {
  const rows = await prisma.esignBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map((b) => ({ id: b.id, title: b.title, total: b.total, created: b.created, failed: b.failed, createdAt: b.createdAt }));
}

export async function bulkSend(actor: EsignActor, input: BulkInput) {
  if (!input.recipients.length) throw HttpError.badRequest('Add at least one recipient');
  if (input.recipients.length > MAX_BULK) throw HttpError.badRequest(`At most ${MAX_BULK} recipients per bulk send`);
  const key = input.idempotencyKey.slice(0, 120);
  const existing = await prisma.esignBatch.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  if (existing) return { replayed: true, batch: await batchSummary(existing.id) };

  let batchId: string;
  try {
    const b = await prisma.esignBatch.create({ data: { title: input.title.slice(0, 200), idempotencyKey: key, total: input.recipients.length, createdById: actor.userId } });
    batchId = b.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await prisma.esignBatch.findUniqueOrThrow({ where: { idempotencyKey: key }, select: { id: true } });
      return { replayed: true, batch: await batchSummary(again.id) };
    }
    throw e;
  }

  const failures: { name: string; email: string; error: string }[] = [];
  let created = 0;
  for (const r of input.recipients) {
    try {
      await createRequest(actor, {
        title: `${input.title} - ${r.name ?? r.email ?? 'signer'}`.slice(0, 200),
        message: input.message,
        documentId: input.documentId,
        fileId: input.fileId,
        signingOrder: 'PARALLEL',
        signers: [{ ...r, orderNo: 1 }],
        fields: input.fieldTemplate?.map((f) => ({ ...f, signerEmail: '*' })),
        expiresInDays: input.expiresInDays,
        reminderIntervalDays: input.reminderIntervalDays,
        reminderMax: input.reminderMax,
        subjectType: 'BULK',
        clientId: r.clientId,
        companyId: r.companyId,
        bulkBatchId: batchId,
        send: input.send,
      });
      created += 1;
    } catch (e) {
      failures.push({ name: r.name ?? '', email: r.email ?? '', error: (e as Error).message.slice(0, 300) });
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.esignBatch.update({ where: { id: batchId }, data: { created, failed: failures.length, failures: failures.length ? (failures as unknown as Prisma.InputJsonValue) : undefined } });
    await writeAudit(tx, ctx(actor), { action: 'esign.bulk.sent', objectType: 'esign_batch', objectId: batchId, after: { title: input.title, total: input.recipients.length, created, failed: failures.length } });
  });
  return { replayed: false, batch: await batchSummary(batchId) };
}

/** Sends a reminder to every signer in the batch whose request is still waiting. */
export async function remindBatch(actor: EsignActor, id: string) {
  const reqs = await prisma.esignRequest.findMany({ where: { bulkBatchId: id, status: 'PENDING' }, select: { id: true } });
  let reminded = 0;
  for (const r of reqs) {
    try {
      await resendRequest(actor, r.id);
      reminded += 1;
    } catch {
      // a request may have completed in the meantime
    }
  }
  return { reminded, batch: await batchSummary(id) };
}
