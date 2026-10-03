import type { Prisma } from '@prisma/client';

/** Appends a counterparty-visible status history row for an execution (same transaction as the change). */
export async function recordExecutionEvent(
  tx: Prisma.TransactionClient,
  e: {
    executionId: string;
    counterpartyId: string;
    action: 'submitted' | 'amended' | 'cancelled' | 'matched' | 'exception';
    fromStatus: string | null;
    toStatus: string;
    reason?: string | null;
    changes?: Prisma.InputJsonValue;
    actorType?: 'COUNTERPARTY' | 'STAFF' | 'SYSTEM';
    actorId?: string | null;
  },
) {
  await tx.custodianExecutionEvent.create({
    data: {
      executionId: e.executionId,
      counterpartyId: e.counterpartyId,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      reason: e.reason ?? null,
      changes: e.changes,
      actorType: e.actorType ?? 'COUNTERPARTY',
      actorId: e.actorId ?? null,
    },
  });
}
