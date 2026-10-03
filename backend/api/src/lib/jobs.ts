import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';

/** Identifies this process in claims and lock rows. */
export const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * Takes the named lock for `ttlMs` if nobody holds an unexpired one. Single conditional UPDATE (or insert on first use),
 * so two workers can never both win. Returns false when another worker holds it.
 */
export async function acquireJob(name: string, ttlMs: number): Promise<boolean> {
  const until = new Date(Date.now() + ttlMs);
  const taken = await prisma.$executeRaw`UPDATE job_locks SET locked_by = ${INSTANCE_ID}, locked_until = ${until} WHERE name = ${name} AND locked_until < NOW(3)`;
  if (taken > 0) return true;
  try {
    await prisma.jobLock.create({ data: { name, lockedBy: INSTANCE_ID, lockedUntil: until } });
    return true;
  } catch {
    return false;
  }
}

/** Marks the run finished: records the result and holds the lock until `nextInMs` so no worker re-runs the job early. */
export async function finishJob(name: string, result: object, nextInMs: number) {
  await prisma.jobLock.updateMany({
    where: { name, lockedBy: INSTANCE_ID },
    data: { lastRunAt: new Date(), lastResult: result as never, lockedUntil: new Date(Date.now() + nextInMs) },
  });
}

/** Releases the lock immediately (after a failed run, so it is retried on the next tick). */
export async function releaseJob(name: string) {
  await prisma.jobLock.updateMany({ where: { name, lockedBy: INSTANCE_ID }, data: { lockedUntil: new Date(0) } });
}
