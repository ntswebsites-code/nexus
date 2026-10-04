import { Router } from 'express';
import { z } from 'zod';
import { emailSchema } from '@matanho/shared';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { policy } from '../../lib/policy';
import { decryptField, encryptField, maskIdentifier } from '../../lib/crypto';
import { actorName, ctx, expectVersion, param, query } from '../../lib/http';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAnyPermission, requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { createInvitation } from '../identity/invitations';
import { caseSummary, caseInclude, maybeCompleteActivation } from '../kyc/kyc.service';
import { accountInclude, cashAccountView, clientInclude, clientView, findAccount, findClient } from './clients.service';
import { pageEnvelope, sqlPage } from '../../middleware/paginate';

export const clientsRoutes = Router();
clientsRoutes.use(requireAuth, requirePortalAccess('admin'));

const listQuery = z.object({ q: z.string().trim().max(120).optional(), risk: z.string().optional(), kyc: z.string().optional() });

clientsRoutes.get('/clients', requirePermission('clients.view'), validateQuery(listQuery), async (req, res) => {
  const q = query<z.infer<typeof listQuery>>(req);
  const where = {
    archivedAt: null,
    ...(q.risk ? { riskRating: q.risk } : {}),
    ...(q.kyc ? { kycStatus: q.kyc } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q } }, { ref: { contains: q.q } }, { ownerName: { contains: q.q } }] } : {}),
  };
  const pg = sqlPage(req, 5000);
  const [rows, total] = await Promise.all([
    prisma.client.findMany({ where, include: clientInclude, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.client.count({ where }),
  ]);
  res.json(pageEnvelope(pg, rows.map(clientView), total));
});

const clientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(64),
  ccy: z.string().trim().length(3).toUpperCase().default('USD'),
  risk: z.enum(['Low', 'Medium', 'High']).default('Medium'),
  mandate: z.string().trim().max(120).optional(),
  owner: z.string().trim().max(120).optional(),
  email: z.union([emailSchema, z.literal('')]).optional(),
  phone: z.string().trim().max(40).optional(),
  registration: z.string().trim().max(80).optional(),
  address: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(4000).optional(),
  kyc: z.enum(['Pending', 'Current', 'Review due', 'Enhanced review']).optional(),
});

function clientData(b: Partial<z.infer<typeof clientSchema>>) {
  return {
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.type !== undefined ? { type: b.type } : {}),
    ...(b.ccy !== undefined ? { baseCurrency: b.ccy } : {}),
    ...(b.risk !== undefined ? { riskRating: b.risk } : {}),
    ...(b.mandate !== undefined ? { mandateLabel: b.mandate || null } : {}),
    ...(b.owner !== undefined ? { ownerName: b.owner || null } : {}),
    ...(b.email !== undefined ? { email: b.email || null } : {}),
    ...(b.phone !== undefined ? { phone: b.phone || null } : {}),
    ...(b.registration !== undefined ? { registrationRef: b.registration || null } : {}),
    ...(b.address !== undefined ? { address: b.address || null } : {}),
    ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
    ...(b.kyc !== undefined ? { kycStatus: b.kyc } : {}),
  };
}

clientsRoutes.post('/clients', requirePermission('clients.edit'), validateBody(clientSchema), async (req, res) => {
  const b = req.body as z.infer<typeof clientSchema>;
  const id = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'client');
    const client = await tx.client.create({
      data: { ref, ...clientData(b), name: b.name, type: b.type, kycStatus: b.kyc ?? 'Pending', createdBy: req.user!.id },
    });
    if (b.mandate) {
      await tx.mandate.create({
        data: { ref: await nextRef(tx, 'mandate'), clientId: client.id, name: b.mandate, type: 'discretionary', createdBy: req.user!.id },
      });
    }
    await writeAudit(tx, ctx(req, 'admin'), { action: 'client.created', objectType: 'client', objectId: client.id, after: { ref, ...b } });
    return client.id;
  });
  const row = await prisma.client.findUniqueOrThrow({ where: { id }, include: clientInclude });
  res.status(201).json({ client: clientView(row) });
});

clientsRoutes.patch('/clients/:id', requirePermission('clients.edit'), validateBody(clientSchema.partial().extend({ version: z.number().int().optional() })), async (req, res) => {
  const client = await findClient(param(req, 'id'));
  expectVersion(req, client.version);
  const data = clientData(req.body);
  const changed = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => (client as unknown as Record<string, unknown>)[k] !== v),
  );
  if (Object.keys(changed).length) {
    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: client.id }, data: { ...changed, updatedBy: req.user!.id, version: { increment: 1 } } });
      // The mandate shown in lists and the 360 view comes from Mandate rows, so keep them in step with the edited label.
      if (req.body.mandate !== undefined) {
        const active = await tx.mandate.findFirst({ where: { clientId: client.id, status: { not: 'Closed' } }, orderBy: { createdAt: 'asc' } });
        if (req.body.mandate && active) {
          if (active.name !== req.body.mandate) await tx.mandate.update({ where: { id: active.id }, data: { name: req.body.mandate } });
        } else if (req.body.mandate) {
          await tx.mandate.create({ data: { ref: await nextRef(tx, 'mandate'), clientId: client.id, name: req.body.mandate, type: 'discretionary', createdBy: req.user!.id } });
        } else if (active) {
          await tx.mandate.update({ where: { id: active.id }, data: { status: 'Closed' } });
        }
      }
      await writeAudit(tx, ctx(req, 'admin'), {
        action: 'client.updated',
        objectType: 'client',
        objectId: client.id,
        before: Object.fromEntries(Object.keys(changed).map((k) => [k, (client as unknown as Record<string, unknown>)[k]])),
        after: changed,
      });
    });
  }
  const row = await prisma.client.findUniqueOrThrow({ where: { id: client.id }, include: clientInclude });
  res.json({ client: clientView(row) });
});

clientsRoutes.get('/clients/:id/360', requirePermission('clients.view'), async (req, res) => {
  const client = await findClient(param(req, 'id'));
  const [row, accounts, cases, documents, requests, users, invitations] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: client.id }, include: clientInclude }),
    prisma.cashAccount.findMany({ where: { clientId: client.id }, include: accountInclude, orderBy: { ref: 'asc' } }),
    prisma.kycCase.findMany({ where: { clientId: client.id }, include: caseInclude }),
    prisma.document.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.serviceRequest.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.clientUser.findMany({ where: { clientId: client.id }, include: { user: { select: { email: true, name: true, lastLoginAt: true } } } }),
    prisma.invitation.findMany({ where: { clientId: client.id, acceptedAt: null, revokedAt: null } }),
  ]);
  res.json({
    client: clientView(row),
    mandates: row.mandates.map((m) => ({ id: m.ref, name: m.name, type: m.type, status: m.status })),
    cashAccounts: accounts.map(cashAccountView),
    kycCases: cases.map(caseSummary),
    documents: documents.map((d) => ({ id: d.ref, name: d.name, type: d.type, status: d.status, date: d.documentDate ?? d.createdAt })),
    requests: requests.map((r) => ({ id: r.ref, title: r.title, status: r.status, type: r.type, updatedAt: r.updatedAt })),
    portalUsers: users.map((u) => ({ email: u.user.email, name: u.user.name, role: u.investorRole, scope: u.accountScope, lastLoginAt: u.user.lastLoginAt })),
    pendingInvitations: invitations.map((i) => ({ id: i.id, email: i.email, roles: i.roleKeys, expiresAt: i.expiresAt })),
  });
});

const mandateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(['discretionary', 'cis', 'private_markets', 'treasury', 'advisory']),
});

clientsRoutes.get('/clients/:id/mandates', requirePermission('clients.view'), async (req, res) => {
  const client = await findClient(param(req, 'id'));
  const rows = await prisma.mandate.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'asc' } });
  res.json({ data: rows.map((m) => ({ id: m.ref, name: m.name, type: m.type, status: m.status })) });
});

clientsRoutes.post('/clients/:id/mandates', requirePermission('clients.edit'), validateBody(mandateSchema), async (req, res) => {
  const client = await findClient(param(req, 'id'));
  const mandate = await prisma.$transaction(async (tx) => {
    const m = await tx.mandate.create({
      data: { ref: await nextRef(tx, 'mandate'), clientId: client.id, name: req.body.name, type: req.body.type, createdBy: req.user!.id },
    });
    await writeAudit(tx, ctx(req, 'admin'), { action: 'mandate.created', objectType: 'mandate', objectId: m.id, after: { ref: m.ref, clientRef: client.ref, ...req.body } });
    return m;
  });
  res.status(201).json({ mandate: { id: mandate.ref, name: mandate.name, type: mandate.type, status: mandate.status } });
});

// -------------------------------------------------------------- cash accounts

clientsRoutes.get('/cash-accounts', requireAnyPermission('cash.view', 'clients.view'), async (req, res) => {
  const pg = sqlPage(req, 5000);
  const [rows, total] = await Promise.all([prisma.cashAccount.findMany({ include: accountInclude, orderBy: { ref: 'asc' }, skip: pg.skip, take: pg.take }), prisma.cashAccount.count()]);
  res.json(pageEnvelope(pg, rows.map(cashAccountView), total));
});

const accountSchema = z.object({
  clientId: z.string().min(1),
  provider: z.string().trim().min(1).max(120),
  identifier: z.string().trim().min(2).max(64),
  currency: z.string().trim().length(3).toUpperCase(),
  portfolio: z.string().trim().max(120).optional(),
  type: z.string().trim().max(40).default('CLIENT_BANK'),
  ownership: z.enum(['SEGREGATED', 'OMNIBUS', 'HYBRID']).default('SEGREGATED'),
});

clientsRoutes.post('/cash-accounts', requirePermission('clients.edit'), validateBody(accountSchema), async (req, res) => {
  const b = req.body as z.infer<typeof accountSchema>;
  const client = await findClient(b.clientId);
  const account = await prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, 'cashAccount');
    const a = await tx.cashAccount.create({
      data: {
        ref,
        clientId: client.id,
        legalEntity: client.name,
        ownership: b.ownership,
        type: b.type,
        provider: b.provider,
        identifierEnc: encryptField(b.identifier),
        masked: maskIdentifier(b.identifier),
        currency: b.currency,
        status: 'DRAFT',
        makerId: req.user!.id,
        meta: { portfolio: b.portfolio ?? '—', makerName: actorName(req) },
      },
    });
    await tx.client.update({ where: { id: client.id }, data: { accountsCount: { increment: 1 } } });
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'cash_account.created',
      objectType: 'cash_account',
      objectId: a.id,
      after: { ref, clientRef: client.ref, provider: b.provider, masked: a.masked, currency: b.currency },
    });
    return a;
  });
  res.status(201).json({ account: cashAccountView(await findAccount(account.id)) });
});

type Action = 'submit' | 'approve' | 'return' | 'suspend' | 'reactivate' | 'close';
const TRANSITIONS: Record<Action, { from: string[]; to: (s: string) => string; perm: string; checker: boolean }> = {
  submit: { from: ['DRAFT'], to: () => 'PENDING_APPROVAL', perm: 'clients.edit', checker: false },
  approve: { from: ['PENDING_APPROVAL'], to: () => 'ACTIVE', perm: 'cash.approve', checker: true },
  return: { from: ['PENDING_APPROVAL'], to: () => 'DRAFT', perm: 'cash.approve', checker: false },
  suspend: { from: ['ACTIVE'], to: () => 'SUSPENDED', perm: 'cash.approve', checker: true },
  reactivate: { from: ['SUSPENDED'], to: () => 'ACTIVE', perm: 'cash.approve', checker: true },
  close: { from: ['ACTIVE', 'CLOSING'], to: (s) => (s === 'ACTIVE' ? 'CLOSING' : 'CLOSED'), perm: 'cash.approve', checker: true },
};

clientsRoutes.post(
  '/cash-accounts/:id/:action',
  validateBody(z.object({ reason: z.string().trim().max(2000).optional(), version: z.number().int().optional() }).default({})),
  async (req, res, next) => {
    const action = param(req, 'action') as Action;
    const t = TRANSITIONS[action];
    if (!t) return next();
    if (action === 'submit' ? !req.user!.permissions.some((p) => p === 'clients.edit' || p === 'cash.approve') : !req.user!.permissions.includes(t.perm)) {
      throw HttpError.forbidden('You do not have permission to perform this action', 'permission_denied');
    }
    const a = await findAccount(param(req, 'id'));
    expectVersion(req, a.version);
    if (!t.from.includes(a.status)) throw HttpError.conflict(`Cannot ${action} an account that is ${a.status}`, 'invalid_transition');
    if (t.checker && (await policy('cash_approval')) && a.makerId === req.user!.id) {
      throw HttpError.conflict('The maker of this account cannot approve it', 'sod_violation');
    }
    if (action === 'return' && !req.body.reason) throw HttpError.badRequest('A reason is required to return an account');
    const to = t.to(a.status);
    await prisma.$transaction(async (tx) => {
      await tx.cashAccount.update({
        where: { id: a.id },
        data: {
          status: to,
          ...(action === 'submit' ? { submittedAt: new Date(), makerId: a.makerId ?? req.user!.id } : {}),
          ...(action === 'approve' ? { checkerId: req.user!.id, approvedAt: new Date() } : {}),
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, ctx(req, 'admin'), {
        action: `cash_account.${action}`,
        objectType: 'cash_account',
        objectId: a.id,
        before: { status: a.status },
        after: { status: to },
        reason: req.body.reason ?? null,
      });
      if (action === 'submit') {
        await enqueue(tx, 'notify.permission', {
          permission: 'cash.approve',
          type: 'cash_account.pending',
          title: `${a.ref} (${a.client.name}) awaits approval`,
          link: '/#clients',
        });
      }
      if (to === 'ACTIVE') await maybeCompleteActivation(tx, a.clientId, ctx(req, 'admin'));
    });
    res.json({ account: cashAccountView(await findAccount(a.id)) });
  },
);

/** FR-CLI-005: full identifier only to cash.approve, with step-up, audited. */
clientsRoutes.post('/cash-accounts/:id/reveal-identifier', requirePermission('cash.approve'), requireStepUp, async (req, res) => {
  const a = await findAccount(param(req, 'id'));
  await prisma.$transaction((tx) =>
    writeAudit(tx, ctx(req, 'admin'), { action: 'cash_account.identifier_revealed', objectType: 'cash_account', objectId: a.id }),
  );
  res.json({ identifier: decryptField(a.identifierEnc) });
});

// -------------------------------------------------------------- investor portal access (staff view)

clientsRoutes.get('/investor-users', requirePermission('clients.view'), async (req, res) => {
  const clientRef = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
  const client = clientRef ? await findClient(clientRef) : null;
  const where = client ? { clientId: client.id } : {};
  const [members, invitations] = await Promise.all([
    prisma.clientUser.findMany({ where, include: { user: { select: { email: true, name: true, lastLoginAt: true, isActive: true } }, client: { select: { ref: true, name: true } } } }),
    prisma.invitation.findMany({ where: { portal: 'investor', acceptedAt: null, revokedAt: null, ...(client ? { clientId: client.id } : {}) } }),
  ]);
  res.json({
    data: members.map((m) => ({
      id: m.id,
      clientId: m.client.ref,
      client: m.client.name,
      email: m.user.email,
      name: m.user.name,
      role: m.investorRole,
      scope: m.accountScope,
      status: m.user.isActive ? 'Active' : 'Disabled',
      lastLoginAt: m.user.lastLoginAt,
    })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, name: i.name, roles: i.roleKeys, expiresAt: i.expiresAt, status: 'Invited' })),
  });
});

const INVESTOR_ROLES = ['admin', 'investment', 'finance', 'auditor'] as const;
const inviteSchema = z.object({
  clientId: z.string().min(1),
  email: emailSchema,
  name: z.string().trim().max(120).optional(),
  role: z.enum(INVESTOR_ROLES),
  scope: z.string().trim().max(32).default('all'),
});

clientsRoutes.post('/investor-users', requirePermission('clients.edit'), validateBody(inviteSchema), async (req, res) => {
  const b = req.body as z.infer<typeof inviteSchema>;
  const client = await findClient(b.clientId);
  const invitation = await prisma.$transaction(async (tx) => {
    const { invitation: inv } = await createInvitation(tx, {
      email: b.email,
      name: b.name,
      portal: 'investor',
      roleKeys: [b.role],
      clientId: client.id,
      scope: b.scope,
      invitedById: req.user!.id,
      context: `the Matanho investor portal for ${client.name}`,
    });
    await writeAudit(tx, ctx(req, 'admin'), {
      action: 'investor_user.invited',
      objectType: 'client',
      objectId: client.id,
      after: { email: b.email, role: b.role, scope: b.scope },
    });
    return inv;
  });
  res.status(201).json({ invitation: { id: invitation.id, email: invitation.email, expiresAt: invitation.expiresAt } });
});

clientsRoutes.delete('/investor-users/:id', requirePermission('clients.edit'), async (req, res) => {
  const id = param(req, 'id');
  await prisma.$transaction(async (tx) => {
    const member = await tx.clientUser.findUnique({ where: { id } });
    if (member) {
      await tx.clientUser.delete({ where: { id } });
      const role = await tx.role.findFirst({ where: { portal: 'investor', key: member.investorRole } });
      const stillMember = await tx.clientUser.count({ where: { userId: member.userId } });
      if (role && !stillMember) await tx.userRole.deleteMany({ where: { userId: member.userId, roleId: role.id } });
      await writeAudit(tx, ctx(req, 'admin'), { action: 'investor_user.removed', objectType: 'client', objectId: member.clientId, before: { userId: member.userId } });
      return;
    }
    const inv = await tx.invitation.findUnique({ where: { id } });
    if (!inv) throw HttpError.notFound('User or invitation not found');
    await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctx(req, 'admin'), { action: 'invitation.revoked', objectType: 'invitation', objectId: id });
  });
  res.json({ ok: true });
});
