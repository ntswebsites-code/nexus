import { prisma } from './prisma';

export const CLAIM_BATCH = 25;
export const MAX_ATTEMPTS = 8;
export const CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Claims up to `batch` unpublished outbox events for `instanceId` with one conditional UPDATE (NFR-AV-005): rows already
 * claimed by a live worker are skipped, claims older than `staleMs` (a crashed worker) are taken over, and rows in
 * back-off (`next_attempt_at` in the future) are left alone. MySQL serialises the UPDATE per row, so two workers can
 * never hold the same event; the SELECT afterwards returns only this instance's rows.
 */
export async function claimEvents(instanceId: string, batch = CLAIM_BATCH, staleMs = CLAIM_STALE_MS) {
  const stale = new Date(Date.now() - staleMs);
  await prisma.$executeRaw`UPDATE outbox_events SET claimed_by = ${instanceId}, claimed_at = NOW(3)
    WHERE published_at IS NULL AND attempts < ${MAX_ATTEMPTS}
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW(3))
      AND (claimed_by IS NULL OR claimed_at < ${stale})
    ORDER BY id LIMIT ${batch}`;
  return prisma.outboxEvent.findMany({ where: { publishedAt: null, claimedBy: instanceId }, orderBy: { id: 'asc' }, take: batch });
}
