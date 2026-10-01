import type { Request, RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import type { LpBankInstructionChange, LpColleague, LpOrganisation, LpRole } from '@matanho/shared';
import { prisma } from '../../../lib/prisma';
import { writeAudit } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { encryptField, maskIdentifier, sha256Hex } from '../../../lib/crypto';
import { createInvitation } from '../../identity/invitations';
import { LpError } from '../lp.http';
import { LP_ROLE_BY_INVESTOR_ROLE, assertFund, type LpContext } from '../lp.context';
import { asRecord, fundNames, lpAudit, str } from './common';

/** LP role -> investor role key (the key carries the `lp.*` permissions, SRD Q-154). */
const INVESTOR_ROLE_FOR: Record<Exclude<LpRole, 'MANAGER'>, string> = { VIEWER: 'investment', SIGNATORY: 'finance' };

function lpRoleOf(m: { lpRole: string | null; investorRole: string }): LpRole {
  return (['VIEWER', 'SIGNATORY', 'MANAGER'].includes(m.lpRole ?? '') ? m.lpRole : LP_ROLE_BY_INVESTOR_ROLE[m.investorRole] ?? 'VIEWER') as LpRole;
}

function scopeOf(fundIds: Prisma.JsonValue | null): string[] | null {
  return Array.isArray(fundIds) && fundIds.length ? fundIds.filter((x): x is string => typeof x === 'string') : null;
}

function normaliseRole(raw: unknown, verb: 'invite' | 'promote'): Exclude<LpRole, 'MANAGER'> {
  const v = (typeof raw === 'string' ? raw : 'VIEWER').trim().toUpperCase();
  if (['MANAGER', 'LP_MANAGER', 'ADMIN'].includes(v)) {
    throw LpError.forbidden(verb === 'invite' ? 'Cannot invite another MANAGER via portal' : 'Cannot promote to MANAGER via portal');
  }
  if (v === 'VIEWER' || v === 'LP_VIEWER') return 'VIEWER';
  if (v === 'SIGNATORY' || v === 'LP_SIGNATORY') return 'SIGNATORY';
  throw LpError.validation('Unknown role', { role: 'Use VIEWER or SIGNATORY' });
}

/** Requested fund scope, never wider than the caller's own; `null` = every fund of the client. */
async function normaliseFunds(ctx: LpContext, raw: unknown): Promise<string[] | null> {
  const own = await prisma.clientUser.findUnique({ where: { id: ctx.membershipId }, select: { fundIds: true } });
  const callerScoped = scopeOf(own?.fundIds ?? null) !== null;
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return callerScoped ? [...ctx.fundIds] : null;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string') || raw.length > 50) {
    throw LpError.validation('Invalid fundIds', { fundIds: 'Provide a list of fund ids' });
  }
  const ids = [...new Set(raw as string[])];
  const outside = ids.filter((id) => !ctx.fundIds.includes(id));
  if (outside.length) throw LpError.validation('Invalid fundIds', { fundIds: 'One or more funds are outside your access' });
  return ids;
}

const inviteKey = (email: string) => `lp.invite:${sha256Hex(email.toLowerCase()).slice(0, 40)}`;

/**
 * The shared invitation accept flow (identity) creates the membership without `fund_ids`. A narrower
 * scope chosen by the inviting Manager is kept on `settings` and applied on the member's first LP
 * request, before any other LP handler runs (this middleware is mounted on the first LP sub-router).
 */
export const applyPendingColleagueScope: RequestHandler = async (req, _res, next) => {
  const ctx = req.lp;
  if (!ctx || !req.user?.email) return next();
  const key = inviteKey(req.user.email);
  const pending = await prisma.setting.findUnique({ where: { ownerId_key: { ownerId: ctx.client.id, key } } });
  if (!pending) return next();
  const v = asRecord(pending.value);
  const fundIds = Array.isArray(v.fundIds) ? v.fundIds.filter((x): x is string => typeof x === 'string') : null;
  const membership = await prisma.clientUser.findUnique({ where: { id: ctx.membershipId } });
  if (membership && membership.createdAt.getTime() >= pending.updatedAt.getTime() - 60_000) {
    // Narrow first so a failure below can never leave this request with the wider default scope.
    if (fundIds) ctx.fundIds = ctx.fundIds.filter((id) => fundIds.includes(id));
    await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.setting.deleteMany({ where: { ownerId: ctx.client.id, key } });
        if (claimed.count === 0) return;
        await tx.clientUser.update({
          where: { id: membership.id },
          data: { fundIds: fundIds ?? undefined, invitedById: typeof v.invitedById === 'string' ? v.invitedById : null },
        });
        await writeAudit(tx, lpAudit(req), { action: 'lp_colleague.scope_applied', objectType: 'client_user', objectId: membership.id, after: { fundIds } });
      },
      { timeout: 15_000 },
    );
  }
  next();
};

async function colleagueRows(ctx: LpContext): Promise<LpColleague[]> {
  const [members, invites] = await Promise.all([
    prisma.clientUser.findMany({
      where: { clientId: ctx.client.id },
      include: { user: { select: { id: true, email: true, name: true, lastLoginAt: true, mfaFactors: { where: { verifiedAt: { not: null } }, select: { id: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invitation.findMany({
      where: { clientId: ctx.client.id, portal: 'investor', acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const pending = invites.length
    ? await prisma.setting.findMany({ where: { ownerId: ctx.client.id, key: { in: invites.map((i) => inviteKey(i.email)) } } })
    : [];
  return [
    ...invites.map((i) => {
      const p = pending.find((s) => s.key === inviteKey(i.email));
      const role = ((i.roleKeys as string[]) ?? [])[0] ?? 'investment';
      return {
        membershipId: i.id,
        userId: '',
        email: i.email,
        name: i.name ?? i.email,
        lpRole: LP_ROLE_BY_INVESTOR_ROLE[role] ?? 'VIEWER',
        fundIds: p && Array.isArray(asRecord(p.value).fundIds) ? (asRecord(p.value).fundIds as string[]) : [],
        isActive: false,
        status: 'INVITED',
        revokedAt: null,
        mfaEnabled: false,
        lastActiveAt: null,
      };
    }),
    ...members.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      email: m.user.email,
      name: m.user.name ?? m.user.email,
      lpRole: lpRoleOf(m),
      fundIds: scopeOf(m.fundIds) ?? [],
      isActive: !m.revokedAt && m.status !== 'SUSPENDED',
      status: m.revokedAt ? 'REVOKED' : m.status,
      revokedAt: m.revokedAt?.toISOString() ?? null,
      mfaEnabled: m.user.mfaFactors.length > 0,
      lastActiveAt: m.user.lastLoginAt?.toISOString() ?? null,
    })),
  ];
}

export const listColleagues = colleagueRows;

export async function getOrganisation(ctx: LpContext): Promise<LpOrganisation> {
  const c = await prisma.client.findUniqueOrThrow({ where: { id: ctx.client.id } });
  return {
    id: c.id,
    legalName: c.name,
    investorId: c.ref,
    email: c.email ?? '',
    country: c.country ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    status: c.archivedAt ? 'ARCHIVED' : ctx.client.dealingHold ? 'ON_HOLD' : 'ACTIVE',
    lpRole: ctx.lpRole,
    colleagues: ctx.lpRole === 'MANAGER' ? await colleagueRows(ctx) : [],
  };
}

export async function inviteColleague(req: Request, ctx: LpContext) {
  const b = asRecord(req.body);
  const email = (str(b.email) ?? '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) throw LpError.validation('Enter a valid email address', { email: 'Invalid email' });
  const role = normaliseRole(b.role, 'invite');
  const fundIds = await normaliseFunds(ctx, b.fundIds);
  const name = str(b.name)?.slice(0, 120) ?? null;

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    const m = await prisma.clientUser.findUnique({ where: { clientId_userId: { clientId: ctx.client.id, userId: existingUser.id } } });
    if (m && !m.revokedAt && m.status !== 'SUSPENDED') throw new LpError(409, 'LP_VERSION_CONFLICT', 'User already has active access');
    if (m) throw new LpError(409, 'LP_VERSION_CONFLICT', 'Access for this user was revoked; Client Services must restore it');
  }

  const investorRole = INVESTOR_ROLE_FOR[role];
  const out = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { clientId: ctx.client.id, portal: 'investor', email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const { invitation } = await createInvitation(tx, {
      email,
      name,
      portal: 'investor',
      roleKeys: [investorRole],
      clientId: ctx.client.id,
      scope: 'all',
      invitedById: ctx.userId,
      context: `${ctx.client.name}'s investor portal`,
    });
    const key = inviteKey(email);
    if (fundIds) {
      const value = { fundIds, lpRole: role, invitationId: invitation.id, invitedById: ctx.userId };
      await tx.setting.upsert({ where: { ownerId_key: { ownerId: ctx.client.id, key } }, create: { ownerId: ctx.client.id, key, value }, update: { value } });
    } else {
      await tx.setting.deleteMany({ where: { ownerId: ctx.client.id, key } });
    }
    await writeAudit(tx, lpAudit(req), {
      action: 'lp_colleague.invited',
      objectType: 'invitation',
      objectId: invitation.id,
      after: { email, lpRole: role, investorRole, fundIds, expiresAt: invitation.expiresAt.toISOString() },
    });
    return invitation;
  });
  return {
    id: out.id,
    userId: '',
    clientId: ctx.client.id,
    lpRole: role,
    fundIds: fundIds ?? [],
    isActive: false,
    invitedById: ctx.userId,
    status: 'INVITED',
    email,
    expiresAt: out.expiresAt.toISOString(),
  };
}

async function findMembership(ctx: LpContext, membershipId: string) {
  const m = await prisma.clientUser.findFirst({ where: { id: membershipId, clientId: ctx.client.id } });
  if (!m) throw new LpError(404, 'LP_NOT_FOUND', 'Membership not found');
  return m;
}

export async function updateColleague(req: Request, ctx: LpContext, membershipId: string) {
  const m = await findMembership(ctx, membershipId);
  if (m.userId === ctx.userId) throw LpError.forbidden('You cannot change your own access');
  if (lpRoleOf(m) === 'MANAGER') throw LpError.forbidden('Cannot change a manager via colleague API');
  if (m.revokedAt) throw new LpError(409, 'LP_VERSION_CONFLICT', 'Access has been revoked');
  const b = asRecord(req.body);
  const role = b.role !== undefined ? normaliseRole(b.role, 'promote') : (lpRoleOf(m) as 'VIEWER' | 'SIGNATORY');
  const fundIds = b.fundIds !== undefined ? await normaliseFunds(ctx, b.fundIds) : scopeOf(m.fundIds);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.clientUser.update({
      where: { id: m.id },
      data: { lpRole: role, investorRole: INVESTOR_ROLE_FOR[role], fundIds: fundIds ?? [] },
    });
    await writeAudit(tx, lpAudit(req), {
      action: 'lp_colleague.updated',
      objectType: 'client_user',
      objectId: m.id,
      before: { lpRole: lpRoleOf(m), fundIds: scopeOf(m.fundIds) },
      after: { lpRole: role, fundIds },
    });
    return u;
  });
  return { id: updated.id, userId: updated.userId, clientId: updated.clientId, lpRole: role, fundIds: fundIds ?? [], isActive: !updated.revokedAt };
}

export async function revokeColleague(req: Request, ctx: LpContext, membershipId: string) {
  const invitation = await prisma.invitation.findFirst({
    where: { id: membershipId, clientId: ctx.client.id, portal: 'investor', acceptedAt: null, revokedAt: null },
  });
  if (invitation) {
    await prisma.$transaction(async (tx) => {
      await tx.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      await tx.setting.deleteMany({ where: { ownerId: ctx.client.id, key: inviteKey(invitation.email) } });
      await writeAudit(tx, lpAudit(req), { action: 'lp_colleague.invitation_revoked', objectType: 'invitation', objectId: invitation.id, after: { email: invitation.email } });
    });
    return { membershipId: invitation.id, userId: '', revokedById: ctx.userId };
  }
  const m = await findMembership(ctx, membershipId);
  if (m.userId === ctx.userId) throw LpError.forbidden('You cannot revoke your own access');
  if (lpRoleOf(m) === 'MANAGER') throw LpError.forbidden('Cannot revoke manager via colleague API');
  if (m.revokedAt) return { membershipId: m.id, userId: m.userId, revokedById: ctx.userId };
  await prisma.$transaction(async (tx) => {
    await tx.clientUser.update({ where: { id: m.id }, data: { revokedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: m.userId } });
    await writeAudit(tx, lpAudit(req), { action: 'lp_colleague.revoked', objectType: 'client_user', objectId: m.id, before: { lpRole: lpRoleOf(m) }, after: { revoked: true, sessionsEnded: true } });
  });
  return { membershipId: m.id, userId: m.userId, revokedById: ctx.userId };
}

// ── Bank-instruction changes (pending until staff verify) ─────────────────

const BANK_STATUS: Record<string, string> = { 'Pending verification': 'PENDING_VERIFICATION', Active: 'ACTIVE', Superseded: 'SUPERSEDED' };

export async function listBankChanges(ctx: LpContext): Promise<LpBankInstructionChange[]> {
  const rows = await prisma.bankInstruction.findMany({
    where: { clientId: ctx.client.id, OR: [{ fundId: null }, { fundId: { in: ctx.fundIds } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const audits = rows.length
    ? await prisma.auditEvent.findMany({
        where: { objectType: 'bank_instruction', objectId: { in: rows.map((r) => r.id) }, action: 'bank_instruction.change_requested' },
        select: { objectId: true, actorId: true },
      })
    : [];
  const users = await prisma.user.findMany({
    where: { id: { in: audits.map((a) => a.actorId).filter((x): x is string => !!x) } },
    select: { id: true, name: true, email: true },
  });
  const who = new Map(users.map((u) => [u.id, u.name ?? u.email]));
  const requestedBy = new Map(audits.map((a) => [a.objectId, (a.actorId && who.get(a.actorId)) || 'Client Services']));
  const names = await fundNames(rows.map((r) => r.fundId));
  return rows.map((r) => ({
    id: r.id,
    fundId: r.fundId ?? '',
    fundName: r.fundId ? (names.get(r.fundId) ?? '') : 'All funds',
    bankName: r.bank,
    accountNumberMasked: r.masked,
    requestedBy: requestedBy.get(r.id) ?? 'Client Services',
    submittedAt: r.createdAt.toISOString(),
    status: BANK_STATUS[r.status] ?? r.status.toUpperCase(),
  }));
}

export async function submitBankChange(req: Request, ctx: LpContext): Promise<LpBankInstructionChange> {
  const factor = await prisma.userMfaFactor.findFirst({ where: { userId: ctx.userId, verifiedAt: { not: null } }, select: { id: true } });
  if (!factor) throw new LpError(403, 'LP_MFA_REQUIRED', 'MFA must be enabled to submit bank instruction changes');
  const b = asRecord(req.body);
  const fieldErrors: Record<string, string> = {};
  const bankName = str(b.bankName);
  const accountNumber = str(b.accountNumber)?.replace(/\s+/g, '');
  const accountName = str(b.accountName);
  const currency = str(b.currency ?? b.currencyCode)?.toUpperCase();
  if (!bankName || bankName.length > 120) fieldErrors.bankName = 'Required (max 120 characters)';
  if (!accountNumber || !/^[A-Za-z0-9-]{4,40}$/.test(accountNumber)) fieldErrors.accountNumber = 'Enter a valid account number or IBAN';
  if (accountName && accountName.length > 160) fieldErrors.accountName = 'At most 160 characters';
  if (currency && !/^[A-Z]{3}$/.test(currency)) fieldErrors.currency = 'Use a 3-letter currency code';
  if (Object.keys(fieldErrors).length) throw LpError.validation('Check the bank details', fieldErrors);
  const fundId = str(b.fundId);
  if (fundId) assertFund(ctx, fundId);
  const label = str(b.label)?.slice(0, 128) ?? null;

  const row = await prisma.$transaction(async (tx) => {
    const last = await tx.bankInstruction.findFirst({ where: { clientId: ctx.client.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const r = await tx.bankInstruction.create({
      data: {
        clientId: ctx.client.id,
        version: (last?.version ?? 0) + 1,
        bank: bankName!,
        accountName: accountName ?? null,
        identifierEnc: encryptField(accountNumber!),
        masked: maskIdentifier(accountNumber!),
        status: 'Pending verification',
        fundId: fundId ?? null,
        label,
        currency: currency ?? null,
        isDefault: false,
      },
    });
    await writeAudit(tx, lpAudit(req), {
      action: 'bank_instruction.change_requested',
      objectType: 'bank_instruction',
      objectId: r.id,
      after: { bank: r.bank, masked: r.masked, fundId: r.fundId, currency: r.currency, status: r.status, via: 'lp-portal' },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'clients.edit',
      type: 'bank_instruction.change_requested',
      title: `Bank instruction change · ${ctx.client.name}`,
      body: `${r.bank} ${r.masked} submitted for verification (call-back required before use).`,
      link: '/?page=clients',
    });
    return r;
  });
  const names = await fundNames([row.fundId]);
  return {
    id: row.id,
    fundId: row.fundId ?? '',
    fundName: row.fundId ? (names.get(row.fundId) ?? '') : 'All funds',
    bankName: row.bank,
    accountNumberMasked: row.masked,
    requestedBy: req.user?.name ?? req.user?.email ?? '',
    submittedAt: row.createdAt.toISOString(),
    status: 'PENDING_VERIFICATION',
  };
}
