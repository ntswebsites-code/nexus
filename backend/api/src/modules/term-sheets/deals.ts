import type { Prisma } from '@prisma/client';
import { nextRef } from '../../lib/refs';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';

/** BR-212: stages in which a countersigned term sheet moves the deal forward. */
export const DEAL_STAGES = ['TERM_SHEET', 'TERM_SHEET_NEGOTIATION', 'UNDER_BOARD_REVIEW', 'APPROVED', 'CLOSED', 'DECLINED'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
const ADVANCEABLE: DealStage[] = ['TERM_SHEET', 'TERM_SHEET_NEGOTIATION'];

/** The deal that a term sheet belongs to: its own, else the company's open pre-board deal, else a new one at TERM_SHEET. */
export async function ensureDeal(tx: Prisma.TransactionClient, ts: { id: string; companyId: string }) {
  const own = await tx.investeeDeal.findUnique({ where: { termSheetId: ts.id } });
  if (own) return own;
  const open = await tx.investeeDeal.findFirst({
    where: { companyId: ts.companyId, stage: { in: ADVANCEABLE }, termSheetId: null },
    orderBy: { createdAt: 'desc' },
  });
  if (open) return tx.investeeDeal.update({ where: { id: open.id }, data: { termSheetId: ts.id } });
  return tx.investeeDeal.create({ data: { ref: await nextRef(tx, 'investeeDeal'), companyId: ts.companyId, termSheetId: ts.id, stage: 'TERM_SHEET' } });
}

/**
 * Both parties have signed. A deal still at TERM_SHEET or TERM_SHEET_NEGOTIATION advances to UNDER_BOARD_REVIEW;
 * a deal that already moved on is left alone (never regress). Returns the stage change, if any.
 */
export async function advanceDealOnCountersign(
  tx: Prisma.TransactionClient,
  ts: { id: string; ref: string; title: string; companyId: string },
  audit: AuditContext,
  companyUserIds: string[],
) {
  const deal = await ensureDeal(tx, ts);
  if (!ADVANCEABLE.includes(deal.stage as DealStage)) return { deal, advanced: false };
  const claim = await tx.investeeDeal.updateMany({
    where: { id: deal.id, stage: { in: ADVANCEABLE } },
    data: { stage: 'UNDER_BOARD_REVIEW', stageChangedAt: new Date() },
  });
  if (claim.count !== 1) return { deal, advanced: false };
  await writeAudit(tx, audit, {
    action: 'deal.stage_advanced',
    objectType: 'investee_deal',
    objectId: deal.id,
    before: { stage: deal.stage },
    after: { stage: 'UNDER_BOARD_REVIEW', termSheet: ts.ref },
  });
  if (companyUserIds.length) {
    await enqueue(tx, 'notify.users', {
      userIds: companyUserIds,
      type: 'deal.under_board_review',
      title: `Deal ${deal.ref} is now under board review`,
      body: `Term sheet ${ts.ref} is signed by both parties.`,
      email: true,
    });
  }
  await enqueue(tx, 'notify.permission', {
    permission: 'term_sheets.view',
    type: 'deal.under_board_review',
    title: `Deal ${deal.ref} moved to board review`,
    body: `${ts.title} (${ts.ref}) was countersigned.`,
    link: '/?page=private-markets',
  });
  return { deal: { ...deal, stage: 'UNDER_BOARD_REVIEW' }, advanced: true };
}
