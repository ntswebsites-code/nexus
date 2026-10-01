import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { config } from '../config';
import { prisma } from './prisma';
import { decryptBuffer, encryptBuffer, hmacHex, safeEqualHex, sha256Hex } from './crypto';
import { HttpError } from './errors';

/**
 * Local encrypted object store (SRD 10.3 "S3-compatible, encrypted"). Files are
 * AES-256-GCM encrypted at rest under STORAGE_DIR; swapping to S3 only changes
 * `putObject`/`getObject`.
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

function objectPath(key: string) {
  return path.resolve(config.storage.dir, key.slice(0, 2), key);
}

async function putObject(key: string, data: Buffer) {
  const target = objectPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, encryptBuffer(data));
}

async function getObject(key: string): Promise<Buffer> {
  return decryptBuffer(await readFile(objectPath(key)));
}

export interface StoredFileInput {
  name: string;
  mime: string;
  data: Buffer;
  uploadedById?: string | null;
  applicationId?: string | null;
}

export async function storeFile(input: StoredFileInput, db: Prisma.TransactionClient = prisma) {
  const mime = input.mime || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mime)) {
    throw HttpError.badRequest(`File type ${mime} is not accepted`);
  }
  if (input.data.length > config.storage.maxUploadBytes) {
    throw new HttpError(413, 'payload_too_large', 'File is larger than the upload limit');
  }
  const storageKey = randomUUID().replace(/-/g, '');
  await putObject(storageKey, input.data);
  return db.fileObject.create({
    data: {
      storageKey,
      name: input.name.slice(0, 255),
      mime,
      size: input.data.length,
      sha256: sha256Hex(input.data),
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
