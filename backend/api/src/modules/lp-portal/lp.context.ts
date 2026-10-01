import type { Request, RequestHandler } from 'express';
import type { LpRole } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { LpError } from './lp.http';

/** SRD Q-154: derived LP role for the first release. */
export const LP_ROLE_BY_INVESTOR_ROLE: Record<string, LpRole> = {
  admin: 'MANAGER',
  finance: 'SIGNATORY',
  investment: 'VIEWER',
  auditor: 'VIEWER',
};
const RANK: Record<LpRole, number> = { VIEWER: 1, SIGNATORY: 2, MANAGER: 3 };

export interface LpContext {
  userId: string;
  membershipId: string;
  client: {
    id: string;
    ref: string;
    name: string;
    email: string | null;
    baseCurrency: string;
    kycStatus: string;
    accreditedInvestor: boolean;
    dealingHold: boolean;
    holdReason: string | null;
  };
  lpRole: LpRole;
  investorRole: string;
  permissions: Set<string>;
  /** Funds this member may see: the client's ACTIVE/PENDING commitments narrowed by `fund_ids`. */
  fundIds: string[];
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `lpContextMiddleware` on /api/v1/lp-portal. */
      lp?: LpContext;
    }
  }
}

/**
 * Resolves the caller's LP membership. Every LP query is scoped by `ctx.client.id` and
 * `ctx.fundIds` from here, never from request input (SRD 8.2). A user linked to several
 * clients may choose one with `?client=<ref>`; anything else answers 403.
 */
export async function resolveLpContext(req: Request): Promise<LpContext> {
  const user = req.user;
  if (!user) throw new LpError(401, 'LP_UNAUTHORIZED', 'Sign in to continue');
  const requested = typeof req.query.client === 'string' ? req.query.client : undefined;
  const memberships = await prisma.clientUser.findMany({
    where: { userId: user.id, revokedAt: null, status: { not: 'SUSPENDED' }, client: { archivedAt: null } },
    include: { client: true },
    orderBy: { createdAt: 'asc' },
  });
  const m = (requested ? memberships.find((x) => x.client.ref === requested) : undefined) ?? (requested ? undefined : memberships[0]);
  if (!m) throw LpError.forbidden('This account is not linked to an investor relationship');

  const lpRole: LpRole = (m.lpRole as LpRole | null) && RANK[m.lpRole as LpRole] ? (m.lpRole as LpRole) : (LP_ROLE_BY_INVESTOR_ROLE[m.investorRole] ?? 'VIEWER');
  const role = await prisma.role.findUnique({
    where: { portal_key: { portal: 'investor', key: m.investorRole } },
    include: { permissions: true },
  });
  const permissions = new Set((role?.permissions ?? []).map((p) => p.permission).filter((p) => p.startsWith('lp.')));

  const commitments = await prisma.fundCommitment.findMany({
    where: { clientId: m.clientId, status: { in: ['ACTIVE', 'PENDING'] }, fund: { portalVisible: true } },
    select: { fundId: true },
  });
  const scope = Array.isArray(m.fundIds) ? (m.fundIds as unknown[]).filter((x): x is string => typeof x === 'string') : null;
  const fundIds = commitments.map((c) => c.fundId).filter((id) => !scope || scope.length === 0 || scope.includes(id));

  const c = m.client;
  return {
    userId: user.id,
    membershipId: m.id,
    client: {
      id: c.id,
      ref: c.ref,
      name: c.name,
      email: c.email,
      baseCurrency: c.baseCurrency,
      kycStatus: c.kycStatus,
      accreditedInvestor: c.accreditedInvestor,
      dealingHold: c.dealingHold,
      holdReason: c.holdReason,
    },
    lpRole,
    investorRole: m.investorRole,
    permissions,
    fundIds,
  };
}

/** Attaches `req.lp`. Mount once on the LP router after `requireAuth`. */
export const lpContextMiddleware: RequestHandler = async (req, _res, next) => {
  req.lp = await resolveLpContext(req);
  next();
};

export function lp(req: Request): LpContext {
  if (!req.lp) throw new LpError(401, 'LP_UNAUTHORIZED', 'Sign in to continue');
  return req.lp;
}

/** 403 `LP_FORBIDDEN` "Missing permission <code>" (reference behaviour). */
export const requireLp =
  (code: string): RequestHandler =>
  (req, _res, next) => {
    if (!lp(req).permissions.has(code)) throw LpError.forbidden(`Missing permission ${code}`);
    next();
  };

/** Role gates S (SIGNATORY or MANAGER) and M (MANAGER). */
export const requireLpRole =
  (min: LpRole): RequestHandler =>
  (req, _res, next) => {
    if (RANK[lp(req).lpRole] < RANK[min]) {
      throw LpError.forbidden(min === 'MANAGER' ? 'LP Manager access required' : 'Authorised Signatory access required');
    }
    next();
  };

/** 404 unless the fund is in the caller's scope (IDOR guard for fund-addressed reads). */
export function assertFund(ctx: LpContext, fundId: string | undefined | null) {
  if (fundId && !ctx.fundIds.includes(fundId)) throw LpError.notFound('Fund');
}

/** Fund filter for queries: a requested fund (checked) or every fund in scope. */
export function fundFilter(ctx: LpContext, fundId?: string | null): { in: string[] } {
  if (fundId) {
    assertFund(ctx, fundId);
    return { in: [fundId] };
  }
  return { in: ctx.fundIds };
}
