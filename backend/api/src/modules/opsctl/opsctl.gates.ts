import { prisma } from '../../lib/prisma';
import { reconGate } from '../recon/recon.service';
import { FAMILY_LABEL, type Family } from '../recon/recon.engine';

/**
 * Close gates shared by the cash and accounting period closes (R4-2). Three controls, each with itemised blockers:
 *  - NAV_RELEASED: a RELEASED NAV run exists for the portfolio at the period end,
 *  - RECON_SIGNOFF: the reconciliation families that feed the close are signed off for the period end date, for every
 *    counterparty that holds the portfolio's mapped accounts (an all-counterparty sign-off covers them all),
 *  - RECON_MATERIAL: no Critical or High break is open up to the period end for the portfolio.
 * The whole set is switched off by the policy `close_gates` = false (the NAV release gate keeps its own policy).
 */
export interface GateItem {
  key: 'NAV_RELEASED' | 'RECON_SIGNOFF' | 'RECON_MATERIAL';
  label: string;
  ok: boolean;
  blockers: string[];
  detail: string;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export async function closeGatesEnabled(): Promise<boolean> {
  const p = await prisma.policy.findUnique({ where: { key: 'close_gates' } });
  return p?.value !== false;
}

export async function navGate(portfolioId: string, periodEnd: Date): Promise<GateItem> {
  const date = isoDay(periodEnd);
  const label = `NAV released for ${date}`;
  const runs = await prisma.navRun.findMany({ where: { portfolioId, navDate: periodEnd }, orderBy: [{ version: 'desc' }], select: { ref: true, version: true, status: true } });
  const released = runs.find((r) => r.status === 'RELEASED');
  if (released) return { key: 'NAV_RELEASED', label, ok: true, blockers: [], detail: `${released.ref} version ${released.version} released` };
  const live = runs.filter((r) => r.status !== 'SUPERSEDED' && r.status !== 'CANCELLED');
  const blockers = live.length
    ? live.map((r) => `NAV run ${r.ref} version ${r.version} for ${date} is ${r.status.toLowerCase().replace(/_/g, ' ')}; it must be released before the period can close`)
    : [`No NAV run exists for ${date}; calculate, review and release the period-end NAV first`];
  return { key: 'NAV_RELEASED', label, ok: false, blockers, detail: live.length ? `${plural(live.length, 'unreleased NAV run')}` : 'No NAV run at the period-end date' };
}

export async function reconSignoffGate(portfolioId: string, periodEnd: Date, families: Family[]): Promise<GateItem> {
  const date = isoDay(periodEnd);
  const label = `Reconciliation signed off for ${date} (${families.map((f) => FAMILY_LABEL[f].toLowerCase()).join(', ')})`;
  const maps = await prisma.reconAccountMap.findMany({ where: { portfolioId }, select: { counterpartyId: true } });
  const cpIds = [...new Set(maps.map((m) => m.counterpartyId))];
  if (!cpIds.length) return { key: 'RECON_SIGNOFF', label, ok: true, blockers: [], detail: 'No custodian accounts are mapped to this portfolio, so nothing is reconciled' };
  const [signoffs, cps] = await Promise.all([
    prisma.reconSignoff.findMany({ where: { family: { in: families }, asOfDate: periodEnd }, select: { family: true, counterpartyId: true } }),
    prisma.counterparty.findMany({ where: { id: { in: cpIds } }, select: { id: true, name: true } }),
  ]);
  const name = new Map(cps.map((c) => [c.id, c.name]));
  const blockers: string[] = [];
  for (const f of families) {
    const mine = signoffs.filter((s) => s.family === f);
    if (mine.some((s) => s.counterpartyId === null)) continue;
    const signed = new Set(mine.map((s) => s.counterpartyId));
    const missing = cpIds.filter((id) => !signed.has(id));
    if (!missing.length) continue;
    blockers.push(
      `${FAMILY_LABEL[f]} reconciliation for ${date} is not signed off${mine.length ? ` for ${missing.map((m) => name.get(m) ?? m).join(', ')}` : ' (no sign-off recorded)'}; run the matching, clear Critical and High breaks and have an independent checker sign it off`,
    );
  }
  return { key: 'RECON_SIGNOFF', label, ok: !blockers.length, blockers, detail: blockers.length ? plural(blockers.length, 'family') + ' not signed off' : 'All families signed off' };
}

export async function reconMaterialGate(portfolioId: string, periodEnd: Date): Promise<GateItem> {
  const date = isoDay(periodEnd);
  const label = 'No open Critical or High reconciliation breaks';
  const g = await reconGate({ portfolioId, asOfDate: date });
  if (!g.enabled) return { key: 'RECON_MATERIAL', label, ok: true, blockers: [], detail: 'Reconciliation gate is switched off by policy' };
  const blockers = g.breaks.map((b) => `Break ${b.ref} (${b.family.toLowerCase().replace(/_/g, ' ')}, ${b.severity.toLowerCase()}) is ${b.status.toLowerCase().replace(/_/g, ' ')}: ${b.label}`);
  return { key: 'RECON_MATERIAL', label, ok: !blockers.length, blockers, detail: blockers.length ? plural(blockers.length, 'material break') + ' open' : 'None open' };
}

/** Cash close: NAV, sign-off of the cash family, no material breaks. */
export async function cashCloseGates(portfolioId: string, periodEnd: Date): Promise<GateItem[]> {
  if (!(await closeGatesEnabled())) return [];
  return Promise.all([navGate(portfolioId, periodEnd), reconSignoffGate(portfolioId, periodEnd, ['CASH']), reconMaterialGate(portfolioId, periodEnd)]);
}

/** Accounting close already checks NAV and open breaks; this adds the sign-off of the families the ledger relies on. */
export async function accountingCloseGates(portfolioId: string, periodEnd: Date): Promise<GateItem[]> {
  if (!(await closeGatesEnabled())) return [];
  return [await reconSignoffGate(portfolioId, periodEnd, ['TRADES', 'CASH', 'HOLDINGS'])];
}
