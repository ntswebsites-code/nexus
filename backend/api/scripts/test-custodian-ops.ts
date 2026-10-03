/**
 * WP-7 custodian operations against a RUNNING API (CUSTODIAN_LIVE=true):
 *   bulk CSV upload (validation, control totals, dry run, dedupe), amend, cancel, status history,
 *   day-end declared control totals, frozen executions once a day-end package is approved.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4154 npx tsx scripts/test-custodian-ops.ts
 *
 * Creates a throwaway counterparty and users and removes them at the end; disposable databases only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { parseExecutionCsv } from '../src/modules/custodian/custodian.ops';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const run = randomBytes(3).toString('hex');
const password = `Cx-${randomBytes(9).toString('base64url')}`;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};

type Res = { status: number; body: any };
function client(origin: string) {
  let cookie = '';
  let n = 0;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET' && !h['Idempotency-Key']) h['Idempotency-Key'] = `ops-${run}-${++n}`;
    let payload: FormData | string | undefined;
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
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed };
  };
  return { call, login: (email: string, portal: string) => call('POST', '/api/auth/login', { email, password, portal }, { 'Idempotency-Key': 'login' }) };
}

function csvForm(csv: string, fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('file', new Blob([csv], { type: 'text/csv' }), `executions-${run}.csv`);
  return f;
}

const HEADER = 'tradeRef,executionAt,accountRef,ticker,side,quantity,price,currency,settlementDate,broker';
const when = new Date(Date.now() - 3_600_000).toISOString();
const today = when.slice(0, 10);
const row = (ref: string, over: Partial<Record<string, string>> = {}) =>
  [ref, over.executionAt ?? when, over.accountRef ?? 'OPS-001', over.ticker ?? 'DLTA.ZW', over.side ?? 'BUY', over.quantity ?? '1000', over.price ?? '0.25', over.currency ?? 'USD', over.settlementDate ?? '', over.broker ?? 'IH Securities'].join(',');

async function main() {
  console.log(`API ${API} · run ${run}`);

  // Pure parser checks (no API).
  const parsed = parseExecutionCsv([HEADER, row('P1'), row('P1'), row('P2', { accountRef: 'NOPE' }), row('P3', { quantity: '-4' })].join('\n'), { accounts: ['OPS-001'] });
  check('parser: duplicate ref, foreign account and bad quantity are row errors', parsed.rows.length === 1 && parsed.errors.length === 3 && parsed.errors.every((e) => e.row >= 3), parsed.errors);
  const noHeader = parseExecutionCsv('a,b\n1,2', { accounts: [] });
  check('parser: missing columns are reported', noHeader.fatal && /Missing column/.test(noHeader.errors[0]!.message), noHeader.errors);

  const bcrypt = (await import('bcryptjs')).default;
  const users: string[] = [];
  const mk = async (label: string, role: string) => {
    const u = await prisma.user.create({ data: { email: `cxops-${run}-${label}@example.test`, name: `CX ${label}`, passwordHash: await bcrypt.hash(password, 4) } });
    users.push(u.id);
    const r = await prisma.role.findUniqueOrThrow({ where: { portal_key: { portal: 'custodian', key: role } } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: r.id } });
    return u;
  };
  const cp = await prisma.counterparty.create({ data: { ref: `CPX${run}`, name: `CX Custodian ${run}`, accounts: ['OPS-001'] } });
  const sub = await mk('sub', 'submitter');
  const appr = await mk('appr', 'approver');
  await prisma.counterpartyUser.createMany({
    data: [
      { counterpartyId: cp.id, userId: sub.id, role: 'submitter' },
      { counterpartyId: cp.id, userId: appr.id, role: 'approver' },
    ],
  });
  const origin = config.portalUrls.custodian;
  const s = client(origin);
  const a = client(origin);
  try {
    check('submitter signs in', (await s.login(sub.email, 'custodian')).status === 200);
    check('approver signs in', (await a.login(appr.email, 'custodian')).status === 200);

    // ---- bulk: invalid rows are rejected as a whole and kept as evidence
    const bad = await s.call('POST', '/api/v1/custodian/executions/bulk', csvForm([HEADER, row(`B1-${run}`), row(`B2-${run}`, { accountRef: 'NOPE' })].join('\n')));
    check('bulk: invalid row -> 422 invalid_rows with row number', bad.status === 422 && bad.body?.error?.code === 'invalid_rows' && bad.body.error.details.errors[0].row === 3, bad.body);
    check('bulk: nothing stored for a rejected file', (await prisma.counterpartyExecution.count({ where: { counterpartyId: cp.id } })) === 0);
    check('bulk: rejected batch kept as evidence', (await prisma.custodianExecutionBatch.count({ where: { counterpartyId: cp.id, status: 'Rejected' } })) === 1);

    // ---- bulk: control totals
    const good = [HEADER, row(`B1-${run}`), row(`B2-${run}`, { quantity: '500', price: '0.5' }), row(`B3-${run}`, { side: 'SELL', quantity: '250', price: '0.4' })].join('\n');
    // quantity 1750, notional 250 + 250 + 100 = 600.00
    const wrong = await s.call('POST', '/api/v1/custodian/executions/bulk', csvForm(good, { declaredCount: '3', declaredQuantity: '1700', declaredNotional: '600' }));
    check('bulk: wrong declared quantity -> 422 control_total_mismatch', wrong.status === 422 && wrong.body?.error?.code === 'control_total_mismatch' && wrong.body.error.details.control.quantity.matches === false, wrong.body);
    const dry = await s.call('POST', '/api/v1/custodian/executions/bulk', csvForm(good, { declaredCount: '3', declaredQuantity: '1750', declaredNotional: '600.00', dryRun: 'true' }));
    check('bulk: dry run validates without storing', dry.status === 200 && dry.body.valid === true && dry.body.newCount === 3 && (await prisma.counterpartyExecution.count({ where: { counterpartyId: cp.id } })) === 0, dry.body);
    const ok = await s.call('POST', '/api/v1/custodian/executions/bulk', csvForm(good, { declaredCount: '3', declaredQuantity: '1750', declaredNotional: '600.00' }));
    check('bulk: matching control totals -> 201, three executions, batch OK', ok.status === 201 && ok.body.created.length === 3 && ok.body.batch.controlStatus === 'OK' && ok.body.batch.acceptedCount === 3, ok.body);
    const first = ok.body.created[0];
    check('bulk: executions carry the batch id', ok.body.created.every((e: any) => e.batchId === ok.body.batch.id));
    const again = await s.call('POST', '/api/v1/custodian/executions/bulk', csvForm(good));
    check('bulk: same file again -> 409 duplicate_trade_ref', again.status === 409 && again.body?.error?.code === 'duplicate_trade_ref', again.body);
    const batches = await s.call('GET', '/api/v1/custodian/executions-batches');
    check('bulk: batch list shows accepted and rejected', batches.status === 200 && batches.body.items.length === 2, batches.body);

    // ---- amend
    const amend = await s.call('PATCH', `/api/v1/custodian/executions/${first.id}`, { price: '0.26', reason: 'Broker confirmation corrected the price' });
    check('amend: price changed, back to Received, amendCount 1', amend.status === 200 && amend.body.execution.price.startsWith('0.26') && amend.body.execution.amendCount === 1 && amend.body.changes.price, amend.body);
    const noop = await s.call('PATCH', `/api/v1/custodian/executions/${first.id}`, { price: '0.26', reason: 'No change really' });
    check('amend: unchanged values -> 400', noop.status === 400, noop.body);
    const noReason = await s.call('PATCH', `/api/v1/custodian/executions/${first.id}`, { price: '0.27' });
    check('amend: reason is mandatory', noReason.status === 400, noReason.body);
    const foreign = await s.call('PATCH', `/api/v1/custodian/executions/${first.id}`, { accountRef: 'NOPE', reason: 'Wrong account on purpose' });
    check('amend: account outside the counterparty -> 403', foreign.status === 403, foreign.body);
    const apprAmend = await a.call('PATCH', `/api/v1/custodian/executions/${first.id}`, { price: '0.27', reason: 'Approver has no submit right' });
    check('amend: approver without submit permission -> 403', apprAmend.status === 403, apprAmend.body);

    // ---- cancel
    const second = ok.body.created[1];
    const cancel = await s.call('POST', `/api/v1/custodian/executions/${second.id}/cancel`, { reason: 'Trade busted by the exchange' });
    check('cancel: status Cancelled', cancel.status === 200 && cancel.body.execution.status === 'Cancelled' && cancel.body.execution.amendable === false, cancel.body);
    const recancel = await s.call('POST', `/api/v1/custodian/executions/${second.id}/cancel`, { reason: 'Cancel it twice please' });
    check('cancel: twice -> 409', recancel.status === 409, recancel.body);
    const amendCancelled = await s.call('PATCH', `/api/v1/custodian/executions/${second.id}`, { price: '1', reason: 'Amend after cancel' });
    check('amend after cancel -> 409', amendCancelled.status === 409, amendCancelled.body);

    // ---- matched executions are locked
    const third = ok.body.created[2];
    await prisma.counterpartyExecution.update({ where: { id: third.id }, data: { status: 'Matched' } });
    const lockedAmend = await s.call('PATCH', `/api/v1/custodian/executions/${third.id}`, { price: '0.5', reason: 'Matched already, should fail' });
    const lockedCancel = await s.call('POST', `/api/v1/custodian/executions/${third.id}/cancel`, { reason: 'Matched already, should fail' });
    check('matched execution cannot be amended or cancelled (execution_locked)', lockedAmend.status === 409 && lockedAmend.body?.error?.code === 'execution_locked' && lockedCancel.status === 409, [lockedAmend.body, lockedCancel.body]);

    // ---- history
    const hist = await s.call('GET', `/api/v1/custodian/executions/${first.id}/history`);
    check('history: submitted then amended with the field change', hist.status === 200 && hist.body.events.map((e: any) => e.action).join() === 'submitted,amended' && hist.body.events[1].changes.price.to === '0.26' && hist.body.events[1].reason, hist.body);
    const all = await s.call('GET', '/api/v1/custodian/history?limit=20');
    check('history: counterparty feed has all events with trade refs', all.status === 200 && all.body.items.length >= 5 && all.body.items.every((i: any) => i.tradeRef), all.body);
    const single = await s.call('POST', '/api/v1/custodian/executions', { executions: [{ tradeRef: `S1-${run}`, executionAt: when, accountRef: 'OPS-001', ticker: 'DLTA.ZW', side: 'BUY', quantity: '10', price: '1', currency: 'USD' }] });
    const singleHist = await s.call('GET', `/api/v1/custodian/executions/${single.body.created?.[0]?.id}/history`);
    check('history: single-entry submissions are recorded too', single.status === 201 && singleHist.body.events?.length === 1, singleHist.body);

    // ---- day-end declared control totals
    const dayFields = (over: Record<string, string> = {}) => ({ statementDate: today, accountRef: 'OPS-001', currency: 'USD', closingCash: '1000.00', holdingsMv: '5000.00', tradeCount: '3', ...over });
    const form = (fields: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      f.append('file', new Blob([`%PDF-1.4\n% ${run}\n%%EOF\n`], { type: 'application/pdf' }), 'dayend.pdf');
      return f;
    };
    // Live executions that day in USD, not superseded: B1 (1000 x 0.26), B3 (250 x 0.4, matched) and S1 (10 x 1).
    const liveQty = '1260';
    const liveNotional = (1000 * 0.26 + 250 * 0.4 + 10 * 1).toFixed(2);
    const dBad = await s.call('POST', '/api/v1/custodian/day-end', form(dayFields({ tradeCount: '3', tradeQuantity: '9999', tradeNotional: liveNotional })));
    check('day-end: declared totals are stored', dBad.status === 201 && dBad.body.package.tradeQuantity === '9999.00000000', dBad.body);
    const dBadSubmit = await s.call('POST', `/api/v1/custodian/day-end/${dBad.body.package.id}/submit`, {});
    check('day-end: submit blocked while declared quantity disagrees (control_total_mismatch)', dBadSubmit.status === 409 && dBadSubmit.body?.error?.code === 'control_total_mismatch', dBadSubmit.body);
    await prisma.counterpartyDayEndPackage.delete({ where: { id: dBad.body.package.id } });
    const dGood = await s.call('POST', '/api/v1/custodian/day-end', form(dayFields({ tradeCount: '3', tradeQuantity: liveQty, tradeNotional: liveNotional })));
    const dGoodSubmit = await s.call('POST', `/api/v1/custodian/day-end/${dGood.body.package.id}/submit`, {});
    check('day-end: matching declared totals submit; controls report quantity and notional', dGoodSubmit.status === 200 && dGoodSubmit.body.controls.quantity?.matches === true && dGoodSubmit.body.controls.notional?.matches === true, dGoodSubmit.body);
    const dApprove = await a.call('POST', `/api/v1/custodian/day-end/${dGood.body.package.id}/approve`, {});
    check('day-end: second user approves', dApprove.status === 200 && dApprove.body.package.status === 'Approved', dApprove.body);

    // ---- an approved package freezes the day's executions
    const frozen = await s.call('PATCH', `/api/v1/custodian/executions/${single.body.created[0].id}`, { price: '2', reason: 'Day-end already approved' });
    check('approved day-end freezes executions (execution_locked)', frozen.status === 409 && frozen.body?.error?.code === 'execution_locked', frozen.body);
    const dh = await s.call('GET', `/api/v1/custodian/day-end/${dGood.body.package.id}/history`);
    check('day-end history: created, submitted, approved by your organisation', dh.status === 200 && ['created', 'submitted', 'approved'].every((x) => dh.body.events.some((e: any) => e.action === x)) && dh.body.events.every((e: any) => e.by === 'Your organisation'), dh.body);
  } finally {
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: users } } });
    await prisma.custodianExecutionEvent.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.custodianExecutionBatch.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterpartyExecution.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterpartyDayEndPackage.deleteMany({ where: { counterpartyId: cp.id } });
    await prisma.counterparty.delete({ where: { id: cp.id } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll custodian ops checks passed');
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
