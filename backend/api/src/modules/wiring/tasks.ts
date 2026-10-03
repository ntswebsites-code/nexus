import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { SYSTEM_ACTOR_ID, SYSTEM_NAME, systemCtx } from '../../lib/system';

/** Operations Control runbook tasks (page `operations`). Persisted in ops_tasks; generated tasks are unique per `sourceRef`. */
export const TASK_AREAS = ['SETTLEMENT', 'CASH', 'CORPORATE_ACTIONS', 'VALUATION', 'CLOSE', 'REPORTING', 'RISK', 'OTHER'] as const;
export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'] as const;
export type TaskRow = Prisma.OpsTaskGetPayload<object>;
type Tx = Prisma.TransactionClient;

export const endOfDay = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));

/** Creates the task for a source once. A DONE or CANCELLED task for the same source is reopened only when `reopen` is set. */
export async function ensureTask(tx: Tx, t: { area: (typeof TASK_AREAS)[number]; title: string; detail?: string; dueAt: Date; sourceRef: string; link?: string; ownerId?: string | null; reopen?: boolean }) {
  const found = await tx.opsTask.findUnique({ where: { sourceRef: t.sourceRef } });
  if (found) {
    if (t.reopen && ['DONE', 'CANCELLED'].includes(found.status)) {
      await tx.opsTask.update({ where: { id: found.id }, data: { status: 'OPEN', completedAt: null, completedBy: null, title: t.title, detail: t.detail ?? null, dueAt: t.dueAt, version: { increment: 1 } } });
      await writeAudit(tx, systemCtx(), { action: 'operations.task_reopened', objectType: 'ops_task', objectId: found.id, before: { status: found.status }, after: { status: 'OPEN', sourceRef: t.sourceRef } });
    }
    return { task: found, created: false };
  }
  const ref = await nextRef(tx, 'opsTask');
  const task = await tx.opsTask.create({
    data: { ref, area: t.area, title: t.title.slice(0, 200), detail: t.detail?.slice(0, 1000) ?? null, dueAt: t.dueAt, status: 'OPEN', ownerId: t.ownerId ?? null, link: t.link ?? null, sourceRef: t.sourceRef, createdBy: SYSTEM_ACTOR_ID },
  });
  await writeAudit(tx, systemCtx(), { action: 'operations.task_created', objectType: 'ops_task', objectId: task.id, after: { ref, area: t.area, title: t.title, sourceRef: t.sourceRef, system: true } });
  return { task, created: true };
}

/** Marks a generated task DONE when the condition behind it has cleared. */
export async function resolveTaskBySource(tx: Tx, sourceRef: string, note: string) {
  const found = await tx.opsTask.findUnique({ where: { sourceRef } });
  if (!found || ['DONE', 'CANCELLED'].includes(found.status)) return false;
  await tx.opsTask.update({ where: { id: found.id }, data: { status: 'DONE', completedAt: new Date(), completedBy: SYSTEM_ACTOR_ID, version: { increment: 1 } } });
  await writeAudit(tx, systemCtx(), { action: 'operations.task_completed', objectType: 'ops_task', objectId: found.id, before: { status: found.status }, after: { status: 'DONE', sourceRef }, reason: note });
  return true;
}

/** State shown on the runbook: DONE, BLOCKED (explicitly, or waiting on an unfinished task), DUE (due by end of today) or SCHEDULED. */
export function effectiveState(t: TaskRow, depDone: Map<string, boolean>, now = new Date()): 'DONE' | 'CANCELLED' | 'BLOCKED' | 'DUE' | 'SCHEDULED' {
  if (t.status === 'DONE') return 'DONE';
  if (t.status === 'CANCELLED') return 'CANCELLED';
  if (t.status === 'BLOCKED') return 'BLOCKED';
  if (t.dependsOnId && depDone.get(t.dependsOnId) === false) return 'BLOCKED';
  return t.dueAt.getTime() <= endOfDay(now).getTime() ? 'DUE' : 'SCHEDULED';
}

/**
 * Makes a generated task wait for another one: the child cannot be completed while the parent is unfinished. Applied once
 * (a child that already depends on something keeps it) and only while the parent is still live.
 */
export async function linkDependency(tx: Tx, childSourceRef: string, parentSourceRef: string) {
  const [child, parent] = await Promise.all([tx.opsTask.findUnique({ where: { sourceRef: childSourceRef } }), tx.opsTask.findUnique({ where: { sourceRef: parentSourceRef } })]);
  if (!child || !parent || child.dependsOnId || ['DONE', 'CANCELLED'].includes(child.status) || ['DONE', 'CANCELLED'].includes(parent.status)) return false;
  await tx.opsTask.update({ where: { id: child.id }, data: { dependsOnId: parent.id, version: { increment: 1 } } });
  await writeAudit(tx, systemCtx(), { action: 'operations.task_dependency_linked', objectType: 'ops_task', objectId: child.id, after: { child: child.ref, dependsOn: parent.ref } });
  return true;
}

export async function taskViews(rows: TaskRow[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.ownerId, r.completedBy, r.createdBy]).filter((x): x is string => !!x && x !== SYSTEM_ACTOR_ID))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name || u.email]));
  name.set(SYSTEM_ACTOR_ID, SYSTEM_NAME);
  const depIds = [...new Set(rows.map((r) => r.dependsOnId).filter((x): x is string => !!x))];
  const deps = depIds.length ? await prisma.opsTask.findMany({ where: { id: { in: depIds } }, select: { id: true, ref: true, title: true, status: true } }) : [];
  const dep = new Map(deps.map((d) => [d.id, d]));
  const counts = rows.length ? await prisma.opsTaskComment.groupBy({ by: ['taskId'], where: { taskId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }) : [];
  const commentsBy = new Map(counts.map((c) => [c.taskId, c._count._all]));
  const depDone = new Map(deps.map((d) => [d.id, ['DONE', 'CANCELLED'].includes(d.status)]));
  return rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    area: r.area,
    title: r.title,
    detail: r.detail,
    dueAt: r.dueAt.toISOString(),
    status: r.status,
    state: effectiveState(r, depDone),
    ownerId: r.ownerId,
    ownerName: r.ownerId ? (name.get(r.ownerId) ?? null) : null,
    dependsOnId: r.dependsOnId,
    dependsOn: r.dependsOnId ? (dep.get(r.dependsOnId) ? { ref: dep.get(r.dependsOnId)!.ref, title: dep.get(r.dependsOnId)!.title, status: dep.get(r.dependsOnId)!.status } : null) : null,
    blockedReason: r.blockedReason,
    link: r.link,
    system: r.createdBy === SYSTEM_ACTOR_ID,
    sourceRef: r.sourceRef,
    commentCount: commentsBy.get(r.id) ?? 0,
    completedByName: r.completedBy ? (name.get(r.completedBy) ?? null) : null,
    completedAt: r.completedAt?.toISOString() ?? null,
    createdByName: name.get(r.createdBy) ?? null,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  }));
}
