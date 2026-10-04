/**
 * Package S7 demo data: the term sheet template library (GAP-020). Reserved matters need no seed: until staff
 * maintain a company's own list the portal shows the five defaults with a 14 day notice period (CMP-030, BR-218).
 * Idempotent: a template that already exists by name is left alone. Nothing is revoked or overwritten.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-investee-deals.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { SYSTEM_ACTOR_ID } from '../src/lib/system';

const log = (m: string) => console.log(`[seed:investee-deals] ${m}`);

const TEMPLATES = [
  {
    name: 'Seed equity round',
    description: 'Ordinary or seed preferred shares, 1x non-participating preference, standard protective provisions.',
    keyTerms: { Instrument: 'Seed preferred shares', 'Liquidation preference': '1x non-participating', 'Anti-dilution': 'Broad-based weighted average', 'Board seat': 'One investor director', 'Pro-rata rights': 'Yes' },
    conditions: 'Satisfactory legal, financial and KYC due diligence.\nNo material adverse change before completion.\nBoard and shareholder approvals of the issue.',
    timeline: 'Term sheet signed within 14 days of issue.\nCompletion within 60 days of signature.',
  },
  {
    name: 'Growth equity round',
    description: 'Series preferred shares with information rights and reserved matters.',
    keyTerms: { Instrument: 'Series preferred shares', 'Liquidation preference': '1x participating up to 2x', 'Anti-dilution': 'Broad-based weighted average', 'Board seat': 'One investor director and one observer', 'Reserved matters': 'Standard investor consent list' },
    conditions: 'Audited accounts for the last two years.\nEstablished option pool before the round.\nCompletion of confirmatory due diligence.',
    timeline: 'Term sheet signed within 21 days of issue.\nCompletion within 90 days of signature.',
  },
  {
    name: 'Convertible instrument',
    description: 'Convertible note with a valuation cap and discount.',
    keyTerms: { Instrument: 'Convertible note', Discount: '20%', 'Valuation cap': 'To be agreed', Maturity: '24 months', Interest: '8% simple' },
    conditions: 'Board resolution authorising the note.\nNo senior debt without investor consent.',
    timeline: 'Term sheet signed within 10 days of issue.\nFunds released within 15 days of signature.',
  },
] as const;

export async function seedInvesteeDeals() {
  let templates = 0;
  for (const t of TEMPLATES) {
    const exists = await prisma.termSheetTemplate.findUnique({ where: { name: t.name }, select: { id: true } });
    if (exists) continue;
    await prisma.termSheetTemplate.create({ data: { name: t.name, description: t.description, keyTerms: t.keyTerms, conditions: t.conditions, timeline: t.timeline, createdBy: SYSTEM_ACTOR_ID } });
    templates += 1;
  }
  log(`term sheet templates: ${templates} added`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedInvesteeDeals();
  } catch (err) {
    console.error('[seed:investee-deals] FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
