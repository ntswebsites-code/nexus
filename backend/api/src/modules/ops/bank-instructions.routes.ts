import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { param } from '../../lib/http';
import { idempotent } from '../../lib/idempotency';
import { validateBody } from '../../middleware/validate';
import { requireAnyPermission, requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, audit, notifyClientMembers } from './ops.common';

/**
 * `/api/v1/ops/bank-instructions` — staff verification of LP bank-instruction changes (BR-185).
 * Pending verification --callback--> Under verification --approve (different person, step-up)--> Active.
 * The previous active instruction for the same client and fund is superseded. The account number stays encrypted.
 */
export const opsBankInstructionRoutes = Router();

const PENDING = 'Pending verification';
const UNDER = 'Under verification';
const ACTIVE = 'Active';
const REJECTED = 'Rejected';

const VIEW = requirePermission('clients.view');
const VERIFY = requirePermission('clients.edit');
const APPROVE = requirePermission('cash.approve');
const DECIDE = requireAnyPermission('clients.edit', 'cash.approve');

async function requesterId(instructionId: string) {
  const row = await prisma.auditEvent.findFirst({
    where: { objectType: 'bank_instruction', objectId: instructionId, action: 'bank_instruction.change_requested' },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true },
  });
  return row?.actorId ?? null;
}

async function verifierId(instructionId: string) {
  const row = await prisma.auditEvent.findFirst({
    where: { objectType: 'bank_instruction', objectId: instructionId, action: 'bank_instruction.callback_verified' },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true },
  });
  return row?.actorId ?? null;
}

function view(row: {
  id: string;
  clientId: string;
  version: number;
  bank: string;
  accountName: string | null;
  masked: string;
  status: string;
  fundId: string | null;
  label: string | null;
  currency: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  client: { ref: string; name: string };
  fund?: { name: string; ref: string } | null;
}) {
  return {
    id: row.id,
    clientId: row.clientId,
    clientRef: row.client.ref,
    clientName: row.client.name,
    version: row.version,
    bankName: row.bank,
    accountName: row.accountName,
    accountNumberMasked: row.masked,
    status: row.status,
    fundId: row.fundId,
    fundName: row.fund?.name ?? (row.fundId ? null : 'All funds'),
    label: row.label,
    currency: row.currency,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    submittedAt: row.createdAt.toISOString(),
  };
}

const include = { client: { select: { ref: true, name: true } }, } as const;

opsBankInstructionRoutes.get('/', VIEW, async (req, res) => {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
  const rows = await prisma.bankInstruction.findMany({
    where: status ? { status } : { status: { in: [PENDING, UNDER, ACTIVE, REJECTED] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { client: { select: { ref: true, name: true } } },
  });
  const fundIds = [...new Set(rows.map((r) => r.fundId).filter((x): x is string => !!x))];
  const funds = fundIds.length ? await prisma.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, name: true, ref: true } }) : [];
  const byId = new Map(funds.map((f) => [f.id, f]));
  res.json({ data: rows.map((r) => view({ ...r, fund: r.fundId ? byId.get(r.fundId) ?? null : null })) });
});

const callbackSchema = z.object({
  callbackNote: z.string().trim().min(3).max(500),
});

opsBankInstructionRoutes.post('/:id/verify', VERIFY, requireStepUp, validateBody(callbackSchema), idempotent('ops.bank.verify'), async (req, res) => {
  const id = param(req, 'id');
  const row = await prisma.bankInstruction.findUnique({ where: { id }, include });
  if (!row) throw HttpError.notFound('Bank instruction not found');
  if (row.status !== PENDING) throw HttpError.conflict(`Only a pending instruction can be verified (this one is ${row.status})`, 'invalid_state');
  assertSegregation(req.user!.id, await requesterId(id));
  const note = (req.body as z.infer<typeof callbackSchema>).callbackNote;
  await prisma.$transaction(async (tx) => {
    const n = await tx.bankInstruction.updateMany({ where: { id, status: PENDING }, data: { status: UNDER } });
    if (n.count !== 1) throw HttpError.conflict('This instruction changed. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'bank_instruction.callback_verified',
      objectType: 'bank_instruction',
      objectId: id,
      before: { status: PENDING },
      after: { status: UNDER, masked: row.masked, bank: row.bank },
      reason: note,
    });
  });
  const fresh = await prisma.bankInstruction.findUniqueOrThrow({ where: { id }, include });
  res.json({ data: view(fresh) });
});

opsBankInstructionRoutes.post('/:id/approve', APPROVE, requireStepUp, idempotent('ops.bank.approve'), async (req, res) => {
  const id = param(req, 'id');
  const row = await prisma.bankInstruction.findUnique({ where: { id }, include });
  if (!row) throw HttpError.notFound('Bank instruction not found');
  if (row.status !== UNDER) throw HttpError.conflict('Record the call-back before activating this instruction', 'invalid_state');
  assertSegregation(req.user!.id, await requesterId(id), await verifierId(id));
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.bankInstruction.updateMany({
      where: { clientId: row.clientId, status: ACTIVE, fundId: row.fundId, id: { not: id } },
      data: { status: 'Superseded' },
    });
    const n = await tx.bankInstruction.updateMany({
      where: { id, status: UNDER },
      data: { status: ACTIVE, verifiedAt: now, isDefault: row.fundId === null },
    });
    if (n.count !== 1) throw HttpError.conflict('This instruction changed. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'bank_instruction.activated',
      objectType: 'bank_instruction',
      objectId: id,
      before: { status: UNDER },
      after: { status: ACTIVE, masked: row.masked, bank: row.bank, fundId: row.fundId },
    });
    await notifyClientMembers(tx, row.clientId, {
      type: 'bank_instruction.activated',
      title: 'Bank instruction verified',
      body: `${row.bank} ${row.masked} is now the active instruction.`,
      link: '/organisation',
    });
  });
  const fresh = await prisma.bankInstruction.findUniqueOrThrow({ where: { id }, include });
  res.json({ data: view(fresh) });
});

const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

opsBankInstructionRoutes.post('/:id/reject', DECIDE, requireStepUp, validateBody(rejectSchema), idempotent('ops.bank.reject'), async (req, res) => {
  const id = param(req, 'id');
  const row = await prisma.bankInstruction.findUnique({ where: { id }, include });
  if (!row) throw HttpError.notFound('Bank instruction not found');
  if (row.status !== PENDING && row.status !== UNDER) throw HttpError.conflict('This instruction is no longer awaiting a decision', 'invalid_state');
  assertSegregation(req.user!.id, await requesterId(id));
  const reason = (req.body as z.infer<typeof rejectSchema>).reason;
  await prisma.$transaction(async (tx) => {
    const n = await tx.bankInstruction.updateMany({ where: { id, status: row.status }, data: { status: REJECTED } });
    if (n.count !== 1) throw HttpError.conflict('This instruction changed. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), {
      action: 'bank_instruction.rejected',
      objectType: 'bank_instruction',
      objectId: id,
      before: { status: row.status },
      after: { status: REJECTED, masked: row.masked },
      reason,
    });
    await notifyClientMembers(tx, row.clientId, {
      type: 'bank_instruction.rejected',
      title: 'Bank instruction change was not accepted',
      body: reason,
      link: '/organisation',
    });
  });
  const fresh = await prisma.bankInstruction.findUniqueOrThrow({ where: { id }, include });
  res.json({ data: view(fresh) });
});
