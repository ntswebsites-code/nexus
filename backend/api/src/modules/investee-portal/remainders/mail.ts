import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { enqueue } from '../../../lib/outbox';
import { redactSecrets } from '../../../lib/mailer';
import { getEmailAdapter } from '../../../integrations/email';

export interface InvesteeMailInput {
  companyId: string;
  kind: 'SHARE_LINK' | 'SIGN_REQUEST' | 'SIGN_REMINDER';
  subjectType: string;
  subjectId: string;
  /** One mail per business event; a repeat with the same key is ignored. */
  dedupeKey: string;
  to: string;
  subject: string;
  text: string;
}

/** Records the delivery and queues it for the worker, inside the caller's transaction (no mail unless the change commits). */
export async function queueInvesteeMail(tx: Prisma.TransactionClient, m: InvesteeMailInput) {
  const dedupeKey = m.dedupeKey.slice(0, 160);
  if (await tx.investeeMailLog.findUnique({ where: { dedupeKey }, select: { id: true } })) return;
  const log = await tx.investeeMailLog.create({
    data: { companyId: m.companyId, kind: m.kind, subjectType: m.subjectType.slice(0, 24), subjectId: m.subjectId.slice(0, 64), recipient: m.to.slice(0, 254), subject: m.subject.slice(0, 300), dedupeKey },
  });
  await enqueue(tx, 'investee.mail', { logId: log.id, to: m.to, subject: m.subject, text: m.text });
}

/** Worker handler for the `investee.mail` outbox event: sends through the email adapter and records the outcome. A failure is rethrown so the outbox retries. */
export async function deliverInvesteeMail(payload: unknown) {
  const p = payload as { logId: string; to: string; subject: string; text: string };
  const log = await prisma.investeeMailLog.findUnique({ where: { id: p.logId } });
  if (!log || log.status === 'SENT') return;
  try {
    const receipt = await getEmailAdapter().send({ to: p.to, subject: p.subject, text: p.text });
    await prisma.investeeMailLog.update({ where: { id: log.id }, data: { status: 'SENT', attempts: { increment: 1 }, messageId: receipt.messageId.slice(0, 160), transport: receipt.transport, sentAt: new Date(), lastError: null } });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300);
    await prisma.investeeMailLog.update({ where: { id: log.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message } });
    throw error;
  }
}

export async function mailLog(companyId: string, take = 100) {
  const rows = await prisma.investeeMailLog.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take });
  return rows.map((r) => ({ id: r.id, kind: r.kind, subjectId: r.subjectId, recipient: r.recipient, subject: r.subject, status: r.status, attempts: r.attempts, transport: r.transport, error: r.lastError, sentAt: r.sentAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }));
}

/** Active users of a company, for notifications. */
export async function companyUserIds(companyId: string): Promise<string[]> {
  const rows = await prisma.companyUser.findMany({ where: { companyId, status: 'active', user: { isActive: true } }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
