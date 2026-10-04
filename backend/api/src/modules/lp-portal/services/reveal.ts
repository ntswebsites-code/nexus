import type { Request } from 'express';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { decryptField } from '../../../lib/crypto';
import { readWire } from '../../ops/ops.common';
import { LpError } from '../lp.http';
import { assertFund, type LpContext } from '../lp.context';
import { lpAudit } from './common';
import { lpAllocationScope } from './capital';

/**
 * Full account number reveal (BR-101, FR-LP-054). The number stays masked in every list and detail payload; only an
 * explicit reveal returns it, only to SIGNATORY or MANAGER (the route gate), and every reveal is audited.
 * A VIEWER never reaches here (403 at the route) and so always sees the masked value.
 */

async function audited(req: Request, ctx: LpContext, objectType: string, objectId: string, extra: Record<string, unknown>) {
  await prisma.$transaction((tx) =>
    writeAudit(tx, lpAudit(req), { action: 'lp_account_number.revealed', objectType, objectId, after: { clientId: ctx.client.id, userId: ctx.userId, lpRole: ctx.lpRole, ...extra } }),
  );
}

export async function revealCallAccount(req: Request, ctx: LpContext, allocationId: string) {
  const a = await prisma.capitalCallAllocation.findFirst({ where: { id: allocationId, ...lpAllocationScope(ctx) }, include: { call: { select: { id: true, wireJson: true } } } });
  if (!a) throw new LpError(404, 'LP_NOT_FOUND', 'Capital call not found');
  const wire = readWire(a.call.wireJson);
  const accountNumber = wire?.accountNumberEnc ? decryptField(wire.accountNumberEnc) : null;
  if (!accountNumber) throw new LpError(404, 'LP_NOT_FOUND', 'No account number is on file for this call');
  await audited(req, ctx, 'capital_call_allocation', a.id, { source: 'capital_call_wiring', callId: a.call.id });
  return { accountNumber, accountNumberMasked: wire?.accountNumberMasked ?? '', revealedAt: new Date().toISOString() };
}

export async function revealBankAccount(req: Request, ctx: LpContext, bankId: string) {
  const b = await prisma.bankInstruction.findFirst({ where: { id: bankId, clientId: ctx.client.id, status: 'Active' } });
  if (!b) throw new LpError(404, 'LP_NOT_FOUND', 'Bank account not found');
  assertFund(ctx, b.fundId);
  const accountNumber = decryptField(b.identifierEnc);
  if (!accountNumber) throw new LpError(404, 'LP_NOT_FOUND', 'No account number is on file');
  await audited(req, ctx, 'bank_instruction', b.id, { source: 'dealing_bank_account' });
  return { accountNumber, accountNumberMasked: b.masked, revealedAt: new Date().toISOString() };
}
