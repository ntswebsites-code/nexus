import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { num, param } from '../../lib/http';
import { validateBody } from '../../middleware/validate';
import { requirePermission, requireStepUp } from '../../middleware/requireAuth';
import { audit } from '../ops/ops.common';
import { accountInclude, cashAccountView, clientInclude, clientView } from '../clients/clients.service';
import { caseInclude, caseSummary } from '../kyc/kyc.service';
import { assertStaff, findClientByRef, staffDirectory } from './co.service';

/** Clients & Accounts (page `clients`): extended 360 view, mandates, dealing hold, review schedule, relationship owner. */
export const coClientsRoutes = Router();

coClientsRoutes.get('/staff', requirePermission('clients.view'), async (_req, res) => {
  res.json({ data: await staffDirectory() });
});

coClientsRoutes.get('/clients/summary', requirePermission('clients.view'), async (_req, res) => {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86_400_000);
  const [byKyc, byRisk, total, onHold, reviewOverdue, reviewSoon, accounts, mandates] = await Promise.all([
    prisma.client.groupBy({ by: ['kycStatus'], where: { archivedAt: null }, _count: true }),
    prisma.client.groupBy({ by: ['riskRating'], where: { archivedAt: null }, _count: true }),
    prisma.client.count({ where: { archivedAt: null } }),
    prisma.client.count({ where: { archivedAt: null, dealingHold: true } }),
    prisma.client.count({ where: { archivedAt: null, nextReviewDate: { lt: now } } }),
    prisma.client.count({ where: { archivedAt: null, nextReviewDate: { gte: now, lte: soon } } }),
    prisma.cashAccount.groupBy({ by: ['status'], _count: true }),
    prisma.mandate.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({
    total,
    onHold,
    reviewOverdue,
    reviewDueIn30Days: reviewSoon,
    byKyc: Object.fromEntries(byKyc.map((r) => [r.kycStatus, r._count])),
    byRisk: Object.fromEntries(byRisk.map((r) => [r.riskRating, r._count])),
    accountsByStatus: Object.fromEntries(accounts.map((r) => [r.status, r._count])),
    mandatesByStatus: Object.fromEntries(mandates.map((r) => [r.status, r._count])),
  });
});

/** Everything about one client in one call: master data, mandates, accounts, portfolios, commitments, documents, KYC, requests. */
coClientsRoutes.get('/clients/:id/360', requirePermission('clients.view'), async (req, res) => {
  const client = await findClientByRef(param(req, 'id'));
  const [row, accounts, cases, documents, docCount, requests, portfolios, commitments, users, capital] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: client.id }, include: clientInclude }),
    prisma.cashAccount.findMany({ where: { clientId: client.id }, include: accountInclude, orderBy: { ref: 'asc' } }),
    prisma.kycCase.findMany({ where: { clientId: client.id }, include: caseInclude }),
    prisma.document.findMany({ where: { OR: [{ clientId: client.id }, { publications: { some: { clientId: client.id, withdrawnAt: null } } }] }, orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.document.count({ where: { OR: [{ clientId: client.id }, { publications: { some: { clientId: client.id, withdrawnAt: null } } }] } }),
    prisma.serviceRequest.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.portfolio.findMany({ where: { clientId: client.id }, orderBy: { ref: 'asc' } }),
    prisma.fundCommitment.findMany({ where: { clientId: client.id }, include: { fund: { select: { ref: true, name: true, currency: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.clientUser.findMany({ where: { clientId: client.id }, include: { user: { select: { email: true, name: true, lastLoginAt: true } } } }),
    prisma.capitalEvent.count({ where: { clientId: client.id } }),
  ]);
  const openRequests = requests.filter((r) => r.status !== 'Closed');
  res.json({
    client: { ...clientView(row), dealingHold: client.dealingHold, holdReason: client.holdReason, country: client.country, relationshipOwnerId: client.relationshipOwnerId },
    mandates: row.mandates.map((m) => ({ id: m.ref, name: m.name, type: m.type, status: m.status })),
    cashAccounts: accounts.map((a) => ({ ...cashAccountView(a), status: a.status })),
    portfolios: portfolios.map((p) => ({ id: p.ref, name: p.name, type: p.type, currency: p.baseCurrency, status: p.status })),
    commitments: commitments.map((c) => ({
      fund: c.fund.name,
      fundRef: c.fund.ref,
      amount: num(c.commitmentAmount),
      currency: c.currency,
      status: c.status,
      effectiveDate: c.effectiveDate,
    })),
    documents: { total: docCount, recent: documents.map((d) => ({ id: d.ref, name: d.name, type: d.type, classification: d.classification, status: d.status, date: d.documentDate ?? d.createdAt })) },
    kycCases: cases.map(caseSummary),
    requests: { open: openRequests.length, recent: requests.map((r) => ({ id: r.ref, title: r.title, status: r.status, type: r.type, slaDueAt: r.slaDueAt })) },
    portalUsers: users.map((u) => ({ email: u.user.email, name: u.user.name, role: u.investorRole, lastLoginAt: u.user.lastLoginAt })),
    capitalEvents: capital,
  });
});

/** Releasing a hold needs a fresh step-up (runs after body validation). */
const stepUpOnRelease: RequestHandler = (req, res, next) => (req.body?.hold === false ? requireStepUp(req, res, next) : next());
const holdSchema = z.object({ hold: z.boolean(), reason: z.string().trim().min(5).max(255) }).strict();

/** Dealing hold: blocks LP dealing requests. Placing needs clients.edit; releasing also needs step-up. */
coClientsRoutes.post('/clients/:id/dealing-hold', requirePermission('clients.edit'), validateBody(holdSchema), stepUpOnRelease, idempotent('co.client_hold', { required: false }), async (req, res) => {
  {
    const b = req.body as z.infer<typeof holdSchema>;
    const client = await findClientByRef(param(req, 'id'));
    if (client.dealingHold === b.hold) throw HttpError.conflict(b.hold ? 'The client is already on dealing hold' : 'The client is not on dealing hold', 'invalid_state');
    await prisma.$transaction(async (tx) => {
      const n = await tx.client.updateMany({ where: { id: client.id, dealingHold: client.dealingHold }, data: { dealingHold: b.hold, holdReason: b.hold ? b.reason : null, updatedBy: req.user!.id, version: { increment: 1 } } });
      if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
      await writeAudit(tx, audit(req), { action: b.hold ? 'client.dealing_hold_placed' : 'client.dealing_hold_released', objectType: 'client', objectId: client.id, before: { dealingHold: client.dealingHold, reason: client.holdReason }, after: { dealingHold: b.hold }, reason: b.reason });
    });
    res.json({ client: { id: client.ref, dealingHold: b.hold, holdReason: b.hold ? b.reason : null } });
  }
});

const ownerSchema = z.object({ userId: z.string().uuid().nullable() }).strict();

coClientsRoutes.post('/clients/:id/relationship-owner', requirePermission('clients.edit'), validateBody(ownerSchema), idempotent('clients-onboarding.post.clients_id_relationship_owner', { required: false }), async (req, res) => {
  const client = await findClientByRef(param(req, 'id'));
  const staff = req.body.userId ? await assertStaff(req.body.userId) : null;
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: client.id }, data: { relationshipOwnerId: staff?.id ?? null, ownerName: staff?.name ?? 'Client Services', updatedBy: req.user!.id, version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'client.owner_assigned', objectType: 'client', objectId: client.id, before: { ownerName: client.ownerName }, after: { ownerName: staff?.name ?? 'Client Services' } });
  });
  res.json({ ok: true, owner: staff?.name ?? 'Client Services' });
});

const reviewSchema = z.object({ nextReviewDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), note: z.string().trim().max(255).optional() }).strict();

coClientsRoutes.post('/clients/:id/review-date', requirePermission('clients.edit'), validateBody(reviewSchema), idempotent('clients-onboarding.post.clients_id_review_date', { required: false }), async (req, res) => {
  const client = await findClientByRef(param(req, 'id'));
  const next = req.body.nextReviewDate ? new Date(`${req.body.nextReviewDate}T00:00:00.000Z`) : null;
  if (next && Number.isNaN(next.getTime())) throw HttpError.badRequest('Invalid date');
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: client.id }, data: { nextReviewDate: next, updatedBy: req.user!.id, version: { increment: 1 } } });
    await writeAudit(tx, audit(req), { action: 'client.review_scheduled', objectType: 'client', objectId: client.id, before: { nextReviewDate: client.nextReviewDate }, after: { nextReviewDate: next }, reason: req.body.note ?? null });
  });
  res.json({ ok: true, nextReviewDate: next });
});

const mandateStatus = z.object({ status: z.enum(['Shell', 'Active', 'Closed']), reason: z.string().trim().max(255).optional() }).strict();

/** Mandate lifecycle: Shell -> Active (only for a client with current KYC and an approved cash account) -> Closed. */
coClientsRoutes.post('/clients/:id/mandates/:mref/status', requirePermission('clients.edit'), validateBody(mandateStatus), idempotent('clients-onboarding.post.clients_id_mandates_mref_status', { required: false }), async (req, res) => {
  const client = await findClientByRef(param(req, 'id'));
  const m = await prisma.mandate.findFirst({ where: { ref: param(req, 'mref'), clientId: client.id } });
  if (!m) throw HttpError.notFound('Mandate not found');
  const to = req.body.status as 'Shell' | 'Active' | 'Closed';
  if (m.status === to) throw HttpError.conflict(`The mandate is already ${to}`, 'invalid_state');
  if (m.status === 'Closed') throw HttpError.conflict('A closed mandate cannot be reopened; create a new mandate', 'invalid_state');
  if (to === 'Active') {
    const blockers: string[] = [];
    if (client.kycStatus !== 'Current') blockers.push(`KYC is ${client.kycStatus}; it must be Current`);
    if (client.dealingHold) blockers.push('The client is on dealing hold');
    const active = await prisma.cashAccount.count({ where: { clientId: client.id, status: 'ACTIVE' } });
    if (!active) blockers.push('No approved (active) cash account');
    if (blockers.length) throw new HttpError(409, 'activation_blocked', `The mandate cannot be activated: ${blockers.join('; ')}`, { blockers });
  }
  await prisma.$transaction(async (tx) => {
    const n = await tx.mandate.updateMany({ where: { id: m.id, status: m.status }, data: { status: to, version: { increment: 1 } } });
    if (n.count !== 1) throw HttpError.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
    await writeAudit(tx, audit(req), { action: 'mandate.status_changed', objectType: 'mandate', objectId: m.id, before: { status: m.status }, after: { status: to }, reason: req.body.reason ?? null });
  });
  res.json({ mandate: { id: m.ref, name: m.name, type: m.type, status: to } });
});
