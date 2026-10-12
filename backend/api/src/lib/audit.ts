import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { sha256Hex } from './crypto';

export interface AuditContext {
  actorId?: string | null;
  actorRole?: string | null;
  portal?: string | null;
  ip?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const GENESIS = '0'.repeat(64);

/**
 * In-process serialization for the audit tail write. The hash chain must never fork
 * (SRD 7.13), and a raw `SELECT ... FOR UPDATE` on the tail row deadlocks when many
 * transactions contend at once (P2010/P2028 under load - 25 concurrent logins took
 * 36-44s and 500'd). Serialising the tail read+create inside the process removes the
 * lock contention while keeping the chain strictly sequential. Single API instance
 * (compose topology); multi-instance deployments would need a distributed lock.
 */
let auditTail: Promise<unknown> = Promise.resolve();

function withAuditTail<T>(fn: () => Promise<T>): Promise<T> {
  const run = auditTail.then(fn, fn);
  auditTail = run.catch(() => undefined);
  return run;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(canonical(value)) as Prisma.InputJsonValue;
}

/**
 * Appends one hash-chained audit event. Must run inside the same transaction as
 * the change it records (SRD 7.13): the tail row is locked so concurrent writers
 * serialise and the chain never forks.
 */
export async function writeAudit(tx: Prisma.TransactionClient, ctx: AuditContext, entry: AuditEntry) {
  await withAuditTail(async () => {
    const tail = await tx.$queryRaw<{ hash: string }[]>`SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1 FOR UPDATE`;
    const prevHash = tail[0]?.hash ?? GENESIS;
    const occurredAt = new Date();
    const before = toJson(entry.before);
    const after = toJson(entry.after);
    const body = canonical({
      occurredAt: occurredAt.toISOString(),
      actorId: ctx.actorId ?? null,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      before: before ?? null,
      after: after ?? null,
      reason: entry.reason ?? null,
    });
    const hash = sha256Hex(prevHash + body);
    await tx.auditEvent.create({
      data: {
        occurredAt,
        actorId: ctx.actorId ?? null,
        actorRole: ctx.actorRole?.slice(0, 120) ?? null,
        portal: ctx.portal ?? null,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        before,
        after,
        reason: entry.reason ?? null,
        ip: ctx.ip?.slice(0, 45) ?? null,
        requestId: ctx.requestId ?? null,
        prevHash,
        hash,
      },
    });
  });
}

/** Recomputes the chain; returns the first broken event id or null if intact. */
export async function verifyAuditChain(): Promise<{ checked: number; brokenAt: string | null }> {
  let prev = GENESIS;
  let checked = 0;
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await prisma.auditEvent.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: 1000,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const body = canonical({
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        action: row.action,
        objectType: row.objectType,
        objectId: row.objectId,
        before: row.before ?? null,
        after: row.after ?? null,
        reason: row.reason,
      });
      if (row.prevHash !== prev || sha256Hex(prev + body) !== row.hash) {
        return { checked, brokenAt: row.id.toString() };
      }
      prev = row.hash;
      checked += 1;
    }
    cursor = rows[rows.length - 1]!.id;
  }
  return { checked, brokenAt: null };
}
