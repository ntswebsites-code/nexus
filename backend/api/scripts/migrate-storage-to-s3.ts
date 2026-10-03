/**
 * Copies stored files from the local filesystem store (STORAGE_DIR) to the S3 / MinIO store.
 * Idempotent: objects already in S3 are skipped, so it is safe to re-run. The local files are
 * never deleted. Bytes are copied as stored (AES-256-GCM ciphertext), then decrypted in memory
 * to verify size and sha256 against the `files` row; mismatching rows are corrected.
 *
 *   npx tsx --env-file-if-exists=../../.env scripts/migrate-storage-to-s3.ts [--dry-run] [--limit=N]
 *
 * Needs STORAGE_S3_ENDPOINT / STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY (bucket names default
 * to nexus-documents / nexus-esign / nexus-exports) and the same FILE_ENCRYPTION_KEY as the API.
 * Run it BEFORE switching INTEGRATION_OBJECT_STORAGE=s3 (or after: the API also falls back to
 * disk for objects that are not in S3 yet).
 */
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { decryptBuffer, sha256Hex } from '../src/lib/crypto';
import { LocalObjectStorage, ObjectNotFoundError, S3ObjectStorage, resolveStorageKey } from '../src/integrations/object-storage';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

async function main() {
  const { s3, dir } = config.storage;
  if (!s3.endpoint || !s3.accessKey || !s3.secretKey) {
    throw new Error('Set STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY first');
  }
  const target = new S3ObjectStorage({ ...s3 });
  const source = new LocalObjectStorage(dir);
  const ping = await target.ping();
  if (!ping.ok) throw new Error(`S3 store unreachable: ${ping.detail ?? 'unknown'}`);

  const stats = { total: 0, copied: 0, skipped: 0, missingLocal: 0, corrected: 0, failed: 0 };
  let cursor: string | undefined;
  console.log(`[migrate-storage] ${dryRun ? 'DRY RUN - ' : ''}source=${dir} target=${s3.endpoint}`);

  for (;;) {
    const rows = await prisma.fileObject.findMany({
      take: 200,
      orderBy: { id: 'asc' },
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1]!.id;
    for (const row of rows) {
      if (stats.total >= limit) break;
      stats.total++;
      const { bucket, key } = resolveStorageKey(row.storageKey);
      try {
        let bytes: Buffer | undefined;
        if (await target.exists(key, { bucket })) {
          stats.skipped++;
        } else {
          try {
            bytes = await source.get(key, { bucket });
          } catch (err) {
            if (err instanceof ObjectNotFoundError) {
              stats.missingLocal++;
              console.warn(`  missing on disk and in S3: ${row.id} (${row.storageKey})`);
              continue;
            }
            throw err;
          }
          if (!dryRun) await target.put(key, bytes, { bucket, contentType: row.mime, sha256: row.sha256 });
          stats.copied++;
        }
        // Verify content hash / size against the record (only when we hold the bytes).
        if (bytes) {
          const plain = decryptBuffer(bytes);
          const sha = sha256Hex(plain);
          if (sha !== row.sha256 || plain.length !== row.size) {
            stats.corrected++;
            console.warn(`  record mismatch ${row.id}: updating size/sha256${dryRun ? ' (dry run)' : ''}`);
            if (!dryRun) await prisma.fileObject.update({ where: { id: row.id }, data: { sha256: sha, size: plain.length } });
          }
        }
      } catch (err) {
        stats.failed++;
        console.error(`  FAILED ${row.id}: ${(err as Error).message}`);
      }
    }
    if (stats.total >= limit) break;
  }

  console.log('[migrate-storage]', JSON.stringify(stats));
  if (stats.failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
