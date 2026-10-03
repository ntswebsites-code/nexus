import type { Prisma } from '@prisma/client';

/** Human reference formats (SRD 10.1). `start` is the first value ever issued. */
const FORMATS = {
  client: { prefix: 'CL-', pad: 5, start: 419 },
  mandate: { prefix: 'MND-', pad: 4, start: 1001 },
  cashAccount: { prefix: 'CCA-', pad: 4, start: 2001 },
  onboarding: { prefix: 'ONB-', pad: 6, start: 104830 },
  kycCase: { prefix: 'KYC-', pad: 4, start: 1001 },
  document: { prefix: 'DOC-', pad: 4, start: 3001 },
  request: { prefix: 'REQ-', pad: 4, start: 2052 },
  capital: { prefix: 'CAP-', pad: 4, start: 1001 },
  question: { prefix: 'Q-', pad: 4, start: 2042 },
  company: { prefix: 'PC-', pad: 3, start: 101 },
  portfolio: { prefix: 'PF-', pad: 4, start: 1001 },
  riskLimit: { prefix: 'LIM-', pad: 4, start: 1001 },
  riskCase: { prefix: 'RC-', pad: 4, start: 1001 },
  navRun: { prefix: 'NAV-', pad: 5, start: 1 },
  journal: { prefix: 'JNL-', pad: 5, start: 1 },
  corpAction: { prefix: 'CA-', pad: 5, start: 1 },
  cashLedger: { prefix: 'CLG-', pad: 4, start: 1001 },
  cashJournal: { prefix: 'CJ-', pad: 5, start: 1 },
  cashReservation: { prefix: 'RSV-', pad: 4, start: 1001 },
  cashExpectation: { prefix: 'EXP-', pad: 4, start: 1001 },
  cashImport: { prefix: 'IMP-', pad: 4, start: 1001 },
  opsTask: { prefix: 'OPT-', pad: 4, start: 1 },
  iborEvent: { prefix: 'IBE-', pad: 6, start: 1 },
  iborSnapshot: { prefix: 'IBR-', pad: 4, start: 1001 },
  perfPeriod: { prefix: 'PRF-', pad: 4, start: 1001 },
} as const;

export type RefKind = keyof typeof FORMATS;

/** Atomically allocates the next reference inside the caller's transaction. */
export async function nextRef(tx: Prisma.TransactionClient, kind: RefKind): Promise<string> {
  const f = FORMATS[kind];
  await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES (${kind}, ${f.start - 1}) ON DUPLICATE KEY UPDATE value = value`;
  await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = ${kind}`;
  const rows = await tx.$queryRaw<{ v: bigint }[]>`SELECT LAST_INSERT_ID() AS v`;
  return `${f.prefix}${String(Number(rows[0]!.v)).padStart(f.pad, '0')}`;
}
