import type { Request, RequestHandler } from 'express';
import type { PortfolioCompany } from '@prisma/client';
import { HttpError } from '../../lib/errors';
import { actorName, ctx } from '../../lib/http';
import {
  asProfile,
  assertProfile,
  companyMembership,
  profileCan,
  type CompanyCapability,
  type CompanyProfile,
  type PackActor,
} from '../company/company.service';

export interface InvesteeContext {
  userId: string;
  company: PortfolioCompany;
  profile: CompanyProfile;
  title: string | null;
  /** Display text of the member's signing authority; null when the member may not sign. */
  signingAuthority: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `investeeContextMiddleware` on /api/v1/investee-portal. */
      investee?: InvesteeContext;
    }
  }
}

/** Reads `company_users.signing_authority` (JSON): `true`, a label string, or `{ label?, termSheets? }`. */
export function authorityText(raw: unknown, title: string | null): string | null {
  if (raw === null || raw === undefined || raw === false) return null;
  if (raw === true) return title ?? 'Authorised signatory';
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as { label?: unknown; termSheets?: unknown; enabled?: unknown };
    if (o.termSheets === false || o.enabled === false) return null;
    return typeof o.label === 'string' && o.label.trim() ? o.label.trim() : (title ?? 'Authorised signatory');
  }
  return null;
}

/**
 * Resolves the caller's active company membership once per request. Every Investee query is scoped
 * by `req.investee.company.id`, never by an id from the request (no letterhead / company IDOR).
 * Company users carry no portal role, so membership is the gate; staff and investors are refused.
 */
export const investeeContextMiddleware: RequestHandler = async (req, _res, next) => {
  const link = await companyMembership(req);
  req.investee = {
    userId: req.user!.id,
    company: link.company,
    profile: asProfile(link.profile),
    title: link.title,
    signingAuthority: authorityText(link.signingAuthority, link.title),
  };
  next();
};

export function inv(req: Request): InvesteeContext {
  if (!req.investee) throw HttpError.unauthorized();
  return req.investee;
}

export const requireProfile =
  (capability: CompanyCapability): RequestHandler =>
  (req, _res, next) => {
    assertProfile(inv(req).profile, capability);
    next();
  };

export function capabilities(profile: CompanyProfile) {
  return {
    editDraft: profileCan(profile, 'edit_draft'),
    submitPack: profileCan(profile, 'submit_pack'),
    submitKpis: profileCan(profile, 'submit_kpis'),
    sign: profileCan(profile, 'sign'),
    postMessages: profileCan(profile, 'post_messages'),
    manageCompany: profileCan(profile, 'manage_company'),
  };
}

export const investeeAudit = (req: Request) => ({
  ...ctx(req, 'company'),
  actorRole: req.investee ? `company:${req.investee.profile}` : null,
});
export const packActor = (req: Request): PackActor => ({ userId: req.user!.id, name: actorName(req), audit: investeeAudit(req) });
