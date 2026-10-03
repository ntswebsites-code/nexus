/**
 * E-sign demo data: one fully signed and sealed request (with certificate), one waiting on an external
 * signer, one capital-call acknowledgement waiting on an LP signatory, one voided. Uses the real service so
 * hashes, chain and sealed PDFs are genuine. Idempotent: skipped when any request exists.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-esign.ts   (standalone; run the role + demo seeds first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prisma } from '../src/lib/prisma';
import { storeFile } from '../src/lib/storage';
import { createRequest, requestCapitalCallAckSignature, signRequest, voidRequest, type EsignActor } from '../src/modules/esign';

const log = (m: string) => console.log(`[seed:esign] ${m}`);

async function pdf(title: string, body: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText(title, { x: 56, y: 770, size: 18, font: bold });
  body.forEach((l, i) => page.drawText(l, { x: 56, y: 730 - i * 18, size: 10.5, font }));
  return Buffer.from(await doc.save());
}

export async function seedEsign() {
  if (await prisma.esignRequest.findFirst()) {
    log('already seeded: skipped');
    return;
  }
  const admin = await prisma.user.findFirst({ where: { roles: { some: { role: { portal: 'admin', key: 'system_admin' } } } }, orderBy: { createdAt: 'asc' } });
  if (!admin) {
    log('no admin user yet: skipped');
    return;
  }
  const staff: EsignActor = { userId: admin.id, name: admin.name ?? admin.email, role: 'System Administrator', portal: 'admin', ip: '127.0.0.1', userAgent: 'seed' };
  const upload = async (name: string, lines: string[]) => (await storeFile({ name, mime: 'application/pdf', data: await pdf(name.replace(/\.pdf$/, ''), lines), uploadedById: admin.id })).id;

  // 1. Completed: staff + external countersigner, sequential.
  const a = await createRequest(staff, {
    title: 'Side letter acknowledgement - Demo Investor',
    message: 'Please countersign the side letter acknowledgement.',
    fileId: await upload('Side letter acknowledgement.pdf', ['The parties acknowledge the side letter dated 1 October 2026.', 'Fee terms are as set out in schedule 2 of the side letter.']),
    signingOrder: 'SEQUENTIAL',
    signers: [
      { userId: admin.id, orderNo: 1 },
      { kind: 'EXTERNAL', name: 'Demo Counterparty', email: 'counterparty@example.com', roleLabel: 'Director, Demo Counterparty Ltd', orderNo: 2 },
    ],
    subjectType: 'GENERIC',
    subjectId: 'seed-side-letter',
  });
  const [s1, s2] = a.signers;
  await signRequest({ ...staff, ip: '10.20.0.5' }, a.id, s1!.id, { method: 'SESSION', mfaAt: new Date() }, { mode: 'TYPED', typedName: admin.name ?? admin.email, consent: true });
  await signRequest({ userId: null, name: s2!.name, role: 'External signer', portal: null, ip: '203.0.113.24', userAgent: 'Mozilla/5.0 (seed)' }, a.id, s2!.id, { method: 'EMAIL_OTP' }, { mode: 'TYPED', typedName: 'Demo Counterparty', consent: true });
  log(`completed ${a.ref}`);

  // 2. Pending: external signer only.
  const b = await createRequest(staff, {
    title: 'NDA - prospective co-investor',
    fileId: await upload('Mutual NDA.pdf', ['Mutual non-disclosure agreement between Matanho and the Recipient.', 'Term: two years from the date of the last signature.']),
    signers: [{ kind: 'EXTERNAL', name: 'Prospect Signer', email: 'prospect@example.com', roleLabel: 'Managing partner' }],
    subjectType: 'GENERIC',
    subjectId: 'seed-nda',
  });
  log(`pending ${b.ref}`);

  // 3. Voided draft that was sent in error.
  const c = await createRequest(staff, {
    title: 'Superseded engagement letter',
    fileId: await upload('Engagement letter (superseded).pdf', ['Superseded draft - do not sign.']),
    signers: [{ kind: 'EXTERNAL', name: 'Prospect Signer', email: 'prospect@example.com' }],
  });
  await voidRequest(staff, c.id, 'Sent in error; replaced by the NDA');
  log(`voided ${c.ref}`);

  // 4. Capital call acknowledgement for an LP signatory, when a suitable allocation exists.
  const allocation = await prisma.capitalCallAllocation.findFirst({
    where: { acknowledgedAt: null, call: { issuedAt: { not: null }, status: { notIn: ['DRAFT', 'CANCELLED', 'PENDING_APPROVAL', 'APPROVED'] } } },
    orderBy: { createdAt: 'asc' },
  });
  if (allocation) {
    try {
      const d = await requestCapitalCallAckSignature(staff, allocation.id);
      log(`pending ${d.ref} (capital call acknowledgement)`);
    } catch (e) {
      log(`capital call acknowledgement skipped: ${(e as Error).message}`);
    }
  } else log('no issued capital call allocation: acknowledgement flow not seeded');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedEsign()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
