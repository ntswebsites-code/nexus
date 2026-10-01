import type { Prisma, CounterpartyDayEndPackage, CounterpartyExecution } from '@prisma/client';
import type { RequestHandler, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { sha256Hex } from '../../lib/crypto';

/**
 * Custodian / counterparty domain (SRD 5E, FR-REC-012..016, Q-165).
 *
 * Day-end package lifecycle (interim, DECISIONS: status vocabulary):
 *   Draft (created by a submitter) -> Received (submitted: server hash fixed)
 *   -> Approved (counterparty approver, not the submitter)
 *   -> Accepted | Rejected (Matanho staff review, `custodian.review`)
 *   Any non-draft package -> Superseded when a newer package for the same
 *   (account, statement date, currency) is submitted with a reason (BR-195).
 * Executions: Received -> Matched | Exception when staff review the day-end package
 * for their account and date.
 */

export interface CounterpartyContext {
  id: string;
  ref: string;
  name: string;
  type: string;
  role: string;
  accounts: string[];
}

/** Accounts come from `counterparties.accounts`: strings or objects with `ref` / `accountRef` / `code`. */
export function accountRefs(raw: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const o = a as Record<string, unknown>;
        return String(o.ref ?? o.accountRef ?? o.code ?? '');
      }
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolves the signed-in user's counterparty (an active link to an active counterparty).
 * Use after `requireAuth` + `requirePortalAccess('custodian')`.
 */
export const counterpartyContext: RequestHandler = async (req, res, next) => {
  const link = await prisma.counterpartyUser.findFirst({
    where: { userId: req.user!.id, status: 'active', counterparty: { status: 'ACTIVE' } },
    include: { counterparty: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!link) throw HttpError.forbidden('This account is not linked to an active counterparty', 'no_counterparty');
  const c = link.counterparty;
  res.locals.counterparty = {
    id: c.id,
    ref: c.ref,
    name: c.name,
    type: c.type,
    role: link.role,
    accounts: accountRefs(c.accounts),
  } satisfies CounterpartyContext;
  next();
};

export function cp(res: Response): CounterpartyContext {
  const c = res.locals.counterparty as CounterpartyContext | undefined;
  if (!c) throw HttpError.forbidden('This account is not linked to an active counterparty', 'no_counterparty');
  return c;
}

const REF_FORMATS = {
  custodianExecution: { prefix: 'CEX-', pad: 6, start: 100001 },
  custodianDayEnd: { prefix: 'CDE-', pad: 5, start: 10001 },
} as const;

/** Same sequence mechanism as `lib/refs` for the two custodian reference kinds. */
export async function nextCustodianRef(tx: Prisma.TransactionClient, kind: keyof typeof REF_FORMATS): Promise<string> {
  const f = REF_FORMATS[kind];
  await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES (${kind}, ${f.start - 1}) ON DUPLICATE KEY UPDATE value = value`;
  await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = ${kind}`;
  const rows = await tx.$queryRaw<{ v: bigint }[]>`SELECT LAST_INSERT_ID() AS v`;
  return `${f.prefix}${String(Number(rows[0]!.v)).padStart(f.pad, '0')}`;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const dec = (v: { toFixed(dp: number): string }, dp: number) => v.toFixed(dp);

/**
 * Canonical form of a day-end package: fixed key order, decimals as fixed-point strings,
 * the date as YYYY-MM-DD and the official file as its server-computed SHA-256. The package
 * hash is SHA-256 over this JSON; anything the browser sends as a hash is ignored.
 */
export function canonicalPackage(
  pkg: Pick<CounterpartyDayEndPackage, 'ref' | 'accountRef' | 'statementDate' | 'currency' | 'closingCash' | 'holdingsMv' | 'tradeCount' | 'note' | 'supersedesId'>,
  counterpartyRef: string,
  file: { sha256: string; size: number; name: string } | null,
): string {
  return JSON.stringify({
    v: 1,
    ref: pkg.ref,
    counterparty: counterpartyRef,
    accountRef: pkg.accountRef,
    statementDate: isoDate(pkg.statementDate),
    currency: pkg.currency,
    closingCash: dec(pkg.closingCash, 2),
    holdingsMv: dec(pkg.holdingsMv, 2),
    tradeCount: pkg.tradeCount,
    file: file ? { sha256: file.sha256, size: file.size, name: file.name } : null,
    note: pkg.note ?? '',
    supersedes: pkg.supersedesId ?? null,
  });
}

export async function packageHash(pkg: CounterpartyDayEndPackage, counterpartyRef: string): Promise<string> {
  const file = pkg.fileId ? await prisma.fileObject.findUnique({ where: { id: pkg.fileId }, select: { sha256: true, size: true, name: true } }) : null;
  if (pkg.fileId && !file) throw HttpError.conflict('The official day-end file is missing', 'integrity_mismatch');
  return sha256Hex(canonicalPackage(pkg, counterpartyRef, file));
}

/** BR-194: executions received for the account and statement date, compared with the package count. */
export async function tradeControl(counterpartyId: string, accountRef: string, statementDate: Date, tradeCount: number) {
  const start = new Date(`${isoDate(statementDate)}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const received = await prisma.counterpartyExecution.count({
    where: { counterpartyId, accountRef, executionAt: { gte: start, lt: end }, status: { not: 'Superseded' } },
  });
  return { executionsReceived: received, tradeCount, matches: received === tradeCount };
}

export function executionView(e: CounterpartyExecution) {
  return {
    id: e.id,
    ref: e.ref,
    tradeRef: e.tradeRef,
    executionAt: e.executionAt.toISOString(),
    accountRef: e.accountRef,
    ticker: e.ticker,
    isin: e.isin,
    side: e.side,
    quantity: e.quantity.toString(),
    price: e.price.toString(),
    currency: e.currency,
    settlementDate: e.settlementDate ? isoDate(e.settlementDate) : null,
    broker: e.broker,
    note: e.note,
    status: e.status,
    submittedById: e.submittedById,
    submittedAt: e.submittedAt.toISOString(),
  };
}

export function dayEndView(p: CounterpartyDayEndPackage, file?: { name: string; size: number; sha256: string } | null) {
  return {
    id: p.id,
    ref: p.ref,
    accountRef: p.accountRef,
    statementDate: isoDate(p.statementDate),
    currency: p.currency,
    closingCash: p.closingCash.toFixed(2),
    holdingsMv: p.holdingsMv.toFixed(2),
    tradeCount: p.tradeCount,
    file: file ? { name: file.name, size: file.size, sha256: file.sha256 } : null,
    sha256: p.sha256,
    note: p.note,
    status: p.status,
    supersedesId: p.supersedesId,
    supersedeReason: p.supersedeReason,
    submittedById: p.submittedById,
    approvedById: p.approvedById,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    submittedAt: p.submittedAt.toISOString(),
  };
}

export async function filesById(ids: (string | null)[]) {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return new Map<string, { name: string; size: number; sha256: string }>();
  const rows = await prisma.fileObject.findMany({ where: { id: { in: list } }, select: { id: true, name: true, size: true, sha256: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

/** Latest staff review (decision + note) per day-end package, from the audit trail. */
export async function latestReviews(packageIds: string[]) {
  if (!packageIds.length) return new Map<string, { decision: string; note: string | null; at: string; reviewerId: string | null }>();
  const rows = await prisma.auditEvent.findMany({
    where: { objectType: 'custodian_day_end', objectId: { in: packageIds }, action: 'custodian.dayend.reviewed' },
    orderBy: { id: 'desc' },
    select: { objectId: true, after: true, reason: true, occurredAt: true, actorId: true },
  });
  const out = new Map<string, { decision: string; note: string | null; at: string; reviewerId: string | null }>();
  for (const r of rows) {
    if (out.has(r.objectId)) continue;
    const after = (r.after ?? {}) as Record<string, unknown>;
    out.set(r.objectId, { decision: String(after.decision ?? ''), note: r.reason, at: r.occurredAt.toISOString(), reviewerId: r.actorId });
  }
  return out;
}
