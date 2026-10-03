/**
 * UAT personas and data (DEV-PLAN section 10) from tools/uat/seed-data/uat-seed.json, the dataset
 * exported from the LP mock store and the Investee fixtures (tools/uat/export-mock-seed.ts).
 *
 *   SEED_UAT_CONFIRM=1 SEED_USERS_FILE=<path> npx tsx prisma/seed-uat.ts
 *
 * Run prisma/seed.ts first (role catalogue). Idempotent: records are matched by their ref (or
 * natural key). Reference data (funds, clients, commitments, holdings, memberships, companies,
 * KPIs, covenants, counterparties) is brought back to the dataset on every run; workflow records
 * (capital calls and allocations, distributions, documents, notices and receipts, requests,
 * threads, dealing requests, reporting periods, term sheets) are only created when missing, so a
 * re-run never undoes what testers did. SEED_UAT_RESET=1 also resets workflow records.
 *
 * SEED_USERS_FILE (delivered out of band, never committed): the prisma/seed.ts format plus a
 * `persona` key per entry, e.g.
 *   [{ "persona": "lp_a_manager", "email": "...", "password": "<10+ chars>", "name": "Jane Smith" }]
 * `roles` may be omitted (the persona's roles are used). Persona keys: see `personas` in the
 * dataset. Passwords are set for new users only (SEED_RESET_PASSWORDS=1 overwrites) and are
 * never printed. Personas missing from the file are skipped with a warning.
 *
 * Optional: SEED_UAT_DATA=<dataset path>, SEED_UAT_MFA_REQUIRED=1 (turns the mfa_required policy on),
 * SEED_UAT_ADOPT=1 (allow taking over an existing client/company whose name differs).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { storeFile } from '../src/lib/storage';
import { openPeriod } from '../src/modules/company/company.service';
import type { ClientKey, SeedPersona, UatSeed } from '../../../tools/uat/seed-types';

if (process.env.SEED_UAT_CONFIRM !== '1') {
  console.error('Refusing to run: set SEED_UAT_CONFIRM=1 (writes UAT personas and data into DATABASE_URL).');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SEED_UAT_DATA?.trim() || path.resolve(here, '../../../tools/uat/seed-data/uat-seed.json');
const RESET = process.env.SEED_UAT_RESET === '1';
const ADOPT = process.env.SEED_UAT_ADOPT === '1';
const MARKER = { ownerId: 'platform', key: 'uat_seed_refs' };

const seed = JSON.parse(readFileSync(DATA, 'utf8')) as UatSeed;
// The dataset's open call is "due soon" in the July 2026 snapshot. Roll only that due date
// forward when the machine clock has passed it, so historical activity dates stay put.
{
  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 5);
  const soonIso = soon.toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const call of seed.capitalCalls) {
    if (call.status === 'ISSUED' && call.dueDate < todayIso) call.dueDate = soonIso;
  }
}
const D = (s: string | number) => new Prisma.Decimal(s);
const date = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
const num = (s: string | number | null | undefined) => Number(s ?? 0);
const log = (msg: string) => console.log(`[seed:uat] ${msg}`);
const warn = (msg: string) => console.warn(`[seed:uat] WARNING ${msg}`);
/** Workflow rows: `update` payload only when SEED_UAT_RESET=1. */
const wf = <T extends object>(data: T): T | Record<string, never> => (RESET ? data : {});

const users = new Map<string, string>(); // persona -> user id
const fundId = new Map<string, string>(); // fund ref -> id
const clientId = new Map<ClientKey, string>();
const clientName = new Map<ClientKey, string>();
const docId = new Map<string, string>(); // document ref -> id
const commitmentId = new Map<string, string>(); // `${client}|${fund}` -> id
let marker = new Set<string>();

const staff = (...keys: string[]) => keys.map((k) => users.get(k)).find(Boolean) ?? null;

// ---------------------------------------------------------------- users
interface FileUser {
  persona?: string;
  email: string;
  password: string;
  name?: string;
  roles?: string[];
}

async function seedUsers() {
  const file = process.env.SEED_USERS_FILE?.trim();
  if (!file) throw new Error('SEED_USERS_FILE is required (persona credentials, delivered out of band)');
  const entries = JSON.parse(readFileSync(file, 'utf8')) as FileUser[];
  const byPersona = new Map(seed.personas.map((p) => [p.key, p]));
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);

  for (const e of entries) {
    if (!e.persona) continue; // plain seed.ts entries are handled by seed.ts
    const p = byPersona.get(e.persona);
    if (!p) {
      warn(`users file entry for unknown persona "${e.persona}" ignored`);
      continue;
    }
    const email = e.email.trim().toLowerCase();
    if (!e.password || e.password.length < 10) throw new Error(`Password for persona ${p.key} must be at least 10 characters`);
    const existing = await prisma.user.findUnique({ where: { email } });
    const setPassword = !existing?.passwordHash || process.env.SEED_RESET_PASSWORDS === '1';
    const passwordHash = setPassword ? await bcrypt.hash(e.password, rounds) : undefined;
    const user = existing
      ? await prisma.user.update({ where: { email }, data: { isActive: true, ...(passwordHash ? { passwordHash } : {}), ...(e.name ? { name: e.name } : {}) } })
      : await prisma.user.create({ data: { email, passwordHash: passwordHash!, name: e.name?.trim() || p.name } });

    for (const spec of e.roles ?? p.roles) {
      const [portal, key] = spec.split(':');
      const role = await prisma.role.findUnique({ where: { portal_key: { portal: portal!, key: key! } } });
      if (!role) throw new Error(`Unknown role "${spec}" for persona ${p.key} - run prisma/seed.ts first`);
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    }
    users.set(p.key, user.id);
  }
  const missing = seed.personas.filter((p) => !users.has(p.key)).map((p) => p.key);
  log(`personas ready: ${users.size}/${seed.personas.length}${missing.length ? ` (missing from users file: ${missing.join(', ')})` : ''}`);
}

// ---------------------------------------------------------------- guards
function sameEntity(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().replace(/\(private\) limited|\blp\b|\blimited\b|[^a-z0-9]/g, '');
  return n(a) === n(b) || n(a).startsWith(n(b)) || n(b).startsWith(n(a));
}

/** True when a ref may be (re)written by the seed: new, created by an earlier run, or clearly the same entity. */
function mayWrite(kind: string, ref: string, existingName: string | undefined, seedName: string) {
  if (existingName === undefined || marker.has(`${kind}:${ref}`) || ADOPT || sameEntity(existingName, seedName)) {
    marker.add(`${kind}:${ref}`);
    return true;
  }
  warn(`${kind} ${ref} already exists as "${existingName}" (not created by this seed) - left untouched; set SEED_UAT_ADOPT=1 to take it over`);
  return false;
}

/** A small valid one-page PDF so seeded documents download and preview in any viewer. */
function placeholderPdf(title: string, lines: string[]) {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, '-').replace(/([()\\])/g, '\\$1');
  const text = ['BT /F1 18 Tf 56 770 Td (' + esc(title) + ') Tj ET', ...lines.map((l, i) => `BT /F1 11 Tf 56 ${736 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

// ---------------------------------------------------------------- LP reference data
async function seedFunds() {
  for (const f of seed.funds) {
    const data = {
      name: f.name,
      shortName: f.shortName,
      publicReference: f.publicReference,
      operatingModel: f.operatingModel,
      currency: f.currency,
      status: 'Active',
      portalVisible: true,
      defaultShareClass: f.defaultShareClass,
      valuationStatus: f.valuationStatus,
      asOfDate: date(f.asOfDate),
      navPerUnit: f.navPerUnit ? D(f.navPerUnit) : null,
      dealingRulesJson: (f.dealingRules ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      wiringJson: (f.wiring ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    };
    const row = await prisma.fund.upsert({ where: { ref: f.ref }, update: data, create: { ref: f.ref, ...data } });
    fundId.set(f.ref, row.id);
  }
  log(`funds: ${seed.funds.map((f) => f.ref).join(', ')}`);
}

async function seedClients() {
  for (const c of seed.clients) {
    const existing = await prisma.client.findUnique({ where: { ref: c.ref } });
    if (!mayWrite('client', c.ref, existing?.name, c.name)) throw new Error(`client ${c.ref} is not seedable - resolve the conflict first`);
    const data = {
      name: c.name,
      type: c.type,
      email: c.email,
      phone: c.phone,
      address: c.address,
      country: c.country,
      baseCurrency: c.baseCurrency,
      kycStatus: c.kycStatus,
      portalEnabled: true,
      accreditedInvestor: true,
      dealingHold: false,
      holdReason: null,
      archivedAt: null,
    };
    const row = await prisma.client.upsert({ where: { ref: c.ref }, update: data, create: { ref: c.ref, ...data } });
    clientId.set(c.key, row.id);
    clientName.set(c.key, row.name);
  }
  log(`clients: ${seed.clients.map((c) => `${c.key}=${c.ref}`).join(', ')}`);
}

async function seedMemberships() {
  let n = 0;
  for (const p of seed.personas.filter((x): x is SeedPersona & { client: ClientKey } => x.kind === 'lp' && !!x.client)) {
    const userId = users.get(p.key);
    if (!userId) continue;
    const data = {
      investorRole: p.investorRole ?? 'auditor',
      lpRole: p.lpRole ?? null,
      fundIds: p.funds ? (p.funds.map((r) => fundId.get(r)).filter(Boolean) as string[]) : Prisma.JsonNull,
      status: 'ACTIVE',
      revokedAt: null,
    };
    const cid = clientId.get(p.client)!;
    await prisma.clientUser.upsert({ where: { clientId_userId: { clientId: cid, userId } }, update: data, create: { clientId: cid, userId, ...data } });
    n++;
  }
  log(`LP memberships: ${n}`);
}

async function seedCommitmentsAndHoldings() {
  for (const c of seed.commitments) {
    const cid = clientId.get(c.client)!;
    const fid = fundId.get(c.fund)!;
    const metrics = { ...c.metrics } as Record<string, unknown>;
    if (metrics.called != null && metrics.openingCalled == null) {
      const platformCalled = seed.capitalCalls
        .filter((call) => call.fund === c.fund)
        .flatMap((call) => call.allocations)
        .filter((a) => a.client === c.client)
        .reduce((sum, a) => sum + num(a.amount), 0);
      metrics.openingCalled = Math.max(0, num(metrics.called as string) - platformCalled).toFixed(2);
    }
    const data = {
      commitmentAmount: D(c.amount),
      currency: 'USD',
      status: 'ACTIVE',
      investorAccountRef: c.investorAccountRef,
      metricsJson: metrics as Prisma.InputJsonValue,
    };
    const row = await prisma.fundCommitment.upsert({
      where: { clientId_fundId: { clientId: cid, fundId: fid } },
      update: data,
      create: { clientId: cid, fundId: fid, effectiveDate: date('2023-03-15'), ...data },
    });
    commitmentId.set(`${c.client}|${c.fund}`, row.id);
  }
  for (const h of seed.holdings) {
    const cid = clientId.get(h.client)!;
    const fid = fundId.get(h.fund)!;
    const data = {
      units: D(h.units),
      navPerUnit: D(h.navPerUnit),
      accountValue: D(h.accountValue),
      currency: 'USD',
      accountRef: h.accountRef,
      asOfDate: date(h.asOfDate),
      valuationStatus: h.valuationStatus,
      isActive: true,
    };
    await prisma.lpHolding.upsert({
      where: { clientId_fundId_shareClassCode: { clientId: cid, fundId: fid, shareClassCode: h.shareClassCode } },
      update: data,
      create: { clientId: cid, fundId: fid, shareClassCode: h.shareClassCode, ...data },
    });
  }
  log(`commitments: ${seed.commitments.length}, holdings: ${seed.holdings.length}`);
}

const bankIdByMasked = new Map<string, string>(); // `${client}|${masked}` -> id
async function seedBankAccounts() {
  for (const b of seed.bankAccounts) {
    const cid = clientId.get(b.client)!;
    const data = {
      bank: b.bankName,
      accountName: b.accountName,
      masked: b.masked,
      label: b.label,
      currency: b.currency,
      isDefault: b.isDefault,
      fundId: b.fund ? fundId.get(b.fund)! : null,
      status: 'Active',
      verifiedAt: date('2025-09-15'),
    };
    const existing = await prisma.bankInstruction.findFirst({ where: { clientId: cid, masked: b.masked, label: b.label } });
    const row = existing ? await prisma.bankInstruction.update({ where: { id: existing.id }, data }) : await prisma.bankInstruction.create({ data: { clientId: cid, ...data } });
    if (!bankIdByMasked.has(`${b.client}|${b.masked}`)) bankIdByMasked.set(`${b.client}|${b.masked}`, row.id);
  }
  log(`bank instructions: ${seed.bankAccounts.length}`);
}

// ---------------------------------------------------------------- LP workflow data
async function seedDocuments() {
  const publisher = staff('client_services', 'sysadmin');
  const approver = staff('compliance', 'investment_director', 'sysadmin');
  let files = 0;
  for (const d of seed.documents) {
    const cid = clientId.get(d.client)!;
    const published = date(d.publishedDate);
    const base = {
      name: d.name,
      type: d.type,
      label: d.label,
      classification: 'Client',
      status: 'Published',
      relatedLabel: seed.funds.find((f) => f.ref === d.fund)?.name ?? null,
      clientId: cid,
      year: published.getUTCFullYear(),
      documentDate: published,
      requiresSignature: d.requiresSignature,
      category: d.category,
      fundId: fundId.get(d.fund)!,
      period: d.period,
      sourceType: d.sourceType ?? 'GP_UPLOAD',
      makerId: publisher,
      checkerId: approver,
      approvedAt: published,
    };
    const existing = await prisma.document.findUnique({ where: { ref: d.ref }, include: { versions: { select: { id: true } } } });
    const doc = existing
      ? await prisma.document.update({ where: { id: existing.id }, data: RESET ? base : { category: base.category, fundId: base.fundId } })
      : await prisma.document.create({ data: { ref: d.ref, createdBy: publisher, ...base } });
    docId.set(d.ref, doc.id);

    if (!existing?.versions.length) {
      const file = await storeFile({
        name: `${d.name}.pdf`,
        mime: 'application/pdf',
        uploadedById: publisher,
        data: placeholderPdf(d.name, [clientName.get(d.client) ?? '', `${d.label} - ${d.period ?? ''}`, `Published ${d.publishedDate}`, '', 'Matanho Nexus UAT document - placeholder content.']),
      });
      await prisma.documentVersion.create({ data: { documentId: doc.id, version: 1, fileId: file.id, sha256: file.sha256, uploadedById: publisher } });
      files++;
    }
    await prisma.publication.upsert({
      where: { documentId_clientId: { documentId: doc.id, clientId: cid } },
      update: wf({ publishedAt: published, withdrawnAt: null }),
      create: { documentId: doc.id, clientId: cid, publishedAt: published, publishedById: publisher },
    });
    if (d.requiresSignature && !(await prisma.signatureRequest.findFirst({ where: { documentId: doc.id, clientId: cid } }))) {
      await prisma.signatureRequest.create({ data: { documentId: doc.id, clientId: cid, status: 'Pending', requestedById: publisher, subjectType: 'document', dueDate: date('2026-07-20') } });
    }
  }
  log(`documents: ${seed.documents.length} (${files} new files stored)`);
}

const callIdByRef = new Map<string, string>();
async function seedCapitalCalls() {
  const maker = staff('client_services', 'sysadmin');
  const checker = staff('investment_director', 'sysadmin');
  const recorder = staff('operations', 'sysadmin');
  const calledBefore = new Map<string, number>(); // `${client}|${fund}` -> called so far
  for (const c of seed.commitments) calledBefore.set(`${c.client}|${c.fund}`, num(c.metrics.openingPaidIn as string));

  for (const c of [...seed.capitalCalls].sort((a, b) => a.callNo - b.callNo)) {
    const fid = fundId.get(c.fund)!;
    const status = c.status === 'PAID' ? 'PAID' : c.allocations.some((a) => num(a.paid) > 0) ? 'PARTIALLY_PAID' : 'ISSUED';
    const data = {
      fundId: fid,
      callNo: c.callNo,
      totalAmount: D(c.totalAmount),
      currency: c.currency,
      dueDate: date(c.dueDate),
      transactionDate: date(c.issueDate),
      wireJson: c.wire as Prisma.InputJsonValue,
      wireText: c.wireText,
      purpose: c.purpose,
      noticeDocumentId: c.noticeDocumentRef ? (docId.get(c.noticeDocumentRef) ?? null) : null,
      status,
      makerId: maker,
      checkerId: checker,
      approvedAt: date(c.issuedAt),
      issuedAt: date(c.issuedAt),
    };
    const existing = await prisma.capitalCall.findFirst({ where: { OR: [{ ref: c.ref }, { fundId: fid, callNo: c.callNo }] } });
    if (existing && existing.ref !== c.ref) {
      warn(`capital call #${c.callNo} of ${c.fund} already exists as ${existing.ref} - seeded call ${c.ref} skipped`);
      continue;
    }
    const call = existing
      ? await prisma.capitalCall.update({ where: { id: existing.id }, data: RESET ? data : { noticeDocumentId: data.noticeDocumentId ?? existing.noticeDocumentId } })
      : await prisma.capitalCall.create({ data: { ref: c.ref, ...data } });
    callIdByRef.set(c.ref, call.id);

    for (const a of c.allocations) {
      const key = `${a.client}|${c.fund}`;
      const cmt = seed.commitments.find((x) => x.client === a.client && x.fund === c.fund);
      const comId = commitmentId.get(key);
      if (!cmt || !comId) continue;
      const before = calledBefore.get(key) ?? 0;
      calledBefore.set(key, before + num(a.amount));
      const cid = clientId.get(a.client)!;
      const paid = num(a.paid);
      const allocStatus = paid >= num(a.amount) && paid > 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'PENDING';
      const ackBy = users.get(a.client === 'A' ? 'lp_a_manager' : 'lp_b_signatory') ?? null;
      const allocData = {
        commitmentId: comId,
        lpLegalNameSnapshot: clientName.get(a.client)!,
        totalCommitmentSnapshot: D(cmt.amount),
        uncalledBeforeSnapshot: D(Math.max(0, num(cmt.amount) - before).toFixed(4)),
        callAmount: D(a.amount),
        amountPaid: D(a.paid),
        status: allocStatus,
        acknowledgedAt: a.acknowledgedAt ? date(a.acknowledgedAt) : null,
        acknowledgedById: a.acknowledgedAt ? ackBy : null,
      };
      const alloc = await prisma.capitalCallAllocation.upsert({
        where: { callId_clientId: { callId: call.id, clientId: cid } },
        update: wf(allocData),
        create: { callId: call.id, clientId: cid, ...allocData },
      });
      if (paid > 0 && !(await prisma.capitalCallPayment.findFirst({ where: { allocationId: alloc.id } }))) {
        if (!recorder) warn(`no staff persona to record the payment of ${c.ref} for client ${a.client} - payment row skipped`);
        else
          await prisma.capitalCallPayment.create({
            data: { allocationId: alloc.id, amount: D(a.paid), recordedAt: date(a.paymentReceivedAt ?? c.dueDate), recordedById: recorder, bankReference: c.wire.reference ?? null },
          });
      }
    }
  }
  log(`capital calls: ${callIdByRef.size}/${seed.capitalCalls.length}`);
}

const distIdByRef = new Map<string, string>();
async function seedDistributions() {
  const maker = staff('operations', 'sysadmin');
  const checker = staff('investment_director', 'sysadmin');
  for (const d of seed.distributions) {
    const data = {
      fundId: fundId.get(d.fund)!,
      distributionDate: date(d.date),
      type: d.type,
      currency: d.currency,
      grossAmount: D(d.gross),
      adjustmentsAmount: D(d.adjustments),
      netToLps: D(d.net),
      status: d.status,
      notes: d.typeLabel,
      makerId: maker,
      checkerId: checker,
      issuedAt: date(d.date),
    };
    const dist = await prisma.distribution.upsert({ where: { ref: d.ref }, update: wf(data), create: { ref: d.ref, ...data } });
    distIdByRef.set(d.ref, dist.id);
    for (const a of d.allocations) {
      const comId = commitmentId.get(`${a.client}|${d.fund}`);
      const cmt = seed.commitments.find((x) => x.client === a.client && x.fund === d.fund);
      if (!comId || !cmt) continue;
      const cid = clientId.get(a.client)!;
      const paid = d.status === 'PAID';
      const allocData = {
        commitmentId: comId,
        lpLegalNameSnapshot: clientName.get(a.client)!,
        commitmentSnapshot: D(cmt.amount),
        paidInSnapshot: D(num(cmt.metrics.paidIn as string).toFixed(4)),
        grossShare: D(a.gross),
        adjustments: D(a.adjustments),
        shareAmount: D(a.net),
        amountPaid: D(paid ? a.net : '0'),
        status: paid ? 'PAID' : 'PENDING',
        destinationBankAccountId: a.bankMasked ? (bankIdByMasked.get(`${a.client}|${a.bankMasked}`) ?? null) : null,
        documentId: a.documentRef ? (docId.get(a.documentRef) ?? null) : null,
        paidAt: paid ? date(d.date) : null,
      };
      await prisma.distributionAllocation.upsert({
        where: { distributionId_clientId: { distributionId: dist.id, clientId: cid } },
        update: wf(allocData),
        create: { distributionId: dist.id, clientId: cid, ...allocData },
      });
    }
  }
  // Documents generated by a call or distribution point back at it.
  for (const doc of seed.documents.filter((x) => x.sourceRef)) {
    const target = callIdByRef.get(doc.sourceRef!) ?? distIdByRef.get(doc.sourceRef!);
    const id = docId.get(doc.ref);
    if (target && id) await prisma.document.update({ where: { id }, data: { sourceRefId: target } });
  }
  log(`distributions: ${distIdByRef.size}`);
}

async function seedNotices() {
  const publisher = staff('client_services', 'sysadmin');
  const approver = staff('compliance', 'sysadmin');
  let receipts = 0;
  for (const n of seed.notices) {
    const cid = clientId.get(n.client)!;
    const data = {
      title: n.title,
      body: n.body,
      category: n.category,
      targetType: 'ORG',
      fundId: fundId.get(n.fund)!,
      clientId: cid,
      shareClassCode: n.shareClass,
      requiresAcknowledgement: n.requiresAcknowledgement,
      status: 'PUBLISHED',
      publishedAt: date(n.publishedAt),
      publishedById: publisher,
      approvedById: approver,
      createdById: publisher,
    };
    const notice = await prisma.lpNotice.upsert({ where: { ref: n.ref }, update: wf(data), create: { ref: n.ref, ...data } });
    for (const r of n.receipts) {
      const userId = users.get(r.persona);
      if (!userId) continue;
      const rd = { clientId: cid, openedAt: r.openedAt ? date(r.openedAt) : null, acknowledgedAt: r.acknowledgedAt ? date(r.acknowledgedAt) : null };
      await prisma.lpNoticeReceipt.upsert({
        where: { noticeId_userId: { noticeId: notice.id, userId } },
        update: wf(rd),
        create: { noticeId: notice.id, userId, deliveredAt: date(n.publishedAt), ...rd },
      });
      receipts++;
    }
  }
  log(`notices: ${seed.notices.length} (${receipts} receipts)`);
}

const requestIdByRef = new Map<string, string>();
async function seedRequestsAndThreads() {
  for (const r of seed.requests) {
    const data = {
      clientId: clientId.get(r.client)!,
      type: r.type,
      priority: r.priority,
      title: r.subject,
      detail: r.description,
      status: r.legacyStatus,
      lpStatus: r.lpStatus,
      fundId: fundId.get(r.fund)!,
      openedById: users.get(r.submittedBy) ?? null,
      progress: r.lpStatus === 'CLOSED' ? 100 : r.lpStatus === 'SUBMITTED' ? 10 : 50,
    };
    const row = await prisma.serviceRequest.upsert({
      where: { ref: r.ref },
      update: wf(data),
      create: { ref: r.ref, ...data, createdAt: date(r.createdAt) },
    });
    requestIdByRef.set(r.ref, row.id);
  }
  let created = 0;
  for (const t of seed.threads) {
    const cid = clientId.get(t.client)!;
    const linkedId = t.relatedRequestRef ? (requestIdByRef.get(t.relatedRequestRef) ?? null) : null;
    let thread = await prisma.messageThread.findFirst({ where: { clientId: cid, title: t.subject } });
    if (thread && RESET) {
      await prisma.messageThread.delete({ where: { id: thread.id } });
      thread = null;
    }
    if (!thread) {
      const last = t.messages.map((m) => m.createdAt).sort().at(-1);
      thread = await prisma.messageThread.create({
        data: {
          clientId: cid,
          title: t.subject,
          ownerName: t.ownerName,
          ownerRole: t.ownerRole,
          linkedType: linkedId ? 'service_request' : null,
          linkedId,
          fundId: fundId.get(t.fund)!,
          status: t.status,
          lastMessageAt: last ? date(last) : null,
          createdAt: date(t.messages[0]?.createdAt ?? seed.asOfDate),
          messages: {
            create: t.messages.map((m) => ({
              authorId: m.authorPersona ? (users.get(m.authorPersona) ?? null) : null,
              authorName: m.authorName,
              fromClient: m.fromClient,
              body: m.body,
              createdAt: date(m.createdAt),
            })),
          },
        },
      });
      created++;
      // Read marker for the client's manager: the latest message they had read in the mock.
      const reader = users.get(t.client === 'A' ? 'lp_a_manager' : 'lp_b_signatory');
      const readAt = t.messages.map((m) => m.readAt).filter((x): x is string => !!x).sort().at(-1);
      if (reader && readAt) {
        await prisma.messageRead.upsert({
          where: { threadId_userId: { threadId: thread.id, userId: reader } },
          update: { readAt: date(readAt) },
          create: { threadId: thread.id, userId: reader, readAt: date(readAt) },
        });
      }
    }
  }
  log(`requests: ${seed.requests.length}, threads: ${seed.threads.length} (${created} created)`);
}

async function seedDealing() {
  for (const d of seed.dealingRequests) {
    const data = {
      clientId: clientId.get(d.client)!,
      fundId: fundId.get(d.fund)!,
      shareClassCode: d.shareClassCode,
      requestType: d.requestType,
      inputMode: d.inputMode,
      redemptionMode: d.redemptionMode,
      amount: D(d.amount),
      units: D(d.units),
      currency: d.currency,
      requestedDealingDate: date(d.requestedDealingDate),
      status: d.status,
      submittedById: users.get('lp_a_manager') ?? null,
      notes: d.notes,
      unitsAllocated: d.status === 'COMPLETED' ? D(d.units) : null,
    };
    await prisma.lpDealingRequest.upsert({ where: { ref: d.ref }, update: wf(data), create: { ref: d.ref, ...data, createdAt: date(d.createdAt) } });
  }
  log(`dealing requests: ${seed.dealingRequests.length}`);
}

async function seedNotifications() {
  let n = 0;
  for (const x of seed.notifications) {
    const userId = users.get(x.persona);
    if (!userId) continue;
    const body = x.fundName ? `fund:${x.fundName}` : null;
    const existing = await prisma.notification.findFirst({ where: { userId, title: x.title } });
    if (existing) {
      if (body && existing.body !== body) await prisma.notification.update({ where: { id: existing.id }, data: { body } });
      continue;
    }
    await prisma.notification.create({ data: { userId, type: x.type, title: x.title, body, link: x.link, createdAt: date(x.createdAt), readAt: x.read ? date(x.createdAt) : null } });
    n++;
  }
  log(`notifications: ${n} new`);
}

// ---------------------------------------------------------------- Investee
async function seedCompanies() {
  const reviewer = staff('analyst', 'investment_director', 'sysadmin');
  const companyId = new Map<string, string>();
  for (const c of seed.companies) {
    const existing = await prisma.portfolioCompany.findUnique({ where: { ref: c.ref } });
    if (!mayWrite('company', c.ref, existing?.name, c.name)) continue;
    const data = {
      name: c.name,
      legalName: c.legalName,
      ticker: c.ticker,
      sector: c.sector,
      country: c.country,
      relationship: c.relationship as Prisma.InputJsonValue,
      contacts: c.contacts as Prisma.InputJsonValue,
      status: c.status,
      fundingStage: c.fundingStage,
      reportingCurrency: c.reportingCurrency,
    };
    const row = await prisma.portfolioCompany.upsert({ where: { ref: c.ref }, update: data, create: { ref: c.ref, ...data } });
    companyId.set(c.ref, row.id);

    for (const k of c.kpis) {
      const kd = { label: k.label, unit: k.unit, prev: D(k.prev), budget: D(k.budget), series: k.series, sort: k.sort };
      await prisma.companyKpi.upsert({ where: { companyId_key: { companyId: row.id, key: k.key } }, update: kd, create: { companyId: row.id, key: k.key, ...kd } });
    }
    for (const v of c.covenants) {
      const vd = { name: v.name, threshold: v.threshold, actual: D(v.actual), limit: D(v.limit), unit: v.unit, headroom: v.headroom, evidence: v.evidence, note: v.note ?? null, sort: v.sort };
      await prisma.covenant.upsert({ where: { companyId_key: { companyId: row.id, key: v.id } }, update: vd, create: { companyId: row.id, key: v.id, ...vd } });
    }
    for (const p of c.periods) {
      const found = await prisma.reportingPeriod.findUnique({ where: { companyId_period: { companyId: row.id, period: p.period } } });
      if (found && !RESET) continue;
      if (found) await prisma.reportingPeriod.delete({ where: { id: found.id } });
      await prisma.$transaction(async (tx) => {
        const period = await openPeriod(tx, row.id, p.period, date(p.due));
        const [y, m] = p.period.split('-').map(Number) as [number, number];
        const start = new Date(Date.UTC(y, m - (p.periodType === 'QUARTERLY' ? 3 : 1), 1));
        const end = new Date(Date.UTC(y, m, 0));
        const done = p.status !== 'open';
        const submittedAt = new Date(date(p.due).getTime() - 5 * 86_400_000);
        await tx.reportingPeriod.update({
          where: { id: period.id },
          data: {
            label: p.label,
            periodType: p.periodType,
            periodStart: start,
            periodEnd: end,
            requestedAt: start,
            status: p.status,
            ...(done
              ? {
                  kpiValues: Object.fromEntries(c.kpis.map((k) => [k.key, k.series.at(-1) ?? 0])),
                  submittedAt,
                  submittedById: users.get('investee_101_contributor') ?? null,
                  reviewedById: reviewer,
                  reviewerName: 'UAT Analyst',
                  reviewedAt: new Date(submittedAt.getTime() + 2 * 86_400_000),
                  reviewNote: p.reviewNote ?? null,
                  closedAt: new Date(submittedAt.getTime() + 2 * 86_400_000),
                }
              : {}),
          },
        });
        if (done) await tx.reportingItem.updateMany({ where: { periodId: period.id }, data: { status: 'Complete' } });
      });
    }
  }

  let links = 0;
  for (const p of seed.personas.filter((x) => x.kind === 'investee' && x.company)) {
    const userId = users.get(p.key);
    const cid = companyId.get(p.company!);
    if (!userId || !cid) continue;
    const profile = p.profile ?? 'read_only';
    const canSign = profile === 'executive_approver' || profile === 'workspace_administrator';
    const data = {
      profile,
      status: 'active',
      title: p.title ?? null,
      ...(canSign ? { signingAuthority: { label: p.title ?? 'Authorised signatory' } } : {}),
    };
    await prisma.companyUser.upsert({ where: { companyId_userId: { companyId: cid, userId } }, update: data, create: { companyId: cid, userId, ...data } });
    links++;
  }

  for (const t of seed.termSheets) {
    const cid = companyId.get(t.company);
    if (!cid) continue;
    const data = {
      companyId: cid,
      title: t.title,
      status: t.status,
      investmentAmount: D(t.investmentAmount),
      valuation: D(t.valuation),
      equityPercentage: D(t.equityPercentage),
      currency: t.currency,
      keyTerms: t.keyTerms as Prisma.InputJsonValue,
      conditions: t.conditions,
      timeline: t.timeline,
      createdById: staff('investment_director', 'sysadmin'),
    };
    await prisma.termSheet.upsert({ where: { ref: t.ref }, update: wf(data), create: { ref: t.ref, ...data } });
  }

  // Staff-created companies take PC-<n> from the `company` sequence; keep it past the seeded refs.
  const maxRef = Math.max(0, ...seed.companies.map((c) => Number(/^PC-(\d+)$/.exec(c.ref)?.[1] ?? 0)));
  if (maxRef) await prisma.$executeRaw`INSERT INTO sequences (name, value) VALUES ('company', ${maxRef}) ON DUPLICATE KEY UPDATE value = GREATEST(value, ${maxRef})`;
  log(`companies: ${companyId.size}/${seed.companies.length}, company users: ${links}, term sheets: ${seed.termSheets.length}`);
}

// ---------------------------------------------------------------- custodian
async function seedCounterparties() {
  for (const c of seed.counterparties) {
    const data = { name: c.name, type: c.type, status: 'ACTIVE', accounts: c.accounts };
    const row = await prisma.counterparty.upsert({ where: { ref: c.ref }, update: data, create: { ref: c.ref, ...data } });
    for (const p of seed.personas.filter((x) => x.kind === 'custodian' && x.counterparty === c.ref)) {
      const userId = users.get(p.key);
      if (!userId) continue;
      const d = { role: p.counterpartyRole ?? 'submitter', status: 'active' };
      await prisma.counterpartyUser.upsert({ where: { counterpartyId_userId: { counterpartyId: row.id, userId } }, update: d, create: { counterpartyId: row.id, userId, ...d } });
    }
  }
  log(`counterparties: ${seed.counterparties.length}`);
}

// ---------------------------------------------------------------- main
try {
  log(`dataset ${path.basename(DATA)} (as of ${seed.asOfDate})${RESET ? ' - RESET mode: workflow records are rewritten' : ''}`);
  const stored = await prisma.setting.findUnique({ where: { ownerId_key: MARKER } });
  marker = new Set(Array.isArray(stored?.value) ? (stored!.value as string[]) : []);

  await seedUsers();
  await seedFunds();
  await seedClients();
  await seedMemberships();
  await seedCommitmentsAndHoldings();
  await seedBankAccounts();
  await seedDocuments();
  await seedCapitalCalls();
  await seedDistributions();
  await seedNotices();
  await seedRequestsAndThreads();
  await seedDealing();
  await seedNotifications();
  await seedCompanies();
  await seedCounterparties();
  await (await import('./seed-portfolio')).seedPortfolio();
  await (await import('./seed-orders')).seedOrders();
  await (await import('./seed-risk')).seedRisk();
  await (await import('./seed-nav')).seedNav();
  await (await import('./seed-accounting')).seedAccounting();
  await (await import('./seed-corporate-actions')).seedCorporateActions();
  await (await import('./seed-cash')).seedCash();
  await (await import('./seed-wiring')).seedWiring();
  await (await import('./seed-admin-core')).seedAdminCore();
  await (await import('./seed-admin-shell')).seedAdminShell();
  await (await import('./seed-recon')).seedRecon();
  await (await import('./seed-recon-ops')).seedReconOps();
  await (await import('./seed-ibor-performance')).seedIborPerformance();
  await (await import('./seed-research-privates')).seedResearchPrivates();
  await (await import('./seed-clients-onboarding')).seedClientsOnboarding();
  await (await import('./seed-reports')).seedReports();
  await (await import('./seed-orders-pm')).seedOrdersPm();
=======
  await (await import('./seed-investee-workspace')).seedInvesteeWorkspace();
=======
  await (await import('./seed-custodian-ops')).seedCustodianOps();

  if (process.env.SEED_UAT_MFA_REQUIRED === '1') {
    await prisma.policy.upsert({ where: { key: 'mfa_required' }, update: { value: true }, create: { key: 'mfa_required', value: true } });
    log('policy mfa_required = true');
  }
  const value = [...marker].sort();
  await prisma.setting.upsert({ where: { ownerId_key: MARKER }, update: { value }, create: { ...MARKER, value } });
  log('done');
} catch (err) {
  console.error('[seed:uat] FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
