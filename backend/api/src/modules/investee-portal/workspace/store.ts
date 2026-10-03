import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { SYSTEM_ACTOR_ID } from '../../../lib/system';
import { seqRef } from '../../ops/ops.common';
import type { InvesteeContext } from '../investee.context';

export type Tx = Prisma.TransactionClient;
export const D = Prisma.Decimal;

export const COLORS = ['#6654e8', '#2774f0', '#0798b6', '#078b68', '#c97b08', '#c2410c', '#7c3aed', '#0f766e'];

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const day = (d = new Date()) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
export const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** References for the workspace tables, from the shared `sequences` table. */
export const refs = {
  capTx: (tx: Tx) => seqRef(tx, 'investeeCapTx', 'CTX-', 4),
  certificate: (tx: Tx) => seqRef(tx, 'investeeCertificate', 'SC-', 5),
  consent: (tx: Tx) => seqRef(tx, 'investeeConsent', 'GOV-', 4),
  meeting: (tx: Tx) => seqRef(tx, 'investeeMeeting', 'BRD-', 4),
  signRequest: (tx: Tx) => seqRef(tx, 'investeeSignRequest', 'SIG-', 4),
};

/** Class terms implied by a class name; the company can edit them afterwards. */
export function classDefaults(name: string) {
  const preferred = /preferred|series|seed/i.test(name);
  const option = /option|esop|warrant/i.test(name);
  return {
    voting: option ? 'No vote until exercise' : preferred ? 'As-converted' : '1 vote / share',
    preferenceMultiple: new D(preferred ? 1 : 0),
    participating: false,
    seniority: preferred ? 1 : 0,
    conversionRatio: new D(1),
  };
}

export async function getOrCreateClass(tx: Tx, companyId: string, name: string) {
  const found = await tx.investeeShareClass.findUnique({ where: { companyId_name: { companyId, name } } });
  if (found) return found;
  return tx.investeeShareClass.create({ data: { companyId, name, ...classDefaults(name) } });
}

export async function getOrCreateHolder(tx: Tx, companyId: string, name: string) {
  const found = await tx.investeeShareholder.findUnique({ where: { companyId_name: { companyId, name } } });
  if (found) return found;
  const count = await tx.investeeShareholder.count({ where: { companyId } });
  return tx.investeeShareholder.create({ data: { companyId, name, color: COLORS[count % COLORS.length]! } });
}

interface LegacyShareholder {
  name: string;
  type: string;
  shares: number;
  color?: string;
}
interface LegacyConsent {
  id: string;
  title: string;
  basis: string;
  submitted: string;
  due: string;
  owner: string;
  status: string;
  note: string;
}
interface LegacyAction {
  title: string;
  owner: string;
  due: string;
  evidence: string;
  status: string;
}
interface LegacyRequisition {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  sourcingCategory: string;
  currency: string;
  estimatedAmount: number;
  needBy: string;
  createdByName: string;
  createdAt: string;
  note: string;
}

const validDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);

/**
 * One-time move of the old `settings` JSON (workspace.cap, .governance, .forecast, .requests) into tables.
 * The settings rows are left in place and never read again. Claimed with a conditional update, so two
 * concurrent first requests migrate once.
 */
async function migrateLegacy(companyId: string) {
  const claim = await prisma.investeeWorkspace.updateMany({ where: { companyId, legacyMigratedAt: null }, data: { legacyMigratedAt: new Date() } });
  if (claim.count === 0) return;
  const rows = await prisma.setting.findMany({ where: { ownerId: companyId, key: { in: ['workspace.cap', 'workspace.governance', 'workspace.forecast', 'workspace.requests'] } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value as Record<string, unknown> | null]));
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { reportingCurrency: true } });
  const currency = company?.reportingCurrency ?? 'USD';
  await prisma.$transaction(async (tx) => {
    const cap = byKey.get('workspace.cap');
    const holders = Array.isArray(cap?.shareholders) ? (cap!.shareholders as LegacyShareholder[]) : [];
    const asOf = validDay(cap?.asOf) ? parseDay(cap!.asOf as string) : new Date();
    for (const h of holders) {
      if (!h?.name || !h.type || !(h.shares > 0)) continue;
      const holder = await getOrCreateHolder(tx, companyId, String(h.name).slice(0, 160));
      const klass = await getOrCreateClass(tx, companyId, String(h.type).slice(0, 80));
      await tx.investeeCapTx.create({
        data: {
          ref: await refs.capTx(tx),
          companyId,
          kind: 'OPENING',
          status: 'APPROVED',
          holderId: holder.id,
          classId: klass.id,
          shares: new D(Math.round(h.shares)),
          currency,
          effectiveDate: asOf,
          note: 'Opening balance moved from the earlier cap table record',
          makerId: SYSTEM_ACTOR_ID,
          makerName: 'System',
          decidedAt: new Date(),
          decisionNote: 'Migrated',
        },
      });
    }
    const gov = byKey.get('workspace.governance');
    const consents = Array.isArray(gov?.consents) ? (gov!.consents as LegacyConsent[]) : [];
    for (const c of consents) {
      if (!c?.title) continue;
      await tx.investeeConsent.create({
        data: {
          ref: await refs.consent(tx),
          companyId,
          title: String(c.title).slice(0, 200),
          basis: String(c.basis ?? '').slice(0, 160),
          submittedOn: validDay(c.submitted) ? parseDay(c.submitted) : new Date(),
          dueOn: validDay(c.due) ? parseDay(c.due) : new Date(),
          ownerName: String(c.owner ?? 'Company').slice(0, 120),
          status: ['Investor review', 'Approved', 'Declined'].includes(c.status) ? c.status : 'Investor review',
          note: c.note ? String(c.note).slice(0, 2000) : null,
        },
      });
    }
    const actions = Array.isArray(gov?.actions) ? (gov!.actions as LegacyAction[]) : [];
    for (const a of actions) {
      if (!a?.title) continue;
      await tx.investeeBoardAction.create({
        data: {
          companyId,
          title: String(a.title).slice(0, 200),
          ownerName: String(a.owner ?? 'Company').slice(0, 120),
          dueOn: validDay(a.due) ? parseDay(a.due) : null,
          evidence: a.evidence ? String(a.evidence).slice(0, 300) : null,
          status: /complete/i.test(a.status ?? '') ? 'COMPLETE' : 'OPEN',
        },
      });
    }
    const fc = byKey.get('workspace.forecast');
    if (fc) {
      const scenario = ['Base case', 'Upside', 'Downside'].includes(String(fc.scenario)) ? String(fc.scenario) : 'Base case';
      await tx.investeeWorkspace.update({ where: { companyId }, data: { forecastScenario: scenario } });
      const revenue = (fc.revenue && typeof fc.revenue === 'object' ? fc.revenue : {}) as Record<string, unknown>;
      for (const [period, value] of Object.entries(revenue)) {
        if (!/^\d{4}-\d{2}$/.test(period) || typeof value !== 'number' || !Number.isFinite(value)) continue;
        await tx.investeeForecastCell.create({ data: { companyId, period, metric: 'revenue', value: new D(value) } });
      }
    }
    const reqs = byKey.get('workspace.requests');
    const list = Array.isArray(reqs?.requisitions) ? (reqs!.requisitions as LegacyRequisition[]) : [];
    for (const r of list) {
      if (!r?.id || !r.title) continue;
      const exists = await tx.investeeRequisition.findUnique({ where: { ref: String(r.id).slice(0, 16) }, select: { id: true } });
      if (exists) continue;
      await tx.investeeRequisition.create({
        data: {
          ref: String(r.id).slice(0, 16),
          companyId,
          title: String(r.title).slice(0, 200),
          description: r.description || null,
          category: String(r.sourcingCategory || 'Capital request: Growth capital').slice(0, 180),
          currency: String(r.currency || currency).toUpperCase().slice(0, 3),
          amount: new D(Number.isFinite(r.estimatedAmount) ? r.estimatedAmount : 0),
          needBy: validDay(r.needBy) ? parseDay(r.needBy) : null,
          priority: ['High', 'Medium', 'Low'].includes(r.priority) ? r.priority : 'Medium',
          status: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FULFILLED'].includes(r.status) ? r.status : 'SUBMITTED',
          note: r.note ? String(r.note).slice(0, 2000) : null,
          createdById: SYSTEM_ACTOR_ID,
          createdByName: String(r.createdByName || 'Company').slice(0, 120),
          createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
        },
      });
    }
  });
}

/** Ensures the workspace row exists and the old settings JSON has been moved. Cheap after the first call. */
export async function ensureWorkspace(companyId: string) {
  let ws = await prisma.investeeWorkspace.findUnique({ where: { companyId } });
  if (!ws) {
    try {
      ws = await prisma.investeeWorkspace.create({ data: { companyId } });
    } catch {
      ws = await prisma.investeeWorkspace.findUniqueOrThrow({ where: { companyId } });
    }
  }
  if (!ws.legacyMigratedAt) {
    await migrateLegacy(companyId);
    ws = await prisma.investeeWorkspace.findUniqueOrThrow({ where: { companyId } });
  }
  return ws;
}

export function requireSigner(c: InvesteeContext, what: string) {
  if (c.profile !== 'workspace_administrator' && c.profile !== 'executive_approver') {
    throw HttpError.forbidden(`Only an administrator or approver can ${what}`, 'permission_denied');
  }
}
