/**
 * Offline unit test of the e-signature hash chain, sealing and helpers. No database, SMTP or API needed:
 *   npx tsx scripts/test-esign.ts
 */
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  CONSENT_VERSION,
  consentHash,
  consentText,
  genesisHash,
  nextLink,
  sha256,
  signatureValueHash,
  walkChain,
  type DigestInput,
} from '../src/integrations/esign/chain';
import { nativeESign } from '../src/integrations/esign/native';
import { liveESign } from '../src/integrations/esign/live';
import type { SealSigner } from '../src/integrations/esign/types';
import { allSigned, dueSigners, isPdf, maskEmail, parseDrawnPng } from '../src/modules/esign/esign.logic';

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function samplePng(): Buffer {
  const w = 60;
  const h = 24;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), randomBytes(w)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

async function samplePdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Subscription agreement page ${i + 1}`, { x: 60, y: 760, size: 14, font });
  return Buffer.from(await doc.save());
}

function buildSigners(ref: string, docSha: string, png: Buffer) {
  const people = [
    { id: 's1', name: 'Tendai Moyo', email: 'tendai@example.com', mode: 'TYPED' as const, method: 'SESSION' },
    { id: 's2', name: 'Rudo Chikwanha', email: 'rudo@example.org', mode: 'DRAWN' as const, method: 'EMAIL_OTP' },
  ];
  let link = genesisHash(ref, docSha);
  const digests: (DigestInput & { chainHash: string })[] = [];
  const seal: SealSigner[] = [];
  people.forEach((p, i) => {
    const signedAt = new Date(Date.UTC(2026, 9, 3, 9, 30 + i, 0));
    const text = consentText(p.name, ref, docSha);
    const ch = consentHash(text, p.name, p.email, ref, docSha);
    const sigHash = signatureValueHash(p.mode, p.mode === 'TYPED' ? p.name : null, p.mode === 'DRAWN' ? png : null);
    const d: DigestInput = { signerId: p.id, name: p.name, email: p.email, signedAt, identityMethod: p.method, signatureMode: p.mode, signatureHash: sigHash, consentHash: ch, docSha256: docSha, ip: `10.0.0.${i + 1}` };
    link = nextLink(link, d);
    digests.push({ ...d, chainHash: link });
    seal.push({
      signerId: p.id,
      name: p.name,
      email: p.email,
      roleLabel: i ? 'Director' : 'Authorised signatory',
      kind: i ? 'EXTERNAL' : 'LP',
      identityMethod: p.method,
      signatureMode: p.mode,
      signatureText: p.mode === 'TYPED' ? p.name : null,
      signaturePng: p.mode === 'DRAWN' ? png : null,
      signatureHash: sigHash,
      ip: d.ip,
      userAgent: 'test-agent/1.0',
      signedAt,
      consentTextVersion: CONSENT_VERSION,
      consentText: text,
      consentHash: ch,
      docSha256: docSha,
      chainHash: link,
    });
  });
  return { digests, seal, head: link };
}

async function main() {
  const png = samplePng();
  const pdf = await samplePdf(2);
  const docSha = sha256(pdf);
  const ref = 'ESG-00001';
  const { digests, seal, head } = buildSigners(ref, docSha, png);

  await t('helpers: isPdf, maskEmail, parseDrawnPng', () => {
    assert.ok(isPdf(pdf));
    assert.ok(!isPdf(Buffer.from('hello world, not a pdf')));
    assert.equal(maskEmail('tendai@example.com'), 'te****@example.com');
    assert.equal(parseDrawnPng(`data:image/png;base64,${png.toString('base64')}`).length, png.length);
    assert.throws(() => parseDrawnPng('data:image/jpeg;base64,AAAA'));
    assert.throws(() => parseDrawnPng(`data:image/png;base64,${Buffer.alloc(200, 1).toString('base64')}`));
  });

  await t('ordering: parallel group, then sequential groups', () => {
    const parallel = [
      { id: 'a', orderNo: 1, status: 'PENDING' },
      { id: 'b', orderNo: 1, status: 'PENDING' },
    ];
    assert.deepEqual(dueSigners(parallel).map((s) => s.id), ['a', 'b']);
    const seq = [
      { id: 'a', orderNo: 1, status: 'SIGNED' },
      { id: 'b', orderNo: 2, status: 'WAITING' },
      { id: 'c', orderNo: 3, status: 'WAITING' },
    ];
    assert.deepEqual(dueSigners(seq).map((s) => s.id), ['b']);
    assert.ok(!allSigned(seq));
    assert.ok(allSigned(seq.map((s) => ({ ...s, status: 'SIGNED' }))));
    assert.deepEqual(dueSigners([{ id: 'x', orderNo: 1, status: 'DECLINED' }]), []);
  });

  await t('chain: recomputes to the recorded head', () => {
    const w = walkChain(ref, docSha, digests);
    assert.equal(w.brokenAt, null);
    assert.equal(w.head, head);
    assert.equal(nativeESign.verifyChain(ref, docSha, seal, head).ok, true);
  });

  await t('chain: any change breaks it (document, name, time, order)', () => {
    assert.equal(walkChain(ref, sha256(Buffer.from('other document')), digests).brokenAt, 0);
    const renamed = digests.map((d, i) => (i === 1 ? { ...d, name: 'Mallory' } : d));
    assert.equal(walkChain(ref, docSha, renamed).brokenAt, 1);
    const retimed = digests.map((d, i) => (i === 0 ? { ...d, signedAt: new Date(d.signedAt.getTime() + 1) } : d));
    assert.equal(walkChain(ref, docSha, retimed).brokenAt, 0);
    assert.equal(walkChain(ref, docSha, [digests[1]!, digests[0]!]).brokenAt, 0);
    assert.equal(nativeESign.verifyChain(ref, docSha, seal, sha256('forged head')).ok, false);
  });

  await t('seal: appends signature + certificate pages and stamps every original page', async () => {
    const out = await nativeESign.seal({
      ref,
      title: 'Subscription agreement - Demo LP',
      subjectLabel: 'COMMITMENT 1234',
      originalPdf: pdf,
      originalSha256: docSha,
      createdAt: new Date(Date.UTC(2026, 9, 3, 8, 0, 0)),
      completedAt: new Date(Date.UTC(2026, 9, 3, 9, 31, 0)),
      chainHead: head,
      signers: seal,
      events: [
        { at: new Date(Date.UTC(2026, 9, 3, 8, 0, 0)), type: 'CREATED', who: null, ip: '10.1.1.1' },
        ...seal.map((s) => ({ at: s.signedAt, type: 'SIGNED', who: s.name, ip: s.ip })),
        { at: new Date(Date.UTC(2026, 9, 3, 9, 31, 0)), type: 'COMPLETED', who: null, ip: null },
      ],
      verifyUrl: 'https://onboarding.example/sign/verify',
    });
    assert.ok(isPdf(out.sealedPdf) && isPdf(out.certificatePdf));
    assert.equal(out.sealedSha256, sha256(out.sealedPdf));
    const sealed = await PDFDocument.load(out.sealedPdf);
    const cert = await PDFDocument.load(out.certificatePdf);
    assert.ok(sealed.getPageCount() >= 2 + 1 + cert.getPageCount(), `sealed pages ${sealed.getPageCount()}, cert pages ${cert.getPageCount()}`);
    assert.ok(sealed.getKeywords()?.includes(`chain:${head}`));
    assert.notEqual(out.sealedSha256, docSha);
    // Tamper evidence: flipping one byte changes the SHA-256 recorded at completion.
    const tampered = Buffer.from(out.sealedPdf);
    tampered[tampered.length - 20] = tampered[tampered.length - 20]! ^ 0xff;
    assert.notEqual(sha256(tampered), out.sealedSha256);
  });

  await t('seal: rejects a source file that is not a PDF', async () => {
    await assert.rejects(
      nativeESign.seal({ ref, title: 'x', subjectLabel: null, originalPdf: Buffer.from('not a pdf at all'), originalSha256: sha256('x'), createdAt: new Date(), completedAt: new Date(), chainHead: head, signers: seal, events: [], verifyUrl: 'u' }),
      /not a valid/,
    );
  });

  await t('live adapter is a clear NotConfigured stub', async () => {
    await assert.rejects(liveESign.seal({} as never), /not configured/i);
  });

  await t('consent text binds name, reference and document hash', () => {
    const c = consentText('A B', ref, docSha);
    assert.ok(c.includes('A B') && c.includes(ref) && c.includes(docSha));
    assert.notEqual(consentHash(c, 'A B', 'a@b.co', ref, docSha), consentHash(c, 'A B', 'x@b.co', ref, docSha));
  });

  console.log(`\n${passed} e-sign checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
