/**
 * Investee vault flow (CMP-038, INO-021, D-15): upload, signed download and inline preview, version history and a
 * new version, withdraw with a reason (nothing erased), legal-hold and published-pack refusals, tenant isolation.
 *
 *   E2E_CONFIRM=local npx tsx --env-file-if-exists=../../.env scripts/test-investee-vault.ts
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { signedDownloadUrl, storeFile } from '../src/lib/storage';
import { decryptField } from '../src/lib/crypto';
import { totpNow } from '../src/lib/totp';

if (process.env.E2E_CONFIRM !== 'local') {
  console.error('Refusing to run: set E2E_CONFIRM=local');
  process.exit(2);
}

const API = process.env.E2E_API ?? `http://127.0.0.1:${config.port}`;
const run = randomBytes(3).toString('hex');
let passes = 0;
let failures = 0;
const check = (name: string, cond: unknown, detail?: unknown) => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 800));
  }
};

type Res = { status: number; body: any; headers: Headers };
const users = JSON.parse(readFileSync(new URL('../../../secrets/uat-users.json', import.meta.url), 'utf8')) as { email: string; password: string }[];
const pw = (email: string) => users.find((u) => u.email === email)?.password ?? '';

function client() {
  const origin = config.portalUrls.company;
  const jar = new Map<string, string>();
  const send = async (method: string, path: string, body?: string | FormData, headers: Record<string, string> = {}): Promise<Res> => {
    const h: Record<string, string> = { Origin: origin, ...headers };
    if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, { method, headers: h, body });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
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
  const upload = (path: string, name: string, mime: string, bytes: Buffer, extra: Record<string, string> = {}, headers: Record<string, string> = {}) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return send('POST', path, form, headers);
  };
  return { call, upload, get: (path: string) => call('GET', path) };
}

async function codeFor(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { mfaFactors: { where: { verifiedAt: { not: null } } } } });
  const secret = decryptField(user.mfaFactors[0]?.secretEnc ?? null);
  if (!secret) throw new Error(`no TOTP for ${email}`);
  return totpNow(secret);
}

const key = (s: string) => ({ 'Idempotency-Key': `vault-${run}-${s}` });

async function signIn(c: ReturnType<typeof client>, email: string) {
  const login = await c.call('POST', '/api/auth/login', { email, password: pw(email) });
  if (login.body?.mfa !== 'verify') return login;
  return c.call('POST', '/api/auth/mfa/verify', { code: await codeFor(email) });
}
const dataOf = (res: Res) => res.body?.data ?? res.body;
const P = '/api/v1/investee-portal';
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

async function main() {
  const email = 'investee_102_admin@uat.matanho.test';
  const c = client();
  const login = await signIn(c, email);
  check(`${email} signs in`, login.status === 200, login.body);
  const link = await prisma.companyUser.findFirst({ where: { user: { email }, status: 'active' }, select: { companyId: true } });
  if (!link) throw new Error('investee has no company');
  const companyId = link.companyId;

  // ---- upload, list, versions
  const v1 = pdf(`v1 ${run}`);
  const up = await c.upload(`${P}/vault`, `Deck ${run}.pdf`, 'application/pdf', v1, { name: `Deck ${run}` }, key('up1'));
  check('a PDF is stored in the vault', up.status === 201 && dataOf(up).id, up.body);
  const docId = dataOf(up).id as string;
  const list = await c.get(`${P}/vault`);
  const listed = (dataOf(list).documents as { id: string; version: number }[]).find((d) => d.id === docId);
  check('the vault lists it as version 1', listed?.version === 1, listed);
  const vers = await c.get(`${P}/vault/${docId}/versions`);
  check('version history has one entry with a fingerprint and size', vers.status === 200 && dataOf(vers).versions.length === 1 && /^[0-9a-f]{64}$/.test(dataOf(vers).versions[0].sha256) && dataOf(vers).versions[0].size === v1.length, vers.body);

  // ---- download and preview
  const dl = await c.get(`${P}/vault/${docId}/download-url`);
  check('a signed download link is issued for the latest version', dl.status === 200 && String(dataOf(dl).url).includes('/api/v1/files/') && dataOf(dl).version === 1 && dataOf(dl).inline === false, dl.body);
  const bytes = await c.get(String(dataOf(dl).url));
  check('the link returns the stored bytes as an attachment', bytes.status === 200 && Buffer.compare(bytes.body as Buffer, v1) === 0 && (bytes.headers.get('content-disposition') ?? '').startsWith('attachment'), bytes.headers.get('content-disposition'));
  check('downloads are sent with nosniff', bytes.headers.get('x-content-type-options') === 'nosniff', bytes.headers.get('x-content-type-options'));
  const pv = await c.get(`${P}/vault/${docId}/download-url?inline=1`);
  check('a preview link is issued for a PDF', pv.status === 200 && dataOf(pv).inline === true && String(dataOf(pv).url).includes('inline=1'), pv.body);
  const pvBytes = await c.get(String(dataOf(pv).url));
  check('the preview link is served inline', pvBytes.status === 200 && (pvBytes.headers.get('content-disposition') ?? '').startsWith('inline'), pvBytes.headers.get('content-disposition'));

  const blob = await storeFile({ name: `page-${run}.html`, mime: 'application/octet-stream', data: Buffer.from('<script>alert(1)</script>'), uploadedById: null });
  const blobRes = await c.get(`${signedDownloadUrl(blob.id, 60)}&inline=1`);
  check('inline is ignored for a type that is not safe to preview (still an attachment)', (blobRes.headers.get('content-disposition') ?? '').startsWith('attachment'), blobRes.headers.get('content-disposition'));
  await prisma.fileObject.delete({ where: { id: blob.id } }).catch(() => undefined);

  const tampered = await c.get(String(dataOf(dl).url).replace(/sig=[0-9a-f]{4}/, 'sig=0000'));
  check('a tampered link is refused', tampered.status === 403, tampered.status);

  // ---- new version
  const v2 = pdf(`v2 ${run} longer`);
  const nv = await c.upload(`${P}/vault/${docId}/versions`, `Deck ${run} v2.pdf`, 'application/pdf', v2, {}, key('v2'));
  check('a new version is stored', nv.status === 201 && dataOf(nv).version === 2 && dataOf(nv).versions.length === 2 && dataOf(nv).versions[0].version === 2, nv.body);
  const latest = await c.get(String(dataOf(await c.get(`${P}/vault/${docId}/download-url`)).url));
  check('the default download is now version 2', Buffer.compare(latest.body as Buffer, v2) === 0);
  const old = await c.get(`${P}/vault/${docId}/download-url?version=1`);
  const oldBytes = await c.get(String(dataOf(old).url));
  check('version 1 stays downloadable', dataOf(old).version === 1 && Buffer.compare(oldBytes.body as Buffer, v1) === 0, old.body);
  const bad = await c.get(`${P}/vault/${docId}/download-url?version=0`);
  check('version 0 is a 400', bad.status === 400, bad.body);
  const missing = await c.get(`${P}/vault/${docId}/download-url?version=9`);
  check('an unknown version is a 404', missing.status === 404, missing.body);
  const exe = await c.upload(`${P}/vault/${docId}/versions`, 'tool.pdf', 'application/pdf', Buffer.from('MZ\x90\x00binary'), {}, key('exe'));
  check('a program disguised as a PDF is refused as a new version', exe.status === 400, exe.body);

  // ---- withdraw
  const noReason = await c.call('POST', `${P}/vault/${docId}/withdraw`, {}, key('w0'));
  check('withdraw needs a reason', noReason.status === 400, noReason.body);
  const wd = await c.call('POST', `${P}/vault/${docId}/withdraw`, { reason: `Uploaded by mistake ${run}` }, key('w1'));
  check('the document is withdrawn', wd.status === 200 && dataOf(wd).status === 'Withdrawn', wd.body);
  const after = await c.get(`${P}/vault`);
  check('a withdrawn document leaves the vault list', !(dataOf(after).documents as { id: string }[]).some((d) => d.id === docId));
  const gone = await c.get(`${P}/vault/${docId}/versions`);
  check('a withdrawn document cannot be opened from the portal', gone.status === 404, gone.body);
  const kept = await prisma.document.findUnique({ where: { id: docId }, include: { versions: true } });
  check('nothing is erased: the row and both versions remain', kept?.status === 'Withdrawn' && kept.versions.length === 2, kept);
  const audit = await prisma.auditEvent.findMany({ where: { objectId: docId }, select: { action: true } });
  const actions = new Set(audit.map((a) => a.action));
  check('downloads, preview, new version and withdraw are audited', ['company.vault.downloaded', 'company.vault.previewed', 'company.vault.version_added', 'company.vault.withdrawn'].every((a) => actions.has(a)), [...actions]);

  // ---- refusals
  const held = await c.upload(`${P}/vault`, `Held ${run}.pdf`, 'application/pdf', pdf(`held ${run}`), {}, key('up2'));
  const heldId = dataOf(held).id as string;
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await prisma.documentHold.create({ data: { documentId: heldId, reason: `test ${run}`, placedBy: user.id } });
  const heldWd = await c.call('POST', `${P}/vault/${heldId}/withdraw`, { reason: 'Old file' }, key('w2'));
  check('a document on legal hold cannot be withdrawn', heldWd.status === 409 && heldWd.body?.error?.code === 'legal_hold', heldWd.body);

  const packed = await c.upload(`${P}/vault`, `Pack ${run}.pdf`, 'application/pdf', pdf(`pack ${run}`), {}, key('up3'));
  const packedId = dataOf(packed).id as string;
  const meetingDay = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const meeting = await c.call('POST', `${P}/governance/meetings`, { title: `Board ${run}`, meetingAt: meetingDay }, key('m1'));
  const meetingId = ((dataOf(meeting)?.meetings ?? []) as { id: string; title: string }[]).find((m) => m.title === `Board ${run}`)?.id ?? '';
  check('a board meeting is scheduled', meeting.status === 201 && Boolean(meetingId), meeting.body);
  const addPack = await c.call('POST', `${P}/governance/meetings/${meetingId}/pack`, { documentId: packedId });
  const publish = await c.call('POST', `${P}/governance/meetings/${meetingId}/publish`, {}, key('pub'));
  check('the document is published in the board pack', addPack.status === 200 && publish.status === 200, [addPack.body, publish.body]);
  const packWd = await c.call('POST', `${P}/vault/${packedId}/withdraw`, { reason: 'Old file' }, key('w3'));
  check('a document in a published board pack cannot be withdrawn', packWd.status === 409 && packWd.body?.error?.code === 'in_published_pack', packWd.body);

  const other = await prisma.document.findFirst({ where: { companyId: { not: companyId }, status: { notIn: ['Withdrawn', 'Disposed'] } }, select: { id: true } });
  if (other) {
    const cross = await c.get(`${P}/vault/${other.id}/download-url`);
    check("another company's document is not found", cross.status === 404, cross.body);
    const crossWd = await c.call('POST', `${P}/vault/${other.id}/withdraw`, { reason: 'Not mine' }, key('w4'));
    check("another company's document cannot be withdrawn", crossWd.status === 404, crossWd.body);
  } else {
    const cross = await c.get(`${P}/vault/00000000-0000-0000-0000-000000000000/download-url`);
    check('an unknown document is not found', cross.status === 404, cross.body);
  }

  const viewer = 'investee_101_viewer@uat.matanho.test';
  if (pw(viewer)) {
    const v = client();
    const viewerLogin = await signIn(v, viewer);
    check(`${viewer} signs in`, viewerLogin.status === 200, viewerLogin.body);
    const viewerCompany = (await prisma.companyUser.findFirst({ where: { user: { email: viewer } }, select: { companyId: true } }))?.companyId ?? '';
    const viewerDoc = await prisma.document.findFirst({ where: { companyId: viewerCompany, status: { notIn: ['Withdrawn', 'Disposed'] } }, select: { id: true } });
    if (viewerDoc) {
      const viewerWd = await v.call('POST', `${P}/vault/${viewerDoc.id}/withdraw`, { reason: 'Viewer try' }, key('w5'));
      check('a read-only member cannot withdraw', viewerWd.status === 403, viewerWd.body);
    }
  }

  await prisma.documentHold.deleteMany({ where: { reason: `test ${run}` } });

  console.log(`\n${passes} passed, ${failures} failed`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
