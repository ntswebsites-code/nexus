import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';

export async function findClient(refOrId: string) {
  const client = await prisma.client.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }], archivedAt: null } });
  if (!client) throw HttpError.notFound('Client not found');
  return client;
}

type ClientRow = Prisma.ClientGetPayload<{ include: { mandates: true; _count: { select: { cashAccounts: true } } } }>;

/** Client in the admin prototype's `clients` shape (plus uuid/version for writes). */
export function clientView(c: ClientRow) {
  const mandate = c.mandates.find((m) => m.status !== 'Closed');
  return {
    id: c.ref,
    uuid: c.id,
    name: c.name,
    type: c.type,
    accounts: Math.max(c.accountsCount, c._count.cashAccounts),
    value: c.valueLabel ?? 'US$ 0.00M',
    ccy: c.baseCurrency,
    kyc: c.kycStatus,
    risk: c.riskRating,
    mandate: c.mandateLabel ?? mandate?.name ?? '—',
    owner: c.ownerName ?? 'Client Services',
    email: c.email ?? '',
    phone: c.phone ?? '',
    registration: c.registrationRef ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    portalEnabled: c.portalEnabled,
    nextReviewDate: c.nextReviewDate,
    version: c.version,
  };
}

export const clientInclude = { mandates: true, _count: { select: { cashAccounts: true } } } satisfies Prisma.ClientInclude;

type AccountRow = Prisma.CashAccountGetPayload<{ include: { client: { select: { ref: true; name: true; mandateLabel: true } } } }>;

interface CashMeta {
  portfolio?: string;
  effective?: string;
  calendar?: string;
  tolerance?: string;
  gl?: string;
  posted?: string;
  reserved?: string;
  blocked?: string;
  expected?: string;
  available?: string;
  withdrawable?: string;
  recon?: string;
  statement?: string;
  makerName?: string;
}

/** Cash account in the prototype's `cashAccounts` shape. The identifier is always masked. */
export function cashAccountView(a: AccountRow) {
  const m = (a.meta as CashMeta | null) ?? {};
  const active = a.status === 'ACTIVE';
  return {
    id: a.ref,
    uuid: a.id,
    legalEntity: a.legalEntity,
    client: a.client.name,
    clientId: a.client.ref,
    mandate: a.client.mandateLabel ?? '—',
    portfolio: m.portfolio ?? '—',
    ownership: a.ownership,
    moneyClass: a.moneyClass === 'Client money' ? 'CLIENT_MONEY' : a.moneyClass,
    type: a.type,
    provider: a.provider,
    masked: a.masked === 'Pending' ? 'Pending' : a.masked.replace('**** ', '••••'),
    currency: a.currency,
    effective: m.effective ?? (a.approvedAt ? a.approvedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'On approval'),
    calendar: m.calendar ?? 'Africa/Harare',
    tolerance: m.tolerance ?? `${a.currency}-CASH-STD`,
    gl: m.gl ?? `${a.currency} cash control`,
    status: a.status,
    posted: m.posted ?? '0.00',
    reserved: m.reserved ?? '0.00',
    blocked: m.blocked ?? '0.00',
    expected: m.expected ?? '0.00',
    available: m.available ?? '0.00',
    withdrawable: m.withdrawable ?? '0.00',
    recon: m.recon ?? (active ? 'Awaiting first statement' : 'Not active'),
    statement: m.statement ?? 'No committed statement',
    maker: m.makerName ?? 'Client Services',
    version: a.version,
  };
}

export const accountInclude = { client: { select: { ref: true, name: true, mandateLabel: true } } } satisfies Prisma.CashAccountInclude;

export async function findAccount(refOrId: string) {
  const account = await prisma.cashAccount.findFirst({ where: { OR: [{ ref: refOrId }, { id: refOrId }] }, include: accountInclude });
  if (!account) throw HttpError.notFound('Cash account not found');
  return account;
}
