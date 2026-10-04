import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { audit } from '../ops/ops.common';
import { loadPortfolio } from '../portfolio/portfolio.service';
import { MARK_METHODS, STRATEGIES } from '../private-markets/pm.engine';
import { D, RowCheck, parseDay, parseDecimal, toDay, type ImportKind, type ImportCtx, type MappedRow, type Validation } from './imports.core';

/**
 * Private-markets CSV imports (build-plan S3): funds, commitments and valuations, each with a dry run. They write the
 * same records, with the same audit events, as the screens do. A valuation lands as a DRAFT mark: it still needs
 * evidence, a submit and an approval by a different person (maker-checker is not bypassed by a file).
 */
const PM_PERMS = ['portfolio.view', 'portfolio.manage'];
const CCY = /^[A-Z]{3}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- funds

interface FundRow { name: string; manager: string; strategy: string; vintage: number; currency: string; notes: string | null }

async function validateFunds(rows: MappedRow[]): Promise<Validation<FundRow>> {
  const out: Validation<FundRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const seen = new Map<string, number>();
  const existing = new Set((await prisma.pmFund.findMany({ select: { name: true, vintage: true } })).map((f) => `${f.name.toLowerCase()}|${f.vintage}`));
  const maxVintage = new Date().getUTCFullYear() + 1;
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const name = x.name ?? '';
    if (name.length < 2 || name.length > 200) c.fail('name', 'is required (2 to 200 characters)');
    const manager = x.manager ?? '';
    if (manager.length < 2 || manager.length > 160) c.fail('manager', 'is required (2 to 160 characters)');
    const strategy = (x.strategy ?? '').toUpperCase().replace(/[ -]/g, '_');
    if (!(STRATEGIES as readonly string[]).includes(strategy)) c.fail('strategy', `must be one of ${STRATEGIES.join(', ')}`);
    const vintage = /^\d{4}$/.test(x.vintage ?? '') ? Number(x.vintage) : NaN;
    if (!(vintage >= 1990 && vintage <= maxVintage)) c.fail('vintage', `must be a year from 1990 to ${maxVintage}`);
    const currency = (x.currency ?? '').toUpperCase() || 'USD';
    if (!CCY.test(currency)) c.fail('currency', 'must be a 3-letter currency code');
    if ((x.notes ?? '').length > 500) c.fail('notes', 'is longer than 500 characters');
    const key = `${name.toLowerCase()}|${vintage}`;
    if (c.ok) {
      if (existing.has(key)) c.fail('name', `a fund called "${name}" with vintage ${vintage} already exists`);
      else if (seen.has(key)) c.fail('name', `duplicate of line ${seen.get(key)} in this file`);
    }
    if (!c.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    seen.set(key, r.line);
    out.valid.push({ line: r.line, value: { name, manager, strategy, vintage, currency, notes: x.notes || null }, display: { name, manager, strategy, vintage: String(vintage), currency } });
  }
  return out;
}

export const pmFundsImport: ImportKind<FundRow> = {
  kind: 'pm-funds',
  title: 'Private funds',
  permissions: PM_PERMS,
  columns: [
    { key: 'name', label: 'Name', required: true, example: 'Harare Growth Fund III' },
    { key: 'manager', label: 'Manager', required: true, example: 'Zambezi Capital' },
    { key: 'strategy', label: 'Strategy', required: true, example: 'PRIVATE_EQUITY', hint: STRATEGIES.join(', ') },
    { key: 'vintage', label: 'Vintage', required: true, example: '2024', hint: 'Year, 1990 or later' },
    { key: 'currency', label: 'Currency', example: 'USD' },
    { key: 'notes', label: 'Notes', example: '' },
  ],
  validate: (rows) => validateFunds(rows),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows) {
      const ref = await nextRef(tx, 'pmFund');
      const f = await tx.pmFund.create({ data: { ref, ...r.value, createdBy: ctx.userId } });
      await writeAudit(tx, audit(ctx.req), { action: 'pm.fund_created', objectType: 'pm_fund', objectId: f.id, after: { ref, name: f.name, strategy: f.strategy, vintage: f.vintage, importBatch: batch.ref, importLine: r.line } });
      refs.push(ref);
    }
    return { created: refs.length, refs: refs.slice(0, 50) };
  },
};

// ---------------------------------------------------------------- commitments

interface CommitRow { fundId: string; fundRef: string; portfolioId: string; portfolioRef: string; amount: string; committedOn: string }

async function validateCommitments(rows: MappedRow[]): Promise<Validation<CommitRow>> {
  const out: Validation<CommitRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const funds = new Map<string, Awaited<ReturnType<typeof prisma.pmFund.findFirst>>>();
  const portfolios = new Map<string, Awaited<ReturnType<typeof loadPortfolio>> | null>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const fk = x.fund ?? '';
    if (!fk) c.fail('fund', 'is required');
    let fund: Awaited<ReturnType<typeof prisma.pmFund.findFirst>> = null;
    if (fk) {
      if (!funds.has(fk)) funds.set(fk, await prisma.pmFund.findFirst({ where: { OR: [{ ref: fk.toUpperCase() }, { id: fk }] } }));
      fund = funds.get(fk) ?? null;
      if (!fund) c.fail('fund', `unknown fund "${fk}"`);
      else if (fund.status !== 'ACTIVE') c.fail('fund', `${fund.ref} is ${fund.status}; new commitments need an active fund`);
    }
    const pk = x.portfolio ?? '';
    if (!pk) c.fail('portfolio', 'is required');
    let portfolio: Awaited<ReturnType<typeof loadPortfolio>> | null = null;
    if (pk) {
      if (!portfolios.has(pk)) portfolios.set(pk, await loadPortfolio(pk).catch(() => null));
      portfolio = portfolios.get(pk) ?? null;
      if (!portfolio) c.fail('portfolio', `unknown portfolio "${pk}"`);
    }
    const amount = parseDecimal(x.amount, { positive: true, scale: 4, max: '9999999999999999' });
    if (!amount.ok) c.fail('amount', amount.message);
    const day = parseDay(x.committedOn);
    if (!day.ok) c.fail('committedOn', day.message);
    else if (day.value > todayIso()) c.fail('committedOn', 'cannot be in the future');
    if (c.ok && fund && portfolio) {
      const key = `${fund.id}|${portfolio.id}`;
      if (seen.has(key)) c.fail('portfolio', `duplicate of line ${seen.get(key)} in this file`);
      else if (await prisma.pmCommitment.findUnique({ where: { fundId_portfolioId: { fundId: fund.id, portfolioId: portfolio.id } } })) c.fail('portfolio', `${portfolio.ref} already has a commitment to ${fund.ref}`);
      else seen.set(key, r.line);
    }
    if (!c.ok || !fund || !portfolio || !amount.ok || !day.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    out.valid.push({
      line: r.line,
      value: { fundId: fund.id, fundRef: fund.ref, portfolioId: portfolio.id, portfolioRef: portfolio.ref, amount: amount.value.toFixed(4), committedOn: day.value },
      display: { fund: fund.ref, portfolio: portfolio.ref, amount: amount.value.toFixed(2), committedOn: day.value },
    });
  }
  return out;
}

export const pmCommitmentsImport: ImportKind<CommitRow> = {
  kind: 'pm-commitments',
  title: 'Private commitments',
  permissions: PM_PERMS,
  controlTotalKey: 'amount',
  columns: [
    { key: 'fund', label: 'Fund', required: true, aliases: ['fund ref'], example: 'PMF-1001' },
    { key: 'portfolio', label: 'Portfolio', required: true, aliases: ['portfolio ref'], example: 'PF-1001' },
    { key: 'amount', label: 'Amount', required: true, example: '500000' },
    { key: 'committedOn', label: 'Committed on', required: true, aliases: ['date', 'commitment date'], example: '2026-03-31' },
  ],
  validate: (rows) => validateCommitments(rows),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows) {
      const v = r.value;
      const ref = await nextRef(tx, 'pmCommitment');
      const c = await tx.pmCommitment.create({ data: { ref, fundId: v.fundId, portfolioId: v.portfolioId, amount: new D(v.amount), committedOn: toDay(v.committedOn), createdBy: ctx.userId } });
      await writeAudit(tx, audit(ctx.req), { action: 'pm.commitment_created', objectType: 'pm_commitment', objectId: c.id, after: { ref, fund: v.fundRef, portfolioId: v.portfolioId, amount: new D(v.amount).toFixed(2), importBatch: batch.ref, importLine: r.line } });
      refs.push(ref);
    }
    return { created: refs.length, refs: refs.slice(0, 50) };
  },
};

// ---------------------------------------------------------------- valuations

interface MarkRow { commitmentId: string; commitmentRef: string; asOf: string; nav: string; method: string; note: string | null }

async function validateMarks(rows: MappedRow[], _ctx: ImportCtx): Promise<Validation<MarkRow>> {
  const out: Validation<MarkRow> = { valid: [], errors: [], fileErrors: [], warnings: [] };
  const commitments = new Map<string, Awaited<ReturnType<typeof prisma.pmCommitment.findFirst>>>();
  const seen = new Map<string, number>();
  for (const r of rows) {
    const c = new RowCheck(r.line);
    const x = r.cells;
    const ck = x.commitment ?? '';
    if (!ck) c.fail('commitment', 'is required');
    let cm: Awaited<ReturnType<typeof prisma.pmCommitment.findFirst>> = null;
    if (ck) {
      if (!commitments.has(ck)) commitments.set(ck, await prisma.pmCommitment.findFirst({ where: { OR: [{ ref: ck.toUpperCase() }, { id: ck }] } }));
      cm = commitments.get(ck) ?? null;
      if (!cm) c.fail('commitment', `unknown commitment "${ck}"`);
      else if (cm.status !== 'ACTIVE') c.fail('commitment', `${cm.ref} is ${cm.status}`);
    }
    const nav = parseDecimal(x.nav, { nonNegative: true, scale: 4, max: '9999999999999999' });
    if (!nav.ok) c.fail('nav', nav.message);
    const day = parseDay(x.asOf);
    if (!day.ok) c.fail('asOf', day.message);
    else if (day.value > todayIso()) c.fail('asOf', 'a mark cannot be dated in the future');
    const method = (x.method ?? '').toUpperCase().replace(/[ -]/g, '_') || 'GP_REPORTED';
    if (!(MARK_METHODS as readonly string[]).includes(method)) c.fail('method', `must be one of ${MARK_METHODS.join(', ')}`);
    if ((x.note ?? '').length > 500) c.fail('note', 'is longer than 500 characters');
    if (c.ok && cm && day.ok) {
      const key = `${cm.id}|${day.value}`;
      if (seen.has(key)) c.fail('asOf', `duplicate of line ${seen.get(key)} in this file`);
      else {
        const dup = await prisma.pmMark.findFirst({ where: { commitmentId: cm.id, asOf: toDay(day.value), status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } });
        if (dup) c.fail('asOf', `${dup.ref} already exists for ${day.value} (${dup.status})`);
        else seen.set(key, r.line);
      }
    }
    if (!c.ok || !cm || !nav.ok || !day.ok) {
      out.errors.push(...c.issues);
      continue;
    }
    out.valid.push({
      line: r.line,
      value: { commitmentId: cm.id, commitmentRef: cm.ref, asOf: day.value, nav: nav.value.toFixed(4), method, note: x.note || null },
      display: { commitment: cm.ref, asOf: day.value, nav: nav.value.toFixed(2), method },
      warnings: ['Imported as a DRAFT mark: add evidence, submit and have a different person approve it'],
    });
  }
  return out;
}

export const pmValuationsImport: ImportKind<MarkRow> = {
  kind: 'pm-valuations',
  title: 'Private valuations',
  permissions: PM_PERMS,
  columns: [
    { key: 'commitment', label: 'Commitment', required: true, aliases: ['commitment ref'], example: 'PMC-1001' },
    { key: 'asOf', label: 'As of', required: true, aliases: ['date', 'valuation date'], example: '2026-06-30' },
    { key: 'nav', label: 'NAV', required: true, aliases: ['value', 'fair value'], example: '525000' },
    { key: 'method', label: 'Method', example: 'GP_REPORTED', hint: MARK_METHODS.join(', ') },
    { key: 'note', label: 'Note', example: '' },
  ],
  validate: (rows, ctx) => validateMarks(rows, ctx),
  async apply(tx, rows, ctx, batch) {
    const refs: string[] = [];
    for (const r of rows) {
      const v = r.value;
      const ref = await nextRef(tx, 'pmMark');
      const m = await tx.pmMark.create({ data: { ref, commitmentId: v.commitmentId, asOf: toDay(v.asOf), nav: new D(v.nav), method: v.method, note: v.note, makerId: ctx.userId } });
      await writeAudit(tx, audit(ctx.req), { action: 'pm.mark_created', objectType: 'pm_mark', objectId: m.id, after: { ref, commitment: v.commitmentRef, asOf: v.asOf, nav: new D(v.nav).toFixed(2), method: v.method, importBatch: batch.ref, importLine: r.line } });
      refs.push(ref);
    }
    return { created: refs.length, status: 'DRAFT', refs: refs.slice(0, 50) };
  },
};
