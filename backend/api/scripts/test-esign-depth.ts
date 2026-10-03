/**
 * Offline test of the R4-4 e-sign depth logic: positioned fields, layout hash, document packs, field stamping
 * on a real PDF, reminder cadence. No database, SMTP or API needed:
 *   npx tsx scripts/test-esign-depth.ts
 */
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sha256 } from '../src/integrations/esign/chain';
import { nativeESign } from '../src/integrations/esign/native';
import { stampPlaceholders } from '../src/integrations/esign/stamp';
import type { SealSigner } from '../src/integrations/esign/types';
import { initialsOf, layoutCanonical, nextReminderAt, normaliseField, overlaps, reminderDue, reminderPolicy, validateLayout, type FieldSpec } from '../src/modules/esign/esign.fields';
import { appendSheet, buildPack } from '../src/modules/esign/esign.packs';
import { isPdf } from '../src/modules/esign/esign.logic';

let passed = 0;
const t = async (name: string, fn: () => void | Promise<void>) => {
  await fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

async function samplePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595.28, 841.89]).drawText(`Sample page ${i}`, { x: 60, y: 780, size: 14, font });
  return Buffer.from(await doc.save());
}

const sig = (page: number, y = 0.7, x = 0.1): FieldSpec => ({ kind: 'SIGNATURE', page, x, y, width: 0.3, height: 0.06 });

function sealSigner(id: string, name: string, mode: 'TYPED' | 'DRAWN' = 'TYPED'): SealSigner {
  return {
    signerId: id,
    name,
    email: `${id}@example.test`,
    roleLabel: 'Signatory',
    kind: 'STAFF',
    identityMethod: 'SESSION',
    signatureMode: mode,
    signatureText: name,
    signaturePng: null,
    signatureHash: sha256(`sig-${id}`),
    ip: '10.0.0.1',
    userAgent: 'test',
    signedAt: new Date(Date.UTC(2026, 9, 3, 9, 0, 0)),
    consentTextVersion: 'v1',
    consentText: `${name} consents`,
    consentHash: sha256('c'),
    docSha256: sha256('d'),
    chainHash: sha256(`chain-${id}`),
  };
}

async function main() {
  await t('field validation: page, bounds, size', () => {
    assert.deepEqual(normaliseField(sig(2), 3).page, 2);
    assert.throws(() => normaliseField(sig(4), 3), /does not exist/);
    assert.throws(() => normaliseField(sig(0), 3), /does not exist/);
    assert.throws(() => normaliseField({ ...sig(1), x: 0.8 }, 3), /past the page edge/);
    assert.throws(() => normaliseField({ ...sig(1), width: 0.001 }, 3), /too small/);
    assert.throws(() => normaliseField({ ...sig(1), x: Number.NaN }, 3), /not a number/);
    assert.equal(normaliseField({ ...sig(1), x: 0.123456789 }, 1).x, 0.12346);
  });

  await t('layout validation: overlap, ownership, a signature per signer', () => {
    assert.ok(overlaps(sig(1), { ...sig(1), x: 0.2 }));
    assert.ok(!overlaps(sig(1), sig(2)));
    const a = { ...sig(1), signerKey: 'a@x.co' };
    const b = { ...sig(1, 0.8), signerKey: 'b@x.co' };
    assert.equal(validateLayout([a, b], 1, ['a@x.co', 'b@x.co']).length, 2);
    assert.throws(() => validateLayout([a, { ...b, y: 0.72 }], 1, ['a@x.co', 'b@x.co']), /overlap/);
    assert.throws(() => validateLayout([a], 1, ['a@x.co', 'b@x.co']), /at least one signature/);
    assert.throws(() => validateLayout([{ ...a, signerKey: 'ghost@x.co' }], 1, ['a@x.co']), /not a signer/);
    assert.throws(() => validateLayout([{ ...a, kind: 'DATE' as const }], 1, ['a@x.co']), /at least one signature/);
    assert.equal(validateLayout([], 1, ['a@x.co']).length, 0);
  });

  await t('layout hash: stable under reordering, changes when a box moves', () => {
    const rows = [
      { signerEmail: 'A@x.co', kind: 'SIGNATURE', page: 2, x: 0.1, y: 0.7, width: 0.3, height: 0.06 },
      { signerEmail: 'b@x.co', kind: 'DATE', page: 1, x: 0.5, y: 0.2, width: 0.1, height: 0.03 },
    ];
    const h = sha256(layoutCanonical(rows));
    assert.equal(sha256(layoutCanonical([...rows].reverse())), h);
    assert.notEqual(sha256(layoutCanonical([{ ...rows[0]!, x: 0.1001 }, rows[1]!])), h);
    assert.equal(sha256(layoutCanonical([{ ...rows[0]!, signerEmail: 'a@x.co' }, rows[1]!])), h);
  });

  await t('reminder cadence: defaults, overrides, caps and due times', () => {
    assert.deepEqual(reminderPolicy({}), { intervalDays: 3, max: 3 });
    assert.deepEqual(reminderPolicy({ reminderIntervalDays: 1, reminderMax: 7 }), { intervalDays: 1, max: 7 });
    assert.deepEqual(reminderPolicy({ reminderIntervalDays: 99, reminderMax: 99 }), { intervalDays: 30, max: 10 });
    const sent = new Date(Date.UTC(2026, 9, 1, 8, 0, 0));
    const p = reminderPolicy({ reminderIntervalDays: 2, reminderMax: 2 });
    assert.ok(!reminderDue({ reminderCount: 0, notifiedAt: sent }, p, new Date(sent.getTime() + 47 * 3_600_000)));
    assert.ok(reminderDue({ reminderCount: 0, notifiedAt: sent }, p, new Date(sent.getTime() + 48 * 3_600_000)));
    assert.ok(!reminderDue({ reminderCount: 2, notifiedAt: sent }, p, new Date(sent.getTime() + 9 * 86_400_000)));
    assert.ok(!reminderDue({ reminderCount: 0, notifiedAt: null }, p, new Date()));
    assert.equal(nextReminderAt({ reminderCount: 0, notifiedAt: sent }, p)?.toISOString(), '2026-10-03T08:00:00.000Z');
    assert.equal(nextReminderAt({ reminderCount: 2, notifiedAt: sent }, p), null);
    assert.equal(reminderPolicy({ reminderMax: 0 }).max, 0);
    assert.ok(!reminderDue({ reminderCount: 0, notifiedAt: sent }, reminderPolicy({ reminderMax: 0 }), new Date(sent.getTime() + 30 * 86_400_000)));
  });

  await t('initials', () => {
    assert.equal(initialsOf('Jane Q. Doe'), 'JD');
    assert.equal(initialsOf('Plato'), 'PL');
    assert.equal(initialsOf('   '), '?');
  });

  await t('pack: one signature + date box per role per part, inside the page count', async () => {
    const roles = [
      { key: 'lp1@x.co', label: 'Investor - One' },
      { key: 'lp2@x.co', label: 'Investor - Two' },
      { key: 'staff@x.co', label: 'Countersignature' },
    ];
    const pack = await buildPack({
      heading: 'Subscription pack',
      cover: [['Investor', 'Demo LP']],
      roles,
      sections: [
        { title: 'Agreement', paragraphs: ['A '.repeat(900)], signedBy: roles.map((r) => r.key) },
        { title: 'Declarations', paragraphs: ['B'], signedBy: ['lp1@x.co', 'lp2@x.co'] },
        { title: 'Notices', paragraphs: ['C'], signedBy: ['lp1@x.co', 'lp2@x.co'] },
      ],
    });
    assert.ok(isPdf(pack.pdf));
    assert.equal(pack.slots.filter((s) => s.kind === 'SIGNATURE').length, 3 + 2 + 2);
    assert.equal(pack.slots.filter((s) => s.kind === 'DATE').length, 7);
    const doc = await PDFDocument.load(pack.pdf);
    assert.equal(doc.getPageCount(), pack.pageCount);
    assert.ok(pack.pageCount >= 4, 'cover + 3 parts');
    const fields = pack.slots.map((s) => ({ ...s, signerKey: s.roleKey }));
    assert.equal(validateLayout(fields, pack.pageCount, roles.map((r) => r.key)).length, fields.length);
    // The countersigner signs part 1 only.
    assert.equal(pack.slots.filter((s) => s.roleKey === 'staff@x.co' && s.kind === 'SIGNATURE').length, 1);
  });

  await t('pack: a long section pushes its signature boxes onto a later page without overlap', async () => {
    const pack = await buildPack({ heading: 'Long', cover_page: false, roles: [{ key: 'a', label: 'A' }], sections: [{ title: 'Long text', paragraphs: Array.from({ length: 40 }, (_, i) => `Paragraph ${i} `.repeat(30)) }] });
    const sigs = pack.slots.filter((s) => s.kind === 'SIGNATURE');
    assert.equal(sigs.length, 1);
    assert.ok(sigs[0]!.page >= 2);
    assert.equal(sigs[0]!.page, pack.pageCount);
  });

  await t('appendSheet shifts slot pages by the source page count', async () => {
    const source = await samplePdf(3);
    const sheet = await buildPack({ heading: 'Approval', cover_page: false, roles: [{ key: 'a', label: 'A' }], sections: [{ title: 'Approve', paragraphs: ['ok'] }] });
    const merged = await appendSheet(source, sheet);
    assert.equal(merged.pageCount, 3 + sheet.pageCount);
    assert.ok(merged.slots.every((s) => s.page > 3 && s.page <= merged.pageCount));
    assert.equal((await PDFDocument.load(merged.pdf)).getPageCount(), merged.pageCount);
  });

  await t('seal: fields are stamped on the original pages and the seal still verifies structurally', async () => {
    const original = await samplePdf(2);
    const signers = [sealSigner('s1', 'Jane Doe'), sealSigner('s2', 'John Roe')];
    const base = {
      ref: 'ESG-00001',
      title: 'Test',
      subjectLabel: null,
      originalPdf: original,
      originalSha256: sha256(original),
      createdAt: new Date(Date.UTC(2026, 9, 3, 8, 0, 0)),
      completedAt: new Date(Date.UTC(2026, 9, 3, 9, 30, 0)),
      chainHead: sha256('head'),
      signers,
      events: [],
      verifyUrl: 'https://onboarding.example/sign/verify',
    };
    const plain = await nativeESign.seal(base);
    const placed = await nativeESign.seal({
      ...base,
      fields: [
        { signerId: 's1', kind: 'SIGNATURE', page: 2, x: 0.1, y: 0.7, width: 0.3, height: 0.06 },
        { signerId: 's1', kind: 'DATE', page: 2, x: 0.45, y: 0.72, width: 0.12, height: 0.03 },
        { signerId: 's2', kind: 'SIGNATURE', page: 1, x: 0.1, y: 0.5, width: 0.3, height: 0.06 },
        { signerId: 's2', kind: 'INITIALS', page: 1, x: 0.5, y: 0.5, width: 0.08, height: 0.04 },
        { signerId: 'ghost', kind: 'NAME', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.03 },
        { signerId: 's1', kind: 'NAME', page: 9, x: 0.1, y: 0.1, width: 0.2, height: 0.03 },
      ],
      fieldsSha256: sha256('layout'),
    });
    assert.ok(isPdf(placed.sealedPdf));
    assert.notEqual(placed.sealedSha256, plain.sealedSha256);
    assert.ok(placed.sealedPdf.length > plain.sealedPdf.length, 'stamps add content');
    const a = await PDFDocument.load(plain.sealedPdf);
    const b = await PDFDocument.load(placed.sealedPdf);
    assert.equal(a.getPageCount(), b.getPageCount(), 'stamping adds no pages');
    assert.equal(b.getKeywords(), a.getKeywords());
    assert.equal(placed.sealedSha256, sha256(placed.sealedPdf));
    assert.equal(sha256(original), base.originalSha256, 'the original bytes are never changed');
  });

  await t('placeholders: labelled boxes on the real PDF, out-of-range pages ignored', async () => {
    const original = await samplePdf(1);
    const doc = await PDFDocument.load(original);
    await stampPlaceholders(doc, [
      { signerId: 'a', kind: 'SIGNATURE', page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.06, label: 'Jane Doe' },
      { signerId: 'a', kind: 'DATE', page: 5, x: 0.1, y: 0.7, width: 0.3, height: 0.06, label: 'Jane Doe' },
    ]);
    const out = Buffer.from(await doc.save());
    assert.ok(isPdf(out) && out.length > original.length);
  });

  console.log(`\n${passed} e-sign depth checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
