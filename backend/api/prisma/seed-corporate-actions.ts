/**
 * Corporate Actions demo wiring: three upcoming events on listed securities so the page is not empty.
 * Idempotent (skips a ticker + type that already has a demo event); nothing is processed, no books change.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-corporate-actions.ts   (standalone; run seed-portfolio first)
 *   also called by seed-demo.ts and seed-uat.ts
 *
 * DLTA.ZW cash dividend (ANNOUNCED), SIM.ZW scrip dividend with an election (CONFIRMED), CMCL.VX 2-for-1 split (ANNOUNCED).
 * Dates are relative to the day the seed runs.
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';

const log = (m: string) => console.log(`[seed:corporate-actions] ${m}`);
const MARK = 'Demo event.';
const day = (n: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
};

const EVENTS = [
  { ticker: 'DLTA.ZW', type: 'CASH_DIVIDEND', status: 'ANNOUNCED', ex: 7, rec: 9, pay: 21, deadline: null, rate: '0.35', ratio: null, wht: '10', note: 'Interim cash dividend.' },
  { ticker: 'SIM.ZW', type: 'SCRIP_DIVIDEND', status: 'CONFIRMED', ex: 5, rec: 7, pay: 20, deadline: 12, rate: '0.12', ratio: ['1', '40'], wht: '0', note: 'Scrip alternative: 1 new share per 40 held, or cash.' },
  { ticker: 'CMCL.VX', type: 'STOCK_SPLIT', status: 'ANNOUNCED', ex: 14, rec: 16, pay: 16, deadline: null, rate: null, ratio: ['2', '1'], wht: '0', note: '2-for-1 split.' },
] as const;

export async function seedCorporateActions() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }
  for (const e of EVENTS) {
    const sec = await prisma.security.findUnique({ where: { ticker: e.ticker } });
    if (!sec) {
      log(`${e.ticker}: security not present, skipped`);
      continue;
    }
    if (await prisma.corpActionEvent.findFirst({ where: { securityId: sec.id, type: e.type, description: { startsWith: MARK } } })) {
      log(`${e.ticker} ${e.type}: already seeded`);
      continue;
    }
    const ref = await prisma.$transaction(async (tx) => {
      const r = await nextRef(tx, 'corpAction');
      await tx.corpActionEvent.create({
        data: {
          ref: r,
          securityId: sec.id,
          ticker: sec.ticker,
          securityName: sec.name,
          type: e.type,
          status: e.status,
          currency: sec.currency,
          exDate: day(e.ex),
          recordDate: day(e.rec),
          payDate: day(e.pay),
          electionDeadline: e.deadline === null ? null : day(e.deadline),
          rate: e.rate ? new Prisma.Decimal(e.rate) : null,
          ratioNew: e.ratio ? new Prisma.Decimal(e.ratio[0]) : null,
          ratioOld: e.ratio ? new Prisma.Decimal(e.ratio[1]) : null,
          withholdingPct: new Prisma.Decimal(e.wht),
          defaultOption: e.type === 'SCRIP_DIVIDEND' ? 'CASH' : null,
          description: `${MARK} ${e.note}`,
          makerId: actor,
          ...(e.status === 'CONFIRMED' ? { confirmedBy: actor, confirmedAt: new Date() } : {}),
        },
      });
      return r;
    });
    log(`${ref} ${e.ticker} ${e.type} (${e.status})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedCorporateActions();
  } catch (err) {
    console.error('[seed:corporate-actions] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
