import { Prisma, type TermSheet, type TermSheetTemplate } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { notifyCompany, snapshot, transition, type TermSheetStatus } from './term-sheets.service';

/**
 * GAP-020 staff extras: fund-side reject and void, amendment versioning and the template library.
 *   SIGNED_BY_COMPANY --reject (fund)--> REJECTED_BY_FUND
 *   SIGNED_BY_COMPANY | COUNTERSIGNED --void--> VOIDED          (an EXECUTED sheet is final)
 *   ISSUED | VIEWED | SIGNED_BY_COMPANY | DECLINED | REJECTED_BY_FUND --amend--> SUPERSEDED, new DRAFT v(n+1) linked by parentId
 */
type Actor = { userId: string; audit: AuditContext };
type WithCompany = TermSheet & { company: { id: string; name: string; ref: string } };

const REJECTABLE: TermSheetStatus[] = ['SIGNED_BY_COMPANY'];
const VOIDABLE: TermSheetStatus[] = ['SIGNED_BY_COMPANY', 'COUNTERSIGNED'];
const AMENDABLE: TermSheetStatus[] = ['ISSUED', 'VIEWED', 'SIGNED_BY_COMPANY', 'DECLINED', 'REJECTED_BY_FUND'];

export const reasonBody = z.object({ reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(500) });

async function close(actor: Actor, ts: WithCompany, from: TermSheetStatus[], to: 'REJECTED_BY_FUND' | 'VOIDED', reason: string, verb: string) {
  if (!from.includes(ts.status as TermSheetStatus)) {
    throw new HttpError(409, 'invalid_state', `A term sheet in ${ts.status} cannot be ${verb}`);
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, from, { status: to, closeReason: reason, closedById: actor.userId, closedAt: new Date() });
    await tx.signatureRequest.updateMany({ where: { subjectType: 'term_sheet', subjectId: ts.id, status: 'Pending' }, data: { status: 'Cancelled' } });
    await writeAudit(tx, actor.audit, {
      action: to === 'VOIDED' ? 'term_sheet.voided' : 'term_sheet.rejected_by_fund',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
      reason,
    });
    await notifyCompany(tx, ts.companyId, `Term sheet ${ts.ref} ${to === 'VOIDED' ? 'voided' : 'rejected by the fund'}`, reason);
    return next;
  });
}

export const rejectByFund = (actor: Actor, ts: WithCompany, reason: string) => close(actor, ts, REJECTABLE, 'REJECTED_BY_FUND', reason, 'rejected');
export const voidTermSheet = (actor: Actor, ts: WithCompany, reason: string) => close(actor, ts, VOIDABLE, 'VOIDED', reason, 'voided');

/** Creates the next version as a draft copy and supersedes the sheet it replaces. The deal follows the new version. */
export async function amendTermSheet(actor: Actor, ts: WithCompany, reason: string) {
  if (!AMENDABLE.includes(ts.status as TermSheetStatus)) {
    throw new HttpError(409, 'invalid_state', `A term sheet in ${ts.status} cannot be amended`);
  }
  return prisma.$transaction(async (tx) => {
    await transition(tx, ts, AMENDABLE, { status: 'SUPERSEDED', closeReason: reason, closedById: actor.userId, closedAt: new Date() });
    await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES ('termSheet', 1000) ON DUPLICATE KEY UPDATE value = value`;
    await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = 'termSheet'`;
    const rows = await tx.$queryRaw<{ v: bigint | number }[]>`SELECT LAST_INSERT_ID() AS v`;
    const ref = `TS-${Number(rows[0]!.v)}`;
    await tx.signatureRequest.updateMany({ where: { subjectType: 'term_sheet', subjectId: ts.id, status: 'Pending' }, data: { status: 'Cancelled' } });
    const next = await tx.termSheet.create({
      data: {
        ref,
        companyId: ts.companyId,
        title: ts.title,
        versionNo: ts.versionNo + 1,
        status: 'DRAFT',
        investmentAmount: ts.investmentAmount,
        valuation: ts.valuation,
        equityPercentage: ts.equityPercentage,
        currency: ts.currency,
        keyTerms: ts.keyTerms === null ? Prisma.DbNull : (ts.keyTerms as Prisma.InputJsonValue),
        conditions: ts.conditions,
        timeline: ts.timeline,
        createdById: actor.userId,
        parentId: ts.id,
        amendmentReason: reason,
      },
    });
    const deal = await tx.investeeDeal.findUnique({ where: { termSheetId: ts.id } });
    if (deal) {
      await tx.investeeDeal.update({
        where: { id: deal.id },
        data: { termSheetId: next.id, ...(deal.stage === 'TERM_SHEET' ? { stage: 'TERM_SHEET_NEGOTIATION', stageChangedAt: new Date() } : {}) },
      });
    }
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.amended',
      objectType: 'term_sheet',
      objectId: next.id,
      before: snapshot(ts),
      after: snapshot(next),
      reason,
    });
    await notifyCompany(tx, ts.companyId, `Term sheet ${ts.ref} is being amended`, `A new version (${next.ref}) will be issued: ${reason}`);
    return next;
  });
}

/** Version chain, oldest first, ending at the newest amendment. */
export async function termSheetHistory(ts: TermSheet) {
  let root: TermSheet = ts;
  for (let i = 0; i < 50 && root.parentId; i += 1) {
    const parent = await prisma.termSheet.findUnique({ where: { id: root.parentId } });
    if (!parent) break;
    root = parent;
  }
  const chain: TermSheet[] = [root];
  for (let i = 0; i < 50; i += 1) {
    const child = await prisma.termSheet.findFirst({ where: { parentId: chain[chain.length - 1]!.id } });
    if (!child) break;
    chain.push(child);
  }
  return chain.map((r) => ({
    id: r.id,
    ref: r.ref,
    versionNo: r.versionNo,
    status: r.status,
    amendmentReason: r.amendmentReason,
    closeReason: r.closeReason,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------- template library

const jsonField = z.union([z.string().max(20000), z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish();
export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullish(),
  keyTerms: jsonField,
  conditions: z.string().max(20000).nullish(),
  timeline: z.string().max(20000).nullish(),
});
export const templateUpdateSchema = templateSchema.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });

const termsJson = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.DbNull : ((typeof v === 'string' ? { summary: v } : v) as Prisma.InputJsonValue));

export const templateView = (t: TermSheetTemplate) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  keyTerms: t.keyTerms ?? null,
  conditions: t.conditions,
  timeline: t.timeline,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

export async function listTemplates(includeArchived = false) {
  const rows = await prisma.termSheetTemplate.findMany({ where: includeArchived ? {} : { status: 'ACTIVE' }, orderBy: { name: 'asc' }, take: 200 });
  return rows.map(templateView);
}

export async function createTemplate(actor: Actor, input: z.infer<typeof templateSchema>) {
  if (await prisma.termSheetTemplate.findUnique({ where: { name: input.name } })) throw HttpError.conflict('A template with this name already exists', 'duplicate');
  return prisma.$transaction(async (tx) => {
    const row = await tx.termSheetTemplate.create({
      data: { name: input.name, description: input.description ?? null, keyTerms: termsJson(input.keyTerms), conditions: input.conditions ?? null, timeline: input.timeline ?? null, createdBy: actor.userId },
    });
    await writeAudit(tx, actor.audit, { action: 'term_sheet.template_created', objectType: 'term_sheet_template', objectId: row.id, after: { name: row.name } });
    return templateView(row);
  });
}

export async function updateTemplate(actor: Actor, id: string, input: z.infer<typeof templateUpdateSchema>) {
  const row = await prisma.termSheetTemplate.findUnique({ where: { id } });
  if (!row) throw HttpError.notFound('Template not found');
  if (input.name && input.name !== row.name && (await prisma.termSheetTemplate.findUnique({ where: { name: input.name } }))) {
    throw HttpError.conflict('A template with this name already exists', 'duplicate');
  }
  return prisma.$transaction(async (tx) => {
    const next = await tx.termSheetTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        keyTerms: termsJson(input.keyTerms),
        conditions: input.conditions,
        timeline: input.timeline,
        status: input.status,
      },
    });
    await writeAudit(tx, actor.audit, { action: 'term_sheet.template_updated', objectType: 'term_sheet_template', objectId: id, before: { name: row.name, status: row.status }, after: { name: next.name, status: next.status } });
    return templateView(next);
  });
}
