import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ctx } from '../../lib/http';
import { HttpError } from '../../lib/errors';
import { encryptField } from '../../lib/crypto';
import { enqueue } from '../../lib/outbox';

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;

export const ZERO = new D(0);

/** Audit context for staff (admin portal) actions. */
export const audit = (req: Request) => ctx(req, 'admin');

/** Positive money amount as a string or number; never parsed through a JS float sum. */
export const moneyInput = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v) && new D(v).gt(0), 'Enter a positive amount (up to 4 decimals)');

export const optionalMoneyInput = z
  .union([z.string().trim(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), 'Enter an amount (up to 4 decimals)');

export const dateInput = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD')
  .transform((v) => new Date(`${v.slice(0, 10)}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

/** 2 dp, half-up. */
export const round2 = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

export const money = (v: Dec | { toString(): string } | null | undefined) => (v === null || v === undefined ? '0.00' : new D(v.toString()).toFixed(2));

export const isoDay = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);

/**
 * Allocates a reference from the shared `sequences` table (same atomic pattern as lib/refs)
 * for fund-operations kinds that lib/refs does not define.
 */
export async function seqRef(tx: Prisma.TransactionClient, name: string, prefix: string, pad: number, start = 1): Promise<string> {
  await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES (${name}, ${start - 1}) ON DUPLICATE KEY UPDATE value = value`;
  await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = ${name}`;
  const rows = await tx.$queryRaw<{ v: bigint }[]>`SELECT LAST_INSERT_ID() AS v`;
  return `${prefix}${String(Number(rows[0]!.v)).padStart(pad, '0')}`;
}

// ---------------------------------------------------------------- wiring

export const wireInput = z.object({
  bank: z.string().trim().min(1).max(120),
  accountName: z.string().trim().min(1).max(160),
  accountNumber: z.string().trim().min(4).max(40).optional(),
  abaRouting: z.string().trim().max(40).optional(),
  swift: z.string().trim().max(11).optional(),
  reference: z.string().trim().max(120).optional(),
});
export type WireInput = z.infer<typeof wireInput>;

export interface StoredWire {
  bank: string;
  accountName: string;
  accountNumberEnc: string | null;
  accountNumberMasked: string;
  abaRouting: string | null;
  swift: string | null;
  reference: string | null;
}

/** The full account number is encrypted at rest; only the masked form is ever returned. */
export function storeWire(w: WireInput): StoredWire {
  const digits = w.accountNumber?.replace(/\s+/g, '') ?? '';
  return {
    bank: w.bank,
    accountName: w.accountName,
    accountNumberEnc: digits ? encryptField(digits) : null,
    accountNumberMasked: digits ? `•••• ${digits.slice(-4)}` : '••••',
    abaRouting: w.abaRouting ?? null,
    swift: w.swift ?? null,
    reference: w.reference ?? null,
  };
}

export function readWire(json: unknown): StoredWire | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const s = (k: string) => (typeof j[k] === 'string' ? (j[k] as string) : null);
  return {
    bank: s('bank') ?? s('bankName') ?? '',
    accountName: s('accountName') ?? '',
    accountNumberEnc: s('accountNumberEnc'),
    accountNumberMasked: s('accountNumberMasked') ?? '••••',
    abaRouting: s('abaRouting'),
    swift: s('swift'),
    reference: s('reference'),
  };
}

/** Staff-facing wire view (masked). */
export function wireView(json: unknown) {
  const w = readWire(json);
  if (!w) return null;
  const { accountNumberEnc: _enc, ...rest } = w;
  return rest;
}

// ---------------------------------------------------------------- notifications

export async function notifyClientMembers(
  tx: Prisma.TransactionClient,
  clientId: string,
  n: { type: string; title: string; body?: string; link?: string; email?: boolean },
) {
  const members = await tx.clientUser.findMany({ where: { clientId, revokedAt: null }, select: { userId: true } });
  if (members.length) await enqueue(tx, 'notify.users', { userIds: members.map((m) => m.userId), ...n });
}

export async function notifyPermission(tx: Prisma.TransactionClient, permission: string, n: { type: string; title: string; body?: string; link?: string }) {
  await enqueue(tx, 'notify.permission', { permission, ...n });
}

/** Maker/checker: the approver must not be the maker (or the processor). */
export function assertSegregation(actorId: string, ...others: (string | null | undefined)[]) {
  if (others.some((o) => o && o === actorId)) {
    throw HttpError.forbidden('A different person must approve this (segregation of duties)', 'segregation_of_duties');
  }
}

/** Optimistic, state-guarded update: 409 when the row moved on since it was read. */
export function assertUpdated(count: number) {
  if (count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
}

export function badState(what: string, status: string, action: string): never {
  throw HttpError.conflict(`${what} is ${status}; it cannot be ${action}`, 'invalid_state');
}
