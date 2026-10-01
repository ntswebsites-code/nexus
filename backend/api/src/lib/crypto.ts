import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM. Layout: iv(12) | tag(16) | ciphertext. */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(blob: Buffer): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

/** Field-level encryption for tax ids, account numbers, TOTP secrets. */
export function encryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `v1:${encryptBuffer(Buffer.from(value, 'utf8')).toString('base64')}`;
}

export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('v1:')) return null;
  return decryptBuffer(Buffer.from(value.slice(3), 'base64')).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hmacHex(data: string): string {
  return createHmac('sha256', config.signingSecret).update(data).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** "4417-8812-0034" -> "**** 0034" */
export function maskIdentifier(value: string | null | undefined): string {
  if (!value) return 'Pending';
  const digits = value.replace(/\s+/g, '');
  return digits.length <= 4 ? '****' : `**** ${digits.slice(-4)}`;
}
