import { z } from 'zod';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';

/** Defaults shown until the fund maintains a company's own list (CMP-030). */
const DEFAULT_RESERVED_MATTERS = [
  { name: 'New debt', detail: 'Borrowing above the agreed facility, or security over company assets.', noticeDays: 14 },
  { name: 'Share capital', detail: 'Issue, transfer, buyback or a change to the option pool.', noticeDays: 14 },
  { name: 'Acquisitions', detail: 'A material acquisition or disposal.', noticeDays: 14 },
  { name: 'Executive changes', detail: 'Appointment, dismissal or a material remuneration change.', noticeDays: 14 },
  { name: 'Annual budget', detail: 'The annual budget and changes above the agreed tolerance.', noticeDays: 14 },
] as const;
export const DEFAULT_NOTICE_DAYS = 14;

type Db = Pick<typeof prisma, 'investeeReservedMatter'>;

export const reservedMatterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  detail: z.string().trim().max(400).optional(),
  noticeDays: z.number().int().min(0).max(365).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const reservedMatterUpdateSchema = reservedMatterSchema.partial().extend({ active: z.boolean().optional() });

export async function reservedMattersFor(companyId: string, db: Db = prisma) {
  const rows = await db.investeeReservedMatter.findMany({ where: { companyId, active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (!rows.length) return DEFAULT_RESERVED_MATTERS.map((m) => ({ id: null as string | null, ...m }));
  return rows.map((r) => ({ id: r.id as string | null, name: r.name, detail: r.detail, noticeDays: r.noticeDays }));
}

/** BR-218: the decision is due after the contractual notice period of the matter (default 14 days). */
export async function noticeDaysFor(db: Db, companyId: string, basis: string) {
  const wanted = basis.trim().toLowerCase();
  const matters = await reservedMattersFor(companyId, db);
  return matters.find((m) => m.name.toLowerCase() === wanted)?.noticeDays ?? DEFAULT_NOTICE_DAYS;
}

/** BR-221: obligations met on time over obligations that fell due in the last 12 months (reporting periods). */
export function healthRatio(due: { dueDate: Date; status: string; submittedAt: Date | null }[]) {
  const onTime = due.filter((p) => {
    if (p.status !== 'submitted' && p.status !== 'accepted') return false;
    const cutoff = new Date(p.dueDate.getTime() + 86400000 - 1);
    return p.submittedAt !== null && p.submittedAt <= cutoff;
  }).length;
  return { due: due.length, onTime, ratio: due.length ? Math.round((onTime / due.length) * 1000) / 10 : null };
}

export async function complianceHealth(companyId: string, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  const due = await prisma.reportingPeriod.findMany({
    where: { companyId, dueDate: { gt: from, lte: now } },
    select: { dueDate: true, status: true, submittedAt: true },
  });
  return healthRatio(due);
}

// ---------------------------------------------------------------- staff maintenance

export async function listReservedMattersForStaff(companyId: string) {
  const rows = await prisma.investeeReservedMatter.findMany({ where: { companyId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (!rows.length) return { custom: false, matters: await reservedMattersFor(companyId) };
  return { custom: true, matters: rows.map((r) => ({ id: r.id, name: r.name, detail: r.detail, noticeDays: r.noticeDays, sortOrder: r.sortOrder, active: r.active })) };
}

async function requireCompany(companyId: string) {
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId }, select: { id: true } });
  if (!company) throw HttpError.notFound('Company not found');
}

export async function addReservedMatter(companyId: string, body: z.infer<typeof reservedMatterSchema>, audit: AuditContext) {
  await requireCompany(companyId);
  const exists = await prisma.investeeReservedMatter.findUnique({ where: { companyId_name: { companyId, name: body.name } } });
  if (exists) throw HttpError.conflict('This company already has a reserved matter with that name', 'duplicate');
  await prisma.$transaction(async (tx) => {
    const row = await tx.investeeReservedMatter.create({
      data: { companyId, name: body.name, detail: body.detail ?? '', noticeDays: body.noticeDays ?? DEFAULT_NOTICE_DAYS, sortOrder: body.sortOrder ?? 0, createdBy: audit.actorId ?? '' },
    });
    await writeAudit(tx, audit, { action: 'company.reserved_matter.created', objectType: 'investee_reserved_matter', objectId: row.id, after: { companyId, name: row.name, noticeDays: row.noticeDays } });
  });
  return listReservedMattersForStaff(companyId);
}

export async function updateReservedMatter(companyId: string, id: string, body: z.infer<typeof reservedMatterUpdateSchema>, audit: AuditContext) {
  const row = await prisma.investeeReservedMatter.findFirst({ where: { id, companyId } });
  if (!row) throw HttpError.notFound('Reserved matter not found');
  await prisma.$transaction(async (tx) => {
    await tx.investeeReservedMatter.update({ where: { id }, data: { name: body.name, detail: body.detail, noticeDays: body.noticeDays, sortOrder: body.sortOrder, active: body.active } });
    await writeAudit(tx, audit, {
      action: 'company.reserved_matter.updated',
      objectType: 'investee_reserved_matter',
      objectId: id,
      before: { name: row.name, noticeDays: row.noticeDays, active: row.active },
      after: { name: body.name ?? row.name, noticeDays: body.noticeDays ?? row.noticeDays, active: body.active ?? row.active },
    });
  });
  return listReservedMattersForStaff(companyId);
}
