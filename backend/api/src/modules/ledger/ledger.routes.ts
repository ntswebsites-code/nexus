import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { idempotent } from '../../lib/idempotency';
import { sha256Hex } from '../../lib/crypto';
import { param, query } from '../../lib/http';
import { sendTable } from '../../lib/tabular';
import { validateBody, validateQuery } from '../../middleware/validate';
import { requireAuth, requirePermission, requirePortalAccess, requireStepUp } from '../../middleware/requireAuth';
import { assertSegregation, assertUpdated, audit, notifyPermission, seqRef } from '../ops/ops.common';
import { resolveFxRate } from '../portfolio/portfolio.service';

/**
 * Staff ledger view with FX stamping and corrections (build-plan S10, FR-LP-029, BR-152). Mounted at `/api/v1/ledger`.
 *
 * The ledger is derived from the capital calls, receipts, distributions and dealing requests (the same read-time ledger
 * the LP portal shows) and is never edited. FX stamping records, once per entry, the rate and rate date used to state the
 * amount in the reporting currency; a stamp's values never change. A correction is a proposal by one person (FX_RESTAMP
 * at a stated rate and date, or an AMOUNT_ADJUSTMENT that shows as its own correcting line) decided by a different
 * person with step-up. Approving a restamp adds a higher stamp version and marks the old one SUPERSEDED; the history stays.
 *
 *   GET  /                    ledger.view      entries with active stamp, corrections applied as separate lines
 *   GET  /export              ledger.view      CSV/XLSX of the filtered view (audited)
 *   POST /stamp               ledger.correct   stamps every unstamped entry in scope from fx_rates
 *   GET  /corrections         ledger.view
 *   POST /corrections         ledger.correct   propose (maker)
 *   POST /corrections/:id/approve | /reject   ledger.approve, different person, step-up on approve
 */
export const ledgerRoutes = Router();

const staff = [requireAuth, requirePortalAccess('admin')];
const canView = [...staff, requirePermission('ledger.view')];
const canCorrect = [...staff, requirePermission('ledger.view'), requirePermission('ledger.correct')];
const canApprove = [...staff, requirePermission('ledger.view'), requirePermission('ledger.approve')];

const D = Prisma.Decimal;
const REPORTING_DEFAULT = 'USD';
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string) => new Date(`${v}T00:00:00.000Z`);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Invalid date');
const ccy = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
const VISIBLE = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

// ---------------------------------------------------------------- derived entries

export interface LedgerEntry {
  entryId: string;
  entryType: string;
  clientId: string;
  fundId: string;
  txnDate: string;
  currency: string;
  /** Signed as the LP statement shows it: calls and subscriptions positive, distributions and payouts negative. */
  amount: string;
  description: string;
  status: string;
}

type CallAlloc = Prisma.CapitalCallAllocationGetPayload<{ include: { call: true; payments: true } }>;
type DistAlloc = Prisma.DistributionAllocationGetPayload<{ include: { distribution: true } }>;
type Dealing = Prisma.LpDealingRequestGetPayload<object>;

const fx2 = (v: Prisma.Decimal) => v.toFixed(4);

function callEntries(a: CallAlloc): LedgerEntry[] {
  const pct = a.call.callPercent ? `${a.call.callPercent.toFixed(2)}%` : null;
  const out: LedgerEntry[] = [
    { entryId: a.id, entryType: 'CAPITAL_CALL', clientId: a.clientId, fundId: a.call.fundId, txnDate: day(a.call.transactionDate ?? a.call.issuedAt ?? a.call.dueDate)!, currency: a.call.currency, amount: fx2(a.callAmount), description: pct ? `Capital call #${a.call.callNo} (${pct})` : `Capital call #${a.call.callNo}`, status: a.status },
  ];
  for (const p of a.payments) out.push({ entryId: p.id, entryType: 'CAPITAL_CALL_PAYMENT', clientId: a.clientId, fundId: a.call.fundId, txnDate: day(p.recordedAt)!, currency: a.call.currency, amount: fx2(p.amount), description: `Capital call #${a.call.callNo} payment received`, status: 'POSTED' });
  return out;
}

function distEntries(a: DistAlloc): LedgerEntry[] {
  const out: LedgerEntry[] = [
    { entryId: a.id, entryType: 'DISTRIBUTION', clientId: a.clientId, fundId: a.distribution.fundId, txnDate: day(a.distribution.distributionDate)!, currency: a.distribution.currency, amount: fx2(a.shareAmount.neg()), description: `Distribution ${a.distribution.ref} declared`, status: a.status },
  ];
  if (a.paidAt && a.amountPaid.gt(0)) out.push({ entryId: `${a.id}:paid`, entryType: 'DISTRIBUTION_PAYMENT', clientId: a.clientId, fundId: a.distribution.fundId, txnDate: day(a.paidAt)!, currency: a.distribution.currency, amount: fx2(a.amountPaid.neg()), description: `Distribution ${a.distribution.ref} payout`, status: 'POSTED' });
  return out;
}

const dealEntry = (d: Dealing): LedgerEntry => ({ entryId: d.id, entryType: d.requestType, clientId: d.clientId, fundId: d.fundId, txnDate: day(d.createdAt)!, currency: d.currency, amount: d.amount ? fx2(d.requestType === 'REDEMPTION' ? d.amount.neg() : d.amount) : '0.0000', description: `${d.requestType === 'SUBSCRIPTION' ? 'Subscription' : 'Redemption'} request ${d.ref}`, status: d.status });

interface Scope {
  clientId?: string;
  fundId?: string;
  from?: string;
  to?: string;
  currency?: string;
}

const MAX_ENTRIES = 5000;

async function derive(s: Scope): Promise<LedgerEntry[]> {
  const [calls, dists, deals] = await Promise.all([
    prisma.capitalCallAllocation.findMany({ where: { ...(s.clientId ? { clientId: s.clientId } : {}), call: { ...(s.fundId ? { fundId: s.fundId } : {}), status: { in: VISIBLE }, issuedAt: { not: null } } }, include: { call: true, payments: true }, take: MAX_ENTRIES }),
    prisma.distributionAllocation.findMany({ where: { ...(s.clientId ? { clientId: s.clientId } : {}), distribution: { ...(s.fundId ? { fundId: s.fundId } : {}), status: { in: VISIBLE } } }, include: { distribution: true }, take: MAX_ENTRIES }),
    prisma.lpDealingRequest.findMany({ where: { ...(s.clientId ? { clientId: s.clientId } : {}), ...(s.fundId ? { fundId: s.fundId } : {}) }, take: MAX_ENTRIES }),
  ]);
  return [...calls.flatMap(callEntries), ...dists.flatMap(distEntries), ...deals.map(dealEntry)]
    .filter((e) => (!s.from || e.txnDate >= s.from) && (!s.to || e.txnDate <= s.to) && (!s.currency || e.currency === s.currency))
    .sort((a, b) => b.txnDate.localeCompare(a.txnDate) || a.entryId.localeCompare(b.entryId));
}

/** One entry by id (a call allocation, receipt, distribution allocation or payout, or a dealing request). */
async function loadEntry(entryId: string): Promise<LedgerEntry | null> {
  const paidId = entryId.endsWith(':paid') ? entryId.slice(0, -5) : null;
  if (paidId) {
    const a = await prisma.distributionAllocation.findUnique({ where: { id: paidId }, include: { distribution: true } });
    return a ? (distEntries(a).find((e) => e.entryId === entryId) ?? null) : null;
  }
  const alloc = await prisma.capitalCallAllocation.findUnique({ where: { id: entryId }, include: { call: true, payments: true } });
  if (alloc) return callEntries(alloc).find((e) => e.entryId === entryId) ?? null;
  const pay = await prisma.capitalCallPayment.findUnique({ where: { id: entryId }, include: { allocation: { include: { call: true, payments: true } } } });
  if (pay) return callEntries(pay.allocation).find((e) => e.entryId === entryId) ?? null;
  const dist = await prisma.distributionAllocation.findUnique({ where: { id: entryId }, include: { distribution: true } });
  if (dist) return distEntries(dist).find((e) => e.entryId === entryId) ?? null;
  const deal = await prisma.lpDealingRequest.findUnique({ where: { id: entryId } });
  return deal ? dealEntry(deal) : null;
}

// ---------------------------------------------------------------- view

const scopeQuery = z.object({
  clientId: z.string().trim().max(36).optional(),
  fundId: z.string().trim().max(36).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  currency: ccy.optional(),
  reporting: ccy.default(REPORTING_DEFAULT),
});
const listQuery = scopeQuery.extend({ stamped: z.enum(['yes', 'no']).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) });

type StampRow = Prisma.LedgerFxStampGetPayload<object>;
type CorrRow = Prisma.LedgerCorrectionGetPayload<object>;

async function names(clientIds: string[], fundIds: string[]) {
  const [clients, funds] = await Promise.all([
    clientIds.length ? prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, ref: true, name: true } }) : [],
    fundIds.length ? prisma.fund.findMany({ where: { id: { in: fundIds } }, select: { id: true, ref: true, name: true } }) : [],
  ]);
  return { clients: new Map(clients.map((c) => [c.id, c])), funds: new Map(funds.map((f) => [f.id, f])) };
}

const stampView = (s: StampRow | undefined) => (s ? { id: s.id, rate: s.rate.toFixed(10), rateDate: day(s.rateDate), source: s.source, version: s.version, reportingAmount: s.reportingAmount.toFixed(2), stampedAt: s.stampedAt.toISOString(), correctionId: s.correctionId } : null);

/** Entries for a scope, each with its active stamp for the reporting currency; approved adjustments are appended as their own lines. */
async function buildView(s: Scope & { reporting: string; stamped?: 'yes' | 'no' }) {
  const entries = await derive(s);
  const ids = entries.map((e) => e.entryId);
  const [stamps, adjustments] = await Promise.all([
    ids.length ? prisma.ledgerFxStamp.findMany({ where: { entryId: { in: ids }, reportingCurrency: s.reporting, status: 'ACTIVE' } }) : [],
    ids.length ? prisma.ledgerCorrection.findMany({ where: { entryId: { in: ids }, kind: 'AMOUNT_ADJUSTMENT', status: 'APPROVED' } }) : [],
  ]);
  const stampOf = new Map(stamps.map((x) => [x.entryId, x]));
  const entryById = new Map(entries.map((e) => [e.entryId, e]));
  const lines: (LedgerEntry & { lineKind: 'ENTRY' | 'CORRECTION'; stamp: ReturnType<typeof stampView>; correctionRef?: string; correctsEntryId?: string; reportingAmount: string | null })[] = [];
  for (const e of entries) {
    const st = stampOf.get(e.entryId);
    lines.push({ ...e, lineKind: 'ENTRY', stamp: stampView(st), reportingAmount: st ? st.reportingAmount.toFixed(2) : e.currency === s.reporting ? new D(e.amount).toFixed(2) : null });
  }
  for (const c of adjustments) {
    const base = entryById.get(c.entryId)!;
    const st = stampOf.get(c.entryId);
    const amt = c.adjustmentAmount!;
    // The correcting line is stated at the entry's active stamp rate (restamped, if that was corrected too).
    const rep = st ? amt.mul(st.rate) : base.currency === s.reporting ? amt : null;
    lines.push({ entryId: `${c.entryId}#${c.ref}`, entryType: 'CORRECTION', clientId: c.clientId, fundId: c.fundId, txnDate: day(c.decidedAt ?? c.createdAt)!, currency: c.currency, amount: fx2(amt), description: `Correction ${c.ref} to ${base.description}: ${c.reason}`, status: 'POSTED', lineKind: 'CORRECTION', correctionRef: c.ref, correctsEntryId: c.entryId, stamp: stampView(st), reportingAmount: rep ? rep.toFixed(2) : null });
  }
  const filtered = lines.filter((l) => (s.stamped === 'yes' ? l.stamp !== null : s.stamped === 'no' ? l.stamp === null && l.currency !== s.reporting : true));
  return { entries, lines: filtered, unstamped: entries.filter((e) => !stampOf.has(e.entryId) && e.currency !== s.reporting).length };
}

ledgerRoutes.get('/', ...canView, validateQuery(listQuery), async (req, res) => {
  const f = query<z.infer<typeof listQuery>>(req);
  const v = await buildView(f);
  const page = v.lines.slice(f.offset, f.offset + f.limit);
  const n = await names([...new Set(page.map((l) => l.clientId))], [...new Set(page.map((l) => l.fundId))]);
  const byCurrency = new Map<string, Prisma.Decimal>();
  for (const l of v.lines) byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? new D(0)).add(l.amount));
  const reportingTotal = v.lines.reduce((sum, l) => (l.reportingAmount ? sum.add(l.reportingAmount) : sum), new D(0));
  res.json({
    data: page.map((l) => ({ ...l, clientRef: n.clients.get(l.clientId)?.ref ?? null, clientName: n.clients.get(l.clientId)?.name ?? null, fundRef: n.funds.get(l.fundId)?.ref ?? null, fundName: n.funds.get(l.fundId)?.name ?? null })),
    total: v.lines.length,
    limit: f.limit,
    offset: f.offset,
    summary: { reporting: f.reporting, entries: v.entries.length, unstamped: v.unstamped, reportingTotal: reportingTotal.toFixed(2), byCurrency: [...byCurrency.entries()].map(([currency, total]) => ({ currency, total: total.toFixed(2) })) },
  });
});

const exportQuery = scopeQuery.extend({ stamped: z.enum(['yes', 'no']).optional(), format: z.enum(['csv', 'xlsx']).default('csv') });

ledgerRoutes.get('/export', ...canView, validateQuery(exportQuery), async (req, res) => {
  const { format, ...f } = query<z.infer<typeof exportQuery>>(req);
  const v = await buildView(f);
  const n = await names([...new Set(v.lines.map((l) => l.clientId))], [...new Set(v.lines.map((l) => l.fundId))]);
  const head = ['Date', 'Entry', 'Type', 'Client', 'Fund', 'Description', 'Currency', 'Amount', 'Status', `Reporting amount ${f.reporting}`, 'FX rate', 'FX rate date', 'FX source', 'Stamp version'];
  const rows = v.lines.map((l) => [l.txnDate, l.entryId, l.entryType, n.clients.get(l.clientId)?.ref ?? l.clientId, n.funds.get(l.fundId)?.ref ?? l.fundId, l.description, l.currency, l.amount, l.status, l.reportingAmount ?? '', l.stamp?.rate ?? '', l.stamp?.rateDate ?? '', l.stamp?.source ?? '', l.stamp?.version ?? '']);
  await prisma.$transaction((tx) => writeAudit(tx, audit(req), { action: 'ledger.exported', objectType: 'ledger', objectId: 'view', after: { format, rows: rows.length, filters: f, sha256: sha256Hex(JSON.stringify([head, rows])) } }));
  sendTable(res, format, `ledger-${new Date().toISOString().slice(0, 10)}`, head, rows, 'Ledger');
});

// ---------------------------------------------------------------- stamping

const stampBody = scopeQuery.pick({ clientId: true, fundId: true, from: true, to: true, reporting: true }).strict();

/** Stamps every entry in scope that has no stamp yet, from the newest fx_rates row at or before its date. Never touches an existing stamp. */
ledgerRoutes.post('/stamp', ...canCorrect, validateBody(stampBody), idempotent('ledger.stamp', { required: false }), async (req, res) => {
  const b = req.body as z.infer<typeof stampBody>;
  const entries = await derive(b);
  const existing = entries.length ? new Set((await prisma.ledgerFxStamp.findMany({ where: { entryId: { in: entries.map((e) => e.entryId) }, reportingCurrency: b.reporting }, select: { entryId: true } })).map((s) => s.entryId)) : new Set<string>();
  const todo = entries.filter((e) => !existing.has(e.entryId));
  const missing: { entryId: string; currency: string; txnDate: string }[] = [];
  const ready: { e: LedgerEntry; rate: Prisma.Decimal; rateDate: Date }[] = [];
  for (const e of todo) {
    if (e.currency === b.reporting) {
      ready.push({ e, rate: new D(1), rateDate: toDate(e.txnDate) });
      continue;
    }
    const rate = await resolveFxRate(e.currency, b.reporting, toDate(e.txnDate));
    if (!rate) {
      missing.push({ entryId: e.entryId, currency: e.currency, txnDate: e.txnDate });
      continue;
    }
    // The stamp records the date of the rate that was used (it can be earlier than the entry's date).
    const direct = await prisma.fxRate.findFirst({ where: { OR: [{ fromCurrency: e.currency, toCurrency: b.reporting }, { fromCurrency: b.reporting, toCurrency: e.currency }], rateDate: { lte: toDate(e.txnDate) } }, orderBy: { rateDate: 'desc' } });
    ready.push({ e, rate, rateDate: direct?.rateDate ?? toDate(e.txnDate) });
  }
  const stamped = await prisma.$transaction(async (tx) => {
    let n = 0;
    for (const { e, rate, rateDate } of ready) {
      try {
        await tx.ledgerFxStamp.create({
          data: { entryId: e.entryId, entryType: e.entryType, clientId: e.clientId, fundId: e.fundId, txnDate: toDate(e.txnDate), currency: e.currency, reportingCurrency: b.reporting, rate, rateDate, source: 'FX_RATES', amount: new D(e.amount), reportingAmount: new D(e.amount).mul(rate).toDecimalPlaces(4, D.ROUND_HALF_UP), version: 1, stampedBy: req.user!.id },
        });
        n += 1;
      } catch (err) {
        // A concurrent stamp for the same entry wins; stamps are never overwritten.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      }
    }
    await writeAudit(tx, audit(req), { action: 'ledger.fx_stamped', objectType: 'ledger', objectId: 'stamp', after: { reporting: b.reporting, stamped: n, missingRate: missing.length, scope: { clientId: b.clientId ?? null, fundId: b.fundId ?? null, from: b.from ?? null, to: b.to ?? null } } });
    return n;
  });
  res.json({ data: { stamped, alreadyStamped: existing.size, missingRate: missing.length, missing: missing.slice(0, 50) } });
});

// ---------------------------------------------------------------- corrections

const correctionBody = z
  .object({
    entryId: z.string().trim().min(1).max(80),
    kind: z.enum(['FX_RESTAMP', 'AMOUNT_ADJUSTMENT']),
    reporting: ccy.default(REPORTING_DEFAULT),
    newRate: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,10}(\.\d{1,10})?$/.test(v) && new D(v).gt(0), 'Enter a positive rate (up to 10 decimals)').optional(),
    newRateDate: dateStr.optional(),
    adjustmentAmount: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d{1,16}(\.\d{1,4})?$/.test(v) && !new D(v).isZero(), 'Enter a non-zero amount (up to 4 decimals)').optional(),
    reason: z.string().trim().min(5, 'A reason of at least 5 characters is required').max(500),
  })
  .strict();

const corrView = (c: CorrRow, who: Map<string, string>, entry?: LedgerEntry | null) => ({
  id: c.id,
  ref: c.ref,
  entryId: c.entryId,
  entryType: c.entryType,
  clientId: c.clientId,
  fundId: c.fundId,
  kind: c.kind,
  currency: c.currency,
  reportingCurrency: c.reportingCurrency,
  newRate: c.newRate?.toFixed(10) ?? null,
  newRateDate: day(c.newRateDate),
  adjustmentAmount: c.adjustmentAmount?.toFixed(4) ?? null,
  reason: c.reason,
  status: c.status,
  makerName: who.get(c.makerId) ?? null,
  makerId: c.makerId,
  checkerName: c.checkerId ? (who.get(c.checkerId) ?? null) : null,
  decidedAt: c.decidedAt?.toISOString() ?? null,
  decisionNote: c.decisionNote,
  createdAt: c.createdAt.toISOString(),
  version: c.version,
  entry: entry ? { description: entry.description, amount: entry.amount, txnDate: entry.txnDate } : null,
});

async function userNames(ids: (string | null)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await prisma.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true, email: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

const corrQuery = z.object({ status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(), entryId: z.string().trim().max(80).optional() });

ledgerRoutes.get('/corrections', ...canView, validateQuery(corrQuery), async (req, res) => {
  const f = query<z.infer<typeof corrQuery>>(req);
  const rows = await prisma.ledgerCorrection.findMany({ where: { status: f.status, entryId: f.entryId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const who = await userNames(rows.flatMap((r) => [r.makerId, r.checkerId]));
  res.json({ data: rows.map((r) => corrView(r, who)), total: rows.length });
});

ledgerRoutes.get('/entries/:entryId', ...canView, async (req, res) => {
  const id = param(req, 'entryId');
  const entry = await loadEntry(id);
  if (!entry) throw HttpError.notFound('Ledger entry not found');
  const [stamps, corrections] = await Promise.all([prisma.ledgerFxStamp.findMany({ where: { entryId: id }, orderBy: [{ reportingCurrency: 'asc' }, { version: 'asc' }] }), prisma.ledgerCorrection.findMany({ where: { entryId: id }, orderBy: { createdAt: 'asc' } })]);
  const who = await userNames(corrections.flatMap((r) => [r.makerId, r.checkerId]));
  res.json({
    data: {
      entry,
      stamps: stamps.map((s) => ({ ...stampView(s), reportingCurrency: s.reportingCurrency, status: s.status })),
      corrections: corrections.map((c) => corrView(c, who)),
    },
  });
});

ledgerRoutes.post('/corrections', ...canCorrect, validateBody(correctionBody), idempotent('ledger.correction.create'), async (req, res) => {
  const b = req.body as z.infer<typeof correctionBody>;
  const entry = await loadEntry(b.entryId);
  if (!entry) throw HttpError.badRequest('Validation failed', [{ path: 'entryId', message: 'Unknown ledger entry' }]);
  if (b.kind === 'FX_RESTAMP') {
    if (!b.newRate) throw HttpError.badRequest('Validation failed', [{ path: 'newRate', message: 'A restamp needs the new rate' }]);
    if (!b.newRateDate) throw HttpError.badRequest('Validation failed', [{ path: 'newRateDate', message: 'A restamp needs the date of the rate' }]);
    if (entry.currency === b.reporting) throw HttpError.badRequest('Validation failed', [{ path: 'entryId', message: `This entry is already in ${b.reporting}; there is no FX to restamp` }]);
  } else if (!b.adjustmentAmount) throw HttpError.badRequest('Validation failed', [{ path: 'adjustmentAmount', message: 'An adjustment needs the amount' }]);
  const open = await prisma.ledgerCorrection.findFirst({ where: { entryId: b.entryId, kind: b.kind, status: 'PENDING_APPROVAL' } });
  if (open) throw HttpError.conflict(`${open.ref} is already waiting for approval on this entry`, 'correction_pending');
  const row = await prisma.$transaction(async (tx) => {
    const ref = await seqRef(tx, 'ledgerCorrection', 'LCR-', 4, 1);
    const c = await tx.ledgerCorrection.create({
      data: { ref, entryId: b.entryId, entryType: entry.entryType, clientId: entry.clientId, fundId: entry.fundId, kind: b.kind, currency: entry.currency, reportingCurrency: b.reporting, newRate: b.kind === 'FX_RESTAMP' ? new D(b.newRate!) : null, newRateDate: b.kind === 'FX_RESTAMP' ? toDate(b.newRateDate!) : null, adjustmentAmount: b.kind === 'AMOUNT_ADJUSTMENT' ? new D(b.adjustmentAmount!) : null, reason: b.reason, makerId: req.user!.id },
    });
    await writeAudit(tx, audit(req), { action: 'ledger.correction_proposed', objectType: 'ledger_correction', objectId: c.id, after: { ref, entryId: b.entryId, kind: b.kind, newRate: b.newRate ?? null, newRateDate: b.newRateDate ?? null, adjustmentAmount: b.adjustmentAmount ?? null, currency: entry.currency }, reason: b.reason });
    await notifyPermission(tx, 'ledger.approve', { type: 'ledger.correction', title: `Ledger correction ${ref} awaits approval`, body: `${b.kind === 'FX_RESTAMP' ? 'FX restamp' : 'Amount adjustment'} on ${entry.description}`, link: `/ops/ledger?correction=${c.id}` });
    return c;
  });
  const who = await userNames([row.makerId]);
  res.status(201).json({ data: corrView(row, who, entry) });
});

async function loadCorrection(id: string) {
  const c = await prisma.ledgerCorrection.findFirst({ where: /^[0-9a-f-]{36}$/i.test(id) ? { id } : { ref: id.toUpperCase() } });
  if (!c) throw HttpError.notFound('Correction not found');
  return c;
}

const decideBody = z.object({ note: z.string().trim().max(500).optional() }).strict();
const rejectBody = z.object({ reason: z.string({ error: 'A reason is required' }).trim().min(3, 'A reason is required').max(500) }).strict();

ledgerRoutes.post('/corrections/:id/approve', ...canApprove, requireStepUp, validateBody(decideBody), idempotent('ledger.correction.approve', { required: false }), async (req: Request, res) => {
  const c = await loadCorrection(param(req, 'id'));
  if (c.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${c.ref} is ${c.status}`, 'invalid_state');
  assertSegregation(req.user!.id, c.makerId);
  const entry = await loadEntry(c.entryId);
  if (!entry) throw HttpError.conflict('The ledger entry no longer exists', 'entry_missing');
  const b = req.body as z.infer<typeof decideBody>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.ledgerCorrection.updateMany({ where: { id: c.id, status: 'PENDING_APPROVAL', version: c.version }, data: { status: 'APPROVED', checkerId: req.user!.id, decidedAt: new Date(), decisionNote: b.note ?? null, version: { increment: 1 } } })).count);
    let after: Record<string, unknown> = { ref: c.ref, kind: c.kind };
    if (c.kind === 'FX_RESTAMP') {
      const prev = await tx.ledgerFxStamp.findFirst({ where: { entryId: c.entryId, reportingCurrency: c.reportingCurrency, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
      const last = await tx.ledgerFxStamp.findFirst({ where: { entryId: c.entryId, reportingCurrency: c.reportingCurrency }, orderBy: { version: 'desc' } });
      if (prev) await tx.ledgerFxStamp.updateMany({ where: { id: prev.id, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      const amount = new D(entry.amount);
      const stamp = await tx.ledgerFxStamp.create({
        data: { entryId: c.entryId, entryType: c.entryType, clientId: c.clientId, fundId: c.fundId, txnDate: toDate(entry.txnDate), currency: c.currency, reportingCurrency: c.reportingCurrency, rate: c.newRate!, rateDate: c.newRateDate!, source: 'CORRECTION', amount, reportingAmount: amount.mul(c.newRate!).toDecimalPlaces(4, D.ROUND_HALF_UP), version: (last?.version ?? 0) + 1, correctionId: c.id, stampedBy: req.user!.id },
      });
      after = { ...after, stampId: stamp.id, version: stamp.version, rate: c.newRate!.toFixed(10), rateDate: day(c.newRateDate), previousRate: prev?.rate.toFixed(10) ?? null, previousVersion: prev?.version ?? null };
    } else after = { ...after, adjustmentAmount: c.adjustmentAmount!.toFixed(4), currency: c.currency };
    await writeAudit(tx, audit(req), { action: 'ledger.correction_approved', objectType: 'ledger_correction', objectId: c.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'APPROVED', entryId: c.entryId, ...after }, reason: b.note ?? null });
    await notifyPermission(tx, 'ledger.correct', { type: 'ledger.correction', title: `Ledger correction ${c.ref} approved`, link: `/ops/ledger?correction=${c.id}` });
  });
  const who = await userNames([c.makerId, req.user!.id]);
  res.json({ data: corrView(await loadCorrection(c.id), who, entry) });
});

ledgerRoutes.post('/corrections/:id/reject', ...canApprove, validateBody(rejectBody), idempotent('ledger.correction.reject', { required: false }), async (req, res) => {
  const c = await loadCorrection(param(req, 'id'));
  if (c.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`${c.ref} is ${c.status}`, 'invalid_state');
  assertSegregation(req.user!.id, c.makerId);
  const b = req.body as z.infer<typeof rejectBody>;
  await prisma.$transaction(async (tx) => {
    assertUpdated((await tx.ledgerCorrection.updateMany({ where: { id: c.id, status: 'PENDING_APPROVAL', version: c.version }, data: { status: 'REJECTED', checkerId: req.user!.id, decidedAt: new Date(), decisionNote: b.reason, version: { increment: 1 } } })).count);
    await writeAudit(tx, audit(req), { action: 'ledger.correction_rejected', objectType: 'ledger_correction', objectId: c.id, before: { status: 'PENDING_APPROVAL' }, after: { status: 'REJECTED', ref: c.ref, entryId: c.entryId }, reason: b.reason });
  });
  const who = await userNames([c.makerId, req.user!.id]);
  res.json({ data: corrView(await loadCorrection(c.id), who) });
});
