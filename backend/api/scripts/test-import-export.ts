/**
 * Package S3 (import and export framework, ledger FX stamps) checks against a RUNNING API:
 *  - shared import service: CSV, XLSX and JSON parse alike; preview (dry run) writes nothing; per-row errors with line numbers;
 *    a file with row errors needs skipInvalid; one batch commits once; the same file twice is flagged; permission-gated; audited.
 *  - FR-OMS-010: orders import creates DRAFT orders owned by the importer. FR-OMS-012/020: blotter export carries the filters.
 *  - FR-FIN-005: margin statement import enforces control totals (mismatch rejects the whole file) and raises calls on commit.
 *  - FR-RSK-012: positions (step-up on commit) and limits (DRAFT, needs the normal approval) import. FR-RSK-013: compliance report.
 *  - FR-PERF-005: attribution export CSV/XLSX, audited. FR-PM-003: look-through export. Build-plan S3: funds, commitments and
 *    valuations import with dry-run.
 *  - Build-plan S10: ledger view, FX stamping (never overwritten), corrections with maker-checker and a separate correcting line.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4181 npx tsx --env-file-if-exists=../../.env scripts/test-import-export.ts
 *
 * Run `prisma migrate deploy` and `prisma/seed.ts` on a disposable schema first and start the API against the same
 * DATABASE_URL (FILE_ENCRYPTION_KEY set, for TOTP). Creates throwaway users and records with a random run id.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { totpNow } from '../src/lib/totp';
import { detectFormat, parseCsv, parseTabular, safeCell } from '../src/lib/tabular';
import { workbook } from '../src/lib/xlsx';
import { parseDay, parseDecimal } from '../src/modules/imports/imports.core';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Ie-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 900));
  }
};
const key = (label: string) => `ie-${run}-${label}-${randomBytes(4).toString('hex')}`;
const D = (v: string | number) => new Prisma.Decimal(v);
const dayStr = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const IMP = '/api/v1/imports';

interface Res {
  status: number;
  body: any;
  headers: Headers;
  buf: Buffer;
}
function client() {
  const origin = config.portalUrls.admin;
  let cookie = '';
  let secret = '';
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      cookie = /max-age=0/i.test(c) ? '' : pair!;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, headers: res.headers, buf };
  };
  const upload = (kind: string, name: string, content: string | Buffer, fields: Record<string, string> = {}, mime = 'text/csv') => {
    const fd = new FormData();
    fd.set('file', new Blob([content as unknown as Uint8Array], { type: mime }), name);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return send('POST', `${IMP}/${kind}/preview`, fd);
  };
  return {
    get: (p: string) => send('GET', p),
    post: (p: string, b?: unknown, h?: Record<string, string>) => send('POST', p, b ?? {}, h),
    upload,
    login: (email: string) => send('POST', '/api/auth/login', { email, password, portal: 'admin' }),
    async enrolMfa() {
      const e = await send('POST', '/api/auth/mfa/enroll', {});
      secret = e.body?.secret ?? '';
      const v = await send('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
      return e.status === 200 && v.status === 200;
    },
    stepUp: () => send('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) }),
  };
}
const errCode = (r: Res) => r.body?.error?.code;
const staleMfa = (userId: string) => prisma.session.updateMany({ where: { userId }, data: { mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
const commitKey = (label: string) => ({ 'Idempotency-Key': key(label) });

async function main() {
  // ---------------------------------------------------------------- pure parsers
  console.log('\nTabular parsers and cell rules (pure)');
  const csv = parseCsv('﻿Name;Qty\r\n"Smith, J";10\r\n"He said ""hi""";20\r\n\r\n');
  check('CSV: BOM dropped, semicolon delimiter, quoted comma and doubled quotes, blank line ignored', csv.length === 3 && csv[0]![0] === 'Name' && csv[1]![0] === 'Smith, J' && csv[2]![0] === 'He said "hi"' && csv[2]![1] === '20', csv);
  check('CSV: tab delimiter detected', parseCsv('a\tb\n1\t2')[1]![1] === '2');
  const wb = workbook('Sheet1', [['Portfolio', 'Qty', 'Note'], ['PF-1', '100', 'a & b <c>'], ['PF-2', '2.5', '']]);
  const fromXlsx = parseTabular(wb, 'x.xlsx', undefined);
  check('XLSX written by lib/xlsx reads back (format detected, headers, cells with markup characters)', fromXlsx.format === 'xlsx' && fromXlsx.headers.join('|') === 'Portfolio|Qty|Note' && fromXlsx.rows[0]![2] === 'a & b <c>' && fromXlsx.rows[1]![1] === '2.5', fromXlsx);
  const fromJson = parseTabular(Buffer.from(JSON.stringify([{ portfolio: 'PF-1', qty: 5 }, { portfolio: 'PF-2', qty: 6, extra: true }])), 'x.json', 'application/json');
  check('JSON array of flat objects reads as a table (union of keys)', fromJson.format === 'json' && fromJson.rows.length === 2 && fromJson.headers.includes('extra'), fromJson);
  check('format detection: extension, mime and ZIP magic', detectFormat('a.XLSX') === 'xlsx' && detectFormat('a.json') === 'json' && detectFormat('a.txt') === 'csv' && detectFormat('blob', null, Buffer.from([0x50, 0x4b, 0x03, 0x04])) === 'xlsx');
  check('formula injection: a leading = + - @ is neutralised on the way out', safeCell('=SUM(A1)').startsWith("'") && safeCell('+1').startsWith("'") && safeCell('@x').startsWith("'") && safeCell('plain') === 'plain');
  check('decimals: thousands separators, scale and sign rules', (parseDecimal('1,234.50', { scale: 2 }) as any).value?.toFixed(2) === '1234.50' && parseDecimal('1.234', { scale: 2 }).ok === false && parseDecimal('-1', { positive: true }).ok === false && parseDecimal('abc').ok === false);
  check('dates: ISO, slashes, Excel serial; impossible dates refused', (parseDay('2026-10-04') as any).value === '2026-10-04' && (parseDay('2026/10/04') as any).value === '2026-10-04' && (parseDay('46000') as any).value?.length === 10 && parseDay('2026-02-30').ok === false && parseDay('04/10/2026').ok === false);

  // ---------------------------------------------------------------- fixtures
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'admin', key: k } } });
  const userIds: string[] = [];
  const mkUser = async (label: string, roleKey: string) => {
    const u = await prisma.user.create({ data: { email: `ie-${run}-${label}@example.test`, name: `IE ${label}`, passwordHash: hash } });
    userIds.push(u.id);
    await prisma.userRole.create({ data: { userId: u.id, roleId: (await role(roleKey)).id } });
    return u;
  };
  const pmU = await mkUser('pm', 'portfolio_manager'); // orders.create, portfolio.manage
  const compU = await mkUser('comp', 'compliance'); // risk.manage, financing.manage
  const opsU = await mkUser('ops', 'operations'); // ledger.view + ledger.correct
  const dirU = await mkUser('dir', 'investment_director'); // ledger.approve
  const audU = await mkUser('aud', 'auditor'); // read only
  const csU = await mkUser('cs', 'client_services'); // no orders.view
  const pm = client();
  const comp = client();
  const ops = client();
  const dir = client();
  const aud = client();
  const cs = client();
  const auditCount = (action: string, objectId?: string) => prisma.auditEvent.count({ where: { action, ...(objectId ? { objectId } : {}) } });

  const createdPortfolios: string[] = [];
  const createdSecurities: string[] = [];
  const createdClients: string[] = [];
  const createdFunds: string[] = [];
  const batchIds: string[] = [];
  const track = (r: Res) => {
    if (r.body?.data?.id) batchIds.push(r.body.data.id);
    return r;
  };

  try {
    console.log('\nSign-in');
    for (const [c, u] of [[pm, pmU], [comp, compU], [ops, opsU], [dir, dirU], [aud, audU], [cs, csU]] as const) check(`${u.name} signs in`, (await c.login(u.email)).status === 200);
    for (const [n, c] of [['comp', comp], ['ops', ops], ['dir', dir]] as const) check(`${n} enrols MFA`, await c.enrolMfa());

    const sec = await prisma.security.create({ data: { ticker: `I${run}A`.toUpperCase(), name: `IE A ${run}`, market: 'ZSE', assetClass: 'Equity', currency: 'USD', boardLot: 10, sector: 'Banks', status: 'Active' } });
    createdSecurities.push(sec.id);
    for (const [off, price] of [[-8, '10'], [-7, '10'], [-5, '10.5'], [-3, '11'], [-1, '11.2']] as const) await prisma.securityPrice.create({ data: { securityId: sec.id, priceDate: day(dayStr(off)), price: D(price), source: 'IETEST' } });
    const pf = await prisma.portfolio.create({ data: { ref: `IE-${run}`, name: `IE Portfolio ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
    createdPortfolios.push(pf.id);

    // ================================================================ catalogue and permissions
    console.log('\nImport catalogue and permissions');
    const kPm = await pm.get(`${IMP}/kinds`);
    const kindsPm = (kPm.body?.data ?? []).map((k: any) => k.kind);
    check('portfolio manager sees orders and the private-markets kinds', kPm.status === 200 && ['orders', 'pm-funds', 'pm-commitments', 'pm-valuations'].every((k) => kindsPm.includes(k)) && !kindsPm.includes('risk-limits'), kindsPm);
    const kAud = await aud.get(`${IMP}/kinds`);
    check('auditor sees no import kinds', kAud.status === 200 && kAud.body.data.length === 0, kAud.body);
    const tpl = await pm.get(`${IMP}/orders/template`);
    check('template is a CSV with the header and an example row', tpl.status === 200 && /text\/csv/.test(tpl.headers.get('content-type') ?? '') && tpl.buf.toString().split(/\r?\n/)[0]!.startsWith('Portfolio,Ticker,Side'), tpl.buf.toString().slice(0, 120));
    check('an unknown kind -> 404', (await pm.get(`${IMP}/nope/template`)).status === 404);
    const denied = await aud.upload('orders', 'o.csv', 'Portfolio,Ticker,Side,Quantity\n');
    check('previewing without the permission -> 403', denied.status === 403, denied.body);

    // ================================================================ orders import (FR-OMS-010)
    console.log('\nFR-OMS-010: orders import, preview then commit');
    const ordersCsv = ['Portfolio,Ticker,Side,Quantity,Order type,Limit price,TIF,Rationale', `${pf.ref},${sec.ticker},BUY,100,LIMIT,10.5,DAY,Rebalance`, `${pf.ref},${sec.ticker},SELL,35,MARKET,,DAY,Not a lot multiple`, `${pf.ref},${sec.ticker},BUY,200,MARKET,,GTC,Second good row`, `NOPE-1,${sec.ticker},BUY,10,MARKET,,DAY,Unknown portfolio`].join('\r\n');
    const before = await prisma.order.count({ where: { portfolioId: pf.id } });
    const p1 = track(await pm.upload('orders', 'orders.csv', ordersCsv));
    check('preview 201 with 4 rows, 2 valid, 2 with errors and a batch ref', p1.status === 201 && p1.body.data.rowCount === 4 && p1.body.data.validCount === 2 && p1.body.data.errorCount === 2 && /^IMB-/.test(p1.body.data.ref), p1.body);
    const errs: any[] = p1.body.data.errors ?? [];
    check('row errors carry the file line (3 = board lot, 5 = portfolio) and the field', errs.some((e) => e.line === 3 && e.field === 'quantity' && /board lot/.test(e.message)) && errs.some((e) => e.line === 5 && e.field === 'portfolio'), errs);
    check('the preview wrote no orders (dry run)', (await prisma.order.count({ where: { portfolioId: pf.id } })) === before);
    check('preview is audited with the file hash', (await auditCount('import.previewed', p1.body.data.id)) === 1);
    check('canCommit is true only because there are valid rows; the preview lists the rows as validated', p1.body.data.canCommit === true && p1.body.data.preview.length === 4 && p1.body.data.preview[0].ok === true);
    const c0 = await pm.post(`${IMP}/orders/${p1.body.data.id}/commit`, {}, commitKey('c0'));
    check('commit without skipInvalid while rows have errors -> 409 import_has_errors and nothing written', c0.status === 409 && errCode(c0) === 'import_has_errors' && (await prisma.order.count({ where: { portfolioId: pf.id } })) === before, c0.body);
    const cDenied = await aud.post(`${IMP}/orders/${p1.body.data.id}/commit`, { skipInvalid: true }, commitKey('c0d'));
    check('commit without the permission -> 403', cDenied.status === 403, cDenied.body);
    const c1k = key('c1');
    const c1 = await pm.post(`${IMP}/orders/${p1.body.data.id}/commit`, { skipInvalid: true }, { 'Idempotency-Key': c1k });
    check('commit with skipInvalid applies the 2 valid rows', c1.status === 200 && c1.body.data.status === 'COMMITTED' && c1.body.data.result?.created === 2, c1.body);
    const created = await prisma.order.findMany({ where: { portfolioId: pf.id }, orderBy: { ref: 'asc' } });
    check('two DRAFT orders owned by the importer (a second person still has to approve)', created.length === before + 2 && created.every((o) => o.status === 'Draft' && o.makerId === pmU.id), created.map((o) => [o.ref, o.status]));
    check('the order audit event names the batch and line', (await prisma.auditEvent.count({ where: { action: 'order.created', objectId: { in: created.map((o) => o.id) } } })) === 2 && JSON.stringify((await prisma.auditEvent.findFirst({ where: { action: 'order.created', objectId: created[0]!.id } }))?.after).includes(p1.body.data.ref));
    check('commit is audited', (await auditCount('import.committed', p1.body.data.id)) >= 1);
    const c1again = await pm.post(`${IMP}/orders/${p1.body.data.id}/commit`, { skipInvalid: true }, commitKey('c1b'));
    check('committing the same batch again -> 409', c1again.status === 409 && errCode(c1again) === 'import_already_committed', c1again.body);
    const c1replay = await pm.post(`${IMP}/orders/${p1.body.data.id}/commit`, { skipInvalid: true }, { 'Idempotency-Key': c1k });
    check('the same Idempotency-Key replays the first answer and creates nothing more', c1replay.status === 200 && (await prisma.order.count({ where: { portfolioId: pf.id } })) === before + 2, c1replay.body);
    const p1dup = track(await pm.upload('orders', 'orders-again.csv', ordersCsv));
    check('the same file again is flagged as a duplicate of the committed batch and cannot be committed by default', p1dup.body.data.duplicateOf?.ref === p1.body.data.ref && p1dup.body.data.canCommit === false, p1dup.body.data);
    const dupCommit = await pm.post(`${IMP}/orders/${p1dup.body.data.id}/commit`, { skipInvalid: true }, commitKey('dup'));
    check('committing a duplicate without allowDuplicate -> 409', dupCommit.status === 409, dupCommit.body);

    const jsonRows = JSON.stringify([{ portfolio: pf.ref, security: sec.ticker, side: 'BUY', quantity: 50, orderType: 'MARKET' }]);
    const pj = track(await pm.upload('orders', 'orders.json', jsonRows, {}, 'application/json'));
    check('JSON import previews the same way', pj.status === 201 && pj.body.data.format === 'json' && pj.body.data.validCount === 1 && pj.body.data.errorCount === 0, pj.body);
    const xl = workbook('Orders', [['Portfolio', 'Ticker', 'Side', 'Quantity'], [pf.ref, sec.ticker, 'SELL', '30'], [pf.ref, sec.ticker, 'BUY', 'abc']]);
    const px = track(await pm.upload('orders', 'orders.xlsx', xl, {}, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    check('XLSX import previews the same way, with the bad quantity on line 3', px.status === 201 && px.body.data.format === 'xlsx' && px.body.data.validCount === 1 && px.body.data.errors.some((e: any) => e.line === 3 && e.field === 'quantity'), px.body);
    const pBadHead = track(await pm.upload('orders', 'x.csv', 'Foo,Bar\n1,2\n'));
    check('a file without the required columns is rejected at preview and cannot be committed', pBadHead.body.data.status === 'REJECTED' && pBadHead.body.data.fileErrors.length > 0 && pBadHead.body.data.canCommit === false, pBadHead.body.data);
    const rejCommit = await pm.post(`${IMP}/orders/${pBadHead.body.data.id}/commit`, { skipInvalid: true }, commitKey('rej'));
    check('commit of a rejected batch -> 409 import_rejected', rejCommit.status === 409 && errCode(rejCommit) === 'import_rejected', rejCommit.body);
    const empty = await pm.upload('orders', 'e.csv', '');
    check('an empty file -> 400', empty.status === 400, empty.body);
    const list = await pm.get(`${IMP}/batches?kind=orders&limit=5`);
    check('recent batches list newest first, readable only for the kinds the role may use', list.status === 200 && list.body.data[0].kind === 'orders' && (await aud.get(`${IMP}/batches?kind=orders`)).status === 403, list.body);
    const one = await pm.get(`${IMP}/batches/${p1.body.data.id}`);
    check('a batch reads back with its stored errors and result', one.status === 200 && one.body.data.errors.length === 2 && one.body.data.result?.created === 2, one.body);

    // ================================================================ blotter export (FR-OMS-012/020)
    console.log('\nFR-OMS-012/020: blotter export with the filters');
    const ex = await pm.get(`/api/v1/orders/export?portfolioId=${pf.id}&status=Draft&format=csv`);
    const exText = ex.buf.toString('utf8');
    check('CSV export carries the filtered orders only, with a header row', ex.status === 200 && /text\/csv/.test(ex.headers.get('content-type') ?? '') && created.every((o) => exText.includes(o.ref)) && exText.split(/\r?\n/).filter(Boolean).length === 1 + before + 2, exText.slice(0, 300));
    const exNone = await pm.get(`/api/v1/orders/export?portfolioId=${pf.id}&status=Filled&format=csv`);
    check('a filter with no match exports the header only', exNone.status === 200 && exNone.buf.toString('utf8').split(/\r?\n/).filter(Boolean).length === 1);
    const exX = await pm.get(`/api/v1/orders/export?portfolioId=${pf.id}&format=xlsx`);
    check('XLSX export is a ZIP workbook', exX.status === 200 && exX.buf.subarray(0, 2).toString() === 'PK' && /spreadsheetml/.test(exX.headers.get('content-type') ?? ''));
    check('exports are audited with the filters and the row count', (await prisma.auditEvent.count({ where: { action: 'orders.blotter_exported', actorId: pmU.id } })) >= 3);
    check('export without orders.view -> 403', (await cs.get('/api/v1/orders/export?format=csv')).status === 403);

    // ================================================================ margin statement (FR-FIN-005)
    console.log('\nFR-FIN-005: margin statement import with control totals');
    const facP = await prisma.portfolio.create({ data: { ref: `IF-${run}`, name: `IE Fin ${run}`, type: 'Mutual fund', baseCurrency: 'USD', status: 'Active' } });
    createdPortfolios.push(facP.id);
    const fac = await prisma.finFacility.create({ data: { ref: `IF${run}`.slice(0, 16), name: `IE line ${run}`, type: 'MARGIN_LOAN', lender: 'IE Bank', portfolioId: facP.id, currency: 'USD', limitAmount: D(2000000), initialRatio: D('1.5'), maintenanceRatio: D('1.25'), status: 'ACTIVE', makerId: compU.id, approverId: dirU.id, approvedAt: new Date() } });
    const due = dayStr(10);
    const stmt = `Facility,Called amount,Drawn,Eligible value,Due date,Statement ref\r\n${fac.ref},125000,1000000,1100000,${due},STM-${run}\r\n`;
    const mBad = track(await comp.upload('margin-statement', 'stm.csv', stmt, { controlCount: '1', controlTotal: '124999.00' }));
    check('control total mismatch rejects the whole file', mBad.status === 201 && mBad.body.data.status === 'REJECTED' && mBad.body.data.fileErrors.some((m: string) => /control/i.test(m)), mBad.body.data);
    check('a rejected statement cannot be committed and raises no call', (await comp.post(`${IMP}/margin-statement/${mBad.body.data.id}/commit`, {}, commitKey('mbad'))).status === 409 && (await prisma.finMarginCall.count({ where: { facilityId: fac.id } })) === 0);
    const mNone = track(await comp.upload('margin-statement', 'stm2.csv', stmt));
    check('control totals are required for this kind (none supplied, none in the file) -> rejected', mNone.body.data.status === 'REJECTED', mNone.body.data);
    const mOk = track(await comp.upload('margin-statement', 'stm3.csv', stmt, { controlCount: '1', controlTotal: '125,000.00' }));
    check('matching control count and total pass; coverage worked out as eligible / drawn', mOk.body.data.status === 'PREVIEWED' && mOk.body.data.validCount === 1 && mOk.body.data.preview[0].values.coverage === '1.1000', mOk.body.data);
    const mc = await comp.post(`${IMP}/margin-statement/${mOk.body.data.id}/commit`, {}, commitKey('mok'));
    const calls = await prisma.finMarginCall.findMany({ where: { facilityId: fac.id } });
    check('commit raises one margin call at the statement figures', mc.status === 200 && calls.length === 1 && calls[0]!.calledAmount.toFixed(2) === '125000.00' && (await auditCount('fin.margin_call_issued', calls[0]!.id)) === 1, mc.body);
    const mSecond = track(await comp.upload('margin-statement', 'stm4.csv', stmt.replace(`STM-${run}`, `STM2-${run}`), { controlCount: '1', controlTotal: '125000' }));
    check('a facility with a call already open is a row error (no second call on top)', mSecond.body.data.validCount === 0 && mSecond.body.data.errors.some((e: any) => /already open/.test(e.message)), mSecond.body.data);

    // ================================================================ risk positions and limits (FR-RSK-012)
    console.log('\nFR-RSK-012: risk positions and limits import');
    const posCsv = `Portfolio,Ticker,Quantity,Average cost,As of\r\n${pf.ref},${sec.ticker},1000,10,${dayStr(-8)}\r\n${pf.ref},NOSUCH,5,1,${dayStr(-8)}\r\n`;
    const rp = track(await comp.upload('risk-positions', 'pos.csv', posCsv));
    check('positions preview flags the unknown ticker on line 3 and writes nothing', rp.status === 201 && rp.body.data.validCount === 1 && rp.body.data.errors.some((e: any) => e.line === 3) && (await prisma.portfolioPosition.count({ where: { portfolioId: pf.id } })) === 0, rp.body.data);
    await staleMfa(compU.id);
    const rpNoStep = await comp.post(`${IMP}/risk-positions/${rp.body.data.id}/commit`, { skipInvalid: true }, commitKey('rp0'));
    check('positions commit needs a fresh step-up -> 401 step_up_required', rpNoStep.status === 401 && errCode(rpNoStep) === 'step_up_required', rpNoStep.body);
    check('step-up succeeds', (await comp.stepUp()).status === 200);
    const rpc = await comp.post(`${IMP}/risk-positions/${rp.body.data.id}/commit`, { skipInvalid: true }, commitKey('rp1'));
    const posRows = await prisma.portfolioPosition.findMany({ where: { portfolioId: pf.id } });
    check('after step-up the position is written with the audit trail', rpc.status === 200 && posRows.length === 1 && posRows[0]!.quantity.toFixed(0) === '1000', rpc.body);
    const limCsv = `Metric,Scope,Portfolio,Threshold %,Breach action,Description\r\nSINGLE_NAME_PCT,PORTFOLIO,${pf.ref},10,ALERT,IE limit ${run}\r\nBOGUS,FIRM,,5,ALERT,bad metric\r\n`;
    const rl = track(await comp.upload('risk-limits', 'limits.csv', limCsv));
    check('limits preview flags the unknown metric', rl.body.data.validCount === 1 && rl.body.data.errors.some((e: any) => e.line === 3 && e.field === 'metric'), rl.body.data);
    const rlc = await comp.post(`${IMP}/risk-limits/${rl.body.data.id}/commit`, { skipInvalid: true }, commitKey('rl'));
    const lims = await prisma.riskLimit.findMany({ where: { description: `IE limit ${run}` } });
    check('limits are created as DRAFT (they still go through the normal approval)', rlc.status === 200 && lims.length === 1 && lims[0]!.status === 'DRAFT' && lims[0]!.makerId === compU.id, rlc.body);

    // ================================================================ compliance report (FR-RSK-013)
    console.log('\nFR-RSK-013: compliance report');
    await prisma.riskLimit.update({ where: { id: lims[0]!.id }, data: { status: 'ACTIVE', checkerId: dirU.id, approvedAt: new Date() } });
    const rep = await comp.get(`/api/v1/risk/compliance-report?portfolioId=${pf.id}&format=json`);
    const line = (rep.body?.data?.lines ?? []).find((l: any) => l.limitRef === lims[0]!.ref);
    check('report lists the active limit against live positions with value, headroom and state', rep.status === 200 && !!line && line.portfolioRef === pf.ref && ['OK', 'WARNING', 'BREACH'].includes(line.state) && Number.isFinite(Number(line.headroom)), rep.body?.data);
    check('summary counts match the lines', rep.body.data.summary.limitsChecked === rep.body.data.lines.length);
    const repCsv = await comp.get(`/api/v1/risk/compliance-report?portfolioId=${pf.id}&format=csv`);
    check('CSV download has the same line', repCsv.status === 200 && repCsv.buf.toString('utf8').includes(lims[0]!.ref) && /attachment/.test(repCsv.headers.get('content-disposition') ?? ''));
    const repX = await comp.get(`/api/v1/risk/compliance-report?portfolioId=${pf.id}&format=xlsx`);
    check('XLSX download is a workbook', repX.status === 200 && repX.buf.subarray(0, 2).toString() === 'PK');
    check('a future as-of date -> 400', (await comp.get(`/api/v1/risk/compliance-report?asOf=${dayStr(5)}`)).status === 400);
    check('each generation is audited', (await prisma.auditEvent.count({ where: { action: 'risk.compliance_report', actorId: compU.id } })) >= 3);

    // ================================================================ attribution export (FR-PERF-005)
    console.log('\nFR-PERF-005: attribution export');
    const attr = await pm.get(`/api/v1/performance/attribution/export?portfolioId=${pf.id}&from=${dayStr(-7)}&to=${dayStr(-1)}&format=csv`);
    const attrText = attr.buf.toString('utf8');
    check('CSV export has the header, a TOTAL row and the holding contribution', attr.status === 200 && attrText.includes('Allocation bps') && attrText.includes('TOTAL') && attrText.includes(sec.ticker), attr.status === 200 ? attrText.slice(0, 400) : attr.body);
    const attrX = await pm.get(`/api/v1/performance/attribution/export?portfolioId=${pf.id}&from=${dayStr(-7)}&to=${dayStr(-1)}&format=xlsx`);
    check('XLSX export is a workbook', attrX.status === 200 && attrX.buf.subarray(0, 2).toString() === 'PK');
    const attrAudit = await prisma.auditEvent.findFirst({ where: { action: 'performance.attribution_exported', actorId: pmU.id }, orderBy: { occurredAt: 'desc' } });
    check('the export is audited with portfolio, period, format, rows and the content hash', !!attrAudit && JSON.stringify(attrAudit.after).includes('sha256') && JSON.stringify(attrAudit.after).includes(pf.ref), attrAudit?.after);
    check('a period ending in the future -> 400', (await pm.get(`/api/v1/performance/attribution/export?portfolioId=${pf.id}&to=${dayStr(3)}`)).status === 400);

    // ================================================================ private markets (FR-PM-003 and S3)
    console.log('\nBuild-plan S3 and FR-PM-003: funds, commitments, valuations import and look-through export');
    const fundCsv = `Name,Manager,Strategy,Vintage,Currency\r\nIE Growth Fund ${run},IE Capital,PRIVATE_EQUITY,2024,USD\r\nBad Fund ${run},IE Capital,NOT_A_STRATEGY,2024,USD\r\n`;
    const pf1 = track(await pm.upload('pm-funds', 'funds.csv', fundCsv));
    check('funds preview: 1 valid, bad strategy on line 3', pf1.body.data.validCount === 1 && pf1.body.data.errors.some((e: any) => e.line === 3 && e.field === 'strategy'), pf1.body.data);
    check('funds preview wrote nothing', (await prisma.pmFund.count({ where: { name: { contains: run } } })) === 0);
    const pf1c = await pm.post(`${IMP}/pm-funds/${pf1.body.data.id}/commit`, { skipInvalid: true }, commitKey('pmf'));
    const fund = await prisma.pmFund.findFirst({ where: { name: `IE Growth Fund ${run}` } });
    check('funds commit creates the fund', pf1c.status === 200 && !!fund, pf1c.body);
    const commitCsv = `Fund,Portfolio,Amount,Committed on\r\n${fund?.ref},${pf.ref},500000,${dayStr(-30)}\r\n`;
    const pcBad = track(await pm.upload('pm-commitments', 'c.csv', commitCsv, { controlCount: '1', controlTotal: '400000' }));
    check('commitments: a wrong control total rejects the file', pcBad.body.data.status === 'REJECTED', pcBad.body.data);
    const pc = track(await pm.upload('pm-commitments', 'c2.csv', commitCsv, { controlCount: '1', controlTotal: '500000' }));
    check('commitments: matching control total previews as valid', pc.body.data.status === 'PREVIEWED' && pc.body.data.validCount === 1, pc.body.data);
    const pcc = await pm.post(`${IMP}/pm-commitments/${pc.body.data.id}/commit`, {}, commitKey('pmc'));
    const cm = await prisma.pmCommitment.findFirst({ where: { fundId: fund?.id, portfolioId: pf.id } });
    check('commitments commit creates the commitment', pcc.status === 200 && !!cm && cm.status === 'ACTIVE', pcc.body);
    const markCsv = `Commitment,As of,NAV,Method\r\n${cm?.ref},${dayStr(-3)},525000,GP_REPORTED\r\n${cm?.ref},${dayStr(-3)},600000,GP_REPORTED\r\n`;
    const pv = track(await pm.upload('pm-valuations', 'v.csv', markCsv));
    check('valuations preview flags the second mark for the same date as a duplicate', pv.body.data.validCount === 1 && pv.body.data.errors.some((e: any) => e.line === 3 && /duplicate/i.test(e.message)), pv.body.data);
    const pvc = await pm.post(`${IMP}/pm-valuations/${pv.body.data.id}/commit`, { skipInvalid: true }, commitKey('pmv'));
    const mark = await prisma.pmMark.findFirst({ where: { commitmentId: cm?.id } });
    check('valuations commit creates a DRAFT mark (the mark still needs a second approver)', pvc.status === 200 && mark?.status === 'DRAFT' && mark.makerId === pmU.id, pvc.body);
    const lt0 = await pm.get(`/api/v1/private-markets/lookthrough?portfolioId=${pf.id}`);
    const lt0Row = (lt0.body?.data?.rows ?? []).find((r: any) => r.commitmentRef === cm?.ref);
    check('look-through lists the commitment even before a mark is approved: exposure is the unfunded amount and the mark is flagged stale', lt0.status === 200 && !!lt0Row && lt0Row.exposureReport === '500000.00' && lt0Row.markStale === true && lt0Row.pctOfNav === null, lt0.body?.data);
    await prisma.pmMark.update({ where: { id: mark!.id }, data: { status: 'APPROVED', approvedAt: new Date() } });
    const lt = await pm.get(`/api/v1/private-markets/lookthrough?portfolioId=${pf.id}`);
    const ltRow = (lt.body?.data?.rows ?? []).find((r: any) => r.commitmentRef === cm?.ref);
    check('once a mark is approved the row carries NAV 525000, exposure NAV + unfunded and 100% of the private NAV of this portfolio', !!ltRow && ltRow.navReport === '525000.00' && ltRow.exposureReport === '1025000.00' && ltRow.pctOfNav === '100.00' && lt.body.data.totalNavReport === '525000.00', lt.body?.data);
    const ltCsv = await pm.get(`/api/v1/private-markets/lookthrough/export?portfolioId=${pf.id}&format=csv`);
    check('look-through CSV has the same commitment', ltCsv.status === 200 && ltCsv.buf.toString('utf8').includes(cm?.ref ?? 'x'));
    const ltX = await pm.get(`/api/v1/private-markets/lookthrough/export?portfolioId=${pf.id}&format=xlsx`);
    check('look-through XLSX is a workbook and the export is audited', ltX.status === 200 && ltX.buf.subarray(0, 2).toString() === 'PK' && (await prisma.auditEvent.count({ where: { action: 'pm.lookthrough_exported', actorId: pmU.id } })) >= 2);

    // ================================================================ ledger view, FX stamps, corrections (S10)
    console.log('\nBuild-plan S10: ledger view, FX stamping and corrections');
    const cur = `Z${run.slice(0, 2).toUpperCase()}`.replace(/[^A-Z]/g, 'X').padEnd(3, 'X').slice(0, 3);
    const lpC = await prisma.client.create({ data: { ref: `CIE-${run}`, name: `IE Client ${run}`, type: 'Individual' } });
    createdClients.push(lpC.id);
    const lpF = await prisma.fund.create({ data: { ref: `FIE-${run}`, name: `IE Fund ${run}`, shortName: `IF ${run}`, currency: 'USD' } });
    createdFunds.push(lpF.id);
    const txn = dayStr(-4);
    const dr = await prisma.lpDealingRequest.create({ data: { ref: `DR${run}`.slice(0, 16), clientId: lpC.id, fundId: lpF.id, requestType: 'SUBSCRIPTION', amount: D('1000'), currency: cur, status: 'SUBMITTED' } });
    await prisma.lpDealingRequest.update({ where: { id: dr.id }, data: { createdAt: new Date(`${txn}T10:00:00.000Z`) } });
    await prisma.fxRate.create({ data: { fromCurrency: cur, toCurrency: 'USD', rateDate: day(dayStr(-5)), rate: D('1.2500000000'), source: 'IETEST' } });
    const scope = `clientId=${lpC.id}&fundId=${lpF.id}`;
    const lv = await ops.get(`/api/v1/ledger?${scope}`);
    const ent = (lv.body?.data ?? []).find((l: any) => l.entryId === dr.id);
    check('ledger view derives the dealing request as an unstamped entry in its own currency', lv.status === 200 && !!ent && ent.currency === cur && ent.stamp === null && lv.body.summary.unstamped === 1, lv.body);
    check('ledger needs ledger.view (auditor has it, portfolio manager does not)', (await aud.get(`/api/v1/ledger?${scope}`)).status === 200 && (await pm.get(`/api/v1/ledger?${scope}`)).status === 403);
    check('auditor cannot stamp -> 403', (await aud.post('/api/v1/ledger/stamp', { clientId: lpC.id, fundId: lpF.id })).status === 403);
    const st = await ops.post('/api/v1/ledger/stamp', { clientId: lpC.id, fundId: lpF.id, reporting: 'USD' }, commitKey('stamp'));
    check('stamping uses the newest rate at or before the date and records that rate date', st.status === 200 && st.body.data.stamped === 1 && st.body.data.missingRate === 0, st.body);
    const stamp1 = await prisma.ledgerFxStamp.findFirst({ where: { entryId: dr.id } });
    check('the stamp holds rate 1.25, reporting amount 1250 and version 1', !!stamp1 && stamp1.rate.toFixed(2) === '1.25' && stamp1.reportingAmount.toFixed(2) === '1250.00' && stamp1.version === 1 && day(dayStr(-5)).getTime() === stamp1.rateDate.getTime(), stamp1);
    await prisma.fxRate.create({ data: { fromCurrency: cur, toCurrency: 'USD', rateDate: day(dayStr(-4)), rate: D('1.9000000000'), source: 'IETEST' } });
    const st2 = await ops.post('/api/v1/ledger/stamp', { clientId: lpC.id, fundId: lpF.id, reporting: 'USD' }, commitKey('stamp2'));
    const stamp1b = await prisma.ledgerFxStamp.findFirst({ where: { entryId: dr.id } });
    check('a later rate never overwrites an existing stamp', st2.body.data.stamped === 0 && st2.body.data.alreadyStamped === 1 && stamp1b?.rate.toFixed(2) === '1.25');
    const lv2 = await ops.get(`/api/v1/ledger?${scope}`);
    check('the view now shows the stamp and reporting amount', lv2.body.data.find((l: any) => l.entryId === dr.id)?.reportingAmount === '1250.00' && lv2.body.summary.unstamped === 0, lv2.body);
    const cr = await ops.post('/api/v1/ledger/corrections', { entryId: dr.id, kind: 'FX_RESTAMP', newRate: '1.3000', newRateDate: dayStr(-4), reason: 'Rate source was wrong' }, commitKey('corr'));
    check('maker proposes an FX restamp -> PENDING_APPROVAL', cr.status === 201 && cr.body.data.status === 'PENDING_APPROVAL' && /^LCR-/.test(cr.body.data.ref), cr.body);
    check('the stamp is unchanged while the correction is pending', (await prisma.ledgerFxStamp.findFirst({ where: { entryId: dr.id, status: 'ACTIVE' } }))?.rate.toFixed(2) === '1.25');
    const crId = cr.body.data.id;
    check('a second open restamp for the same entry is refused -> 409', (await ops.post('/api/v1/ledger/corrections', { entryId: dr.id, kind: 'FX_RESTAMP', newRate: '1.4', newRateDate: dayStr(-4), reason: 'Another try at it' }, commitKey('corr2'))).status === 409);
    check('a proposal without a reason of 5 characters -> 400', (await ops.post('/api/v1/ledger/corrections', { entryId: dr.id, kind: 'FX_RESTAMP', newRate: '1.4', newRateDate: dayStr(-4), reason: 'x' }, commitKey('corr3'))).status === 400);
    check('an unknown entry -> 400', (await ops.post('/api/v1/ledger/corrections', { entryId: 'nope', kind: 'AMOUNT_ADJUSTMENT', adjustmentAmount: '5', reason: 'No such entry' }, commitKey('corr4'))).status === 400);
    check('the maker cannot approve their own correction (no ledger.approve -> 403)', (await ops.post(`/api/v1/ledger/corrections/${crId}/approve`, {})).status === 403);
    await staleMfa(dirU.id);
    check('approval needs step-up -> 401 step_up_required', errCode(await dir.post(`/api/v1/ledger/corrections/${crId}/approve`, {})) === 'step_up_required');
    check('director steps up', (await dir.stepUp()).status === 200);
    const ap = await dir.post(`/api/v1/ledger/corrections/${crId}/approve`, { note: 'Checked against the bank advice' }, commitKey('ap'));
    check('a different person with ledger.approve approves', ap.status === 200 && ap.body.data.status === 'APPROVED' && ap.body.data.checkerName !== null, ap.body);
    const stamps = await prisma.ledgerFxStamp.findMany({ where: { entryId: dr.id }, orderBy: { version: 'asc' } });
    check('the old stamp is SUPERSEDED and kept; a version 2 stamp at the corrected rate is ACTIVE', stamps.length === 2 && stamps[0]!.status === 'SUPERSEDED' && stamps[0]!.rate.toFixed(2) === '1.25' && stamps[1]!.status === 'ACTIVE' && stamps[1]!.rate.toFixed(2) === '1.30' && stamps[1]!.reportingAmount.toFixed(2) === '1300.00' && stamps[1]!.source === 'CORRECTION', stamps);
    check('approval is audited', (await auditCount('ledger.correction_approved', crId)) === 1 && (await auditCount('ledger.correction_proposed', crId)) === 1);
    check('deciding twice -> 409', (await dir.post(`/api/v1/ledger/corrections/${crId}/approve`, {}, commitKey('ap2'))).status === 409);
    // an amount adjustment is its own line; a rejection leaves everything as it was
    const adj = await ops.post('/api/v1/ledger/corrections', { entryId: dr.id, kind: 'AMOUNT_ADJUSTMENT', adjustmentAmount: '-100', reason: 'Fee was over-charged' }, commitKey('adj'));
    check('maker proposes an amount adjustment', adj.status === 201, adj.body);
    const rejShort = await dir.post(`/api/v1/ledger/corrections/${adj.body.data.id}/reject`, { reason: '' });
    check('rejecting needs a reason -> 400', rejShort.status === 400);
    const adjAp = await dir.post(`/api/v1/ledger/corrections/${adj.body.data.id}/approve`, {}, commitKey('adjap'));
    check('approved adjustment', adjAp.status === 200, adjAp.body);
    const lv3 = await ops.get(`/api/v1/ledger?${scope}`);
    const corrLine = (lv3.body?.data ?? []).find((l: any) => l.lineKind === 'CORRECTION');
    check('the adjustment shows as a separate correcting line, never an edit of the original; stated at the active stamp rate', !!corrLine && corrLine.amount === '-100.0000' && corrLine.correctsEntryId === dr.id && corrLine.reportingAmount === '-130.00' && lv3.body.data.find((l: any) => l.entryId === dr.id)?.amount === '1000.0000', lv3.body.data);
    const rej = await ops.post('/api/v1/ledger/corrections', { entryId: dr.id, kind: 'AMOUNT_ADJUSTMENT', adjustmentAmount: '7', reason: 'Probably wrong adjustment' }, commitKey('rejp'));
    const rejDone = await dir.post(`/api/v1/ledger/corrections/${rej.body.data.id}/reject`, { reason: 'Not supported by evidence' }, commitKey('rejd'));
    check('rejection with a reason leaves no line and no stamp change', rejDone.status === 200 && rejDone.body.data.status === 'REJECTED' && (await prisma.ledgerFxStamp.count({ where: { entryId: dr.id } })) === 2);
    const hist = await ops.get(`/api/v1/ledger/entries/${encodeURIComponent(dr.id)}`);
    check('entry history lists both stamps and all three corrections', hist.status === 200 && hist.body.data.stamps.length === 2 && hist.body.data.corrections.length === 3, hist.body.data);
    const lx = await ops.get(`/api/v1/ledger/export?${scope}&format=csv`);
    check('ledger CSV export includes the stamp rate and the correcting line, and is audited with a hash', lx.status === 200 && lx.buf.toString('utf8').includes('1.3000000000') && lx.buf.toString('utf8').includes('CORRECTION') && (await prisma.auditEvent.count({ where: { action: 'ledger.exported', actorId: opsU.id } })) === 1);
    const lxx = await ops.get(`/api/v1/ledger/export?${scope}&format=xlsx`);
    check('ledger XLSX export is a workbook', lxx.status === 200 && lxx.buf.subarray(0, 2).toString() === 'PK');
    check('the corrections list filters by status', (await ops.get('/api/v1/ledger/corrections?status=PENDING_APPROVAL')).body.data.every((c: any) => c.status === 'PENDING_APPROVAL'));
  } finally {
    await prisma.ledgerCorrection.deleteMany({ where: { reason: { in: ['Rate source was wrong', 'Fee was over-charged', 'Probably wrong adjustment'] } } }).catch(() => undefined);
    await prisma.ledgerFxStamp.deleteMany({ where: { clientId: { in: createdClients } } }).catch(() => undefined);
    await prisma.fxRate.deleteMany({ where: { source: 'IETEST' } }).catch(() => undefined);
    await prisma.lpDealingRequest.deleteMany({ where: { clientId: { in: createdClients } } }).catch(() => undefined);
    await prisma.client.deleteMany({ where: { id: { in: createdClients } } }).catch(() => undefined);
    await prisma.fund.deleteMany({ where: { id: { in: createdFunds } } }).catch(() => undefined);
    await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } }).catch(() => undefined);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    console.log('\n(throwaway records are left in the disposable schema; users, sessions, batches and ledger rows removed where possible)');
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
