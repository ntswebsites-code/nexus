import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { config } from '../config';
import {
  ObjectNotFoundError,
  legacyLocalStorage,
  makeStorageKey,
  objectStorage,
  resolveStorageKey,
  type StorageBucket,
} from '../integrations/object-storage';
import { prisma } from './prisma';
import { hmacHex, safeEqualHex, sha256Hex } from './crypto';
import { getAvScanAdapter } from '../integrations/av-scan';
import { getObjectStorageAdapter } from '../integrations/object-storage';
import { HttpError } from './errors';

/**
 * Encrypted object store (SRD 10.3 "S3-compatible, encrypted"). Bytes go through the object-storage adapter
 * (fake = local AES-256-GCM files under STORAGE_DIR) and every upload is scanned by the av-scan adapter first.
=======
 * Encrypted object store (SRD 10.3 "S3-compatible, encrypted"). Files are AES-256-GCM
 * encrypted by the app before they reach the backend chosen by INTEGRATION_OBJECT_STORAGE
 * (local filesystem under STORAGE_DIR, or S3 / MinIO). Every document, upload, vault, report
 * and export write goes through `storeFile`, which records size, content type and sha256 of
 * the plaintext on the `files` row.
 */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/octet-stream',
]);

const putObject = (key: string, data: Buffer) => getObjectStorageAdapter().put(key, data);
const getObject = (key: string): Promise<Buffer> => getObjectStorageAdapter().get(key);
=======
async function putObject(storageKey: string, data: Buffer, mime: string, sha256: string) {
  const { bucket, key } = resolveStorageKey(storageKey);
  await objectStorage().put(key, encryptBuffer(data), { bucket, contentType: mime, sha256 });
}

/** Raw (still encrypted) stored bytes. With s3 active, objects not yet migrated are read from disk. */
export async function getStoredBytes(storageKey: string): Promise<Buffer> {
  const { bucket, key } = resolveStorageKey(storageKey);
  const store = objectStorage();
  try {
    return await store.get(key, { bucket });
  } catch (err) {
    if (err instanceof ObjectNotFoundError && store.kind === 's3') {
      return legacyLocalStorage().get(key, { bucket });
    }
    throw err;
  }
}

async function getObject(storageKey: string): Promise<Buffer> {
  return decryptBuffer(await getStoredBytes(storageKey));
}

export interface StoredFileInput {
  name: string;
  mime: string;
  data: Buffer;
  uploadedById?: string | null;
  applicationId?: string | null;
  /** Target bucket; defaults to `documents`. Reports and exports use `exports`. */
  bucket?: StorageBucket;
}

export async function storeFile(input: StoredFileInput, db: Prisma.TransactionClient = prisma) {
  const mime = input.mime || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    throw HttpError.badRequest(`File type ${mime} is not accepted`);
  }
  if (input.data.length > config.storage.maxUploadBytes) {
    throw new HttpError(413, 'payload_too_large', 'File is larger than the upload limit');
  }
  const scan = await getAvScanAdapter().scan({ name: input.name, mime, data: input.data });
  if (scan.verdict !== 'clean') {
    throw new HttpError(422, 'malware_detected', `The file was rejected by the malware scan${scan.signature ? ` (${scan.signature})` : ''}`);
  }
  const storageKey = randomUUID().replace(/-/g, '');
  await putObject(storageKey, input.data);
=======
  const storageKey = makeStorageKey(input.bucket ?? 'documents', randomUUID().replace(/-/g, ''));
  const sha256 = sha256Hex(input.data);
  await putObject(storageKey, input.data, mime, sha256);
  return db.fileObject.create({
    data: {
      storageKey,
      name: input.name.slice(0, 255),
      mime,
      size: input.data.length,
      sha256,
      scanStatus: 'clean',
      uploadedById: input.uploadedById ?? null,
      applicationId: input.applicationId ?? null,
    },
  });
}

export async function readFileObject(fileId: string) {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId } });
  if (!file) throw HttpError.notFound('File not found');
  return { file, data: await getObject(file.storageKey) };
}

/** Short-lived signed download URL. Authorisation is checked before one is issued. */
export function signedDownloadUrl(fileId: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmacHex(`${fileId}.${exp}`);
  return `${config.publicApiUrl}/api/v1/files/${fileId}/download?exp=${exp}&sig=${sig}`;
}

export function verifyDownloadSignature(fileId: string, exp: string, sig: string): boolean {
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now() / 1000) return false;
  return /^[0-9a-f]{64}$/.test(sig) && safeEqualHex(hmacHex(`${fileId}.${expNum}`), sig);
}
