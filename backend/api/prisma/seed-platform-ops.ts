/**
 * Package S8 demo data: baseline document retention schedules (FR-DOC-017). Each row is the 7 year floor already used
 * as the upload default, so seeding changes no existing document; staff raise or add rows on the Vault retention tab.
 * Idempotent: a row that exists for the same type and classification is left alone. Nothing is revoked or overwritten.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-platform-ops.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { SYSTEM_ACTOR_ID } from '../src/lib/system';

const log = (m: string) => console.log(`[seed:platform-ops] ${m}`);

const SCHEDULES = [
  { docType: 'kyc', classification: '*', retentionYears: 7, basis: 'AML and KYC records: kept at least 7 years after the relationship ends' },
  { docType: 'tax', classification: '*', retentionYears: 7, basis: 'Tax documents: statutory 7 year retention' },
  { docType: 'statement', classification: '*', retentionYears: 7, basis: 'Client statements: 7 years' },
  { docType: 'legal', classification: '*', retentionYears: 7, basis: 'Legal agreements: 7 years after expiry' },
] as const;

export async function seedPlatformOps() {
  let added = 0;
  for (const s of SCHEDULES) {
    const exists = await prisma.documentRetentionSchedule.findUnique({ where: { docType_classification: { docType: s.docType, classification: s.classification } }, select: { id: true } });
    if (exists) continue;
    await prisma.documentRetentionSchedule.create({ data: { ...s, createdBy: SYSTEM_ACTOR_ID } });
    added += 1;
  }
  log(`retention schedules: ${added} added`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedPlatformOps();
  } catch (err) {
    console.error('[seed:platform-ops] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
