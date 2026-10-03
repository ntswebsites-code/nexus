import type { Prisma } from '@prisma/client';

/**
 * Outbox event types handled by the worker (src/worker.ts). Enqueue inside the
 * business transaction so side effects happen only if the change commits.
 */
export type OutboxEventType =
  | 'notify.users'
  | 'notify.permission'
  | 'email.send'
  | 'kyc.screening.requested'
  | 'investee.mail';

export interface NotifyUsersPayload {
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
}

export interface NotifyPermissionPayload extends Omit<NotifyUsersPayload, 'userIds'> {
  /** Every active user holding this permission code is notified. */
  permission: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
}

export async function enqueue(tx: Prisma.TransactionClient, type: OutboxEventType, payload: object) {
  await tx.outboxEvent.create({ data: { type, payload: payload as Prisma.InputJsonValue } });
}
