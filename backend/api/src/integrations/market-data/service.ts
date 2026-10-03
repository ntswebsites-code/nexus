import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { latestPrices } from '../../modules/portfolio/portfolio.service';
import { IntegrationNotConfiguredError, businessDaysBetween, dayFromIso, isoDay, sha256 } from '../common';
import { getMarketDataAdapter, marketDataMode, schedulerEnabled } from './index';
import { PUBLIC_SOURCES } from './public/sources.config';
import type { FetchIssue, FxPair, SourceReport } from './types';
import { DEFAULT_POLICY, FX_POLICY, validateValue } from './validate';

/**
 * Market-data refresh: asks the active adapter for quotes and FX, validates every value (format, date, sanity bound
 * vs the previous stored price), writes accepted values to security_prices / fx_rates (the tables Orders, NAV, IBOR and
 * Performance already read) and records provenance and exceptions in md_provenance. A MANUAL price for the same date
 * always wins; the feed row is recorded as OVERRIDDEN and not written.
 */

export type RefreshScope = 'EOD' | 'INTRADAY' | 'FX' | 'ALL';
export interface RefreshOptions {
  trigger: 'SCHEDULE' | 'MANUAL';
  scope: RefreshScope;
  userId?: string | null;
  audit?: AuditContext;
  tickers?: string[];
  force?: boolean;
  now?: Date;
}

export interface RefreshSummary {
  runId: string;
  provider: string;
  scope: RefreshScope;
  status: 'OK' | 'PARTIAL' | 'FAILED';
  accepted: number;
  unchanged: number;
  rejected: number;
  errors: number;
  skipped: number;
  overridden: number;
  stale: number;
  message?: string;
}

const SYSTEM_AUDIT: AuditContext = { actorId: null, actorRole: 'System', portal: null };
const trunc = (s: string | undefined | null, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : null);
const SOURCE_RATE_GUARD_MS = 55_000;

function backoffAfter(failures: number): number {
  return failures < 3 ? 0 : Math.min(60_000 * 2 ** (failures - 3), 6 * 3_600_000);
}

async function updateSourceStatuses(reports: SourceReport[], provider: string, now: Date) {
  for (const r of reports) {
    const prior = await prisma.mdSourceStatus.findUnique({ where: { source: r.source } });
    const ok = r.status === 'OK' || r.status === 'CACHED';
    const skipped = r.status === 'BACKOFF';
    if (skipped) continue;
    const failures = ok ? 0 : (prior?.consecutiveFailures ?? 0) + 1;
    const data = {
      provider,
      label: r.label,
      url: r.url,
      lastAttemptAt: r.status === 'CACHED' ? prior?.lastAttemptAt ?? now : now,
      lastSuccessAt: ok ? now : prior?.lastSuccessAt ?? null,
      lastStatus: r.status === 'CACHED' ? 'OK' : r.status,
      lastError: trunc(r.error, 500),
      lastCount: r.count,
      consecutiveFailures: failures,
      backoffUntil: ok ? null : backoffAfter(failures) ? new Date(now.getTime() + backoffAfter(failures)) : null,
    };
    await prisma.mdSourceStatus.upsert({ where: { source: r.source }, create: { source: r.source, ...data }, update: data });
  }
}

async function skipSet(now: Date, force: boolean): Promise<Set<string>> {
  const rows = await prisma.mdSourceStatus.findMany();
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.enabled) out.add(r.source);
    else if (r.backoffUntil && r.backoffUntil > now) out.add(r.source);
    else if (!force && r.lastAttemptAt && now.getTime() - r.lastAttemptAt.getTime() < SOURCE_RATE_GUARD_MS && r.lastStatus === 'OK') out.add(r.source);
  }
  return out;
}

/** Rows a run created or changed, so the whole run can be reversed. `prev` is null for a created row. */
interface UndoLog {
  prices: { id: string; prev: string | null }[];
  fx: { id: string; prev: string | null }[];
}

interface Tally {
  accepted: number;
  unchanged: number;
  rejected: number;
  errors: number;
  skipped: number;
  overridden: number;
  stale: number;
}

async function recordIssue(tx: Prisma.TransactionClient, i: FetchIssue, securityId: string | null, tally: Tally) {
  if (i.kind === 'NO_SOURCE' || i.kind === 'BACKOFF') {
    tally.skipped++;
    return;
  }
  const status = i.kind === 'REJECTED' ? 'REJECTED' : 'ERROR';
  if (status === 'REJECTED') tally.rejected++;
  else tally.errors++;
  const ticker = i.ticker ?? '*';
  const rawHash = i.rawHash ?? sha256(i.message);
  const keyHash = sha256(['PRICE', i.source, ticker, '', status, rawHash, i.rawHash ? '' : i.message].join('|'));
  await tx.mdProvenance.upsert({
    where: { keyHash },
    create: { keyHash, refType: 'PRICE', securityId, ticker, source: i.source, url: trunc(i.url, 500) ?? '', fetchedAt: i.fetchedAt, rawHash, rawValue: trunc(i.rawValue, 80), status, reason: trunc(`${i.kind}: ${i.message}`, 300) },
    update: { fetchedAt: i.fetchedAt, reason: trunc(`${i.kind}: ${i.message}`, 300), seenCount: { increment: 1 }, url: trunc(i.url, 500) ?? '' },
  });
}

async function refreshPrices(o: RefreshOptions, now: Date, skip: Set<string>, reports: SourceReport[], tally: Tally, undo: UndoLog) {
  const adapter = getMarketDataAdapter();
  const securities = await prisma.security.findMany({
    where: { status: 'Active', assetClass: { not: 'Cash' }, ...(o.tickers?.length ? { ticker: { in: o.tickers } } : {}) },
    select: { id: true, ticker: true, currency: true },
  });
  const byTicker = new Map(securities.map((s) => [s.ticker, s]));
  const prices = await latestPrices(securities.map((s) => s.id), now);
  const batch = await adapter.fetchQuotes(
    securities.map((s) => s.ticker),
    { force: o.force, fallbackLimit: o.trigger === 'SCHEDULE' ? 5 : 0, skipSources: skip, now, anchors: new Map(securities.flatMap((s) => { const p = prices.get(s.id); return p ? [[s.ticker, p.latest.price] as const] : []; })) },
  );
  reports.push(...batch.sources);

  await prisma.$transaction(
    async (tx) => {
      for (const q of batch.items) {
        const sec = byTicker.get(q.ticker);
        if (!sec) continue;
        const pp = prices.get(sec.id);
        const ref = pp ? (pp.latest.priceDate < q.priceDate ? pp.latest : (pp.previous ?? pp.latest)) : null;
        const v = validateValue(q.price, q.priceDate, ref ? { value: ref.price, date: ref.priceDate } : null, now, DEFAULT_POLICY);
        if (!v.ok) {
          await recordIssue(tx, { kind: 'REJECTED', source: q.source, url: q.url, ticker: q.ticker, message: `${v.code}: ${v.reason}`, fetchedAt: q.fetchedAt, rawHash: q.rawHash, rawValue: q.rawValue }, sec.id, tally);
          continue;
        }
        const priceDate = dayFromIso(q.priceDate);
        const manual = await tx.securityPrice.findFirst({ where: { securityId: sec.id, priceDate, source: 'MANUAL' } });
        const provBase = { refType: 'PRICE', securityId: sec.id, ticker: q.ticker, priceDate, source: q.source, url: trunc(q.url, 500) ?? '', fetchedAt: q.fetchedAt, rawHash: q.rawHash, rawValue: trunc(q.rawValue, 80), value: new Prisma.Decimal(q.price), previousValue: ref ? new Prisma.Decimal(ref.price) : null };
        const keyHash = sha256(['PRICE', q.source, q.ticker, q.priceDate, manual ? 'OVERRIDDEN' : 'ACCEPTED'].join('|'));
        if (manual) {
          tally.overridden++;
          await tx.mdProvenance.upsert({ where: { keyHash }, create: { keyHash, ...provBase, refId: manual.id, status: 'OVERRIDDEN', reason: 'A manual price exists for this date and takes precedence' }, update: { ...provBase, refId: manual.id, seenCount: { increment: 1 } } });
          continue;
        }
        const where = { securityId_priceDate_source: { securityId: sec.id, priceDate, source: q.source } };
        const existing = await tx.securityPrice.findUnique({ where });
        const value = new Prisma.Decimal(q.price).toDecimalPlaces(6);
        let row = existing;
        if (!existing || !existing.price.eq(value)) {
          row = await tx.securityPrice.upsert({ where, update: { price: value }, create: { securityId: sec.id, priceDate, source: q.source, price: value } });
          undo.prices.push({ id: row.id, prev: existing ? existing.price.toString() : null });
          tally.accepted++;
        } else tally.unchanged++;
        if (v.stale) tally.stale++;
        await tx.mdProvenance.upsert({
          where: { keyHash },
          create: { keyHash, ...provBase, refId: row!.id, status: 'ACCEPTED', reason: v.stale ? `STALE: ${v.ageBusinessDays} business days old` : null },
          update: { ...provBase, refId: row!.id, reason: v.stale ? `STALE: ${v.ageBusinessDays} business days old` : null, seenCount: { increment: 1 } },
        });
      }
      for (const i of batch.issues) await recordIssue(tx, i, i.ticker ? (byTicker.get(i.ticker)?.id ?? null) : null, tally);
    },
    { timeout: 60_000 },
  );
}

/** USD to every non-USD currency in the masters, plus every pair already stored in fx_rates. */
export async function fxPairsToRefresh(): Promise<FxPair[]> {
  const [secs, pfs, stored] = await Promise.all([
    prisma.security.findMany({ distinct: ['currency'], select: { currency: true } }),
    prisma.portfolio.findMany({ distinct: ['baseCurrency'], select: { baseCurrency: true } }),
    prisma.fxRate.findMany({ distinct: ['fromCurrency', 'toCurrency'], select: { fromCurrency: true, toCurrency: true } }),
  ]);
  const pairs = new Map<string, FxPair>();
  const add = (from: string, to: string) => from !== to && pairs.set(`${from}/${to}`, { from, to });
  for (const c of new Set([...secs.map((s) => s.currency), ...pfs.map((p) => p.baseCurrency)])) add('USD', c);
  for (const s of stored) add(s.fromCurrency, s.toCurrency);
  return [...pairs.values()];
}

async function refreshFx(o: RefreshOptions, now: Date, skip: Set<string>, reports: SourceReport[], tally: Tally, undo: UndoLog) {
  const adapter = getMarketDataAdapter();
  const pairs = await fxPairsToRefresh();
  const anchors = new Map<string, string>();
  for (const p of pairs) {
    const last = await prisma.fxRate.findFirst({ where: { fromCurrency: p.from, toCurrency: p.to }, orderBy: { rateDate: 'desc' } });
    if (last) anchors.set(`${p.from}/${p.to}`, last.rate.toString());
  }
  const batch = await adapter.fetchFx(pairs, { force: o.force, skipSources: skip, now, anchors });
  reports.push(...batch.sources);
  await prisma.$transaction(
    async (tx) => {
      for (const q of batch.items) {
        const prev = await tx.fxRate.findFirst({ where: { fromCurrency: q.from, toCurrency: q.to, rateDate: { lt: dayFromIso(q.rateDate) } }, orderBy: { rateDate: 'desc' } });
        const v = validateValue(q.rate, q.rateDate, prev ? { value: prev.rate.toString(), date: isoDay(prev.rateDate) } : null, now, FX_POLICY);
        const label = `${q.from}/${q.to}`;
        if (!v.ok) {
          await recordIssue(tx, { kind: 'REJECTED', source: q.source, url: q.url, ticker: label, message: `${v.code}: ${v.reason}`, fetchedAt: q.fetchedAt, rawHash: q.rawHash, rawValue: q.rawValue }, null, tally);
          continue;
        }
        const rateDate = dayFromIso(q.rateDate);
        const where = { fromCurrency_toCurrency_rateDate: { fromCurrency: q.from, toCurrency: q.to, rateDate } };
        const existing = await tx.fxRate.findUnique({ where });
        const base = { refType: 'FX', ticker: label, priceDate: rateDate, source: q.source, url: trunc(q.url, 500) ?? '', fetchedAt: q.fetchedAt, rawHash: q.rawHash, rawValue: trunc(q.rawValue, 80), value: new Prisma.Decimal(q.rate), previousValue: prev?.rate ?? null };
        if (existing && existing.source === 'MANUAL') {
          tally.overridden++;
          const keyHash = sha256(['FX', q.source, label, q.rateDate, 'OVERRIDDEN'].join('|'));
          await tx.mdProvenance.upsert({ where: { keyHash }, create: { keyHash, ...base, refId: existing.id, status: 'OVERRIDDEN', reason: 'A manual rate exists for this date and takes precedence' }, update: { ...base, refId: existing.id, seenCount: { increment: 1 } } });
          continue;
        }
        const rate = new Prisma.Decimal(q.rate);
        let row = existing;
        if (!existing || !existing.rate.eq(rate)) {
          row = await tx.fxRate.upsert({ where, update: { rate, source: q.source }, create: { fromCurrency: q.from, toCurrency: q.to, rateDate, rate, source: q.source } });
          undo.fx.push({ id: row.id, prev: existing ? existing.rate.toString() : null });
          tally.accepted++;
        } else tally.unchanged++;
        const keyHash = sha256(['FX', q.source, label, q.rateDate, 'ACCEPTED'].join('|'));
        await tx.mdProvenance.upsert({ where: { keyHash }, create: { keyHash, ...base, refId: row!.id, status: 'ACCEPTED', reason: v.stale ? `STALE: ${v.ageBusinessDays} business days old` : null }, update: { ...base, refId: row!.id, seenCount: { increment: 1 } } });
      }
      for (const i of batch.issues) await recordIssue(tx, i, null, tally);
    },
    { timeout: 30_000 },
  );
}

export async function refreshMarketData(o: RefreshOptions): Promise<RefreshSummary> {
  const now = o.now ?? new Date();
  const provider = marketDataMode();
  const recent = await prisma.mdRefreshRun.findFirst({ where: { status: 'RUNNING', startedAt: { gt: new Date(now.getTime() - 10 * 60_000) } } });
  if (recent) throw HttpError.conflict('A market-data refresh is already running', 'refresh_running');
  const run = await prisma.mdRefreshRun.create({ data: { trigger: o.trigger, provider, scope: o.scope, requestedBy: o.userId ?? null, startedAt: now } });
  const tally: Tally = { accepted: 0, unchanged: 0, rejected: 0, errors: 0, skipped: 0, overridden: 0, stale: 0 };
  const reports: SourceReport[] = [];
  const undo: UndoLog = { prices: [], fx: [] };
  let message: string | undefined;
  let failed = false;
  try {
    const skip = await skipSet(now, !!o.force);
    if (o.scope !== 'FX') await refreshPrices(o, now, skip, reports, tally, undo);
    if (o.scope === 'FX' || o.scope === 'ALL') await refreshFx(o, now, skip, reports, tally, undo);
    await updateSourceStatuses(reports, provider, now);
  } catch (e) {
    failed = true;
    message = e instanceof Error ? e.message : String(e);
    if (e instanceof IntegrationNotConfiguredError) {
      await prisma.mdSourceStatus.upsert({
        where: { source: 'LIVE' },
        create: { source: 'LIVE', provider: 'live', label: 'Paid market-data feed', url: '', lastAttemptAt: now, lastStatus: 'NOT_CONFIGURED', lastError: trunc(message, 500) },
        update: { lastAttemptAt: now, lastStatus: 'NOT_CONFIGURED', lastError: trunc(message, 500) },
      });
    }
    console.error('[market-data] refresh failed', message);
  }
  const noData = tally.accepted + tally.unchanged + tally.overridden === 0;
  const status: RefreshSummary['status'] = failed || (noData && tally.errors > 0) ? 'FAILED' : tally.errors + tally.rejected > 0 ? 'PARTIAL' : 'OK';
  const summary = { ...tally, message, undo, sources: reports.map((r) => ({ source: r.source, status: r.status, count: r.count, error: r.error })) };
  await prisma.$transaction(async (tx) => {
    await tx.mdRefreshRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), accepted: tally.accepted + tally.unchanged, rejected: tally.rejected, errors: tally.errors, skipped: tally.skipped, summary: summary as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(tx, o.audit ?? SYSTEM_AUDIT, { action: 'market_data.refresh', objectType: 'market_data_run', objectId: run.id, after: { provider, scope: o.scope, trigger: o.trigger, status, ...tally } });
  });
  return { runId: run.id, provider, scope: o.scope, status, ...tally, message };
}

/**
 * Reverses a finished run: rows it created are deleted, rows it changed go back to their previous value. Only rows still
 * carrying the run's own value are touched (a later manual correction is left alone). Provenance of the run's accepted
 * values is marked REVERTED so the status screen stops showing it as the current source.
 */
export async function undoRefreshRun(runId: string, audit: AuditContext) {
  const run = await prisma.mdRefreshRun.findUnique({ where: { id: runId } });
  if (!run) throw HttpError.notFound('Refresh run not found');
  if (run.status === 'REVERTED') throw HttpError.conflict('This run was already reversed', 'already_reverted');
  if (run.status === 'RUNNING') throw HttpError.conflict('This run is still in progress', 'refresh_running');
  const undo = ((run.summary as { undo?: UndoLog } | null)?.undo ?? { prices: [], fx: [] }) as UndoLog;
  if (!undo.prices.length && !undo.fx.length) throw HttpError.conflict('This run changed no prices or rates, nothing to reverse', 'nothing_to_reverse');
  const out = { pricesRemoved: 0, pricesRestored: 0, fxRemoved: 0, fxRestored: 0 };
  await prisma.$transaction(
    async (tx) => {
      for (const u of undo.prices) {
        if (u.prev === null) out.pricesRemoved += (await tx.securityPrice.deleteMany({ where: { id: u.id } })).count;
        else out.pricesRestored += (await tx.securityPrice.updateMany({ where: { id: u.id }, data: { price: new Prisma.Decimal(u.prev) } })).count;
      }
      for (const u of undo.fx) {
        if (u.prev === null) out.fxRemoved += (await tx.fxRate.deleteMany({ where: { id: u.id } })).count;
        else out.fxRestored += (await tx.fxRate.updateMany({ where: { id: u.id }, data: { rate: new Prisma.Decimal(u.prev) } })).count;
      }
      const ids = [...undo.prices, ...undo.fx].map((u) => u.id);
      if (ids.length) await tx.mdProvenance.updateMany({ where: { refId: { in: ids }, status: 'ACCEPTED' }, data: { status: 'REVERTED', reason: trunc(`Reversed with run ${runId}`, 300) } });
      await tx.mdRefreshRun.update({ where: { id: runId }, data: { status: 'REVERTED' } });
      await writeAudit(tx, audit, { action: 'market_data.refresh.reverted', objectType: 'market_data_run', objectId: runId, after: out });
    },
    { timeout: 30_000 },
  );
  return { runId, ...out };
}

// ---------------------------------------------------------------- status for the ops screen

export const STALE_AFTER_BUSINESS_DAYS = DEFAULT_POLICY.maxAgeBusinessDays;

export async function getMarketDataStatus(now = new Date()) {
  const today = isoDay(now);
  const [statuses, runs, secs, fxRows, exceptions] = await Promise.all([
    prisma.mdSourceStatus.findMany({ orderBy: { source: 'asc' } }),
    prisma.mdRefreshRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
    prisma.security.findMany({ where: { status: 'Active', assetClass: { not: 'Cash' } }, orderBy: { ticker: 'asc' }, take: 500 }),
    prisma.fxRate.findMany({ orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }], take: 40 }),
    prisma.mdProvenance.findMany({ where: { status: { in: ['REJECTED', 'ERROR'] }, acknowledgedAt: null, fetchedAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } }, orderBy: { fetchedAt: 'desc' }, take: 100 }),
  ]);
  const prices = await latestPrices(secs.map((s) => s.id), now);
  const ids = secs.map((s) => s.id);
  const provRows = ids.length ? await prisma.mdProvenance.findMany({ where: { securityId: { in: ids }, status: { in: ['ACCEPTED', 'OVERRIDDEN'] } }, orderBy: { fetchedAt: 'desc' } }) : [];
  const provBySec = new Map<string, (typeof provRows)[number]>();
  for (const p of provRows) if (p.securityId && !provBySec.has(p.securityId)) provBySec.set(p.securityId, p);

  const known = new Map(statuses.map((s) => [s.source, s]));
  const sources = [
    ...PUBLIC_SOURCES.map((d) => ({ source: d.code, label: d.label, url: d.url, note: d.note, status: known.get(d.code) })),
    ...statuses.filter((s) => !PUBLIC_SOURCES.some((d) => d.code === s.source)).map((s) => ({ source: s.source, label: s.label, url: s.url, note: '', status: s })),
  ].map((s) => ({
    source: s.source,
    label: s.label,
    url: s.url,
    note: s.note,
    lastAttemptAt: s.status?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: s.status?.lastSuccessAt?.toISOString() ?? null,
    lastStatus: s.status?.lastStatus ?? 'NEVER',
    lastError: s.status?.lastError ?? null,
    lastCount: s.status?.lastCount ?? 0,
    consecutiveFailures: s.status?.consecutiveFailures ?? 0,
    backoffUntil: s.status?.backoffUntil?.toISOString() ?? null,
    stale: !s.status?.lastSuccessAt || businessDaysBetween(isoDay(s.status.lastSuccessAt), today) > 1,
  }));

  return {
    provider: marketDataMode(),
    scheduler: schedulerEnabled(),
    staleAfterBusinessDays: STALE_AFTER_BUSINESS_DAYS,
    sources,
    runs: runs.map((r) => ({ revertible: r.status !== 'REVERTED' && r.status !== 'RUNNING' && !!((r.summary as { undo?: UndoLog } | null)?.undo?.prices.length || (r.summary as { undo?: UndoLog } | null)?.undo?.fx.length), id: r.id, trigger: r.trigger, provider: r.provider, scope: r.scope, status: r.status, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, accepted: r.accepted, rejected: r.rejected, errors: r.errors, skipped: r.skipped })),
    securities: secs.map((s) => {
      const p = prices.get(s.id);
      const prov = provBySec.get(s.id);
      const age = p ? businessDaysBetween(p.latest.priceDate, today) : null;
      return {
        id: s.id,
        ticker: s.ticker,
        market: s.market,
        currency: s.currency,
        price: p?.latest.price ?? null,
        priceDate: p?.latest.priceDate ?? null,
        priceSource: p?.latest.source ?? null,
        ageBusinessDays: age,
        stale: age === null || age > STALE_AFTER_BUSINESS_DAYS,
        publicSource: s.ticker.toUpperCase().endsWith('.ZW'),
        provenance: prov ? { source: prov.source, url: prov.url, fetchedAt: prov.fetchedAt.toISOString(), rawHash: prov.rawHash, status: prov.status, reason: prov.reason } : null,
      };
    }),
    fx: fxRows.map((f) => ({ pair: `${f.fromCurrency}/${f.toCurrency}`, rate: f.rate.toString(), rateDate: isoDay(f.rateDate), source: f.source, ageBusinessDays: businessDaysBetween(isoDay(f.rateDate), today) })),
    exceptions: exceptions.map((e) => ({ id: e.id, refType: e.refType, ticker: e.ticker, source: e.source, status: e.status, reason: e.reason, url: e.url, fetchedAt: e.fetchedAt.toISOString(), seenCount: e.seenCount, rawValue: e.rawValue })),
  };
}

export async function securityProvenance(securityId: string) {
  const rows = await prisma.mdProvenance.findMany({ where: { securityId }, orderBy: { fetchedAt: 'desc' }, take: 50 });
  return rows.map((p) => ({ id: p.id, source: p.source, url: p.url, fetchedAt: p.fetchedAt.toISOString(), rawHash: p.rawHash, rawValue: p.rawValue, priceDate: p.priceDate ? isoDay(p.priceDate) : null, value: p.value?.toString() ?? null, previousValue: p.previousValue?.toString() ?? null, status: p.status, reason: p.reason, seenCount: p.seenCount }));
}
