/**
 * Custodian operations demo data (WP-7): backfills the status history of existing custodian executions and adds one
 * accepted bulk-upload batch (three executions, control totals matched) plus one rejected batch (kept as evidence),
 * so /custodian shows history, amend and cancel on real rows and the batch list is not empty.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-custodian-ops.ts      (standalone, after seed-uat)
 *
 * Idempotent: bulk trade references start with "BULK-DEMO-"; nothing is created when one exists; history rows are
 * only added for executions that have none. Skipped with a message when there is no custodian counterparty with an
 * account and an active user.
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { accountRefs, nextCustodianRef } from '../src/modules/custodian/custodian.service';
import { recordExecutionEvent } from '../src/modules/custodian/custodian.events';

const D = (v: string | number) => new Prisma.Decimal(v);
const log = (m: string) => console.log(`[seed:custodian-ops] ${m}`);

export async function seedCustodianOps() {
  const cp = await prisma.counterparty.findFirst({ where: { type: 'CUSTODIAN', status: 'ACTIVE' }, orderBy: { ref: 'asc' } });
  const account = cp ? accountRefs(cp.accounts)[0] : undefined;
  if (!cp || !account) return log('no custodian counterparty with an account; skipped');
  const link = await prisma.counterpartyUser.findFirst({ where: { counterpartyId: cp.id, status: 'active' } });
  if (!link) return log('no active custodian user; skipped');

  // Status history for executions that predate the history table.
  const existing = await prisma.counterpartyExecution.findMany({ where: { counterpartyId: cp.id }, select: { id: true, status: true, submittedById: true, submittedAt: true } });
  const withHistory = new Set((await prisma.custodianExecutionEvent.findMany({ where: { counterpartyId: cp.id }, select: { executionId: true } })).map((e) => e.executionId));
  let backfilled = 0;
  for (const e of existing.filter((x) => !withHistory.has(x.id))) {
    await prisma.custodianExecutionEvent.create({
      data: { executionId: e.id, counterpartyId: cp.id, action: 'submitted', fromStatus: null, toStatus: 'Received', actorType: 'COUNTERPARTY', actorId: e.submittedById, at: e.submittedAt },
    });
    backfilled++;
  }

  if (await prisma.counterpartyExecution.findFirst({ where: { counterpartyId: cp.id, tradeRef: { startsWith: 'BULK-DEMO-' } } })) {
    return log(`bulk demo records already present (backfilled ${backfilled} history rows)`);
  }

  const at = new Date(Date.now() - 2 * 3_600_000);
  const rows = [
    { tradeRef: 'BULK-DEMO-001', side: 'BUY', qty: 5000, price: '0.2100' },
    { tradeRef: 'BULK-DEMO-002', side: 'BUY', qty: 2500, price: '0.2150' },
    { tradeRef: 'BULK-DEMO-003', side: 'SELL', qty: 1000, price: '0.2200' },
  ];
  const quantity = rows.reduce((a, r) => a.plus(r.qty), D(0));
  const notional = rows.reduce((a, r) => a.plus(D(r.qty).times(r.price)), D(0)).toDecimalPlaces(2);
  const currency = 'USD';

  await prisma.$transaction(async (tx) => {
    const batch = await tx.custodianExecutionBatch.create({
      data: {
        ref: await nextCustodianRef(tx, 'custodianBatch'),
        counterpartyId: cp.id,
        fileName: 'demo-executions.csv',
        rowCount: rows.length,
        acceptedCount: rows.length,
        duplicateCount: 0,
        rejectedCount: 0,
        declaredCount: rows.length,
        declaredQuantity: quantity,
        declaredNotional: notional,
        actualQuantity: quantity,
        actualNotional: notional,
        controlStatus: 'OK',
        status: 'Accepted',
        submittedById: link.userId,
        submittedAt: at,
      },
    });
    for (const r of rows) {
      const row = await tx.counterpartyExecution.create({
        data: {
          ref: await nextCustodianRef(tx, 'custodianExecution'),
          counterpartyId: cp.id,
          tradeRef: r.tradeRef,
          executionAt: at,
          accountRef: account,
          ticker: 'DLTA.ZW',
          side: r.side,
          quantity: r.qty,
          price: r.price,
          currency,
          broker: 'Demo Securities',
          submittedById: link.userId,
          submittedAt: at,
          batchId: batch.id,
        },
      });
      await recordExecutionEvent(tx, { executionId: row.id, counterpartyId: cp.id, action: 'submitted', fromStatus: null, toStatus: 'Received', reason: `Bulk upload ${batch.ref}`, actorId: link.userId });
    }
    await tx.custodianExecutionBatch.create({
      data: {
        ref: await nextCustodianRef(tx, 'custodianBatch'),
        counterpartyId: cp.id,
        fileName: 'demo-executions-bad.csv',
        rowCount: 2,
        acceptedCount: 0,
        duplicateCount: 0,
        rejectedCount: 2,
        actualQuantity: D(0),
        actualNotional: D(0),
        controlStatus: 'NONE',
        status: 'Rejected',
        errors: [{ row: 3, field: 'quantity', message: 'Quantity must be greater than zero' }] as unknown as Prisma.InputJsonValue,
        submittedById: link.userId,
        submittedAt: new Date(at.getTime() - 3_600_000),
      },
    });
  });
  log(`${cp.ref}/${account}: 1 accepted batch (3 executions), 1 rejected batch, ${backfilled} history rows backfilled`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedCustodianOps()
    .catch((err) => {
      console.error('[seed:custodian-ops] FAILED:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
