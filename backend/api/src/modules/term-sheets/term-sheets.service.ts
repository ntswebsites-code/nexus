import { Prisma, type PortfolioCompany, type TermSheet } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { writeAudit, type AuditContext } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { nextRef } from '../../lib/refs';
import { sha256Hex } from '../../lib/crypto';
import { signedDownloadUrl, storeFile } from '../../lib/storage';
import { simplePdf } from './pdf';

/**
 * Term sheet lifecycle (SRD 5D J6):
 *   DRAFT --submit (maker)--> PENDING_APPROVAL --approve (checker != maker, step-up)--> APPROVED
 *   APPROVED --issue (step-up)--> ISSUED --investee opens--> VIEWED
 *   ISSUED|VIEWED --sign (signing authority, step-up)--> SIGNED_BY_COMPANY
 *   ISSUED|VIEWED --decline--> DECLINED
 *   PENDING_APPROVAL --return--> DRAFT;  any pre-signature state --withdraw--> WITHDRAWN
 * SIGNED_BY_COMPANY --countersign (staff, step-up, not the issuer)--> COUNTERSIGNED
 * COUNTERSIGNED --execute (a different staff member, step-up)--> EXECUTED
 */
export const TERM_SHEET_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ISSUED',
  'VIEWED',
  'SIGNED_BY_COMPANY',
  'COUNTERSIGNED',
  'EXECUTED',
  'DECLINED',
  'WITHDRAWN',
] as const;
export type TermSheetStatus = (typeof TERM_SHEET_STATUSES)[number];

/** States an investee can see. Drafts and internal approval states are never exposed. */
export const INVESTEE_VISIBLE: TermSheetStatus[] = ['ISSUED', 'VIEWED', 'SIGNED_BY_COMPANY', 'COUNTERSIGNED', 'EXECUTED', 'DECLINED'];
export const SIGNABLE: TermSheetStatus[] = ['ISSUED', 'VIEWED'];
const WITHDRAWABLE: TermSheetStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'VIEWED'];

export const CONSENT_VERSION = 'ts-esign-v1';
export const CONSENT_TEXT =
  'I confirm that I am authorised to sign this term sheet on behalf of the company named in it, that I have ' +
  'read it in full, and that typing my name and confirming is my electronic signature with the same effect as a ' +
  'handwritten signature. I understand that the time, my IP address, browser, session and multi-factor ' +
  'verification, and the SHA-256 fingerprint of the document are recorded as evidence of this signature.';
export const CONSENT_HASH = sha256Hex(`${CONSENT_VERSION}\n${CONSENT_TEXT}`);
export const consentBlock = () => ({ version: CONSENT_VERSION, text: CONSENT_TEXT, hash: CONSENT_HASH });

const money = (d: Prisma.Decimal) => d.toFixed(2);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function keyTermsText(raw: Prisma.JsonValue | null): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.summary === 'string' && Object.keys(o).length === 1) return o.summary;
    return Object.entries(o)
      .map(([k, v]) => `${k}: ${typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)}`)
      .join('\n');
  }
  return String(raw);
}

// ---------------------------------------------------------------- refs

async function nextTermSheetRef(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`INSERT INTO sequences (name, value) VALUES ('termSheet', 1000) ON DUPLICATE KEY UPDATE value = value`;
  await tx.$executeRaw`UPDATE sequences SET value = LAST_INSERT_ID(value + 1) WHERE name = 'termSheet'`;
  const rows = await tx.$queryRaw<{ v: bigint | number }[]>`SELECT LAST_INSERT_ID() AS v`;
  return `TS-${Number(rows[0]!.v)}`;
}

// ---------------------------------------------------------------- loading

type WithCompany = TermSheet & { company: PortfolioCompany };

/** Staff lookup by id or ref. */
export async function loadTermSheet(idOrRef: string): Promise<WithCompany> {
  const ts = await prisma.termSheet.findFirst({ where: { OR: [{ id: idOrRef }, { ref: idOrRef }] }, include: { company: true } });
  if (!ts) throw HttpError.notFound('Term sheet not found');
  return ts;
}

/** Investee lookup: scoped to the caller's company and to issued states. Anything else is a 404. */
export async function loadCompanyTermSheet(companyId: string, idOrRef: string): Promise<WithCompany> {
  const ts = await prisma.termSheet.findFirst({
    where: { companyId, status: { in: INVESTEE_VISIBLE }, OR: [{ id: idOrRef }, { ref: idOrRef }] },
    include: { company: true },
  });
  if (!ts) throw HttpError.notFound('Term sheet not found');
  return ts;
}

interface Extras {
  document: { id: string; ref: string; fileId: string | null; fileName: string | null; size: number | null; sha256: string | null } | null;
  signature: Prisma.SignatureGetPayload<object> | null;
  request: { id: string; status: string } | null;
  createdBy: { id: string; firstName: string; lastName: string; email: string } | null;
  people: Record<string, string>;
}

export async function loadExtras(rows: TermSheet[]): Promise<Map<string, Extras>> {
  const ids = rows.map((r) => r.id);
  const docIds = rows.map((r) => r.documentId).filter((x): x is string => !!x);
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.createdById, r.approvedById, r.issuedById]).filter((x): x is string => !!x)),
  ];
  const [docs, requests, users] = await Promise.all([
    docIds.length
      ? prisma.document.findMany({ where: { id: { in: docIds } }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
      : Promise.resolve([]),
    ids.length
      ? prisma.signatureRequest.findMany({
          where: { subjectType: 'term_sheet', subjectId: { in: ids } },
          include: { signatures: { orderBy: { signedAt: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } } }) : Promise.resolve([]),
  ]);
  const fileIds = docs.map((d) => d.versions[0]?.fileId).filter((x): x is string => !!x);
  const files = fileIds.length ? await prisma.fileObject.findMany({ where: { id: { in: fileIds } } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const out = new Map<string, Extras>();
  for (const r of rows) {
    const doc = docs.find((d) => d.id === r.documentId);
    const v = doc?.versions[0];
    const file = v ? files.find((f) => f.id === v.fileId) : undefined;
    const req = requests.find((q) => q.subjectId === r.id);
    const creator = r.createdById ? userById.get(r.createdById) : undefined;
    const people: Record<string, string> = {};
    for (const id of [r.createdById, r.approvedById, r.issuedById]) {
      const u = id ? userById.get(id) : undefined;
      if (u && id) people[id] = u.name ?? u.email;
    }
    const creatorName = creator ? (creator.name ?? creator.email) : '';
    out.set(r.id, {
      document: doc
        ? { id: doc.id, ref: doc.ref, fileId: v?.fileId ?? null, fileName: file?.name ?? null, size: file?.size ?? null, sha256: v?.sha256 ?? null }
        : null,
      signature: req?.signatures[0] ?? null,
      request: req ? { id: req.id, status: req.status } : null,
      createdBy: creator
        ? { id: creator.id, firstName: creatorName.split(' ')[0] ?? creatorName, lastName: creatorName.split(' ').slice(1).join(' '), email: creator.email }
        : null,
      people,
    });
  }
  return out;
}

function evidence(sig: Extras['signature']) {
  if (!sig) return null;
  return {
    signerName: sig.signerName,
    authority: sig.authority,
    signedAt: sig.signedAt.toISOString(),
    docSha256: sig.docSha256,
    consentTextVersion: sig.consentTextVersion,
    consentHash: sig.consentHash,
    mfaAt: iso(sig.mfaAt),
    certificateDocumentId: sig.certificateDocumentId,
  };
}

// ---------------------------------------------------------------- views

/** NVCCZ `TermSheet` shape plus Nexus fields (contract: investee.contract.ts `termSheetSchema`). */
export function investeeTermSheetView(ts: TermSheet, x: Extras | undefined, viewer: { canSign: boolean }) {
  const status = ts.status as TermSheetStatus;
  const signable = SIGNABLE.includes(status);
  const signed = ['SIGNED_BY_COMPANY', 'COUNTERSIGNED', 'EXECUTED'].includes(status);
  const sig = x?.signature ?? null;
  return {
    id: ts.id,
    applicationId: null,
    title: ts.title,
    version: `v${ts.versionNo}`,
    status,
    investmentAmount: money(ts.investmentAmount),
    equityPercentage: ts.equityPercentage.toNumber(),
    valuation: money(ts.valuation),
    keyTerms: keyTermsText(ts.keyTerms),
    conditions: ts.conditions,
    timeline: ts.timeline,
    documentUrl: x?.document?.fileId ? signedDownloadUrl(x.document.fileId, 300) : null,
    documentFileName: x?.document?.fileName ?? null,
    documentSize: x?.document?.size ?? null,
    isDraft: false,
    isFinal: true,
    isSigned: signed,
    signedAt: iso(ts.signedAt),
    applicantSignatureUrl: null,
    applicantSignatureFileName: null,
    applicantSignedById: sig?.signerUserId ?? null,
    applicantSignedAt: sig ? sig.signedAt.toISOString() : null,
    investorSignatureUrl: null,
    investorSignatureFileName: null,
    investorSignedById: null,
    investorSignedAt: null,
    createdAt: ts.createdAt.toISOString(),
    updatedAt: ts.updatedAt.toISOString(),
    createdBy: x?.createdBy ?? null,
    application: null,
    ref: ts.ref,
    currency: ts.currency,
    structuredTerms: ts.keyTerms ?? null,
    issuedAt: iso(ts.issuedAt),
    viewedAt: iso(ts.viewedAt),
    canSign: signable && viewer.canSign,
    canDecline: signable && viewer.canSign,
    consent: consentBlock(),
    signature: evidence(sig),
  };
}

export function staffTermSheetView(ts: WithCompany, x: Extras | undefined) {
  const name = (id: string | null) => (id ? (x?.people[id] ?? null) : null);
  return {
    id: ts.id,
    ref: ts.ref,
    title: ts.title,
    status: ts.status,
    versionNo: ts.versionNo,
    version: ts.version,
    company: { id: ts.company.id, ref: ts.company.ref, name: ts.company.name },
    investmentAmount: money(ts.investmentAmount),
    valuation: money(ts.valuation),
    equityPercentage: ts.equityPercentage.toNumber(),
    currency: ts.currency,
    keyTerms: ts.keyTerms ?? null,
    keyTermsText: keyTermsText(ts.keyTerms),
    conditions: ts.conditions,
    timeline: ts.timeline,
    createdById: ts.createdById,
    createdByName: name(ts.createdById),
    approvedById: ts.approvedById,
    approvedByName: name(ts.approvedById),
    issuedById: ts.issuedById,
    issuedByName: name(ts.issuedById),
    issuedAt: iso(ts.issuedAt),
    viewedAt: iso(ts.viewedAt),
    signedAt: iso(ts.signedAt),
    createdAt: ts.createdAt.toISOString(),
    updatedAt: ts.updatedAt.toISOString(),
    document: x?.document
      ? { id: x.document.id, ref: x.document.ref, fileName: x.document.fileName, size: x.document.size, sha256: x.document.sha256 }
      : null,
    signatureRequest: x?.request ?? null,
    signature: evidence(x?.signature ?? null),
  };
}

// ---------------------------------------------------------------- staff mutations

const amount = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/)]).transform((v) => new Prisma.Decimal(v));

export const createTermSheetSchema = z.object({
  company: z.string().trim().min(1).max(36),
  title: z.string().trim().min(1).max(255),
  investmentAmount: amount,
  valuation: amount,
  equityPercentage: z.union([z.number(), z.string().trim()]).transform(Number).pipe(z.number().min(0).max(100)),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('USD'),
  keyTerms: z.union([z.string().max(20000), z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish(),
  conditions: z.string().max(20000).nullish(),
  timeline: z.string().max(20000).nullish(),
});
export const updateTermSheetSchema = createTermSheetSchema.omit({ company: true }).partial().extend({ version: z.number().int() });

const jsonTerms = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : ((typeof v === 'string' ? { summary: v } : v) as Prisma.InputJsonValue);

export async function createTermSheet(actor: { userId: string; audit: AuditContext }, input: z.infer<typeof createTermSheetSchema>) {
  const company = await prisma.portfolioCompany.findFirst({ where: { OR: [{ id: input.company }, { ref: input.company }] } });
  if (!company) throw HttpError.notFound('Company not found');
  return prisma.$transaction(async (tx) => {
    const ref = await nextTermSheetRef(tx);
    const ts = await tx.termSheet.create({
      data: {
        ref,
        companyId: company.id,
        title: input.title,
        investmentAmount: input.investmentAmount,
        valuation: input.valuation,
        equityPercentage: new Prisma.Decimal(input.equityPercentage.toFixed(2)),
        currency: input.currency,
        keyTerms: jsonTerms(input.keyTerms),
        conditions: input.conditions ?? null,
        timeline: input.timeline ?? null,
        createdById: actor.userId,
        status: 'DRAFT',
      },
    });
    await writeAudit(tx, actor.audit, { action: 'term_sheet.created', objectType: 'term_sheet', objectId: ts.id, after: snapshot(ts) });
    return ts;
  });
}

export async function updateDraft(
  actor: { userId: string; audit: AuditContext },
  ts: TermSheet,
  input: z.infer<typeof updateTermSheetSchema>,
) {
  if (ts.status !== 'DRAFT') throw new HttpError(409, 'invalid_state', 'Only draft term sheets can be edited');
  if (input.version !== ts.version) throw new HttpError(409, 'version_conflict', 'This term sheet was changed by someone else; reload and retry');
  return prisma.$transaction(async (tx) => {
    const next = await tx.termSheet.update({
      where: { id: ts.id },
      data: {
        title: input.title,
        investmentAmount: input.investmentAmount,
        valuation: input.valuation,
        equityPercentage: input.equityPercentage === undefined ? undefined : new Prisma.Decimal(input.equityPercentage.toFixed(2)),
        currency: input.currency,
        keyTerms: jsonTerms(input.keyTerms),
        conditions: input.conditions,
        timeline: input.timeline,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.updated',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: snapshot(ts),
      after: snapshot(next),
    });
    return next;
  });
}

function snapshot(ts: TermSheet) {
  return {
    ref: ts.ref,
    status: ts.status,
    title: ts.title,
    investmentAmount: money(ts.investmentAmount),
    valuation: money(ts.valuation),
    equityPercentage: ts.equityPercentage.toNumber(),
    currency: ts.currency,
    versionNo: ts.versionNo,
  };
}

/** Guarded state change: re-checks the current status inside the transaction (no lost updates). */
async function transition(
  tx: Prisma.TransactionClient,
  ts: TermSheet,
  from: TermSheetStatus[],
  data: Prisma.TermSheetUpdateManyMutationInput,
) {
  const res = await tx.termSheet.updateMany({ where: { id: ts.id, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (res.count !== 1) throw new HttpError(409, 'invalid_state', `Term sheet is not in a state that allows this (${ts.status})`);
  return tx.termSheet.findUniqueOrThrow({ where: { id: ts.id } });
}

export async function submitForApproval(actor: { userId: string; audit: AuditContext }, ts: TermSheet) {
  if (ts.status !== 'DRAFT') throw new HttpError(409, 'invalid_state', 'Only draft term sheets can be submitted for approval');
  if (ts.createdById && ts.createdById !== actor.userId) {
    throw new HttpError(403, 'permission_denied', 'Only the term sheet author can submit it for approval');
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, ['DRAFT'], { status: 'PENDING_APPROVAL' });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.submitted',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'term_sheets.approve',
      type: 'term_sheets.approval',
      title: `Term sheet ${ts.ref} awaiting approval`,
      body: ts.title,
      link: '/?page=private-markets',
    });
    return next;
  });
}

export async function approve(actor: { userId: string; audit: AuditContext }, ts: TermSheet, note?: string) {
  if (ts.createdById === actor.userId) {
    throw new HttpError(403, 'segregation_of_duties', 'The approver must be a different person from the author of this term sheet');
  }
  if (ts.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'invalid_state', 'Only term sheets awaiting approval can be approved');
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, ['PENDING_APPROVAL'], { status: 'APPROVED', approvedById: actor.userId });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.approved',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status, approvedById: actor.userId },
      reason: note ?? null,
    });
    return next;
  });
}

export async function returnToDraft(actor: { userId: string; audit: AuditContext }, ts: TermSheet, reason: string) {
  if (ts.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'invalid_state', 'Only term sheets awaiting approval can be returned');
  if (ts.createdById === actor.userId) {
    throw new HttpError(403, 'segregation_of_duties', 'The reviewer must be a different person from the author of this term sheet');
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, ['PENDING_APPROVAL'], { status: 'DRAFT' });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.returned',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
      reason,
    });
    if (ts.createdById) {
      await enqueue(tx, 'notify.users', {
        userIds: [ts.createdById],
        type: 'term_sheets.returned',
        title: `Term sheet ${ts.ref} returned`,
        body: reason,
        link: '/?page=private-markets',
      });
    }
    return next;
  });
}

export async function withdraw(actor: { userId: string; audit: AuditContext }, ts: WithCompany, reason: string) {
  if (!WITHDRAWABLE.includes(ts.status as TermSheetStatus)) {
    throw new HttpError(409, 'invalid_state', 'Signed, declined or withdrawn term sheets cannot be withdrawn');
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, WITHDRAWABLE, { status: 'WITHDRAWN' });
    await tx.signatureRequest.updateMany({
      where: { subjectType: 'term_sheet', subjectId: ts.id, status: 'Pending' },
      data: { status: 'Cancelled' },
    });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.withdrawn',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
      reason,
    });
    if (SIGNABLE.includes(ts.status as TermSheetStatus)) await notifyCompany(tx, ts.companyId, `Term sheet ${ts.ref} withdrawn`, ts.title);
    return next;
  });
}

async function notifyCompany(tx: Prisma.TransactionClient, companyId: string, title: string, body: string) {
  const users = await tx.companyUser.findMany({ where: { companyId, status: 'active' }, select: { userId: true } });
  if (users.length) {
    await enqueue(tx, 'notify.users', { userIds: users.map((u) => u.userId), type: 'term_sheets', title, body, link: '/term-sheets' });
  }
}

function termSheetPdfLines(ts: WithCompany) {
  return [
    `Reference: ${ts.ref}   Version: v${ts.versionNo}`,
    `Company: ${ts.company.legalName ?? ts.company.name} (${ts.company.ref})`,
    `Investment amount: ${ts.currency} ${money(ts.investmentAmount)}`,
    `Pre-money valuation: ${ts.currency} ${money(ts.valuation)}`,
    `Equity: ${ts.equityPercentage.toFixed(2)}%`,
    '',
    'Key terms:',
    ...(keyTermsText(ts.keyTerms) ?? '-').split('\n'),
    '',
    'Conditions precedent:',
    ...(ts.conditions ?? '-').split('\n'),
    '',
    'Timeline:',
    ...(ts.timeline ?? '-').split('\n'),
    '',
    'This term sheet is issued through Matanho Nexus and is signed electronically by an authorised signatory.',
  ];
}

export async function issue(actor: { userId: string; name: string; audit: AuditContext }, ts: WithCompany) {
  if (ts.status !== 'APPROVED') throw new HttpError(409, 'invalid_state', 'Only approved term sheets can be issued');
  const pdf = simplePdf(`Term sheet - ${ts.title}`, termSheetPdfLines(ts));
  return prisma.$transaction(async (tx) => {
    const file = await storeFile({ name: `${ts.ref}-v${ts.versionNo}.pdf`, mime: 'application/pdf', data: pdf, uploadedById: actor.userId }, tx);
    const doc = await tx.document.create({
      data: {
        ref: await nextRef(tx, 'document'),
        name: `${ts.ref} · ${ts.title}`,
        type: 'legal',
        label: 'Term sheet',
        classification: 'Client',
        status: 'Published',
        ownerName: actor.name,
        relatedType: 'term_sheet',
        relatedId: ts.id,
        relatedLabel: ts.ref,
        companyId: ts.companyId,
        documentDate: new Date(),
        year: new Date().getUTCFullYear(),
        requiresSignature: true,
        makerId: ts.createdById,
        checkerId: ts.approvedById,
        approvedAt: new Date(),
        createdBy: actor.userId,
        versions: { create: { version: 1, fileId: file.id, sha256: file.sha256, uploadedById: actor.userId } },
      },
    });
    // signature_requests.client_id is NOT NULL with no FK; term sheet requests carry the company id there.
    await tx.signatureRequest.create({
      data: { documentId: doc.id, clientId: ts.companyId, status: 'Pending', requestedById: actor.userId, subjectType: 'term_sheet', subjectId: ts.id },
    });
    const next = await transition(tx, ts, ['APPROVED'], {
      status: 'ISSUED',
      issuedById: actor.userId,
      issuedAt: new Date(),
      documentId: doc.id,
    });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.issued',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status, documentId: doc.id, docSha256: file.sha256 },
    });
    await notifyCompany(tx, ts.companyId, `Term sheet ${ts.ref} issued for signature`, ts.title);
    return next;
  });
}

// ---------------------------------------------------------------- investee mutations

export async function markViewed(ts: TermSheet, audit: AuditContext) {
  if (ts.status !== 'ISSUED') return ts;
  return prisma.$transaction(async (tx) => {
    const res = await tx.termSheet.updateMany({ where: { id: ts.id, status: 'ISSUED' }, data: { status: 'VIEWED', viewedAt: new Date() } });
    if (res.count === 1) {
      await writeAudit(tx, audit, {
        action: 'term_sheet.viewed',
        objectType: 'term_sheet',
        objectId: ts.id,
        before: { status: 'ISSUED' },
        after: { status: 'VIEWED' },
      });
    }
    return tx.termSheet.findUniqueOrThrow({ where: { id: ts.id } });
  });
}

export interface SignInput {
  userId: string;
  typedName: string;
  authority: string;
  consentTextVersion: string;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  mfaAt: Date | null;
  signatureImage?: { name: string; mime: string; data: Buffer } | null;
  audit: AuditContext;
}

export async function sign(ts: WithCompany, input: SignInput) {
  if (!SIGNABLE.includes(ts.status as TermSheetStatus)) throw new HttpError(409, 'invalid_state', 'This term sheet is not awaiting signature');
  if (input.consentTextVersion !== CONSENT_VERSION) {
    throw new HttpError(409, 'consent_version_mismatch', 'The signing statement has changed; reload the term sheet and confirm again', {
      expected: CONSENT_VERSION,
    });
  }
  const request = await prisma.signatureRequest.findFirst({
    where: { subjectType: 'term_sheet', subjectId: ts.id, status: 'Pending' },
    include: { document: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
  });
  const version = request?.document.versions[0];
  if (!request || !version) throw new HttpError(409, 'invalid_state', 'This term sheet has no document awaiting signature');
  const consentAt = new Date();
  const certificate = simplePdf(`Signature certificate - ${ts.ref}`, [
    `Term sheet: ${ts.ref} v${ts.versionNo} - ${ts.title}`,
    `Company: ${ts.company.legalName ?? ts.company.name} (${ts.company.ref})`,
    `Document: ${request.document.ref}   SHA-256: ${version.sha256}`,
    '',
    `Signed by: ${input.typedName}`,
    `Authority: ${input.authority}`,
    `Signer user id: ${input.userId}`,
    `Signed at (UTC): ${consentAt.toISOString()}`,
    `Multi-factor verified at (UTC): ${input.mfaAt ? input.mfaAt.toISOString() : 'not enrolled'}`,
    `IP address: ${input.ip ?? 'unknown'}`,
    `Session: ${input.sessionId ?? 'unknown'}`,
    `User agent: ${(input.userAgent ?? 'unknown').slice(0, 200)}`,
    '',
    `Consent statement version: ${CONSENT_VERSION}   SHA-256: ${CONSENT_HASH}`,
    CONSENT_TEXT,
  ]);
  return prisma.$transaction(async (tx) => {
    const signatureFile = input.signatureImage
      ? await storeFile({ ...input.signatureImage, uploadedById: input.userId }, tx)
      : null;
    const certFile = await storeFile(
      { name: `${ts.ref}-signature-certificate.pdf`, mime: 'application/pdf', data: certificate, uploadedById: input.userId },
      tx,
    );
    const certDoc = await tx.document.create({
      data: {
        ref: await nextRef(tx, 'document'),
        name: `${ts.ref} · Signature certificate`,
        type: 'legal',
        label: 'Signature certificate',
        classification: 'Client',
        status: 'Published',
        ownerName: input.typedName,
        relatedType: 'term_sheet',
        relatedId: ts.id,
        relatedLabel: ts.ref,
        companyId: ts.companyId,
        documentDate: consentAt,
        year: consentAt.getUTCFullYear(),
        createdBy: input.userId,
        versions: { create: { version: 1, fileId: certFile.id, sha256: certFile.sha256, uploadedById: input.userId } },
      },
    });
    const next = await transition(tx, ts, SIGNABLE, { status: 'SIGNED_BY_COMPANY', signedAt: consentAt });
    const signature = await tx.signature.create({
      data: {
        requestId: request.id,
        signerUserId: input.userId,
        signerName: input.typedName,
        authority: input.authority.slice(0, 160),
        consentAt,
        mfaAt: input.mfaAt,
        docSha256: version.sha256,
        ip: input.ip?.slice(0, 45) ?? null,
        consentTextVersion: CONSENT_VERSION,
        consentHash: CONSENT_HASH,
        userAgent: input.userAgent?.slice(0, 255) ?? null,
        sessionId: input.sessionId,
        certificateDocumentId: certDoc.id,
        signedAt: consentAt,
      },
    });
    const updated = await tx.signatureRequest.updateMany({ where: { id: request.id, status: 'Pending' }, data: { status: 'Signed' } });
    if (updated.count !== 1) throw new HttpError(409, 'invalid_state', 'This term sheet has already been signed');
    await writeAudit(tx, input.audit, {
      action: 'term_sheet.signed',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: {
        status: next.status,
        signatureId: signature.id,
        signerName: input.typedName,
        authority: input.authority,
        docSha256: version.sha256,
        consentTextVersion: CONSENT_VERSION,
        consentHash: CONSENT_HASH,
        certificateDocumentId: certDoc.id,
        signatureImageFileId: signatureFile?.id ?? null,
      },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'term_sheets.view',
      type: 'term_sheets.signed',
      title: `${ts.company.name} signed term sheet ${ts.ref}`,
      body: `${input.typedName} (${input.authority}) signed ${ts.title}.`,
      link: '/?page=private-markets',
    });
    return { termSheet: next, signature };
  });
}

export async function decline(ts: WithCompany, input: { userId: string; name: string; reason: string; audit: AuditContext }) {
  if (!SIGNABLE.includes(ts.status as TermSheetStatus)) throw new HttpError(409, 'invalid_state', 'This term sheet is not awaiting signature');
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, SIGNABLE, { status: 'DECLINED' });
    await tx.signatureRequest.updateMany({
      where: { subjectType: 'term_sheet', subjectId: ts.id, status: 'Pending' },
      data: { status: 'Cancelled' },
    });
    await writeAudit(tx, input.audit, {
      action: 'term_sheet.declined',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
      reason: input.reason,
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'term_sheets.view',
      type: 'term_sheets.declined',
      title: `${ts.company.name} declined term sheet ${ts.ref}`,
      body: `${input.name}: ${input.reason.slice(0, 300)}`,
      link: '/?page=private-markets',
    });
    return next;
  });
}

async function companyUserIds(companyId: string) {
  const links = await prisma.companyUser.findMany({ where: { companyId, status: 'active' }, select: { userId: true } });
  return links.map((l) => l.userId);
}

/** Fund countersignature after the company has signed. The issuer cannot countersign their own sheet. */
export async function countersign(actor: { userId: string; audit: AuditContext }, ts: WithCompany) {
  if (ts.status !== 'SIGNED_BY_COMPANY') throw new HttpError(409, 'invalid_state', 'The company must sign before the fund countersigns');
  if (ts.issuedById === actor.userId || ts.createdById === actor.userId) {
    throw new HttpError(403, 'segregation_of_duties', 'A different person must countersign this term sheet');
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, ['SIGNED_BY_COMPANY'], { status: 'COUNTERSIGNED' });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.countersigned',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
    });
    const userIds = await companyUserIds(ts.companyId);
    if (userIds.length) {
      await enqueue(tx, 'notify.users', {
        userIds,
        type: 'term_sheets.countersigned',
        title: `Term sheet ${ts.ref} countersigned`,
        body: `${ts.title} has been countersigned by the fund.`,
      });
    }
    return next;
  });
}

/** Marks a countersigned sheet executed. The countersigner cannot be the person who executes it. */
export async function executeTermSheet(actor: { userId: string; audit: AuditContext }, ts: WithCompany) {
  if (ts.status !== 'COUNTERSIGNED') throw new HttpError(409, 'invalid_state', 'Countersign the term sheet before marking it executed');
  const prior = await prisma.auditEvent.findFirst({
    where: { objectType: 'term_sheet', objectId: ts.id, action: 'term_sheet.countersigned' },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true },
  });
  if (prior?.actorId === actor.userId) {
    throw new HttpError(403, 'segregation_of_duties', 'A different person must mark this term sheet executed');
  }
  return prisma.$transaction(async (tx) => {
    const next = await transition(tx, ts, ['COUNTERSIGNED'], { status: 'EXECUTED' });
    await writeAudit(tx, actor.audit, {
      action: 'term_sheet.executed',
      objectType: 'term_sheet',
      objectId: ts.id,
      before: { status: ts.status },
      after: { status: next.status },
    });
    return next;
  });
}
