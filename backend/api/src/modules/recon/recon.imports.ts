import type { Prisma } from '@prisma/client';
import { seqRef } from '../ops/ops.common';

/**
 * The shared counterparty-import pipeline (FR-REC-017). Every source that reaches reconciliation, whether a staff
 * member uploads a file or a connector pulls it, ends here: one `counterpart_imports` batch with the channel, account,
 * file name, record count, import time and SHA-256, and any earlier batch for the same feed, account and date marked
 * SUPERSEDED. Called inside the caller's transaction so the batch and the rows it loaded commit together.
 */
export type ImportSource = 'MANUAL' | 'CONNECTOR';
export type ImportFeed = 'POSITIONS' | 'CORP_ACTIONS' | 'STATEMENT';

export interface ImportBatchInput {
  /** Pre-allocated FEED-00000 reference, when the loader already stamped it on the rows. */
  ref?: string;
  source: ImportSource;
  connector?: string | null;
  feed: ImportFeed;
  counterpartyId: string;
  accountRef: string;
  asOfDate: Date;
  filename: string;
  format: string;
  recordCount: number;
  sha256: string;
  fileId?: string | null;
  receiptId?: string | null;
  note?: string | null;
  createdBy: string;
}

export async function newBatchRef(tx: Prisma.TransactionClient) {
  return seqRef(tx, 'reconFeed', 'FEED-', 5, 1);
}

export async function recordCounterpartImport(tx: Prisma.TransactionClient, i: ImportBatchInput) {
  const ref = i.ref ?? (await newBatchRef(tx));
  await tx.reconCounterpartImport.updateMany({
    where: { counterpartyId: i.counterpartyId, accountRef: i.accountRef, asOfDate: i.asOfDate, feed: i.feed, status: 'RECEIVED' },
    data: { status: 'SUPERSEDED' },
  });
  return tx.reconCounterpartImport.create({
    data: {
      ref,
      source: i.source,
      connector: i.connector ?? null,
      feed: i.feed,
      counterpartyId: i.counterpartyId,
      accountRef: i.accountRef,
      asOfDate: i.asOfDate,
      filename: i.filename.slice(0, 200),
      format: i.format,
      recordCount: i.recordCount,
      sha256: i.sha256,
      fileId: i.fileId ?? null,
      receiptId: i.receiptId ?? null,
      note: i.note ?? null,
      createdBy: i.createdBy,
    },
  });
}
