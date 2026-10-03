import { prisma } from '../../lib/prisma';

/** Search-by-name/ref pickers for the signing flows (so staff never paste raw ids). All return at most 25 rows. */

export interface LookupRow {
  id: string;
  label: string;
  sub: string;
  status?: string;
}

const money = (v: { toString(): string } | number, ccy: string) => `${ccy} ${Number(v.toString()).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export async function lookupCommitments(q?: string): Promise<LookupRow[]> {
  const t = q?.trim();
  const rows = await prisma.fundCommitment.findMany({
    where: {
      status: { not: 'CLOSED' },
      ...(t ? { OR: [{ client: { name: { contains: t } } }, { client: { ref: { contains: t } } }, { fund: { name: { contains: t } } }, { fund: { shortName: { contains: t } } }, { investorAccountRef: { contains: t } }] } : {}),
    },
    include: { client: { select: { name: true, ref: true } }, fund: { select: { name: true, shortName: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 25,
  });
  return rows.map((c) => ({ id: c.id, label: `${c.client.name} - ${c.fund.shortName}`, sub: `${c.client.ref} - ${money(c.commitmentAmount, c.currency)} - ${c.status.toLowerCase()}`, status: c.status }));
}

export async function lookupAllocations(q?: string): Promise<LookupRow[]> {
  const t = q?.trim();
  const rows = await prisma.capitalCallAllocation.findMany({
    where: {
      acknowledgedAt: null,
      call: { issuedAt: { not: null }, status: { notIn: ['DRAFT', 'CANCELLED', 'PENDING_APPROVAL', 'APPROVED'] } },
      ...(t ? { OR: [{ client: { name: { contains: t } } }, { client: { ref: { contains: t } } }, { call: { ref: { contains: t } } }, { call: { fund: { shortName: { contains: t } } } }] } : {}),
    },
    include: { client: { select: { name: true, ref: true } }, call: { select: { ref: true, callNo: true, currency: true, dueDate: true, fund: { select: { shortName: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  return rows.map((a) => ({ id: a.id, label: `${a.call.ref} - ${a.client.name}`, sub: `${a.call.fund.shortName} - call ${a.call.callNo} - ${money(a.callAmount, a.call.currency)} - due ${a.call.dueDate.toISOString().slice(0, 10)}`, status: a.status }));
}

/** Term sheets the company has signed and the fund has not yet countersigned. */
export async function lookupTermSheets(q?: string): Promise<LookupRow[]> {
  const t = q?.trim();
  const rows = await prisma.termSheet.findMany({
    where: { status: 'SIGNED_BY_COMPANY', ...(t ? { OR: [{ ref: { contains: t } }, { title: { contains: t } }, { company: { name: { contains: t } } }] } : {}) },
    include: { company: { select: { name: true } } },
    orderBy: { signedAt: 'desc' },
    take: 25,
  });
  return rows.map((s) => ({ id: s.id, label: `${s.ref} - ${s.company.name}`, sub: `${s.title} - ${money(s.investmentAmount, s.currency)} - signed by company`, status: s.status }));
}
