/**
 * Cash & Ledgers demo wiring: gives every portfolio the standard cash ledger set (bank, client control, clearing,
 * suspense, fees) in each currency it holds cash in, and books ONE posted opening-balance journal from its latest
 * portfolio_cash figure so the derived balances start from the book of record. Idempotent: existing ledgers are left
 * alone and a portfolio that already has any cash journal is not touched. Nothing else is posted.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-cash.ts   (standalone; run seed-portfolio first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';

const log = (m: string) => console.log(`[seed:cash] ${m}`);

const SET = [
  { name: 'Operating bank account', kind: 'BANK' },
  { name: 'Client cash control', kind: 'CONTROL' },
  { name: 'Settlement clearing', kind: 'CLEARING' },
  { name: 'Cash suspense', kind: 'SUSPENSE' },
  { name: 'Fees and charges', kind: 'EXPENSE' },
] as const;

export async function seedCash() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }
  // Maker-checker: the opening-balance journals are prepared by one user and posted by a different one. The poster must be an
  // active admin-portal user whose role carries the posting permission (cash.journal.approve), never a portal user.
  const poster =
    (await prisma.user.findFirst({
      where: { id: { not: actor }, isActive: true, roles: { some: { role: { portal: 'admin', permissions: { some: { permission: 'cash.journal.approve' } } } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }))?.id ?? actor;
  if (poster === actor) log('no other admin user with cash.journal.approve: opening journals keep the same maker and poster');
  else {
    // Only opening journals the seed itself posted with the same user as maker are re-assigned.
    const fixed = await prisma.cashJournal.updateMany({ where: { sourceRef: 'OPENING-BALANCE', status: 'POSTED', makerId: actor, postedBy: actor }, data: { postedBy: poster } });
    if (fixed.count) log(`${fixed.count} opening journal(s): poster changed to a different user than the maker`);
  }
  const portfolios = await prisma.portfolio.findMany({ select: { id: true, ref: true, baseCurrency: true } });
  if (!portfolios.length) {
    log('no portfolios: skipped');
    return;
  }
  for (const p of portfolios) {
    const cash = await prisma.portfolioCash.findMany({ where: { portfolioId: p.id }, orderBy: { asOf: 'desc' } });
    const latest = new Map<string, { available: Prisma.Decimal; asOf: Date }>();
    for (const c of cash) if (!latest.has(c.currency)) latest.set(c.currency, { available: c.available, asOf: c.asOf });
    if (!latest.size) latest.set(p.baseCurrency, { available: new Prisma.Decimal(0), asOf: new Date() });
    let added = 0;
    let opened = 0;
    for (const [currency, v] of latest) {
      const have = await prisma.cashLedger.findMany({ where: { portfolioId: p.id, currency }, select: { name: true } });
      const names = new Set(have.map((h) => h.name));
      await prisma.$transaction(async (tx) => {
        for (const l of SET.filter((x) => !names.has(x.name))) {
          const ref = await nextRef(tx, 'cashLedger');
          await tx.cashLedger.create({ data: { ref, portfolioId: p.id, name: l.name, currency, kind: l.kind, createdBy: actor } });
          added++;
        }
      });
      const hasJournal = await prisma.cashJournal.count({ where: { portfolioId: p.id } });
      if (hasJournal || v.available.lte(0)) continue;
      const bank = await prisma.cashLedger.findFirst({ where: { portfolioId: p.id, currency, kind: 'BANK' }, orderBy: { ref: 'asc' } });
      const control = await prisma.cashLedger.findFirst({ where: { portfolioId: p.id, currency, kind: 'CONTROL' }, orderBy: { ref: 'asc' } });
      if (!bank || !control) continue;
      await prisma.$transaction(async (tx) => {
        const ref = await nextRef(tx, 'cashJournal');
        const now = new Date();
        await tx.cashJournal.create({
          data: {
            ref,
            portfolioId: p.id,
            entryDate: v.asOf,
            description: `Opening cash balance from the portfolio cash record (${currency})`,
            purpose: 'MANUAL_CORRECTION',
            sourceRef: 'OPENING-BALANCE',
            currency,
            status: 'POSTED',
            totalDebit: v.available,
            totalCredit: v.available,
            makerId: actor,
            submittedAt: now,
            postedBy: poster,
            postedAt: now,
            lines: {
              create: [
                { lineNo: 1, ledgerId: bank.id, debit: v.available, credit: 0, memo: 'Opening balance' },
                { lineNo: 2, ledgerId: control.id, debit: 0, credit: v.available, memo: 'Opening balance' },
              ],
            },
          },
        });
        opened++;
      });
    }
    log(`${p.ref}: ${added} ledger(s) added, ${opened} opening journal(s)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedCash();
  } catch (err) {
    console.error('[seed:cash] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
