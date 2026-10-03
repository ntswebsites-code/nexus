import { HttpError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { nextRef } from '../../lib/refs';
import { storeFile } from '../../lib/storage';
import { investedAmount } from './investee.service';
import type { InvesteeContext } from './investee.context';
import { INVESTEE_VISIBLE } from '../term-sheets/term-sheets.service';

/**
 * Company workspace. Cap table, forecast, governance, requisitions, board, signature requests and share links are
 * tables (see ./workspace/*); this file keeps the original export names so routes and staff screens are unchanged.
 * The vault and the application summary are read from documents, term sheets and the company row.
 */
export { capTableSchema, capTableView, roundSchema, saveCapTable, simulateRound } from './workspace/cap';
export {
  addConsent,
  consentDecisionSchema,
  consentSchema,
  createRequisition,
  decideConsent,
  decideRequisition,
  decisionSchema,
  forecastSchema,
  forecastView,
  governanceView,
  listConsentsForStaff,
  listRequisitionsForStaff,
  requisitionList,
  requisitionSchema,
  saveForecast,
} from './workspace/records';

export async function vaultDocuments(companyId: string) {
  const docs = await prisma.document.findMany({
    where: { companyId },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, ref: true, name: true, type: true, status: true, createdAt: true, updatedAt: true },
  });
  return docs.map((d) => ({
    id: d.id,
    ref: d.ref,
    fileName: d.name,
    name: d.name,
    documentType: d.type,
    type: d.type,
    isSubmitted: d.status === 'Approved' || d.status === 'Published',
    uploadedAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    status: d.status,
  }));
}

/** INO-021: the bytes must match the declared type; executables are refused whatever they are called. */
export function assertFileContentMatches(file: { originalname: string; mimetype: string; buffer: Buffer }) {
  const b = file.buffer;
  const starts = (sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
  const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
  const mime = file.mimetype.toLowerCase();
  if (starts([0x4d, 0x5a]) || starts([0x7f, 0x45, 0x4c, 0x46]) || starts([0x23, 0x21]) || starts([0xca, 0xfe, 0xba, 0xbe])) {
    throw HttpError.badRequest('This file looks like a program, not a document, and was not stored', [{ path: 'file', message: 'Executable content is not accepted' }]);
  }
  const bad = (what: string) =>
    HttpError.badRequest(`The file content is not a valid ${what}; it does not match its name or type`, [{ path: 'file', message: `Not a valid ${what}` }]);
  if ((ext === 'pdf' || mime === 'application/pdf') && !b.subarray(0, 1024).includes('%PDF-')) throw bad('PDF');
  if ((ext === 'png' || mime === 'image/png') && !starts([0x89, 0x50, 0x4e, 0x47])) throw bad('PNG image');
  if ((ext === 'jpg' || ext === 'jpeg' || mime === 'image/jpeg') && !starts([0xff, 0xd8, 0xff])) throw bad('JPEG image');
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext) && !starts([0x50, 0x4b])) throw bad('Office document');
  if (['csv', 'txt'].includes(ext) && b.subarray(0, 4096).includes(0)) throw bad('text file');
}

export async function uploadVaultFile(
  c: InvesteeContext,
  file: { originalname: string; mimetype: string; buffer: Buffer },
  meta: { name?: string; type?: string },
  audit: AuditContext,
) {
  assertFileContentMatches(file);
  const id = await prisma.$transaction(async (tx) => {
    const stored = await storeFile({ name: file.originalname, mime: file.mimetype, data: file.buffer, uploadedById: c.userId }, tx);
    const ref = await nextRef(tx, 'document');
    const doc = await tx.document.create({
      data: {
        ref,
        name: (meta.name || file.originalname).slice(0, 255),
        type: (meta.type || 'company').slice(0, 32),
        classification: 'Client',
        status: 'Published',
        ownerName: c.company.name,
        companyId: c.company.id,
        relatedType: 'company',
        relatedId: c.company.id,
        relatedLabel: c.company.name,
        year: new Date().getFullYear(),
        makerId: c.userId,
        createdBy: c.userId,
        versions: { create: { version: 1, fileId: stored.id, sha256: stored.sha256, uploadedById: c.userId } },
      },
    });
    await writeAudit(tx, audit, { action: 'company.vault.uploaded', objectType: 'document', objectId: doc.id, after: { ref, name: doc.name } });
    return doc.id;
  });
  const docs = await vaultDocuments(c.company.id);
  return docs.find((d) => d.id === id) ?? docs[0];
}

export async function applicationView(c: InvesteeContext) {
  const company = c.company;
  const [latest, documents] = await Promise.all([
    prisma.termSheet.findFirst({
      where: { companyId: company.id, status: { in: [...INVESTEE_VISIBLE] } },
      orderBy: { issuedAt: 'desc' },
      select: { investmentAmount: true, equityPercentage: true, status: true, issuedAt: true },
    }),
    vaultDocuments(company.id),
  ]);
  const invested = investedAmount(company);
  const requested = latest ? latest.investmentAmount.toNumber() : invested || null;
  const stage = invested > 0 ? 'Invested' : latest ? 'Term sheet issued' : company.status;
  return {
    id: company.id,
    businessName: company.legalName || company.name,
    currentStage: stage,
    submittedAt: company.createdAt.toISOString(),
    requestedAmount: requested,
    approvedAmount: invested || null,
    industry: company.industry ?? company.sector,
    businessStage: company.fundingStage,
    applicationProgress: invested > 0 ? 100 : latest ? 80 : 20,
    registrationNumber: company.registrationNumber,
    equityPercentage: latest ? latest.equityPercentage.toNumber() : null,
    termSheetStatus: latest?.status ?? null,
    documents,
  };
}

export async function signatureRequests(companyId: string) {
  const rows = await prisma.termSheet.findMany({
    where: { companyId, status: { in: [...INVESTEE_VISIBLE] } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, ref: true, title: true, status: true, signedAt: true, issuedAt: true, updatedAt: true },
  });
  return rows.map((ts) => {
    const signed = ts.status === 'SIGNED_BY_COMPANY' || ts.status === 'COUNTERSIGNED' || ts.status === 'EXECUTED';
    const declined = ts.status === 'WITHDRAWN';
    return {
      id: ts.id,
      termSheetId: ts.id,
      document: ts.title,
      category: 'Term sheet',
      status: signed ? 'Completed' : declined ? 'Declined' : 'Awaiting your signature',
      ref: ts.ref,
      updatedAt: ts.updatedAt.toISOString(),
      signedAt: ts.signedAt?.toISOString() ?? null,
    };
  });
}
