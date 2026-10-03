import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { sha256, walkChain } from './chain';
import type { ChainCheck, ESignAdapter, SealInput, SealResult, SealSigner } from './types';

/**
 * Native e-signature sealing with pdf-lib (free, MIT). Appends a signature page (stamped signatures
 * + audit block) and a certificate of completion to the original PDF, writes a seal footer on every
 * original page and returns the bytes. The SHA-256 of the sealed bytes is recorded by the caller.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const BRAND = rgb(0.06, 0.2, 0.4);
const RULE = rgb(0.8, 0.82, 0.86);

/** Standard fonts are WinAnsi only; anything else prints as '?'. */
const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const utc = (d: Date) => `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  script: PDFFont;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly header: string,
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.page.drawText(clean(this.header), { x: MARGIN, y: A4[1] - 28, size: 7.5, font: this.fonts.regular, color: MUTED });
    this.page.drawLine({ start: { x: MARGIN, y: A4[1] - 34 }, end: { x: A4[0] - MARGIN, y: A4[1] - 34 }, thickness: 0.5, color: RULE });
    this.y = A4[1] - 58;
  }

  ensure(h: number) {
    if (this.y - h < MARGIN) this.newPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split(/\s{2,}/g)) {
      let line = '';
      for (const word of para.split(' ')) {
        let w = word;
        // Hard-split very long tokens (hashes) so they never overflow the page.
        while (font.widthOfTextAtSize(w, size) > width) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
          if (line) {
            out.push(line);
            line = '';
          }
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const probe = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(probe, size) > width && line) {
          out.push(line);
          line = w;
        } else line = probe;
      }
      out.push(line);
    }
    return out;
  }

  text(
    value: string,
    o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; lead?: number } = {},
  ) {
    const size = o.size ?? 9;
    const font = o.font ?? this.fonts.regular;
    const x = MARGIN + (o.indent ?? 0);
    const lines = this.wrap(value, font, size, A4[0] - MARGIN - x);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= o.lead ?? size + 3.5;
    }
  }

  kv(key: string, value: string, o: { mono?: boolean } = {}) {
    const keyW = 112;
    const size = 8.5;
    const font = o.mono ? this.fonts.mono : this.fonts.regular;
    const lines = this.wrap(value || '-', font, o.mono ? 7.5 : size, A4[0] - 2 * MARGIN - keyW);
    this.ensure(lines.length * 11 + 2);
    this.page.drawText(clean(key), { x: MARGIN, y: this.y - size, size: 8, font: this.fonts.bold, color: MUTED });
    for (const l of lines) {
      this.page.drawText(l, { x: MARGIN + keyW, y: this.y - size, size: o.mono ? 7.5 : size, font, color: INK });
      this.y -= 11;
    }
    this.y -= 1;
  }

  rule() {
    this.ensure(8);
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 2 }, end: { x: A4[0] - MARGIN, y: this.y - 2 }, thickness: 0.5, color: RULE });
    this.y -= 8;
  }

  heading(value: string, size = 14) {
    this.ensure(size + 12);
    this.page.drawText(clean(value), { x: MARGIN, y: this.y - size, size, font: this.fonts.bold, color: BRAND });
    this.y -= size + 10;
  }
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    script: await doc.embedFont(StandardFonts.TimesRomanItalic),
  };
}

async function drawSignatureBlocks(w: Writer, signers: SealSigner[]) {
  for (const s of signers) {
    const blockH = 118;
    w.ensure(blockH + 8);
    const top = w.y;
    w.page.drawRectangle({ x: MARGIN, y: top - blockH, width: A4[0] - 2 * MARGIN, height: blockH, borderColor: RULE, borderWidth: 0.8 });
    // Signature artefact
    const boxX = MARGIN + 12;
    const boxY = top - 76;
    w.page.drawRectangle({ x: boxX, y: boxY, width: 210, height: 56, color: rgb(0.97, 0.98, 1) });
    let drawn = false;
    if (s.signatureMode === 'DRAWN' && s.signaturePng) {
      try {
        const img = await w.doc.embedPng(s.signaturePng);
        const scale = Math.min(200 / img.width, 48 / img.height);
        w.page.drawImage(img, { x: boxX + 5, y: boxY + 4, width: img.width * scale, height: img.height * scale });
        drawn = true;
      } catch {
        drawn = false;
      }
    }
    if (!drawn) {
      const t = clean(s.signatureText || s.name).slice(0, 40);
      let size = 24;
      while (size > 10 && w.fonts.script.widthOfTextAtSize(t, size) > 200) size -= 1;
      w.page.drawText(t, { x: boxX + 6, y: boxY + 20, size, font: w.fonts.script, color: rgb(0.05, 0.1, 0.45) });
    }
    w.page.drawLine({ start: { x: boxX, y: boxY }, end: { x: boxX + 210, y: boxY }, thickness: 0.6, color: INK });
    const x2 = MARGIN + 240;
    w.page.drawText(clean(s.name), { x: x2, y: top - 22, size: 11, font: w.fonts.bold, color: INK });
    w.page.drawText(clean(s.roleLabel ?? s.kind), { x: x2, y: top - 36, size: 8.5, font: w.fonts.regular, color: MUTED });
    const rows = [
      `Signed ${utc(s.signedAt)}`,
      `Identity: ${s.identityMethod === 'SESSION' ? 'authenticated session' : 'e-mail one-time code'}  |  IP ${s.ip ?? 'n/a'}`,
      `Signature hash ${s.signatureHash.slice(0, 32)}...`,
      `Chain link     ${s.chainHash.slice(0, 32)}...`,
    ];
    rows.forEach((r, i) => w.page.drawText(clean(r), { x: x2, y: top - 54 - i * 12, size: 7.5, font: i >= 2 ? w.fonts.mono : w.fonts.regular, color: INK }));
    w.page.drawText(clean(s.email), { x: boxX, y: top - 100, size: 8, font: w.fonts.regular, color: MUTED });
    w.y = top - blockH - 10;
  }
}

function drawCertificate(w: Writer, i: SealInput) {
  w.heading('Certificate of Completion', 18);
  w.text('Issued by Matanho Nexus eSign. This certificate records who signed, when, from where and exactly which document.', { color: MUTED, size: 8.5 });
  w.gap(6);
  w.rule();
  w.kv('Reference', i.ref);
  w.kv('Document', i.title);
  if (i.subjectLabel) w.kv('Subject', i.subjectLabel);
  w.kv('Created', utc(i.createdAt));
  w.kv('Completed', utc(i.completedAt));
  w.kv('Original SHA-256', i.originalSha256, { mono: true });
  w.kv('Signature chain head', i.chainHead, { mono: true });
  w.kv('Verification', i.verifyUrl);
  w.gap(4);
  w.rule();
  w.heading('Signers', 11);
  for (const s of i.signers) {
    w.ensure(120);
    w.text(`${s.name}  <${s.email}>`, { font: w.fonts.bold, size: 9.5 });
    w.kv('Capacity', `${s.roleLabel ?? '-'} (${s.kind})`);
    w.kv('Signed at', utc(s.signedAt));
    w.kv('Identity check', s.identityMethod === 'SESSION' ? 'Authenticated platform session' : 'One-time code sent to e-mail address');
    w.kv('IP address', s.ip ?? 'n/a');
    w.kv('Browser', s.userAgent ?? 'n/a');
    w.kv('Signature', s.signatureMode === 'TYPED' ? `Typed: "${s.signatureText ?? s.name}"` : 'Drawn signature (image)');
    w.kv('Signature hash', s.signatureHash, { mono: true });
    w.kv('Document hash seen', s.docSha256, { mono: true });
    w.kv('Consent', `${s.consentTextVersion}  ${s.consentHash}`, { mono: true });
    w.kv('Chain link', s.chainHash, { mono: true });
    w.gap(4);
  }
  w.rule();
  w.heading('Consent text', 11);
  const first = i.signers[0];
  if (first) w.text(first.consentText.replace(first.name, '[signer name]'), { size: 8, color: MUTED });
  w.gap(6);
  w.heading('Audit trail', 11);
  for (const e of i.events) {
    w.text(`${utc(e.at)}  ${e.type}${e.who ? `  ${e.who}` : ''}${e.ip ? `  ${e.ip}` : ''}`, { font: w.fonts.mono, size: 7, lead: 9.5 });
  }
  w.gap(8);
  w.text(
    'Tamper evidence: each signature is hashed together with the signer identity, time, consent and document hash, and linked ' +
      'to the previous signature (SHA-256 chain). Any change to the document or to this record breaks the chain. Upload the sealed ' +
      'PDF at the verification address above to check it against the SHA-256 recorded at completion.',
    { size: 8, color: MUTED },
  );
}

async function sealNative(input: SealInput): Promise<SealResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.originalPdf, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new Error('The source file is not a valid, unencrypted PDF');
  }
  const fonts = await loadFonts(doc);
  const originalPages = doc.getPages();
  const footer = clean(`Sealed ${input.ref}  |  original SHA-256 ${input.originalSha256.slice(0, 32)}...  |  ${input.verifyUrl}`);
  originalPages.forEach((p, idx) => {
    p.drawText(`${footer}  |  page ${idx + 1}/${originalPages.length}`, {
      x: 20,
      y: 9,
      size: 6,
      font: fonts.regular,
      color: MUTED,
      maxWidth: p.getWidth() - 40,
    });
  });

  const header = `Matanho Nexus eSign  |  ${input.ref}  |  ${input.title}`;
  const sig = new Writer(doc, fonts, header);
  sig.heading('Signature page', 16);
  sig.text(`${input.title} (${input.ref}). Signed electronically by the parties below.`, { size: 9, color: MUTED });
  sig.gap(8);
  await drawSignatureBlocks(sig, input.signers);
  sig.text(`Audit block: document SHA-256 ${input.originalSha256}. Completed ${utc(input.completedAt)}. Chain head ${input.chainHead}.`, { font: fonts.mono, size: 6.5, color: MUTED });

  drawCertificate(new Writer(doc, fonts, header), input);

  doc.setTitle(clean(`${input.title} (signed)`));
  doc.setProducer('Matanho Nexus eSign (pdf-lib)');
  doc.setCreator('Matanho Nexus');
  doc.setKeywords([`esign:${input.ref}`, `orig:${input.originalSha256}`, `chain:${input.chainHead}`]);
  doc.setModificationDate(input.completedAt);
  const sealedPdf = Buffer.from(await doc.save());

  const cert = await PDFDocument.create();
  const cf = await loadFonts(cert);
  drawCertificate(new Writer(cert, cf, header), input);
  cert.setTitle(clean(`Certificate of completion ${input.ref}`));
  cert.setProducer('Matanho Nexus eSign (pdf-lib)');
  cert.setKeywords([`esign:${input.ref}`, `chain:${input.chainHead}`]);
  const certificatePdf = Buffer.from(await cert.save());

  return { sealedPdf, sealedSha256: sha256(sealedPdf), certificatePdf };
}

function verifyNativeChain(ref: string, originalSha256: string, signers: SealSigner[], recordedHead: string | null): ChainCheck {
  const { head, brokenAt } = walkChain(ref, originalSha256, signers);
  return { ok: brokenAt === null && (recordedHead === null || head === recordedHead), expectedHead: head, brokenAt };
}

export const nativeESign: ESignAdapter = {
  mode: 'native',
  seal: sealNative,
  verifyChain: verifyNativeChain,
};
