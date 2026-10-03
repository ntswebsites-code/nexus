/**
 * Offline checks for the market-data and custodian-feed integrations: no network, no database.
 *
 *   npx tsx scripts/test-market-data.ts
 *
 * Parsers run against saved HTML/JSON in backend/api/test-fixtures/market-data (captured 2026-10-03 from the public
 * pages named in src/integrations/market-data/public/sources.config.ts). Covers parsing, layout-change detection,
 * validation bounds, the polite fetcher (cache, rate limit, host allow-list), the public provider with an injected
 * transport (fallback chain, NO_SOURCE, errors), the fake generator, the live stub, the scheduler rules and the
 * custodian statement parsers (CSV, MT940-like, JSON).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntegrationNotConfiguredError, businessDaysBetween, lastWeekdayOnOrBefore } from '../src/integrations/common';
import { extractTables, parseNumber } from '../src/integrations/market-data/public/html';
import { LayoutChangedError, parseAfxHistory, parseAfxList, parseErApi } from '../src/integrations/market-data/public/parsers';
import { FetchError, PoliteFetcher, type FetchImpl } from '../src/integrations/market-data/public/fetcher';
import { PublicMarketDataProvider } from '../src/integrations/market-data/public/provider';
import { validateValue } from '../src/integrations/market-data/validate';
import { FakeMarketDataProvider, fakeClose } from '../src/integrations/market-data/fake';
import { LiveMarketDataProvider } from '../src/integrations/market-data/live';
import { dueScope } from '../src/integrations/market-data/schedule';
import { marketDataMode, schedulerEnabled } from '../src/integrations/market-data';
import { detectFormat, parseStatements, renderStatement, StatementParseError } from '../src/integrations/custodian-feed/parsers';
import { fakeStatement, FakeCustodianFeed } from '../src/integrations/custodian-feed/fake';
import { LiveCustodianFeed } from '../src/integrations/custodian-feed/live';
import { custodianFeedMode } from '../src/integrations/custodian-feed/mode';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(here, '..', 'test-fixtures', 'market-data', name), 'utf8');
const LIST = fx('afx-zse-list.html');
const TICKER = fx('afx-zse-ticker-zimr.html');
const ER = fx('er-api-usd.json');

let pass = 0;
let fail = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}`, detail ?? '');
  }
};
const throwsAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

async function main() {
  const T0 = new Date('2026-10-03T08:00:00Z'); // Saturday

  // ---------------------------------------------------------------- html + parsers
  check('parseNumber', parseNumber('1,234.50') === '1234.50' && parseNumber('+0.43') === '0.43' && parseNumber('n/a') === null && parseNumber('') === null);
  const tables = extractTables('<table><thead><tr><th>A<th>B<tbody><tr><td>1<td>2<tr><td>3<td>4</table>');
  check('tolerant table (no closing tags)', tables[0]?.rows.length === 2 && tables[0].headers.join() === 'a,b' && tables[0].rows[1]?.cells.join() === '3,4', tables);

  const list = parseAfxList(LIST, 'https://afx.kwayisi.org/zse/', T0);
  const by = new Map(list.items.map((q) => [q.ticker, q]));
  check('list parses 13 rows', list.items.length === 13 && list.problems.length === 0, list.items.length);
  check('DLTA price + ticker mapping', by.get('DLTA.ZW')?.price === '32.416862' && by.get('DLTA.ZW')?.source === 'ZSE_AFX', by.get('DLTA.ZW'));
  check('trading day from page timestamp (Fri 2026-10-02)', by.get('DLTA.ZW')?.priceDate === '2026-10-02', by.get('DLTA.ZW')?.priceDate);
  check('volume parsed, blank volume null', by.get('DLTA.ZW')?.volume === '13800' && by.get('AFDS.ZW')?.volume === null, [by.get('DLTA.ZW')?.volume, by.get('AFDS.ZW')?.volume]);
  check('raw hash is sha256 hex per row, differs by row', /^[0-9a-f]{64}$/.test(by.get('DLTA.ZW')!.rawHash) && by.get('DLTA.ZW')!.rawHash !== by.get('CBZ.ZW')!.rawHash);
  check('provenance fields set', by.get('CBZ.ZW')!.url === 'https://afx.kwayisi.org/zse/' && by.get('CBZ.ZW')!.fetchedAt === T0);

  // Column reorder and renamed header still parse; bad cells become problems, not exceptions.
  const reordered = '<time id=u datetime=2026-10-01T10:00:00+00:00>x</time><table><tr><th>Price (ZWG)<th>Symbol<tr><td>1.50<td>ABC<tr><td>oops<td>XYZ<tr><td>2<td>bad ticker!</table>';
  const re = parseAfxList(reordered, 'u', T0);
  check('reordered columns + header aliases', re.items.length === 1 && re.items[0]!.ticker === 'ABC.ZW' && re.items[0]!.price === '1.50', re.items);
  check('bad price/ticker cells reported as problems', re.problems.length === 2, re.problems);
  check('layout change: no table -> LayoutChangedError', throws(() => parseAfxList('<html><div>new design</div></html>', 'u', T0)) instanceof LayoutChangedError);
  check('layout change: price column renamed -> LayoutChangedError', throws(() => parseAfxList('<table><tr><th>Ticker<th>Foo<tr><td>A<td>1</table>', 'u', T0)) instanceof LayoutChangedError);

  const hist = parseAfxHistory(TICKER, 'https://afx.kwayisi.org/zse/zimr.html', T0, 'ZIMR.ZW');
  check('history parses 7 rows newest first', hist.items.length === 7 && hist.items[0]!.priceDate === '2026-10-02' && hist.items[0]!.close === '0.703269', hist.items[0]);
  check('history layout change detected', throws(() => parseAfxHistory('<table><tr><th>Date<tr><td>1</table>', 'u', T0, 'X.ZW')) instanceof LayoutChangedError);

  const fxq = parseErApi(ER, 'https://open.er-api.com/v6/latest/USD', T0, [{ from: 'USD', to: 'ZWG' }, { from: 'ZWG', to: 'USD' }, { from: 'USD', to: 'XXX' }, { from: 'EUR', to: 'GBP' }]);
  const usdzwg = fxq.items.find((i) => i.from === 'USD' && i.to === 'ZWG');
  const zwgusd = fxq.items.find((i) => i.from === 'ZWG' && i.to === 'USD');
  check('FX USD/ZWG', usdzwg?.rate === '26.7653' && usdzwg.rateDate === '2026-10-03', usdzwg);
  check('FX inverse and cross are consistent', Math.abs(Number(usdzwg!.rate) * Number(zwgusd!.rate) - 1) < 1e-8 && fxq.items.some((i) => i.from === 'EUR' && i.to === 'GBP'), zwgusd);
  check('FX unknown currency is a problem', fxq.problems.length === 1 && fxq.problems[0]!.ticker === 'USD/XXX');
  check('FX non-JSON -> LayoutChangedError', throws(() => parseErApi('<html>', 'u', T0, [])) instanceof LayoutChangedError);
  check('FX error payload -> LayoutChangedError', throws(() => parseErApi('{"result":"error"}', 'u', T0, [])) instanceof LayoutChangedError);

  // ---------------------------------------------------------------- validation
  const now = new Date('2026-10-02T12:00:00Z');
  check('valid price', validateValue('10.5', '2026-10-02', { value: '10.4' }, now).ok);
  check('reject zero', !validateValue('0', '2026-10-02', null, now).ok);
  check('reject non-numeric', !validateValue('1e9', '2026-10-02', null, now).ok);
  check('reject future date', (validateValue('1', '2026-10-09', null, now) as { code?: string }).code === 'FUTURE_DATE');
  check('reject bad date', (validateValue('1', '2026-13-40', null, now) as { code?: string }).code === 'BAD_DATE');
  const big = validateValue('20', '2026-10-02', { value: '10' }, now);
  check('reject +100% move vs previous close', !big.ok && big.code === 'MOVE_EXCEEDS_BOUND', big);
  check('accept -9% move', validateValue('9.1', '2026-10-02', { value: '10' }, now).ok);
  const stale = validateValue('10', '2026-09-24', null, now);
  check('stale flagged not rejected', stale.ok && stale.stale && stale.ageBusinessDays === 6, stale);
  check('business days', businessDaysBetween('2026-10-02', '2026-10-05') === 1 && businessDaysBetween('2026-09-28', '2026-10-02') === 4 && lastWeekdayOnOrBefore('2026-10-03') === '2026-10-02');

  // ---------------------------------------------------------------- fetcher
  let clock = 1_000_000;
  const calls: string[] = [];
  const route: FetchImpl = async (url) => {
    calls.push(url);
    const body = url.endsWith('/zse/') ? LIST : url.endsWith('zimr.html') ? TICKER : url.includes('er-api') ? ER : '';
    return { status: body ? 200 : 404, headers: { get: () => null }, text: async () => body };
  };
  const mk = (impl: FetchImpl = route) => new PoliteFetcher({ fetchImpl: impl, now: () => clock, sleep: async (ms) => void (clock += ms) });
  const f1 = mk();
  const a = await f1.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 60_000, cacheTtlMs: 300_000 });
  const b = await f1.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 60_000, cacheTtlMs: 300_000 });
  check('cache serves second read', !a.fromCache && b.fromCache && calls.length === 1);
  clock += 10_000;
  const c = await f1.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 60_000, cacheTtlMs: 300_000, force: true });
  check('force within crawl-delay falls back to cache (no request)', c.fromCache && calls.length === 1);
  const rl = await throwsAsync(() => f1.getText('https://afx.kwayisi.org/zse/zimr.html', { minIntervalMs: 60_000, cacheTtlMs: 1000 }));
  check('rate limit refused when no cache and cannot wait', rl instanceof FetchError && rl.kind === 'RATE_LIMIT', rl);
  const waited = await f1.getText('https://afx.kwayisi.org/zse/zimr.html', { minIntervalMs: 60_000, cacheTtlMs: 1000, maxWaitMs: 70_000 });
  check('waits out the crawl delay when allowed', !waited.fromCache && calls.length === 2);
  const bad = await throwsAsync(() => f1.getText('https://evil.example.com/x', { minIntervalMs: 0, cacheTtlMs: 0 }));
  check('host allow-list', bad instanceof FetchError && bad.kind === 'FORBIDDEN_HOST');
  const plain = await throwsAsync(() => f1.getText('http://afx.kwayisi.org/zse/', { minIntervalMs: 0, cacheTtlMs: 0 }));
  check('https only', plain instanceof FetchError && plain.kind === 'FORBIDDEN_HOST');
  const f2 = mk(async () => ({ status: 429, headers: { get: () => null }, text: async () => '' }));
  const e429 = await throwsAsync(() => f2.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 0, cacheTtlMs: 0 }));
  check('429 -> RATE_LIMIT', e429 instanceof FetchError && e429.kind === 'RATE_LIMIT');
  const f3 = mk(async () => ({ status: 302, headers: { get: () => 'https://elsewhere.example.com/' }, text: async () => '' }));
  const redir = await throwsAsync(() => f3.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 0, cacheTtlMs: 0 }));
  check('off-host redirect refused', redir instanceof FetchError && redir.kind === 'FORBIDDEN_HOST');
  let sentUa = '';
  const f4 = mk(async (_u, init) => {
    sentUa = init.headers['User-Agent'] ?? '';
    return route('https://afx.kwayisi.org/zse/', init);
  });
  await f4.getText('https://afx.kwayisi.org/zse/', { minIntervalMs: 0, cacheTtlMs: 0 });
  check('identifying User-Agent', /MatanhoNexusBot/.test(sentUa) && /mailto:/.test(sentUa), sentUa);

  // ---------------------------------------------------------------- public provider
  calls.length = 0;
  clock = 5_000_000;
  const prov = new PublicMarketDataProvider(mk());
  const batch = await prov.fetchQuotes(['DLTA.ZW', 'ZIMR.ZW', 'ECO.ZW', 'ZIM.VX', 'T-BILL-91D'], { now: T0, fallbackLimit: 1 });
  const got = new Map(batch.items.map((q) => [q.ticker, q]));
  check('provider: list hit', got.get('DLTA.ZW')?.price === '32.416862');
  check('provider: fallback to counter page for ZIMR', got.get('ZIMR.ZW')?.price === '0.703269' && got.get('ZIMR.ZW')?.url.endsWith('zimr.html'), got.get('ZIMR.ZW'));
  check('provider: fallback budget exhausted -> issue for ECO', batch.issues.some((i) => i.ticker === 'ECO.ZW' && i.kind === 'ERROR'), batch.issues);
  check('provider: VFEX/OTC reported NO_SOURCE not fetched', batch.issues.filter((i) => i.kind === 'NO_SOURCE').map((i) => i.ticker).sort().join() === 'T-BILL-91D,ZIM.VX');
  check('provider: one list request + one fallback request', calls.length === 2, calls);
  check('provider: source report', batch.sources[0]?.status === 'OK' && batch.sources[0].count === 13, batch.sources);

  const nofb = await new PublicMarketDataProvider(mk()).fetchQuotes(['DLTA.ZW', 'ZIMR.ZW'], { now: T0 });
  check('provider: no fallback by default (manual refresh stays cheap)', nofb.items.length === 1 && nofb.issues.length === 1);

  const broken = new PublicMarketDataProvider(mk(async () => ({ status: 200, headers: { get: () => null }, text: async () => '<html>redesigned</html>' })));
  const bb = await broken.fetchQuotes(['DLTA.ZW'], { now: T0, fallbackLimit: 5 });
  check('provider: layout change -> PARSE issue, zero requests wasted on fallback, zero rows', bb.items.length === 0 && bb.issues.some((i) => i.kind === 'PARSE') && bb.sources[0]?.status === 'ERROR', bb);
  const down = new PublicMarketDataProvider(mk(async () => ({ status: 500, headers: { get: () => null }, text: async () => '' })));
  const dd = await down.fetchQuotes(['DLTA.ZW'], { now: T0 });
  check('provider: HTTP 500 -> ERROR issue', dd.items.length === 0 && dd.issues[0]?.kind === 'ERROR' && /500/.test(dd.issues[0].message));
  const skipped = await new PublicMarketDataProvider(mk()).fetchQuotes(['DLTA.ZW'], { now: T0, skipSources: new Set(['ZSE_AFX']) });
  check('provider: back-off source skipped', skipped.items.length === 0 && skipped.issues[0]?.kind === 'BACKOFF');

  const fxb = await new PublicMarketDataProvider(mk()).fetchFx([{ from: 'USD', to: 'ZWG' }], { now: T0 });
  check('provider: fx', fxb.items[0]?.rate === '26.7653' && fxb.items[0].source === 'ER_API');
  const hb = await new PublicMarketDataProvider(mk()).fetchHistory('ZIMR.ZW', '2026-09-29', '2026-10-01', { now: T0 });
  check('provider: history window filter', hb.items.length === 3 && hb.items[0]!.priceDate === '2026-10-01', hb.items.map((i) => i.priceDate));
  const hv = await new PublicMarketDataProvider(mk()).fetchHistory('ZIM.VX', '2026-01-01', '2026-10-01', { now: T0 });
  check('provider: VFEX history NO_SOURCE', hv.items.length === 0 && hv.issues[0]?.kind === 'NO_SOURCE');
  const health = await new PublicMarketDataProvider(mk()).healthCheck();
  check('provider: healthCheck parses both sources', health.ok && health.sources.length === 2, health);

  // ---------------------------------------------------------------- fake + live + mode
  const fake = new FakeMarketDataProvider();
  const f1q = await fake.fetchQuotes(['DLTA.ZW', 'ZIM.VX'], { now: T0 });
  const f2q = await fake.fetchQuotes(['DLTA.ZW', 'ZIM.VX'], { now: T0 });
  check('fake: deterministic', JSON.stringify(f1q.items) === JSON.stringify(f2q.items) && f1q.items[0]!.priceDate === '2026-10-02');
  check('fake: values within bounds', f1q.items.every((q) => validateValue(q.price, q.priceDate, null, T0).ok));
  const fh = await fake.fetchHistory('DLTA.ZW', '2026-09-28', '2026-10-02', { now: T0 });
  check('fake: history is weekdays only and matches fakeClose', fh.items.length === 5 && fh.items[0]!.close === fakeClose('DLTA.ZW', '2026-10-02'));
  const walk = fh.items.map((i) => Number(i.close));
  check('fake: day-to-day moves under 3%', walk.every((v, i) => i === 0 || Math.abs(v / walk[i - 1]! - 1) < 0.03));
  const ffx = await fake.fetchFx([{ from: 'USD', to: 'ZWG' }, { from: 'ZWG', to: 'USD' }], { now: T0 });
  check('fake: fx inverse', Math.abs(Number(ffx.items[0]!.rate) * Number(ffx.items[1]!.rate) - 1) < 1e-6);
  const live = new LiveMarketDataProvider();
  check('live: NotConfigured names env', (await throwsAsync(() => live.fetchQuotes(['A']))) instanceof IntegrationNotConfiguredError && ((await live.healthCheck()).ok === false));
  const lerr = (await throwsAsync(() => live.fetchFx([]))) as IntegrationNotConfiguredError;
  check('live: error lists MARKET_DATA_LIVE_API_KEY', lerr.requiredEnv.includes('MARKET_DATA_LIVE_API_KEY') && /MARKET_DATA_LIVE_API_KEY/.test(lerr.message));
  check('mode selection', marketDataMode({ INTEGRATION_MARKET_DATA: 'public' }) === 'public' && marketDataMode({}) === 'fake' && marketDataMode({ INTEGRATION_MARKET_DATA: 'bogus' }) === 'fake' && marketDataMode({ INTEGRATION_MARKET_DATA: 'LIVE' }) === 'live');
  check('scheduler default: on only for public', schedulerEnabled({ INTEGRATION_MARKET_DATA: 'public' }) && !schedulerEnabled({}) && !schedulerEnabled({ INTEGRATION_MARKET_DATA: 'public', MARKET_DATA_SCHEDULER: 'off' }) && schedulerEnabled({ MARKET_DATA_SCHEDULER: 'on' }));

  // ---------------------------------------------------------------- scheduler rules (Harare = UTC+2)
  const at = (iso: string) => new Date(iso); // UTC
  const run = (scope: string, status: string, iso: string) => ({ scope, status, startedAt: at(iso) });
  check('schedule: Saturday nothing', dueScope(at('2026-10-03T08:00:00Z'), []) === null);
  check('schedule: 06:00 Harare nothing', dueScope(at('2026-10-02T04:00:00Z'), []) === null);
  check('schedule: 08:00 Harare -> FX', dueScope(at('2026-10-02T06:00:00Z'), []) === 'FX');
  check('schedule: FX done -> nothing before open', dueScope(at('2026-10-02T06:30:00Z'), [run('FX', 'OK', '2026-10-02T06:00:00Z')]) === null);
  check('schedule: 10:00 Harare -> INTRADAY', dueScope(at('2026-10-02T08:00:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z')]) === 'INTRADAY');
  check('schedule: intraday not repeated within 30 min', dueScope(at('2026-10-02T08:20:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z'), run('INTRADAY', 'OK', '2026-10-02T08:00:00Z')]) === null);
  check('schedule: intraday again after 30 min', dueScope(at('2026-10-02T08:31:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z'), run('INTRADAY', 'OK', '2026-10-02T08:00:00Z')]) === 'INTRADAY');
  check('schedule: 15:30 Harare -> EOD', dueScope(at('2026-10-02T13:30:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z')]) === 'EOD');
  check('schedule: EOD done -> nothing', dueScope(at('2026-10-02T14:30:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z'), run('EOD', 'OK', '2026-10-02T13:30:00Z')]) === null);
  check('schedule: EOD failed retries after 30 min, max 3', dueScope(at('2026-10-02T14:05:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z'), run('EOD', 'FAILED', '2026-10-02T13:30:00Z')]) === 'EOD' && dueScope(at('2026-10-02T16:00:00Z'), [run('FX', 'OK', '2026-10-02T05:35:00Z'), run('EOD', 'FAILED', '2026-10-02T13:30:00Z'), run('EOD', 'FAILED', '2026-10-02T14:05:00Z'), run('EOD', 'FAILED', '2026-10-02T14:40:00Z')]) === null);

  // ---------------------------------------------------------------- custodian statement parsers
  const base = fakeStatement('cp-1', 'ACC-001', '2026-10-02');
  check('fake statement deterministic', JSON.stringify(base) === JSON.stringify(fakeStatement('cp-1', 'ACC-001', '2026-10-02')) && base.holdings.length === 3 && base.transactions.length === 2);
  for (const fmt of ['CSV', 'MT940', 'JSON'] as const) {
    const text = renderStatement(base, fmt);
    check(`detect ${fmt}`, detectFormat(text) === fmt);
    const [p] = parseStatements(text);
    check(`${fmt}: account/date/cash`, p?.accountRef === 'ACC-001' && p.statementDate === '2026-10-02' && p.closingCash === base.closingCash && p.currency === 'USD', p);
    check(`${fmt}: holdings round trip`, p?.holdings.length === 3 && p.holdings.map((h) => `${h.ticker}:${h.quantity}`).join() === base.holdings.map((h) => `${h.ticker}:${h.quantity}`).join(), p?.holdings);
    check(`${fmt}: trades round trip`, p?.transactions.length === 2 && p.transactions[0]!.tradeRef === base.transactions[0]!.tradeRef && p.transactions[0]!.side === base.transactions[0]!.side && Number(p.transactions[0]!.price) === Number(base.transactions[0]!.price), p?.transactions);
  }
  const mt = parseStatements(':20:X\n:25:/GB99ACC\n:62F:D261002USD1000,50\n') as ReturnType<typeof parseStatements>;
  check('MT940: debit balance negative, comma decimal, account slash prefix stripped', mt[0]?.closingCash === '-1000.50' && mt[0].accountRef === 'GB99ACC', mt);
  check('MT940: no holdings warns', mt[0]!.warnings.some((w) => /holdings/i.test(w)));
  const multi = parseStatements('record_type,account,statement_date,currency,amount\nBALANCE,A1,2026-10-02,USD,10\nBALANCE,A2,2026-10-02,ZWG,20\n');
  check('CSV: multiple accounts grouped', multi.length === 2 && multi[1]!.currency === 'ZWG');
  const rejects = (fn: () => unknown) => throws(fn) instanceof StatementParseError;
  check('CSV: bad number rejected', rejects(() => parseStatements('record_type,account,statement_date,currency,ticker,quantity,price\nHOLDING,A,2026-10-02,USD,X,abc,1\n')));
  check('CSV: bad side rejected', rejects(() => parseStatements('record_type,account,statement_date,currency,ticker,side,quantity,price,trade_ref\nTRADE,A,2026-10-02,USD,X,HOLD,1,1,R1\n')));
  check('CSV: unknown record type rejected', rejects(() => parseStatements('record_type,account,statement_date\nFOO,A,2026-10-02\n')));
  check('CSV: missing header rejected', rejects(() => parseStatements('a,b\n1,2\n')));
  check('CSV: bad date rejected', rejects(() => parseStatements('record_type,account,statement_date,currency,amount\nBALANCE,A,02/10/2026,USD,1\n')));
  check('JSON: invalid rejected', rejects(() => parseStatements('{"accountRef":')));
  check('JSON: negative price rejected', rejects(() => parseStatements(JSON.stringify({ accountRef: 'A', statementDate: '2026-10-02', currency: 'USD', transactions: [{ tradeRef: 'R', ticker: 'X', side: 'BUY', quantity: '1', price: '-2' }] }))));
  check('empty file rejected', rejects(() => parseStatements('   ')));
  const err = throws(() => parseStatements('record_type,account,statement_date,currency,ticker,quantity\nHOLDING,A,2026-10-02,USD,X,abc\nHOLDING,A,2026-10-02,USD,Y,def\n')) as StatementParseError;
  check('errors list rows', err.problems.length === 2 && /row 2/.test(err.problems[0]!));
  const feed = new FakeCustodianFeed([{ counterpartyId: 'cp-1', accountRef: 'ACC-001' }]);
  const stmts = await feed.listStatements();
  check('fake feed lists 5 weekday statements', stmts.length === 5 && stmts.every((s) => new Date(`${s.statementDate}T00:00:00Z`).getUTCDay() % 6 !== 0));
  check('fake feed fetch holdings/transactions', (await feed.fetchHoldings(stmts[0]!.id)).length === 3 && (await feed.fetchTransactions(stmts[0]!.id)).length === 2 && (await feed.fetchStatement(stmts[0]!.id))?.tradeCount === 2);
  const lf = new LiveCustodianFeed();
  const lerr2 = (await throwsAsync(() => lf.listStatements())) as IntegrationNotConfiguredError;
  check('custodian live: NotConfigured names env', lerr2 instanceof IntegrationNotConfiguredError && /CUSTODIAN_FEED_SWIFT_BIC/.test(lerr2.message) && /CUSTODIAN_FEED_API_KEY/.test(lerr2.message));
  check('custodian mode default file-drop', custodianFeedMode({}) === 'file-drop' && custodianFeedMode({ INTEGRATION_CUSTODIAN_FEED: 'fake' }) === 'fake' && custodianFeedMode({ INTEGRATION_CUSTODIAN_FEED: 'live' }) === 'live');

  console.log(`\nmarket-data/custodian-feed offline checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
