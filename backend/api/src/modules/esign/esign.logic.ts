/** Pure helpers for the e-signature module (no database / config), unit tested by scripts/test-esign.ts. */

export type RequestStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'DECLINED' | 'VOIDED' | 'EXPIRED';
export type SignerStatus = 'WAITING' | 'PENDING' | 'SIGNED' | 'DECLINED' | 'VOIDED';
export type SignerKind = 'STAFF' | 'LP' | 'INVESTEE' | 'EXTERNAL';

export const TERMINAL_REQUEST: ReadonlySet<string> = new Set(['COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']);
/** Statuses in which signers may still act. */
export const OPEN_REQUEST: ReadonlySet<string> = new Set(['PENDING']);

export interface OrderedSigner {
  id: string;
  orderNo: number;
  status: string;
}

/**
 * Signers who are due to sign now: the lowest `orderNo` group that still has an unsigned member.
 * PARALLEL requests store every signer at orderNo 1, SEQUENTIAL requests number the groups 1..n
 * (signers sharing a number sign in parallel within their group).
 */
export function dueSigners<T extends OrderedSigner>(signers: T[]): T[] {
  const open = signers.filter((s) => s.status === 'WAITING' || s.status === 'PENDING');
  if (!open.length) return [];
  const lowest = Math.min(...open.map((s) => s.orderNo));
  return open.filter((s) => s.orderNo === lowest);
}

export function allSigned(signers: OrderedSigner[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === 'SIGNED');
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

const MAX_PNG_BYTES = 150 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Accepts only `data:image/png;base64,...` below 150 KB whose bytes really start with the PNG magic. */
export function parseDrawnPng(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error('Drawn signature must be a PNG image');
  const buf = Buffer.from(m[1]!, 'base64');
  if (buf.length < 100 || buf.length > MAX_PNG_BYTES || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('Drawn signature image is invalid or too large');
  }
  return buf;
}

export function isPdf(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const PROOF_TTL_MS = 30 * 60 * 1000;
export const REMINDER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_REMINDERS = 3;
export const DEFAULT_EXPIRY_DAYS = 14;
