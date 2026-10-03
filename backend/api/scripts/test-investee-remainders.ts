/**
 * R4-3 investee remainders against a running API on a disposable DB: staff review of cap table / forecast /
 * governance (idempotent, snapshot-pinned), watermarked share links with e-mail delivery log, reporting sign-off
 * through the native e-sign module (completion hook), consent and requisition notifications.
 *
 *   E2E_CONFIRM=local npx tsx --env-file-if-exists=../../.env scripts/test-investee-remainders.ts
 *
 * The worker is not needed: mail rows are checked as QUEUED or SENT, and the `investee.mail` handler is called directly.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { decryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';
import { deliverInvesteeMail } from '../src/modules/investee-portal/remainders/mail';
import { signRequest } from '../src/modules/esign';

if (process.env.E2E_CONFIRM !== 'local') {
  console.error('Refusing to run: set E2E_CONFIRM=local');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://127.0.0.1:${config.port}`;
const run = randomBytes(3).toString('hex');
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
  }
};

type Res = { status: number; body: any; headers: Headers };
const users = JSON.parse(readFileSync(new URL('../../../secrets/uat-users.json', import.meta.url), 'utf8')) as { email: string; password: string }[];
const pw = (email: string) => users.find((u) => u.email === email)?.password ?? '';

function client(portal: 'admin' | 'company') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: string | FormData, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      if (!pair.slice(eq + 1)) jar.delete(pair.slice(0, eq));
      else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    if (!(res.headers.get('content-type') ?? '').includes('json')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    send(method, path, body === undefined ? undefined : JSON.stringify(body), body === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
  return { call, get: (path: string) => call('GET', path), send };
}

async function signIn(portal: 'admin' | 'company', email: string, loginPortal: string | null = portal) {
  const c = client(portal);
  const login = await c.call('POST', '/api/auth/login', { email, password: pw(email), ...(loginPortal ? { portal: loginPortal } : {}) });
  if (login.body?.mfa === 'verify') {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
    const secret = decryptField(user.mfaFactors[0]?.secretEnc ?? null);
    if (!secret) throw new Error(`no TOTP for ${email}`);
    const verified = await c.call('POST', '/api/auth/mfa/verify', { code: totpNow(secret) });
    check(`${email} signs in`, verified.status === 200, verified.body);
  } else check(`${email} signs in`, login.status === 200, login.body);
  return c;
}

const key = (s: string) => ({ 'Idempotency-Key': `r43-${run}-${s}` });
const d = (r: Res) => r.body?.data ?? r.body;

async function pdfBytes() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]).drawText(`Board paper ${run}`, { x: 40, y: 200, size: 18 });
  return Buffer.from(await doc.save());
}

async function main() {
  const investee = 'investee_102_admin@uat.matanho.test';
  const link = await prisma.companyUser.findFirst({ where: { user: { email: investee }, status: 'active' }, select: { companyId: true } });
  if (!link) throw new Error('investee has no company');
  const companyId = link.companyId;
  const company = await signIn('company', investee, null);
  const staffUser = await prisma.user.findFirst({ where: { roles: { some: { role: { portal: 'admin', permissions: { some: { permission: 'research.edit' } } } } } }, select: { email: true } });
  if (!staffUser || !pw(staffUser.email)) throw new Error('no staff user with research.edit and a known password');
  const staff = await signIn('admin', staffUser.email);
  const R = `/api/v1/ops/investee-review/${companyId}`;

  // ---- staff reads
  const list = await staff.get('/api/v1/ops/investee-review/companies');
  check('company overview lists the company', list.status === 200 && (d(list) as { id: string }[]).some((c) => c.id === companyId), list.body);
  const noStaff = await company.get(`${R}/cap-table`);
  check('a company session cannot open the staff screen', noStaff.status === 401 || noStaff.status === 403, noStaff.status);
  const cap = await staff.get(`${R}/cap-table`);
  check('staff read the cap table with a snapshot hash', cap.status === 200 && /^[0-9a-f]{64}$/.test(d(cap).snapshotSha256) && Array.isArray(d(cap).cap.shareholders), cap.body);
  const fc = await staff.get(`${R}/forecast`);
  const gov = await staff.get(`${R}/governance`);
  check('staff read forecast and governance', fc.status === 200 && gov.status === 200 && Array.isArray(d(gov).consents), [fc.status, gov.status]);

  // ---- review: idempotent, snapshot-pinned
  const body = { area: 'CAP_TABLE', outcome: 'REVIEWED', note: `ok ${run}`, snapshotSha256: d(cap).snapshotSha256 };
  const r1 = await staff.call('POST', `${R}/reviews`, body, key('rev1'));
  const r2 = await staff.call('POST', `${R}/reviews`, body, key('rev2'));
  check('review recorded', r1.status === 201 && d(r1).outcome === 'REVIEWED', r1.body);
  check('the same review of the same data is a no-op', r2.status === 201 && d(r2).id === d(r1).id, r2.body);
  const stale = await staff.call('POST', `${R}/reviews`, { ...body, snapshotSha256: 'f'.repeat(64) }, key('rev3'));
  check('a stale snapshot is refused', stale.status === 409 && (stale.body?.error?.code ?? stale.body?.code) === 'data_changed', stale.body);
  const noNote = await staff.call('POST', `${R}/reviews`, { area: 'FORECAST', outcome: 'QUERIED' }, key('rev4'));
  check('a query needs a note', noNote.status === 400, noNote.body);
  const q = await staff.call('POST', `${R}/reviews`, { area: 'GOVERNANCE', outcome: 'QUERIED', note: `explain ${run}` }, key('rev5'));
  check('a query is recorded and notifies the company', q.status === 201 && (await prisma.outboxEvent.count({ where: { type: 'notify.users', payload: { path: '$.type', equals: 'investee.review_queried' } } })) > 0, q.body);
  const revs = await staff.get(`${R}/reviews`);
  check('latest review shows no change since', d(revs).latest?.CAP_TABLE?.changedSince === false && d(revs).history.length >= 2, revs.body);
  const audited = await prisma.auditEvent.count({ where: { action: 'investee.staff_review.recorded', objectId: d(r1).id } });
  check('the review is audited', audited === 1, audited);

  // ---- share link: watermark + e-mail delivery
  const P = '/api/v1/investee-portal';
  const original = await pdfBytes();
  const pdfForm = new FormData();
  pdfForm.append('file', new Blob([new Uint8Array(original)], { type: 'application/pdf' }), `board-${run}.pdf`);
  pdfForm.append('name', `Board paper ${run}`);
  pdfForm.append('type', 'company');
  const up = await company.send('POST', `${P}/vault`, pdfForm, key('vault-pdf'));
  const pdfDoc = d(up).id as string;
  check('PDF uploaded to the vault', up.status === 201 && !!pdfDoc, up.body);
  const sl = await company.call('POST', `${P}/share-links`, { documentId: pdfDoc, recipient: `Auditor ${run}`, recipientEmail: `auditor-${run}@example.test`, expiresInDays: 2 }, key('share'));
  check('share link created and e-mail queued', sl.status === 201 && d(sl).emailed === true && typeof d(sl).url === 'string', sl.body);
  const logRow = await prisma.investeeMailLog.findFirst({ where: { companyId, kind: 'SHARE_LINK', recipient: `auditor-${run}@example.test` } });
  check('delivery is logged', !!logRow && ['QUEUED', 'SENT'].includes(logRow.status), logRow);
  if (logRow) {
    const event = await prisma.outboxEvent.findFirst({ where: { type: 'investee.mail', payload: { path: '$.logId', equals: logRow.id } } });
    if (event) {
      await deliverInvesteeMail(event.payload);
      await deliverInvesteeMail(event.payload); // a retry after success sends nothing more
      const after = await prisma.investeeMailLog.findUniqueOrThrow({ where: { id: logRow.id } });
      check('adapter send recorded once', after.status === 'SENT' && after.attempts <= 2 && !!after.messageId, after);
    } else check('outbox event exists for the delivery', false);
  }
  const fileUrl = new URL(d(sl).url as string);
  const served = await client('company').send('GET', fileUrl.pathname);
  check('public file is a watermarked PDF', served.status === 200 && (served.headers.get('content-type') ?? '').includes('pdf') && Buffer.isBuffer(served.body) && served.body.length > original.length && !!served.headers.get('x-watermark')?.includes(`Auditor ${run}`), [served.status, served.headers.get('x-watermark')]);
  if (Buffer.isBuffer(served.body)) check('watermarked file is still a valid one-page PDF', (await PDFDocument.load(served.body)).getPageCount() === 1);
  const binForm = new FormData();
  binForm.append('file', new Blob([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], { type: 'application/zip' }), `x-${run}.zip`);
  binForm.append('name', `Zip ${run}`);
  binForm.append('type', 'company');
  const bin = await company.send('POST', `${P}/vault`, binForm, key('vault-zip'));
  if (bin.status === 201) {
    const refused = await company.call('POST', `${P}/share-links`, { documentId: d(bin).id, recipient: `Zip ${run}` }, key('share-zip'));
    check('a format that cannot be watermarked is refused (415)', refused.status === 415, refused.body);
  } else console.log('  SKIP  zip upload refused by the vault itself');

  // ---- reporting sign-off through e-sign
  let period = await prisma.reportingPeriod.findFirst({ where: { companyId, status: 'submitted' }, orderBy: { period: 'desc' } });
  let madePeriod = false;
  if (!period) {
    const stamp = `${2090 + (parseInt(run.slice(0, 2), 16) % 9)}-${String(1 + (parseInt(run.slice(2, 4), 16) % 12)).padStart(2, '0')}`;
    period = await prisma.reportingPeriod.create({ data: { companyId, period: stamp, label: `Test ${stamp}`, dueDate: new Date(), status: 'submitted', submittedAt: new Date(), kpiValues: { totalRevenue: 1000 } } });
    madePeriod = true;
  }
  const open = await prisma.esignRequest.findFirst({ where: { subjectType: 'INVESTEE_REPORT', subjectId: period.id, status: { in: ['DRAFT', 'PENDING'] } } });
  if (open) await prisma.esignRequest.update({ where: { id: open.id }, data: { status: 'VOIDED' } });
  const so = await staff.call('POST', `${R}/signoffs`, { period: period.period }, key('so1'));
  check('sign-off requested through e-sign', so.status === 201 && d(so).status === 'REQUESTED' && /^ESG|^SIG|-/.test(d(so).esignRef), so.body);
  const so2 = await staff.call('POST', `${R}/signoffs`, { period: period.period }, key('so2'));
  check('a second open request for the same period is refused', so2.status === 409, so2.body);
  const signers = await prisma.esignSigner.findMany({ where: { requestId: d(so).esignRequestId } });
  check('signers are the company members with signing authority', signers.length >= 1 && signers.every((s) => s.kind === 'INVESTEE'), signers.length);
  for (const s of signers) {
    await signRequest({ userId: s.userId, name: s.name, role: 'Company', portal: 'company', ip: '127.0.0.1', userAgent: 'test' }, d(so).esignRequestId, s.id, { method: 'SESSION' }, { mode: 'TYPED', typedName: s.name, consent: true });
  }
  const done = await staff.get(`${R}/signoffs`);
  const row = (d(done).signoffs as { id: string; status: string }[]).find((x) => x.id === d(so).id);
  check('completion hook marks the sign-off SIGNED', row?.status === 'SIGNED', done.body);
  const again = await staff.call('POST', `${R}/signoffs`, { period: period.period }, key('so3'));
  check('a signed-off period cannot be requested again', again.status === 409, again.body);

  // ---- consent and requisition notifications
  const before = await prisma.outboxEvent.count({ where: { type: 'notify.permission' } });
  const req = await company.call('POST', `${P}/procurement`, { title: `Rig ${run}`, type: 'Procurement request', category: 'Equipment procurement', currency: 'USD', amount: 1000, priority: 'Low' }, key('req'));
  check('requisition submit notifies staff', req.status === 201 && (await prisma.outboxEvent.count({ where: { type: 'notify.permission' } })) > before, req.body);
  const dec = await staff.call('POST', `/api/v1/ops/investee-requests/${companyId}/${d(req).id}/decide`, { status: 'APPROVED' }, key('dec'));
  const decided = await prisma.outboxEvent.count({ where: { type: 'notify.users', payload: { path: '$.type', equals: 'investee.requisition_decided' } } });
  check('decision notifies the company', dec.status === 200 && decided > 0, dec.body);

  // ---- cleanup
  await prisma.investeeShareLink.deleteMany({ where: { companyId, recipient: { contains: run } } });
  await prisma.investeeMailLog.deleteMany({ where: { companyId, recipient: { contains: run } } });
  await prisma.investeeStaffReview.deleteMany({ where: { companyId, note: { contains: run } } });
  await prisma.investeeRequisition.deleteMany({ where: { companyId, title: { contains: run } } });
  if (madePeriod) {
    await prisma.investeeReportSignoff.deleteMany({ where: { periodId: period.id } });
    await prisma.reportingPeriod.delete({ where: { id: period.id } }).catch(() => undefined);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
