/**
 * WS1 (LP core) checks against a RUNNING API: documents/vault/e-sign, notices (LP + staff lifecycle),
 * requests/messages, dashboard, activity, performance, organisation/colleagues, bank changes,
 * settings, reports. Happy paths vs the mock shapes, IDOR and role negatives, SoD, idempotent replay.
 *
 *   E2E_CONFIRM=throwaway-db E2E_API=http://localhost:4151 npx tsx scripts/test-ws1.ts
 *
 * Creates throwaway users, clients, funds and records (removed at the end); disposable DBs only.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { storeFile } from '../src/lib/storage';
import { encryptField } from '../src/lib/crypto';
import { generateTotpSecret, totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'throwaway-db') {
  console.error('Refusing to run: set E2E_CONFIRM=throwaway-db (this script writes records).');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://localhost:${config.port}`;
const LP = '/api/v1/lp-portal';
const run = randomBytes(3).toString('hex');
const password = `Ws1-${randomBytes(9).toString('base64url')}`;
let failures = 0;
let passes = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 1500));
  }
};

type Res = { status: number; body: any; headers: Headers };

function client(portal: 'investor' | 'admin' = 'investor') {
  const origin = config.portalUrls[portal];
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, init: { body?: string | FormData; headers?: Record<string, string> } = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...(init.headers ?? {}) };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${API}${path}`, { method, headers: h, body: init.body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/max-age=0/i.test(c) || /expires=Thu, 01 Jan 1970/i.test(c) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: buf, headers: res.headers };
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  // The shared idempotency record is completed asynchronously after the response, so an immediate
  // replay can see IN_PROGRESS (documented as retryable); retry like a real client would.
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const once = () =>
      send(method, path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      });
    let res = await once();
    for (let i = 0; i < 10 && res.status === 409 && res.body?.code === 'LP_IDEMPOTENCY_IN_PROGRESS'; i++) {
      await new Promise((r) => setTimeout(r, 300));
      res = await once();
    }
    return res;
  };
  return {
    call,
    get: (path: string) => call('GET', path),
    upload: (path: string, name: string, mime: string, data: Buffer, headers: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: mime }), name);
      return send('POST', path, { body: form, headers });
    },
    login: (email: string, pw = password) => call('POST', '/api/auth/login', { email, password: pw, portal }),
  };
}

const pdf = (label: string) => Buffer.from(`%PDF-1.4\n% WS1 test ${label}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`);
const key = (s: string) => ({ 'Idempotency-Key': `ws1-${run}-${s}` });

async function main() {
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(password, 4);
  const role = (portal: string, k: string) => prisma.role.findUniqueOrThrow({ where: { portal_key: { portal, key: k } } });

  const created = { users: [] as string[], clients: [] as string[], funds: [] as string[], docs: [] as string[], files: [] as string[], notices: [] as string[], emails: [] as string[] };

  const fund = await prisma.fund.create({
    data: { ref: `W1F${run}`, name: `WS1 Growth Fund ${run}`, shortName: 'WS1G', currency: 'USD', asOfDate: new Date('2026-06-30'), valuationStatus: 'FINAL' },
  });
  const fund2 = await prisma.fund.create({
    data: { ref: `W1G${run}`, name: `WS1 Credit Fund ${run}`, shortName: 'WS1C', currency: 'USD', asOfDate: new Date('2026-06-30'), valuationStatus: 'FINAL' },
  });
  created.funds.push(fund.id, fund2.id);
  const mkClient = (s: string) => prisma.client.create({ data: { ref: `W1${run}${s}`, name: `WS1 Client ${s} ${run}`, type: 'Pension fund', portalEnabled: true } });
  const a = await mkClient('A');
  const b = await mkClient('B');
  created.clients.push(a.id, b.id);
  const metrics = { nav: '1200000', netIrr: '0.1530', tvpi: '1.3500', dpi: '0.2000', rvpi: '1.1500' };
  const cA = await prisma.fundCommitment.create({ data: { clientId: a.id, fundId: fund.id, commitmentAmount: '1000000.00', investorAccountRef: 'ACC-A', metricsJson: metrics } });
  await prisma.fundCommitment.create({ data: { clientId: a.id, fundId: fund2.id, commitmentAmount: '500000.00', metricsJson: { nav: '300000', paidIn: '250000' } } });
  const cB = await prisma.fundCommitment.create({ data: { clientId: b.id, fundId: fund.id, commitmentAmount: '250000.00' } });

  const mkUser = async (label: string, clientId: string | null, portal: string, roleKey: string) => {
    const email = `ws1-${run}-${label}@example.test`;
    const user = await prisma.user.create({ data: { email, name: `WS1 ${label}`, passwordHash: hash } });
    created.users.push(user.id);
    await prisma.userRole.create({ data: { userId: user.id, roleId: (await role(portal, roleKey)).id } });
    if (clientId) await prisma.clientUser.create({ data: { userId: user.id, clientId, investorRole: roleKey } });
    return user;
  };
  const mgrA = await mkUser('mgr', a.id, 'investor', 'admin');
  const sigA = await mkUser('sig', a.id, 'investor', 'finance');
  const viewA = await mkUser('viewer', a.id, 'investor', 'investment');
  const sigB = await mkUser('sigb', b.id, 'investor', 'finance');
  const staff1 = await mkUser('cs', null, 'admin', 'client_services');
  const staff2 = await mkUser('comp', null, 'admin', 'compliance');

  // Documents: a report for A (fund), a signature-required doc for A, a report for B.
  const mkDoc = async (clientId: string, name: string, type: string, fundId: string | null, sign = false) => {
    const file = await storeFile({ name: `${name}.pdf`, mime: 'application/pdf', data: pdf(name) });
    created.files.push(file.id);
    const d = await prisma.document.create({
      data: {
        ref: `W1D${run}${created.docs.length}`,
        name,
        type,
        status: 'Published',
        classification: 'Client',
        clientId,
        fundId,
        period: '2026-Q2',
        requiresSignature: sign,
        versions: { create: { version: 1, fileId: file.id, sha256: file.sha256 } },
        publications: { create: { clientId } },
      },
    });
    created.docs.push(d.id);
    if (sign) await prisma.signatureRequest.create({ data: { documentId: d.id, clientId, status: 'Pending' } });
    return { d, file };
  };
  const docA = await mkDoc(a.id, `Q2 report ${run}`, 'report', fund.id);
  const signA = await mkDoc(a.id, `Side letter ${run}`, 'legal', null, true);
  const docB = await mkDoc(b.id, `B report ${run}`, 'report', fund.id);

  // Capital: an issued call (A part-paid), a paid distribution.
  const call = await prisma.capitalCall.create({
    data: { ref: `W1C${run}`, fundId: fund.id, callNo: 7, totalAmount: '125000', dueDate: new Date('2026-12-31'), status: 'ISSUED', issuedAt: new Date('2026-06-01') },
  });
  const allocA = await prisma.capitalCallAllocation.create({
    data: { callId: call.id, clientId: a.id, commitmentId: cA.id, lpLegalNameSnapshot: a.name, totalCommitmentSnapshot: '1000000', uncalledBeforeSnapshot: '1000000', callAmount: '100000', amountPaid: '40000', status: 'PARTIALLY_PAID' },
  });
  const allocB = await prisma.capitalCallAllocation.create({
    data: { callId: call.id, clientId: b.id, commitmentId: cB.id, lpLegalNameSnapshot: b.name, totalCommitmentSnapshot: '250000', uncalledBeforeSnapshot: '250000', callAmount: '25000' },
  });
  await prisma.capitalCallPayment.create({ data: { allocationId: allocA.id, amount: '40000', recordedById: staff1.id, recordedAt: new Date('2026-06-10') } });
  const dist = await prisma.distribution.create({
    data: { ref: `W1X${run}`, fundId: fund.id, distributionDate: new Date('2026-06-20'), type: 'DIVIDEND', grossAmount: '60000', netToLps: '60000', status: 'PAID', issuedAt: new Date('2026-06-20') },
  });
  await prisma.distributionAllocation.create({
    data: { distributionId: dist.id, clientId: a.id, commitmentId: cA.id, lpLegalNameSnapshot: a.name, commitmentSnapshot: '1000000', shareAmount: '50000', amountPaid: '50000', status: 'PAID', paidAt: new Date('2026-06-21') },
  });

  try {
    const m = client();
    const s = client();
    const v = client();
    const ob = client();
    const cs = client('admin');
    const co = client('admin');
    check('LP users sign in', [await m.login(mgrA.email), await s.login(sigA.email), await v.login(viewA.email), await ob.login(sigB.email)].every((r) => r.status === 200));
    check('staff sign in', [await cs.login(staff1.email), await co.login(staff2.email)].every((r) => r.status === 200));

    // ── Documents ─────────────────────────────────────────────────────────
    console.log('\nDocuments & vault');
    const docs = await v.get(`${LP}/documents`);
    const items: any[] = docs.body?.data?.items ?? [];
    check('documents list is a contract list', docs.status === 200 && typeof docs.body?.data?.total === 'number' && docs.body?.data?.page === 1, docs.body);
    check('documents list holds only own client docs', items.length === 2 && items.every((d) => d.id !== docB.d.id), items.map((d) => d.id));
    const rep = items.find((d) => d.id === docA.d.id);
    check(
      'document shape (category, version, checksum, mime, fund)',
      rep?.category === 'PERFORMANCE_REPORT' && rep?.version === '1.0' && rep?.checksumSha256 === docA.file.sha256 && rep?.mimeType === 'application/pdf' && rep?.fundName === fund.name && rep?.publishedDate?.length === 10,
      rep,
    );
    check('signature doc status REQUIRES_SIGNATURE', items.find((d) => d.id === signA.d.id)?.status === 'REQUIRES_SIGNATURE', items);
    const filtered = await v.get(`${LP}/documents?category=LEGAL`);
    check('category filter', filtered.body?.data?.items?.length === 1, filtered.body);
    const sum = await v.get(`${LP}/documents/summary`);
    check('documents summary', sum.body?.data?.total === 2 && sum.body?.data?.requiresSignature === 1 && Array.isArray(sum.body?.data?.byCategory), sum.body);
    const detail = await v.get(`${LP}/documents/${docA.d.id}`);
    check('document detail with access history', detail.status === 200 && Array.isArray(detail.body?.data?.history) && detail.body.data.history.length >= 1, detail.body);
    const dl = await v.get(`${LP}/documents/${docA.d.id}/download`);
    check('download streams the PDF bytes', dl.status === 200 && dl.headers.get('content-type') === 'application/pdf' && Buffer.isBuffer(dl.body) && dl.body.subarray(0, 4).toString() === '%PDF', dl.status);
    const logs = await prisma.documentAccessLog.count({ where: { documentId: docA.d.id, action: 'DOWNLOAD', userId: viewA.id } });
    check('download logged in document_access_log', logs === 1, logs);
    const pv = await v.get(`${LP}/documents/${docA.d.id}/preview`);
    check('preview inline for PDF', pv.status === 200 && /inline/.test(pv.headers.get('content-disposition') ?? ''), pv.status);
    const url = await v.get(`${LP}/documents/${docA.d.id}/download?format=url`);
    check('signed download URL variant', url.status === 200 && typeof url.body?.data?.url === 'string' && url.body.data.expiresIn === 300, url.body);
    const idor = await v.get(`${LP}/documents/${docB.d.id}`);
    check('IDOR: other client document -> 404 LP_NOT_FOUND', idor.status === 404 && idor.body?.code === 'LP_NOT_FOUND', idor.body);
    const idorDl = await v.get(`${LP}/documents/${docB.d.id}/download`);
    check('IDOR: other client download -> 404', idorDl.status === 404, idorDl.status);
    const vault = await v.get(`${LP}/vault`);
    check('vault is a bare array with sha256', Array.isArray(vault.body?.data) && vault.body.data.length === 2 && vault.body.data.every((x: any) => x.sha256?.length === 64), vault.body);
    const ver = await v.get(`${LP}/vault/${docA.d.id}/verify`);
    check('vault verify sha256', ver.body?.data?.verified === true && ver.body.data.actualSha256 === docA.file.sha256, ver.body);
    const verB = await v.get(`${LP}/vault/${docB.d.id}/verify`);
    check('IDOR: vault verify other client -> 404', verB.status === 404, verB.body);
    const vSign = await v.call('POST', `${LP}/documents/${signA.d.id}/sign`, { name: 'WS1 viewer', authority: 'Director', consent: true });
    check('VIEWER cannot sign -> 403', vSign.status === 403 && vSign.body?.code === 'LP_FORBIDDEN', vSign.body);
    const noConsent = await s.call('POST', `${LP}/documents/${signA.d.id}/sign`, { name: 'WS1 sig', authority: 'CFO' });
    check('sign without consent -> 400 fieldErrors.consent', noConsent.status === 400 && noConsent.body?.fieldErrors?.consent, noConsent.body);
    const signed = await s.call('POST', `${LP}/documents/${signA.d.id}/sign`, { name: 'WS1 sig', authority: 'CFO', consent: true }, key('sign'));
    check('signatory signs (Signature + consent hash)', signed.status === 201 && signed.body?.data?.status === 'SIGNED' && signed.body.data.docSha256 === signA.file.sha256, signed.body);
    const sigRow = await prisma.signature.findFirst({ where: { signerUserId: sigA.id } });
    check('signature row captures consent fields', !!sigRow?.consentHash && !!sigRow?.consentTextVersion && sigRow?.sessionId !== null, sigRow);
    const signedReplay = await s.call('POST', `${LP}/documents/${signA.d.id}/sign`, { name: 'WS1 sig', authority: 'CFO', consent: true }, key('sign'));
    check('sign replay is idempotent', signedReplay.status === 201 && signedReplay.headers.get('idempotent-replayed') === 'true' && signedReplay.body?.data?.signatureId === signed.body?.data?.signatureId, signedReplay.body);

    // ── Notices ───────────────────────────────────────────────────────────
    console.log('\nNotices (staff lifecycle + LP)');
    const lpOps = await m.get('/api/v1/ops/notices');
    check('LP user cannot reach staff notices', lpOps.status === 403, lpOps.body);
    const draft = await cs.call('POST', '/api/v1/ops/notices', {
      title: `Capital call #7 ${run}`,
      body: 'Please acknowledge this notice.',
      category: 'CAPITAL_CALL',
      targetType: 'ORG',
      clientId: a.id,
      requiresAcknowledgement: true,
    });
    const notice = draft.body?.notice;
    if (notice?.id) created.notices.push(notice.id);
    check('staff creates DRAFT notice with NTC- ref', draft.status === 201 && notice?.status === 'DRAFT' && /^NTC-\d{5}$/.test(notice?.ref), draft.body);
    const bad = await cs.call('POST', '/api/v1/ops/notices', { title: 'Fund notice', body: 'x', targetType: 'FUND' });
    check('FUND notice without fundId -> 400', bad.status === 400, bad.body);
    const early = await co.call('POST', `/api/v1/ops/notices/${notice.id}/approve`);
    check('approve before submit -> 409', early.status === 409, early.body);
    const sub = await cs.call('POST', `/api/v1/ops/notices/${notice.id}/submit`);
    check('submit -> PENDING_APPROVAL', sub.body?.notice?.status === 'PENDING_APPROVAL', sub.body);
    const sod = await cs.call('POST', `/api/v1/ops/notices/${notice.id}/approve`);
    check('SoD: creator cannot approve -> 403 segregation_of_duties', sod.status === 403 && sod.body?.error?.code === 'segregation_of_duties', sod.body);
    const appr = await co.call('POST', `/api/v1/ops/notices/${notice.id}/approve`);
    check('second person approves -> APPROVED', appr.body?.notice?.status === 'APPROVED' && appr.body.notice.approvedById === staff2.id, appr.body);
    const pub = await co.call('POST', `/api/v1/ops/notices/${notice.id}/publish`);
    check('publish -> PUBLISHED with receipts for client A members', pub.body?.notice?.status === 'PUBLISHED' && pub.body.notice.recipients === 3, pub.body);
    const outbox = await prisma.outboxEvent.count({ where: { type: 'notify.users', payload: { path: '$.link', equals: `/lp-portal/notices?id=${notice.id}` } } });
    check('publish enqueues LP notifications', outbox === 1, outbox);
    const staffList = await co.get('/api/v1/ops/notices?status=PUBLISHED');
    check('staff list notices', staffList.status === 200 && staffList.body?.data?.some((n: any) => n.id === notice.id), staffList.body);

    const vn = await v.get(`${LP}/notices`);
    const ln = vn.body?.data?.items?.find((n: any) => n.id === notice.id);
    check('LP sees published notice (unread)', ln && ln.status === 'PUBLISHED' && ln.acknowledgedAt === null && ln.requiresAcknowledgement === true && ln.category === 'CAPITAL_CALL', vn.body);
    const sessBefore = await v.get(`${LP}/session`);
    check('session unread notices counts it', sessBefore.body?.data?.unreadCounts?.notices >= 1, sessBefore.body?.data?.unreadCounts);
    const bn = await ob.get(`${LP}/notices`);
    check('IDOR: client B does not see A notice', !bn.body?.data?.items?.some((n: any) => n.id === notice.id), bn.body);
    const bnd = await ob.get(`${LP}/notices/${notice.id}`);
    check('IDOR: client B notice detail -> 404', bnd.status === 404 && bnd.body?.code === 'LP_NOT_FOUND', bnd.body);
    const opened = await v.get(`${LP}/notices/${notice.id}`);
    check('detail records openedAt (status OPENED) with body', opened.body?.data?.status === 'OPENED' && !!opened.body.data.openedAt && opened.body.data.body?.length > 0, opened.body);
    const vAck = await v.call('POST', `${LP}/notices/${notice.id}/acknowledge`, {}, key('vack'));
    check('VIEWER cannot acknowledge -> 403', vAck.status === 403 && /lp\.notices\.acknowledge/.test(vAck.body?.message), vAck.body);
    const ack = await s.call('POST', `${LP}/notices/${notice.id}/acknowledge`, {}, key('ack'));
    check('signatory acknowledges', ack.status === 200 && !!ack.body?.data?.acknowledgedAt, ack.body);
    const ackReplay = await s.call('POST', `${LP}/notices/${notice.id}/acknowledge`, {}, key('ack'));
    check('acknowledge replay -> Idempotent-Replayed', ackReplay.status === 200 && ackReplay.headers.get('idempotent-replayed') === 'true' && ackReplay.body?.data?.acknowledgedAt === ack.body?.data?.acknowledgedAt, ackReplay.body);
    const rec = await co.get(`/api/v1/ops/notices/${notice.id}/receipts`);
    check('receipts show delivered/opened/acknowledged', rec.body?.summary?.delivered === 3 && rec.body.summary.opened === 2 && rec.body.summary.acknowledged === 1, rec.body?.summary);
    const wd = await co.call('POST', `/api/v1/ops/notices/${notice.id}/withdraw`, { reason: 'test' });
    check('withdraw -> WITHDRAWN and hidden from LP', wd.body?.notice?.status === 'WITHDRAWN' && (await v.get(`${LP}/notices/${notice.id}`)).status === 404, wd.body);

    // ── Requests & messages ───────────────────────────────────────────────
    console.log('\nRequests & messages');
    const att = await s.upload(`${LP}/requests/attachments`, 'evidence.pdf', 'application/pdf', pdf('att'));
    check('attachment upload 201', att.status === 201 && /^att_[0-9a-f]{16}$/.test(att.body?.data?.id) && att.body.data.size > 0 && !!att.body.data.uploadedAt, att.body);
    const badMime = await s.upload(`${LP}/requests/attachments`, 'run.exe', 'application/x-msdownload', Buffer.from('MZ'));
    check('disallowed attachment type -> 415 LP_UNSUPPORTED_MEDIA', badMime.status === 415 && badMime.body?.code === 'LP_UNSUPPORTED_MEDIA', badMime.body);
    const vReq = await v.call('POST', `${LP}/requests`, { type: 'DOCUMENT_REQUEST', subject: 'x' });
    check('VIEWER cannot create request -> 403', vReq.status === 403, vReq.body);
    const noSubj = await s.call('POST', `${LP}/requests`, { type: 'GENERAL', description: 'x' });
    check('missing subject -> 400 fieldErrors.subject', noSubj.status === 400 && noSubj.body?.fieldErrors?.subject === 'Required', noSubj.body);
    const badAtt = await ob.call('POST', `${LP}/requests`, { subject: 'steal', attachmentIds: [att.body?.data?.id] });
    check('IDOR: other client attachment id -> 400 invalid attachmentIds', badAtt.status === 400 && badAtt.body?.fieldErrors?.attachmentIds, badAtt.body);
    const reqBody = { type: 'TAX_DOCUMENT', fundId: fund.id, subject: `Need W-8 ${run}`, description: 'Please send the tax pack.', priority: 'HIGH', attachmentIds: [att.body?.data?.id] };
    const created1 = await s.call('POST', `${LP}/requests`, reqBody, key('req'));
    const r1 = created1.body?.data;
    check(
      'create request -> SUBMITTED with REQ- reference, attachment, first message',
      created1.status === 201 && r1?.status === 'SUBMITTED' && /^REQ-/.test(r1?.reference) && r1?.attachments?.length === 1 && r1?.messages?.[0]?.authorType === 'INVESTOR' && r1?.priority === 'HIGH' && r1?.fundName === fund.name,
      created1.body,
    );
    const replay = await s.call('POST', `${LP}/requests`, reqBody, key('req'));
    check('create replay -> same request, Idempotent-Replayed', replay.status === 201 && replay.headers.get('idempotent-replayed') === 'true' && replay.body?.data?.id === r1?.id, replay.body);
    const reused = await s.call('POST', `${LP}/requests`, { ...reqBody, subject: 'different' }, key('req'));
    check('key reused with another body -> 409', reused.status === 409 && reused.body?.code === 'LP_IDEMPOTENCY_KEY_REUSED', reused.body);
    const list = await v.get(`${LP}/requests`);
    check('requests list (viewer can view)', list.body?.data?.items?.some((x: any) => x.reference === r1?.reference), list.body);
    const bReq = await ob.get(`${LP}/requests/${r1?.reference}`);
    check('IDOR: client B request detail -> 404', bReq.status === 404 && bReq.body?.code === 'LP_NOT_FOUND', bReq.body);
    const bReply = await ob.call('POST', `${LP}/requests/${r1?.reference}/messages`, { body: 'hi' });
    check('IDOR: client B reply -> 404', bReply.status === 404, bReply.body);
    const staffQueue = await cs.get(`/api/v1/service-requests?clientId=${a.ref}`);
    check('LP request appears in staff queue', staffQueue.body?.data?.some((x: any) => x.id === r1?.reference), staffQueue.body);
    const patch = await cs.call('PATCH', `/api/v1/service-requests/${r1?.reference}`, { status: 'Waiting on you', note: 'Please confirm your tax residency.' });
    check('staff moves request to Waiting on you', patch.status === 200, patch.body);
    const afterStaff = await s.get(`${LP}/requests/${r1?.reference}`);
    check(
      'LP sees AWAITING_INVESTOR + staff note as INTERNAL message',
      afterStaff.body?.data?.status === 'AWAITING_INVESTOR' && afterStaff.body.data.messages.some((x: any) => x.authorType === 'INTERNAL' && /tax residency/.test(x.body)),
      afterStaff.body,
    );
    const vReply = await v.call('POST', `${LP}/requests/${r1?.reference}/messages`, { body: 'viewer' });
    check('VIEWER cannot reply -> 403', vReply.status === 403, vReply.body);
    const reply = await s.call('POST', `${LP}/requests/${r1?.reference}/messages`, { body: 'Resident in Zimbabwe.' });
    check('LP reply 201 INVESTOR', reply.status === 201 && reply.body?.data?.authorType === 'INVESTOR', reply.body);
    const afterReply = await s.get(`${LP}/requests/${r1?.reference}`);
    check('reply moves request to UNDER_REVIEW', afterReply.body?.data?.status === 'UNDER_REVIEW', afterReply.body?.data?.status);

    const threads = await v.get(`${LP}/messages`);
    const th = threads.body?.data?.items?.find((t: any) => t.relatedId === r1?.reference);
    check('request thread listed (relatedType REQUEST)', th?.relatedType === 'REQUEST' && th.unreadCount === 0, threads.body);
    const staffMsg = await cs.call('POST', `/api/v1/message-threads/${th?.id}/messages`, { text: 'Thanks, received.' });
    check('staff replies in thread', staffMsg.status === 200, staffMsg.body);
    const threads2 = await v.get(`${LP}/messages`);
    check('LP thread shows 1 unread', threads2.body?.data?.items?.find((t: any) => t.id === th?.id)?.unreadCount === 1, threads2.body);
    const tdet = await v.get(`${LP}/messages/${th?.id}`);
    check('thread detail participants + INTERNAL message unread', tdet.body?.data?.participants?.length >= 2 && tdet.body.data.messages.some((x: any) => x.authorType === 'INTERNAL' && x.readAt === null), tdet.body);
    const read = await v.call('POST', `${LP}/messages/${th?.id}/read`, {});
    check('mark read (viewer allowed)', read.body?.data?.markedRead === 1, read.body);
    const bThread = await ob.get(`${LP}/messages/${th?.id}`);
    check('IDOR: client B thread -> 404', bThread.status === 404 && bThread.body?.code === 'LP_NOT_FOUND', bThread.body);
    const bThreadReply = await ob.call('POST', `${LP}/messages/${th?.id}/replies`, { body: 'x' });
    check('IDOR: client B thread reply -> 404', bThreadReply.status === 404, bThreadReply.body);
    const vThreadReply = await v.call('POST', `${LP}/messages/${th?.id}/replies`, { body: 'x' });
    check('VIEWER thread reply -> 403', vThreadReply.status === 403, vThreadReply.body);
    const tReply = await s.call('POST', `${LP}/messages/${th?.id}/replies`, { body: 'One more thing.' });
    check('signatory thread reply 201', tReply.status === 201 && tReply.body?.data?.authorType === 'INVESTOR', tReply.body);
    const attDl = await s.get(`${LP}/requests/attachments/${att.body?.data?.id}/download`);
    check('attachment download (own client)', attDl.status === 200 && Buffer.isBuffer(attDl.body), attDl.status);
    const attDlB = await ob.get(`${LP}/requests/attachments/${att.body?.data?.id}/download`);
    check('IDOR: attachment download other client -> 404', attDlB.status === 404, attDlB.body);

    // ── Dashboard / activity / performance / reports ───────────────────────
    console.log('\nDashboard, activity, performance, reports');
    const dash = await m.get(`${LP}/dashboard`);
    const k = dash.body?.data?.kpis;
    check(
      'dashboard KPIs from commitments + issued capital',
      dash.status === 200 && k?.totalCommitment === '1500000.00' && k?.called === '350000.00' && k?.paidIn === '290000.00' && k?.distributions === '50000.00' && k?.investmentCount === 2 && k?.unfunded === '1150000.00',
      k,
    );
    check('dashboard multiples recomputed, IRR null for multi-fund', k?.netIrr === null && k?.tvpi === '5.3448' && dash.body?.data?.asOfDate === '2026-06-30', k);
    const dashF = await m.get(`${LP}/dashboard?fundId=${fund.id}`);
    check('single-fund dashboard uses stored IRR', dashF.body?.data?.kpis?.netIrr === '0.1530', dashF.body?.data?.kpis);
    const acts = await m.get(`${LP}/dashboard/actions`);
    const types = (acts.body?.data?.items ?? []).map((x: any) => x.type);
    check('actions include capital call', types.includes('CAPITAL_CALL'), acts.body);
    const recent = await m.get(`${LP}/dashboard/activity/recent?limit=5`);
    check('recent activity items (<= limit, desc)', Array.isArray(recent.body?.data?.items) && recent.body.data.items.length <= 5 && recent.body.data.items.length > 0, recent.body);
    const actv = await m.get(`${LP}/account-activity`);
    const etypes = new Set((actv.body?.data?.items ?? []).map((x: any) => x.entryType));
    check('account activity union', ['CAPITAL_CALL', 'CAPITAL_CALL_PAYMENT', 'DISTRIBUTION', 'DISTRIBUTION_PAYMENT'].every((t) => etypes.has(t)) && actv.body.data.total === 4, actv.body);
    const actvB = await ob.get(`${LP}/account-activity`);
    check('client B activity excludes A allocations', (actvB.body?.data?.items ?? []).every((x: any) => x.entryId !== allocA.id), actvB.body);
    const csv = await v.get(`${LP}/account-activity/export`);
    check('CSV export', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type') ?? '') && csv.body.toString().startsWith('entryId,transactionDate'), csv.status);
    const led = await m.get(`${LP}/ledger/${allocA.id}`);
    check('ledger entry detail', led.body?.data?.entryType === 'CAPITAL_CALL' && led.body.data.allocation?.amountPaid === '40000.00' && led.body.data.payments.length === 1, led.body);
    const ledB = await m.get(`${LP}/ledger/${allocB.id}`);
    check('IDOR: other client ledger entry -> 404', ledB.status === 404 && ledB.body?.code === 'LP_NOT_FOUND', ledB.body);
    const foreignFund = await ob.get(`${LP}/account-activity?fundId=${fund2.id}`);
    check('out-of-scope fundId -> 404', foreignFund.status === 404, foreignFund.body);
    const perf = await m.get(`${LP}/performance`);
    check('performance metrics + byFund', perf.body?.data?.metrics?.paidIn === '290000.00' && perf.body.data.byFund?.length === 2, perf.body);
    const hist = await m.get(`${LP}/performance/history`);
    check('performance history points end at Now', hist.body?.data?.points?.at(-1)?.label === 'Now', hist.body);
    const bench = await m.get(`${LP}/performance/benchmarks`);
    check('benchmarks unconfigured, honest note', bench.body?.data?.configured === false && bench.body.data.series.length === 0 && typeof bench.body.data.note === 'string', bench.body);
    const job = await m.call('POST', `${LP}/jobs/performance-report`, { period: 'SI' }, key('job'));
    check('performance job 202 COMPLETED', job.status === 202 && job.body?.data?.status === 'COMPLETED' && typeof job.body?.data?.downloadUrl === 'string', job.body);
    const jobGet = await m.get(`${LP}/jobs/${job.body?.data?.jobId}`);
    check('job detail carries result', jobGet.body?.data?.result?.metrics?.paidIn === '290000.00' && jobGet.body?.data?.status === 'COMPLETED', jobGet.body);
    const reportPdf = await m.get(`${LP}/reports/${job.body?.data?.jobId}/download`);
    check('performance report downloads as PDF', reportPdf.status === 200 && /pdf/.test(reportPdf.headers.get('content-type') ?? '') && reportPdf.body.toString('latin1').startsWith('%PDF') && reportPdf.body.toString('latin1').includes('Paid in'), reportPdf.status);
    const reportPdfB = await ob.get(`${LP}/reports/${job.body?.data?.jobId}/download`);
    check('IDOR: other client report download -> 404', reportPdfB.status === 404, reportPdfB.status);
    const jobB = await ob.get(`${LP}/jobs/${job.body?.data?.jobId}`);
    check('IDOR: other client job -> 404', jobB.status === 404, jobB.body);
    const reports = await m.get(`${LP}/reports`);
    check('reports list from published report docs', reports.body?.data?.data?.some((r: any) => r.jobId === docA.d.id) && reports.body.data.pagination?.total === 1, reports.body);
    const notif = await m.get(`${LP}/notifications`);
    check('notifications feed', notif.status === 200 && Array.isArray(notif.body?.data?.items), notif.body);
    const rt = await m.get(`${LP}/realtime`);
    // Realtime is now live: an SSE stream (streamUrl) with a 15s polling fallback and a change cursor (WP: LP realtime).
    check('realtime info: SSE stream plus polling fallback', rt.body?.data?.enabled === true && typeof rt.body.data.streamUrl === 'string' && rt.body.data.streamUrl.endsWith('/realtime/stream') && rt.body.data.pollingIntervalMs === 15000 && Array.isArray(rt.body.data.changes) && !!rt.body.data.cursor, rt.body);

    // ── Settings ──────────────────────────────────────────────────────────
    console.log('\nSettings');
    const st = await v.get(`${LP}/settings`);
    check('settings shape (10 booleans, digest, mfa)', st.body?.data?.notifications?.emailNotices === true && st.body.data.notifications.digest === 'weekly' && st.body.data.mfa?.enabled === false, st.body);
    const pn = await v.call('PATCH', `${LP}/settings/notifications`, { emailDocuments: false, digest: 'daily' });
    check('viewer updates own notification prefs', pn.body?.data?.emailDocuments === false && pn.body.data.digest === 'daily', pn.body);
    const pnBad = await v.call('PATCH', `${LP}/settings/notifications`, { emailDocuments: 'nope' });
    check('invalid pref -> 400', pnBad.status === 400 && pnBad.body?.fieldErrors?.emailDocuments, pnBad.body);
    const pd = await v.call('PATCH', `${LP}/settings/display`, { presentationCurrency: 'ZIG' });
    check('display prefs saved', pd.body?.data?.presentationCurrency === 'ZIG' && (await v.get(`${LP}/settings`)).body?.data?.presentationCurrency === 'ZIG', pd.body);
    check('prefs are per user', (await m.get(`${LP}/settings`)).body?.data?.notifications?.emailDocuments === true);

    // ── Organisation, colleagues, bank changes ────────────────────────────
    console.log('\nOrganisation & colleagues');
    const org = await m.get(`${LP}/organisation`);
    check('organisation (manager sees colleagues)', org.body?.data?.investorId === a.ref && org.body.data.colleagues.length === 3, org.body);
    check('organisation (viewer sees no colleagues)', (await v.get(`${LP}/organisation`)).body?.data?.colleagues?.length === 0);
    const vInv = await v.call('POST', `${LP}/colleagues`, { email: `x-${run}@example.test`, role: 'VIEWER' });
    check('VIEWER invite -> 403', vInv.status === 403 && vInv.body?.code === 'LP_FORBIDDEN', vInv.body);
    const sInv = await s.call('POST', `${LP}/colleagues`, { email: `x-${run}@example.test`, role: 'VIEWER' });
    check('SIGNATORY invite -> 403', sInv.status === 403, sInv.body);
    const mgrInv = await m.call('POST', `${LP}/colleagues`, { email: `x-${run}@example.test`, role: 'MANAGER' });
    check('invite MANAGER -> 403', mgrInv.status === 403 && /MANAGER/.test(mgrInv.body?.message), mgrInv.body);
    const dup = await m.call('POST', `${LP}/colleagues`, { email: viewA.email, role: 'VIEWER' });
    check('invite active member -> 409', dup.status === 409, dup.body);
    const scopeBad = await ob.call('GET', `${LP}/colleagues`);
    check('client B colleagues exclude A', (scopeBad.body?.data ?? []).every((c: any) => c.userId !== viewA.id), scopeBad.body);
    const newEmail = `ws1-${run}-invitee@example.test`;
    created.emails.push(newEmail);
    const inv = await m.call('POST', `${LP}/colleagues`, { email: newEmail, role: 'VIEWER', fundIds: [fund.id] }, key('inv'));
    check('manager invites VIEWER scoped to one fund', inv.status === 201 && inv.body?.data?.status === 'INVITED' && inv.body.data.fundIds?.[0] === fund.id, inv.body);
    const invReplay = await m.call('POST', `${LP}/colleagues`, { email: newEmail, role: 'VIEWER', fundIds: [fund.id] }, key('inv'));
    check('invite replay -> same invitation', invReplay.headers.get('idempotent-replayed') === 'true' && invReplay.body?.data?.id === inv.body?.data?.id, invReplay.body);
    const evt = await prisma.outboxEvent.findFirst({ where: { type: 'email.send', payload: { path: '$.to', equals: newEmail } }, orderBy: { createdAt: 'desc' } });
    const token = /token=([^\s&]+)/.exec(String((evt?.payload as any)?.text ?? ''))?.[1];
    check('invitation email queued (token not logged)', !!token);
    const invitee = client();
    const acc = await invitee.call('POST', '/api/auth/invitations/accept', { token: decodeURIComponent(token ?? ''), name: 'WS1 Invitee', password });
    check('J1A: invitee accepts invitation', acc.status === 200, acc.body);
    const newUser = await prisma.user.findUnique({ where: { email: newEmail } });
    if (newUser) created.users.push(newUser.id);
    const isess = await invitee.get(`${LP}/session`);
    check('J1A: invitee session resolves as VIEWER of client A', isess.status === 200 && isess.body?.data?.client?.id === a.id && isess.body.data.lpRole === 'VIEWER', isess.body);
    check('J1A: invited fund scope applied (1 of 2 funds)', isess.body?.data?.funds?.length === 1 && isess.body.data.funds[0].fundId === fund.id, isess.body?.data?.funds);
    const idocs = await invitee.get(`${LP}/documents`);
    check('J1A: invitee sees fund + org docs only', idocs.status === 200, idocs.body);
    const cols = await m.get(`${LP}/colleagues`);
    const viewerRow = cols.body?.data?.find((c: any) => c.userId === viewA.id);
    check('colleagues list', Array.isArray(cols.body?.data) && !!viewerRow && cols.body.data.some((c: any) => c.email === newEmail && c.status === 'ACTIVE'), cols.body);
    const promote = await m.call('PATCH', `${LP}/colleagues/${viewerRow?.membershipId}`, { role: 'MANAGER' });
    check('promote to MANAGER -> 403', promote.status === 403, promote.body);
    const upd = await m.call('PATCH', `${LP}/colleagues/${viewerRow?.membershipId}`, { role: 'SIGNATORY', fundIds: [fund.id] });
    check('update colleague role + funds', upd.body?.data?.lpRole === 'SIGNATORY' && upd.body.data.fundIds[0] === fund.id, upd.body);
    const vAfter = await v.get(`${LP}/session`);
    check('update takes effect on next request', vAfter.body?.data?.lpRole === 'SIGNATORY' && vAfter.body.data.funds.length === 1, vAfter.body?.data);
    const foreignMember = await prisma.clientUser.findFirstOrThrow({ where: { userId: sigB.id } });
    const foreignUpd = await m.call('PATCH', `${LP}/colleagues/${foreignMember.id}`, { role: 'VIEWER' });
    check('IDOR: update other client membership -> 404', foreignUpd.status === 404, foreignUpd.body);
    const mgrMember = await prisma.clientUser.findFirstOrThrow({ where: { userId: mgrA.id } });
    const selfRevoke = await m.call('PATCH', `${LP}/colleagues/${mgrMember.id}/revoke`);
    check('manager cannot revoke self', selfRevoke.status === 403, selfRevoke.body);
    const revoke = await m.call('PATCH', `${LP}/colleagues/${viewerRow?.membershipId}/revoke`);
    check('revoke colleague', revoke.status === 200 && revoke.body?.data?.userId === viewA.id, revoke.body);
    const revoked = await v.get(`${LP}/session`);
    check('revoked colleague sessions ended -> 401', revoked.status === 401, revoked.body);

    console.log('\nBank-instruction changes');
    const bankBody = { fundId: fund.id, bankName: 'CBZ Bank', accountName: 'WS1 Client A', accountNumber: '4100123456789', currency: 'USD' };
    const iv = client();
    await iv.login(newEmail);
    const vBank = await iv.call('POST', `${LP}/bank-instructions/changes`, bankBody, key('vbank'));
    check('VIEWER bank change -> 403', vBank.status === 403 && vBank.body?.code === 'LP_FORBIDDEN', vBank.body);
    const noKey = await s.call('POST', `${LP}/bank-instructions/changes`, bankBody);
    check('bank change without Idempotency-Key -> 400', noKey.status === 400, noKey.body);
    const noMfa = await s.call('POST', `${LP}/bank-instructions/changes`, bankBody, key('bank0'));
    check('bank change without MFA -> 403 LP_MFA_REQUIRED', noMfa.status === 403 && noMfa.body?.code === 'LP_MFA_REQUIRED', noMfa.body);
    const secret = generateTotpSecret();
    await prisma.userMfaFactor.create({ data: { userId: sigA.id, type: 'totp', secretEnc: encryptField(secret)!, verifiedAt: new Date() } });
    const stale = await s.call('POST', `${LP}/bank-instructions/changes`, bankBody, key('bank1'));
    check('bank change without fresh step-up -> 401 LP_STEP_UP_REQUIRED', stale.status === 401 && stale.body?.code === 'LP_STEP_UP_REQUIRED', stale.body);
    const step = await s.call('POST', '/api/auth/mfa/step-up', { code: totpNow(secret) });
    check('step-up verified', step.status === 200, step.body);
    const bank = await s.call('POST', `${LP}/bank-instructions/changes`, bankBody, key('bank2'));
    check('bank change -> 201 PENDING_VERIFICATION, masked', bank.status === 201 && bank.body?.data?.status === 'PENDING_VERIFICATION' && /6789$/.test(bank.body.data.accountNumberMasked) && !JSON.stringify(bank.body).includes('4100123456789'), bank.body);
    const bankReplay = await s.call('POST', `${LP}/bank-instructions/changes`, bankBody, key('bank2'));
    check('bank change replay -> same id', bankReplay.headers.get('idempotent-replayed') === 'true' && bankReplay.body?.data?.id === bank.body?.data?.id, bankReplay.body);
    const row = await prisma.bankInstruction.findUnique({ where: { id: bank.body?.data?.id ?? '' } });
    check('stored pending, account number encrypted', row?.status === 'Pending verification' && !!row?.identifierEnc && !row.identifierEnc.includes('4100123456789'), row?.status);
    const changes = await m.get(`${LP}/bank-instructions/changes`);
    check('bank changes list', Array.isArray(changes.body?.data) && changes.body.data.some((c: any) => c.id === bank.body?.data?.id && c.requestedBy === 'WS1 sig'), changes.body);
    check('client B cannot see A bank changes', !((await ob.get(`${LP}/bank-instructions/changes`)).body?.data ?? []).some((c: any) => c.id === bank.body?.data?.id));
  } finally {
    await prisma.capitalCallPayment.deleteMany({ where: { allocation: { callId: call.id } } });
    await prisma.capitalCallAllocation.deleteMany({ where: { callId: call.id } });
    await prisma.capitalCall.deleteMany({ where: { id: call.id } });
    await prisma.distributionAllocation.deleteMany({ where: { distributionId: dist.id } });
    await prisma.distribution.deleteMany({ where: { id: dist.id } });
    await prisma.lpNotice.deleteMany({ where: { OR: [{ id: { in: created.notices } }, { clientId: { in: created.clients } }] } });
    await prisma.documentAccessLog.deleteMany({ where: { documentId: { in: created.docs } } });
    await prisma.document.deleteMany({ where: { id: { in: created.docs } } });
    const attachments = await prisma.requestAttachment.findMany({ where: { clientId: { in: created.clients } } });
    await prisma.requestAttachment.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.fileObject.deleteMany({ where: { id: { in: [...created.files, ...attachments.map((x) => x.fileId)] } } });
    await prisma.setting.deleteMany({ where: { ownerId: { in: [...created.users, ...created.clients] } } });
    const jobs = await prisma.setting.findMany({ where: { key: 'lp.job' } });
    for (const j of jobs) if (created.clients.includes((j.value as any)?.clientId)) await prisma.setting.delete({ where: { ownerId_key: { ownerId: j.ownerId, key: j.key } } });
    await prisma.invitation.deleteMany({ where: { clientId: { in: created.clients } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await prisma.client.deleteMany({ where: { id: { in: created.clients } } });
    await prisma.fund.deleteMany({ where: { id: { in: created.funds } } });
  }

  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} WS1 checks passed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
