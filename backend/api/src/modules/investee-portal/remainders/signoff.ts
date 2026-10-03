import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit } from '../../../lib/audit';
import { enqueue } from '../../../lib/outbox';
import { nextRef } from '../../../lib/refs';
import { storeFile } from '../../../lib/storage';
import { createRequest, registerCompletionHook, type EsignActor } from '../../esign';
import { loadPeriod } from '../../company/company.service';
import { authorityText } from '../investee.context';

/**
 * Reporting sign-off: once a company has submitted a period's pack, its authorised signatories sign a one-page
 * declaration of the submitted figures through the native e-sign module (subjectType INVESTEE_REPORT). The signed
 * copy is sealed by the e-sign module and filed as a new version of the declaration document.
 */
export const SUBJECT = 'INVESTEE_REPORT';

const clean = (s: string) => s.replace(/[^\x20-\x7e]/g, '?');
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : 'n/a');

type Period = Awaited<ReturnType<typeof loadPeriod>>;

/** Deterministic for a given submission (no clock), so the same pack always hashes the same. */
async function declarationPdf(company: { name: string; ref: string; reportingCurrency: string }, p: Period): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]);
  let y = 790;
  const ink = rgb(0.1, 0.12, 0.16);
  const line = (text: string, o: { f?: typeof font; size?: number; x?: number } = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 10;
    const x = o.x ?? 56;
    let cur = '';
    const flush = () => {
      if (y < 70) {
        page = doc.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(cur, { x, y, size, font: f, color: ink });
      y -= size + 5;
      cur = '';
    };
    for (const w of clean(text).split(' ')) {
      const probe = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(probe, size) > 595.28 - x - 56 && cur) {
        flush();
        cur = w;
      } else cur = probe;
    }
    if (cur) flush();
  };
  line('Matanho Nexus', { f: bold, size: 9 });
  y -= 6;
  line('Reporting Pack Declaration', { f: bold, size: 18 });
  y -= 10;
  const rows: [string, string][] = [
    ['Company', `${company.name} (${company.ref})`],
    ['Reporting period', `${p.label} (${p.period})`],
    ['Submitted', `${isoDay(p.submittedAt)}`],
    ['Currency', company.reportingCurrency],
  ];
  for (const [k, v] of rows) {
    page.drawText(clean(k), { x: 56, y, size: 9, font: bold, color: rgb(0.4, 0.43, 0.48) });
    line(v, { x: 190 });
  }
  y -= 8;
  line('Submitted figures', { f: bold, size: 12 });
  const kpis = p.kpiValues && typeof p.kpiValues === 'object' && !Array.isArray(p.kpiValues) ? Object.entries(p.kpiValues as Record<string, unknown>) : [];
  if (!kpis.length) line('No headline figures were entered.');
  for (const [k, v] of kpis.slice(0, 40)) {
    page.drawText(clean(k).slice(0, 40), { x: 56, y, size: 9, font, color: ink });
    line(String(v ?? ''), { x: 260, size: 9 });
  }
  y -= 8;
  line('Pack contents', { f: bold, size: 12 });
  for (const i of p.items) line(`${i.title}: ${i.status}${i.required ? '' : ' (optional)'}`, { size: 9 });
  y -= 10;
  line('Declaration', { f: bold, size: 12 });
  line(`The signatories confirm, on behalf of ${company.name}, that the figures and documents submitted for ${p.label} are complete, accurate and prepared from the company's books and records, and that they are authorised to give this confirmation.`);
  y -= 6;
  line('Electronic signature has the same effect as a handwritten signature; the signing record, document hash and certificate of completion form part of this declaration.');
  return Buffer.from(await doc.save());
}

export async function requestSignoff(actor: EsignActor, companyId: string, periodKey: string) {
  const company = await prisma.portfolioCompany.findUnique({ where: { id: companyId } });
  if (!company) throw HttpError.notFound('Company not found');
  const period = await loadPeriod(companyId, periodKey);
  if (period.status !== 'submitted' && period.status !== 'accepted') throw HttpError.conflict('Only a submitted reporting pack can be signed off', 'invalid_state');
  const signed = await prisma.investeeReportSignoff.findFirst({ where: { periodId: period.id, status: 'SIGNED' } });
  if (signed) throw HttpError.conflict(`${period.label} was already signed off (${signed.esignRef})`, 'already_signed');
  const open = await prisma.esignRequest.findFirst({ where: { subjectType: SUBJECT, subjectId: period.id, status: { in: ['DRAFT', 'PENDING'] } }, select: { ref: true } });
  if (open) throw HttpError.conflict(`Signature request ${open.ref} is already open for ${period.label}`, 'esign_already_open');
  const members = await prisma.companyUser.findMany({ where: { companyId, status: 'active', user: { isActive: true } }, select: { userId: true, title: true, signingAuthority: true } });
  const signers = members.filter((m) => authorityText(m.signingAuthority, m.title)).map((m) => ({ userId: m.userId, kind: 'INVESTEE' as const, companyId }));
  if (!signers.length) throw HttpError.badRequest('No member of this company holds signing authority. Add one in the company workspace first.');

  const pdf = await declarationPdf(company, period);
  const stored = await storeFile({ name: `Reporting declaration ${company.ref} ${period.period}.pdf`, mime: 'application/pdf', data: pdf, uploadedById: actor.userId });
  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        ref: await nextRef(tx, 'document'),
        name: `Reporting declaration - ${company.name} - ${period.label}`,
        type: 'legal',
        label: 'Signature required',
        classification: 'Client',
        status: 'Draft',
        companyId,
        period: period.period,
        relatedType: SUBJECT,
        relatedId: period.id,
        relatedLabel: `${period.label} reporting declaration`,
        requiresSignature: true,
        category: 'REPORTING',
        sourceType: 'GP_UPLOAD',
        year: new Date().getUTCFullYear(),
        documentDate: new Date(),
        ownerName: 'Investment team',
        createdBy: actor.userId,
        makerId: actor.userId,
      },
    });
    await tx.documentVersion.create({ data: { documentId: doc.id, version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: actor.userId } });
    return doc;
  });
  const request = await createRequest(actor, {
    title: `Reporting declaration - ${company.name} - ${period.label}`,
    message: `Please review and sign the reporting declaration for ${period.label}.`,
    documentId: document.id,
    signingOrder: 'PARALLEL',
    signers,
    expiresInDays: 14,
    subjectType: SUBJECT,
    subjectId: period.id,
    companyId,
  });
  const row = await prisma.investeeReportSignoff.create({
    data: { companyId, periodId: period.id, period: period.period, esignRequestId: request.id, esignRef: request.ref, packSha256: stored.sha256, requestedById: actor.userId ?? '', requestedByName: (actor.name ?? 'Staff').slice(0, 120) },
  });
  await prisma.$transaction((tx) =>
    writeAudit(tx, { actorId: actor.userId, actorRole: actor.role, portal: actor.portal, ip: actor.ip, requestId: actor.requestId ?? null }, { action: 'investee.report_signoff.requested', objectType: 'investee_report_signoff', objectId: row.id, after: { companyId, period: period.period, esign: request.ref, signers: signers.length, packSha256: stored.sha256 } }),
  );
  return signoffView(row, request.status);
}

type Row = Awaited<ReturnType<typeof prisma.investeeReportSignoff.findMany>>[number];
const signoffView = (r: Row, esignStatus: string | null) => ({
  id: r.id,
  period: r.period,
  esignRef: r.esignRef,
  esignRequestId: r.esignRequestId,
  packSha256: r.packSha256,
  status: r.status === 'SIGNED' ? 'SIGNED' : esignStatus === 'PENDING' || !esignStatus || esignStatus === 'DRAFT' ? 'REQUESTED' : esignStatus,
  requestedBy: r.requestedByName,
  requestedAt: r.requestedAt.toISOString(),
  signedAt: r.signedAt?.toISOString() ?? null,
});

export async function signoffs(companyId: string) {
  const rows = await prisma.investeeReportSignoff.findMany({ where: { companyId }, orderBy: { requestedAt: 'desc' }, take: 100 });
  const reqs = await prisma.esignRequest.findMany({ where: { id: { in: rows.map((r) => r.esignRequestId) } }, select: { id: true, status: true } });
  const status = new Map(reqs.map((r) => [r.id, r.status]));
  const periods = await prisma.reportingPeriod.findMany({ where: { companyId, status: { in: ['submitted', 'accepted'] } }, orderBy: { period: 'desc' }, take: 12, select: { period: true, label: true, status: true, submittedAt: true } });
  return {
    signoffs: rows.map((r) => signoffView(r, status.get(r.esignRequestId) ?? null)),
    periods: periods.map((p) => ({ period: p.period, label: p.label, status: p.status, submittedAt: p.submittedAt?.toISOString() ?? null })),
  };
}

registerCompletionHook(SUBJECT, async (tx, request, by) => {
  const signedAt = by.map((s) => s.signedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date();
  const claim = await tx.investeeReportSignoff.updateMany({ where: { esignRequestId: request.id, status: 'REQUESTED' }, data: { status: 'SIGNED', signedAt } });
  if (!claim.count) return;
  const row = await tx.investeeReportSignoff.findFirst({ where: { esignRequestId: request.id } });
  await writeAudit(tx, { actorId: null, actorRole: 'E-signature', portal: null }, { action: 'investee.report_signoff.signed', objectType: 'investee_report_signoff', objectId: row?.id ?? request.id, after: { esign: request.ref, signedBy: by.map((s) => s.name) } });
  await enqueue(tx, 'notify.permission', { permission: 'research.edit', type: 'investee.report_signed', title: `Reporting declaration ${request.ref} is signed`, body: request.title, link: '/ops/investee-review' });
  if (row?.requestedById) await enqueue(tx, 'notify.users', { userIds: [row.requestedById], type: 'investee.report_signed', title: `Reporting declaration ${request.ref} is signed`, body: request.title, link: '/ops/investee-review' });
});
