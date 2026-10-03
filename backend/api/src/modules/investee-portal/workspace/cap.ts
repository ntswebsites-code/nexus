import { z } from 'zod';
import type { PortfolioCompany } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { HttpError } from '../../../lib/errors';
import { writeAudit, type AuditContext } from '../../../lib/audit';
import { nextRef } from '../../../lib/refs';
import { SYSTEM_ACTOR_ID } from '../../../lib/system';
import { readFileObject, signedDownloadUrl, storeFile } from '../../../lib/storage';
import { autoAccountingJournal } from '../../wiring/autojournals';
import { INVESTEE_VISIBLE } from '../../term-sheets/term-sheets.service';
import type { InvesteeContext } from '../investee.context';
import { computeWaterfall, type WaterfallClass } from './waterfall';
import { COLORS, D, day, getOrCreateClass, getOrCreateHolder, isoDay, parseDay, refs, requireSigner, sha256, type Tx } from './store';

const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const roundSchema = z.object({
  amount: z.number().positive().max(1_000_000_000_000),
  preMoney: z.number().positive().max(1_000_000_000_000),
});

export const capTableSchema = z.object({
  shareholders: z
    .array(
      z.object({
        id: z.string().trim().max(40).optional(),
        name: z.string().trim().min(1).max(160),
        type: z.string().trim().min(1).max(80),
        shares: z.number().int().positive().max(1_000_000_000_000),
      }),
    )
    .min(1)
    .max(40),
});

export const capTxSchema = z
  .object({
    kind: z.enum(['ISSUANCE', 'TRANSFER', 'CANCELLATION']),
    holder: z.string().trim().min(1).max(160),
    fromHolder: z.string().trim().min(1).max(160).optional(),
    className: z.string().trim().min(1).max(80),
    shares: z.number().int().positive().max(1_000_000_000_000),
    pricePerShare: z.number().nonnegative().max(1_000_000_000).optional(),
    consideration: z.number().nonnegative().max(1_000_000_000_000).optional(),
    currency: z.string().trim().length(3).optional(),
    effectiveDate: dayStr.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.kind !== 'TRANSFER' || (v.fromHolder && v.fromHolder !== v.holder), { message: 'A transfer needs a different "from" holder', path: ['fromHolder'] });

export const capDecisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).optional() });

export const classTermsSchema = z.object({
  voting: z.string().trim().min(1).max(60).optional(),
  preferenceMultiple: z.number().min(0).max(10).optional(),
  participating: z.boolean().optional(),
  seniority: z.number().int().min(0).max(20).optional(),
  conversionRatio: z.number().positive().max(1000).optional(),
});

export const waterfallSchema = z.object({
  exitValue: z.number().positive().max(1_000_000_000_000),
  invested: z.record(z.string().max(80), z.number().nonnegative().max(1_000_000_000_000)).optional(),
});

interface Row {
  holderId: string;
  classId: string;
  shares: number;
}

/** Share balance per holder and class from approved transactions up to an optional date. */
async function balances(db: Tx | typeof prisma, companyId: string, asOf?: Date): Promise<Row[]> {
  const txs = await db.investeeCapTx.findMany({
    where: { companyId, status: 'APPROVED', ...(asOf ? { effectiveDate: { lte: asOf } } : {}) },
    select: { kind: true, holderId: true, fromHolderId: true, classId: true, shares: true },
  });
  const map = new Map<string, Row>();
  const add = (holderId: string, classId: string, delta: number) => {
    const key = `${holderId}|${classId}`;
    const row = map.get(key) ?? { holderId, classId, shares: 0 };
    row.shares += delta;
    map.set(key, row);
  };
  for (const t of txs) {
    const n = t.shares.toNumber();
    if (t.kind === 'OPENING' || t.kind === 'ISSUANCE') add(t.holderId, t.classId, n);
    else if (t.kind === 'CANCELLATION') add(t.holderId, t.classId, -n);
    else if (t.kind === 'TRANSFER' && t.fromHolderId) {
      add(t.fromHolderId, t.classId, -n);
      add(t.holderId, t.classId, n);
    }
  }
  return [...map.values()].filter((r) => r.shares !== 0);
}

function fundLabel(company: PortfolioCompany) {
  const rel = company.relationship && typeof company.relationship === 'object' && !Array.isArray(company.relationship) ? (company.relationship as Record<string, unknown>) : null;
  return typeof rel?.fund === 'string' && rel.fund.trim() ? rel.fund.trim() : 'Matanho';
}

interface HolderView {
  id: string;
  name: string;
  type: string;
  shares: number;
  pct: number;
  color: string;
}

function preferenceText(multiple: number, participating: boolean) {
  return multiple > 0 ? `${multiple}x ${participating ? 'participating' : 'non-participating'}` : 'None';
}

async function derivedCap(company: PortfolioCompany): Promise<HolderView[]> {
  const latest = await prisma.termSheet.findFirst({
    where: { companyId: company.id, status: { in: [...INVESTEE_VISIBLE] } },
    orderBy: { issuedAt: 'desc' },
    select: { equityPercentage: true },
  });
  const equity = latest ? latest.equityPercentage.toNumber() : 0;
  if (equity <= 0 || equity >= 100) return [];
  const base = 10_000_000;
  const fundShares = Math.round((base * equity) / 100);
  const rows = [
    { name: 'Founders and management', type: 'Ordinary', shares: base - fundShares },
    { name: fundLabel(company), type: 'Preferred', shares: fundShares },
  ];
  return rows.map((r, i) => ({ id: `derived-${i}`, ...r, pct: Math.round((r.shares / base) * 1000) / 10, color: COLORS[i]! }));
}

export async function capTableView(company: PortfolioCompany, asOf?: string) {
  const companyId = company.id;
  const approved = await prisma.investeeCapTx.count({ where: { companyId, status: 'APPROVED' } });
  const [classes, holders, pending] = await Promise.all([
    prisma.investeeShareClass.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
    prisma.investeeShareholder.findMany({ where: { companyId } }),
    prisma.investeeCapTx.count({ where: { companyId, status: 'PENDING_APPROVAL' } }),
  ]);
  if (!approved) {
    const shareholders = await derivedCap(company);
    const grouped = new Map<string, number>();
    for (const s of shareholders) grouped.set(s.type, (grouped.get(s.type) ?? 0) + s.shares);
    return {
      asOf: day(),
      derived: true,
      pendingTransactions: pending,
      shareholders,
      classes: [...grouped].map(([name, outstanding]) => ({ name, outstanding, voting: /preferred/i.test(name) ? 'As-converted' : '1 vote / share', preference: /preferred/i.test(name) ? '1x non-participating' : 'None', conversion: /preferred/i.test(name) ? '1:1' : 'n/a', status: 'Active' })),
    };
  }
  const rows = await balances(prisma, companyId, asOf ? parseDay(asOf) : undefined);
  const total = rows.reduce((s, r) => s + r.shares, 0);
  const holderById = new Map(holders.map((h) => [h.id, h]));
  const classById = new Map(classes.map((k) => [k.id, k]));
  const perHolder = new Map<string, number>();
  for (const r of rows) perHolder.set(r.holderId, (perHolder.get(r.holderId) ?? 0) + 1);
  const shareholders: HolderView[] = rows
    .map((r) => {
      const h = holderById.get(r.holderId)!;
      const k = classById.get(r.classId)!;
      return {
        id: (perHolder.get(r.holderId) ?? 1) > 1 ? `${r.holderId}:${r.classId}` : r.holderId,
        name: h.name,
        type: k.name,
        shares: r.shares,
        pct: total > 0 ? Math.round((r.shares / total) * 1000) / 10 : 0,
        color: h.color,
      };
    })
    .sort((a, b) => b.shares - a.shares);
  const outstanding = new Map<string, number>();
  for (const r of rows) outstanding.set(r.classId, (outstanding.get(r.classId) ?? 0) + r.shares);
  return {
    asOf: asOf ?? day(),
    derived: false,
    pendingTransactions: pending,
    shareholders,
    classes: classes
      .filter((k) => outstanding.has(k.id))
      .map((k) => ({
        id: k.id,
        name: k.name,
        outstanding: outstanding.get(k.id) ?? 0,
        voting: k.voting,
        preference: preferenceText(k.preferenceMultiple.toNumber(), k.participating),
        preferenceMultiple: k.preferenceMultiple.toNumber(),
        participating: k.participating,
        seniority: k.seniority,
        conversion: /option|esop|warrant/i.test(k.name) ? 'Exercise' : k.conversionRatio.toNumber() > 0 && k.preferenceMultiple.toNumber() > 0 ? `${k.conversionRatio.toNumber()}:1` : 'n/a',
        status: k.status,
      })),
  };
}

/** New-money round at a pre-money valuation. Does not write the register. */
export function simulateRound(holders: { name: string; type: string; shares: number }[], amount: number, preMoney: number) {
  const existing = holders.reduce((sum, row) => sum + row.shares, 0);
  if (existing <= 0) throw HttpError.badRequest('Record at least one holder before modelling a round');
  const price = preMoney / existing;
  const issued = Math.round(amount / price);
  if (issued <= 0) throw HttpError.badRequest('The round issues no shares at this valuation');
  const total = existing + issued;
  const pct = (shares: number) => Number(((shares / total) * 100).toFixed(1));
  return {
    pricePerShare: Number(price.toFixed(4)),
    issued,
    postMoney: preMoney + amount,
    shareholders: [
      ...holders.map((row) => ({ name: row.name, type: row.type, shares: row.shares, pct: pct(row.shares) })),
      { name: 'New investor', type: 'New money', shares: issued, pct: pct(issued) },
    ],
  };
}

/**
 * Baseline register entry (the old "save cap table" action). Allowed only while the register holds opening
 * balances alone; once an issuance, transfer or cancellation is approved, changes go through transactions.
 */
export async function saveCapTable(c: InvesteeContext, body: z.infer<typeof capTableSchema>, audit: AuditContext) {
  const companyId = c.company.id;
  await prisma.$transaction(async (tx) => {
    const others = await tx.investeeCapTx.count({ where: { companyId, kind: { not: 'OPENING' } } });
    if (others > 0) throw HttpError.conflict('The register has transactions. Record a new transaction instead of replacing the baseline.', 'register_locked');
    await tx.investeeCertificate.deleteMany({ where: { companyId } });
    const removed = await tx.investeeCapTx.deleteMany({ where: { companyId, kind: 'OPENING' } });
    for (const h of body.shareholders) {
      const holder = await getOrCreateHolder(tx, companyId, h.name);
      const klass = await getOrCreateClass(tx, companyId, h.type);
      await tx.investeeCapTx.create({
        data: {
          ref: await refs.capTx(tx),
          companyId,
          kind: 'OPENING',
          status: 'APPROVED',
          holderId: holder.id,
          classId: klass.id,
          shares: new D(h.shares),
          currency: c.company.reportingCurrency,
          effectiveDate: parseDay(day()),
          note: 'Opening balance',
          makerId: c.userId,
          makerName: 'Company user',
          checkerId: c.userId,
          decidedAt: new Date(),
          decisionNote: 'Baseline register',
        },
      });
    }
    await writeAudit(tx, audit, { action: 'company.cap_table.saved', objectType: 'investee_cap_tx', objectId: companyId, after: { holders: body.shareholders.length, replaced: removed.count } });
  });
  return capTableView(c.company);
}

function txView(t: Awaited<ReturnType<typeof prisma.investeeCapTx.findMany>>[number], names: Map<string, string>) {
  return {
    id: t.ref,
    kind: t.kind,
    status: t.status,
    holder: names.get(t.holderId) ?? '',
    fromHolder: t.fromHolderId ? (names.get(t.fromHolderId) ?? '') : null,
    className: names.get(t.classId) ?? '',
    shares: t.shares.toNumber(),
    pricePerShare: t.pricePerShare ? t.pricePerShare.toNumber() : null,
    consideration: t.consideration.toNumber(),
    currency: t.currency,
    effectiveDate: isoDay(t.effectiveDate),
    note: t.note,
    maker: t.makerName,
    makerId: t.makerId,
    decidedAt: t.decidedAt?.toISOString() ?? null,
    decisionNote: t.decisionNote,
    glStatus: t.glStatus,
    glRef: t.glRef,
    glNote: t.glNote,
    createdAt: t.createdAt.toISOString(),
  };
}

async function nameMap(companyId: string) {
  const [h, k] = await Promise.all([prisma.investeeShareholder.findMany({ where: { companyId } }), prisma.investeeShareClass.findMany({ where: { companyId } })]);
  return new Map<string, string>([...h.map((x) => [x.id, x.name] as const), ...k.map((x) => [x.id, x.name] as const)]);
}

export async function capTransactions(companyId: string) {
  const [rows, names] = await Promise.all([prisma.investeeCapTx.findMany({ where: { companyId, kind: { not: 'OPENING' } }, orderBy: { createdAt: 'desc' }, take: 200 }), nameMap(companyId)]);
  return rows.map((t) => txView(t, names));
}

export async function createCapTransaction(c: InvesteeContext, name: string, body: z.infer<typeof capTxSchema>, audit: AuditContext) {
  const companyId = c.company.id;
  const created = await prisma.$transaction(async (tx) => {
    const klass = await getOrCreateClass(tx, companyId, body.className);
    const holder = await getOrCreateHolder(tx, companyId, body.holder);
    const from = body.fromHolder ? await getOrCreateHolder(tx, companyId, body.fromHolder) : null;
    const source = body.kind === 'TRANSFER' ? from : body.kind === 'CANCELLATION' ? holder : null;
    if (source) {
      const have = (await balances(tx, companyId)).find((r) => r.holderId === source.id && r.classId === klass.id)?.shares ?? 0;
      if (have < body.shares) throw HttpError.conflict(`${source.name} holds ${have} ${klass.name} shares, fewer than ${body.shares}`, 'insufficient_shares');
    }
    const consideration = body.consideration ?? (body.pricePerShare !== undefined ? body.pricePerShare * body.shares : 0);
    const price = body.pricePerShare ?? (consideration > 0 ? consideration / body.shares : null);
    const row = await tx.investeeCapTx.create({
      data: {
        ref: await refs.capTx(tx),
        companyId,
        kind: body.kind,
        holderId: holder.id,
        fromHolderId: from?.id ?? null,
        classId: klass.id,
        shares: new D(body.shares),
        pricePerShare: price === null ? null : new D(price.toFixed(6)),
        consideration: new D(consideration.toFixed(4)),
        currency: (body.currency ?? c.company.reportingCurrency).toUpperCase(),
        effectiveDate: parseDay(body.effectiveDate ?? day()),
        note: body.note ?? null,
        makerId: c.userId,
        makerName: name.slice(0, 120),
      },
    });
    await writeAudit(tx, audit, { action: 'company.cap_tx.submitted', objectType: 'investee_cap_tx', objectId: row.id, after: { ref: row.ref, kind: row.kind, shares: body.shares, holder: holder.name } });
    return row;
  });
  return txView(created, await nameMap(companyId));
}

async function ledgerPortfolio(tx: Tx, company: PortfolioCompany) {
  const ws = await tx.investeeWorkspace.findUniqueOrThrow({ where: { companyId: company.id } });
  if (ws.ledgerPortfolioId) return { id: ws.ledgerPortfolioId, baseCurrency: (await tx.portfolio.findUnique({ where: { id: ws.ledgerPortfolioId }, select: { baseCurrency: true } }))?.baseCurrency ?? company.reportingCurrency };
  const p = await tx.portfolio.create({
    data: { ref: await nextRef(tx, 'portfolio'), name: `${company.name} (investee ledger)`.slice(0, 160), type: 'Investee ledger', baseCurrency: company.reportingCurrency, status: 'Active', createdBy: SYSTEM_ACTOR_ID },
  });
  await tx.investeeWorkspace.update({ where: { companyId: company.id }, data: { ledgerPortfolioId: p.id } });
  return { id: p.id, baseCurrency: p.baseCurrency };
}

function certificateText(a: { certNo: string; company: string; companyRef: string; holder: string; className: string; shares: number; issuedOn: string; txRef: string; kind: string }) {
  return [
    'SHARE CERTIFICATE',
    `Certificate no: ${a.certNo}`,
    `Company: ${a.company} (${a.companyRef})`,
    `Holder: ${a.holder}`,
    `Class: ${a.className}`,
    `Shares: ${a.shares}`,
    `Issued on: ${a.issuedOn}`,
    `Basis: ${a.kind} ${a.txRef}`,
    '',
    'Recorded in the Matanho investee register after maker and checker approval.',
  ].join('\n');
}

export async function decideCapTransaction(c: InvesteeContext, ref: string, body: z.infer<typeof capDecisionSchema>, audit: AuditContext) {
  requireSigner(c, 'approve cap-table transactions');
  const companyId = c.company.id;
  const result = await prisma.$transaction(async (tx) => {
    const t = await tx.investeeCapTx.findFirst({ where: { companyId, ref } });
    if (!t) throw HttpError.notFound('Transaction not found');
    if (t.status !== 'PENDING_APPROVAL') throw HttpError.conflict(`A ${t.status} transaction cannot be decided again`, 'invalid_state');
    if (t.makerId === c.userId) throw HttpError.forbidden('The person who entered a transaction cannot approve it', 'maker_checker');
    const claim = await tx.investeeCapTx.updateMany({
      where: { id: t.id, status: 'PENDING_APPROVAL' },
      data: { status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', checkerId: c.userId, decidedAt: new Date(), decisionNote: body.note ?? null },
    });
    if (claim.count === 0) throw HttpError.conflict('This transaction was just decided by someone else', 'invalid_state');
    const names = new Map<string, string>();
    for (const h of await tx.investeeShareholder.findMany({ where: { companyId } })) names.set(h.id, h.name);
    for (const k of await tx.investeeShareClass.findMany({ where: { companyId } })) names.set(k.id, k.name);
    let certNo: string | null = null;
    let glRef: string | null = null;
    let glStatus = 'NONE';
    let glNote: string | null = null;
    if (body.decision === 'APPROVE') {
      const source = t.kind === 'TRANSFER' ? t.fromHolderId : t.kind === 'CANCELLATION' ? t.holderId : null;
      if (source) {
        const have = (await balances(tx, companyId)).find((r) => r.holderId === source && r.classId === t.classId)?.shares ?? 0;
        if (have < 0) throw HttpError.conflict('Approving this would leave a holder with negative shares', 'insufficient_shares');
      }
      if (t.kind === 'ISSUANCE' || t.kind === 'TRANSFER') {
        certNo = await refs.certificate(tx);
        const text = certificateText({
          certNo,
          company: c.company.name,
          companyRef: c.company.ref,
          holder: names.get(t.holderId) ?? '',
          className: names.get(t.classId) ?? '',
          shares: t.shares.toNumber(),
          issuedOn: isoDay(t.effectiveDate)!,
          txRef: t.ref,
          kind: t.kind,
        });
        const file = await storeFile({ name: `${certNo}.txt`, mime: 'text/plain', data: Buffer.from(text, 'utf8'), uploadedById: c.userId }, tx);
        await tx.investeeCertificate.create({
          data: { certNo, companyId, txId: t.id, holderId: t.holderId, classId: t.classId, shares: t.shares, issuedOn: t.effectiveDate, sha256: file.sha256, fileId: file.id },
        });
      }
      if ((t.kind === 'ISSUANCE' || t.kind === 'CANCELLATION') && t.consideration.gt(0)) {
        const ledger = await ledgerPortfolio(tx, c.company);
        if (ledger.baseCurrency !== t.currency) {
          glStatus = 'SKIPPED';
          glNote = `Transaction currency ${t.currency} differs from the ledger currency ${ledger.baseCurrency}`;
        } else {
          const issue = t.kind === 'ISSUANCE';
          const res = await autoAccountingJournal(tx, {
            portfolioId: ledger.id,
            entryDate: t.effectiveDate,
            description: `${c.company.name}: ${issue ? 'share issue' : 'share cancellation'} ${t.ref}`,
            sourceRef: `CAP:${t.ref}`,
            lines: issue ? [{ code: '1000', debit: t.consideration }, { code: '3000', credit: t.consideration }] : [{ code: '3000', debit: t.consideration }, { code: '1000', credit: t.consideration }],
          });
          if (res.ref) {
            glStatus = 'PENDING_GL';
            glRef = res.ref;
          } else {
            glStatus = 'SKIPPED';
            glNote = (res.detail ?? res.skipped ?? 'not posted').slice(0, 300);
          }
        }
        await tx.investeeCapTx.update({ where: { id: t.id }, data: { glStatus, glRef, glNote } });
      }
    }
    await writeAudit(tx, audit, {
      action: body.decision === 'APPROVE' ? 'company.cap_tx.approved' : 'company.cap_tx.rejected',
      objectType: 'investee_cap_tx',
      objectId: t.id,
      before: { status: 'PENDING_APPROVAL' },
      after: { ref: t.ref, certNo, glRef, glStatus },
    });
    return t.id;
  });
  const row = await prisma.investeeCapTx.findUniqueOrThrow({ where: { id: result } });
  return txView(row, await nameMap(companyId));
}

export async function updateClassTerms(c: InvesteeContext, classId: string, body: z.infer<typeof classTermsSchema>, audit: AuditContext) {
  requireSigner(c, 'change share-class terms');
  return prisma.$transaction(async (tx) => {
    const k = await tx.investeeShareClass.findFirst({ where: { id: classId, companyId: c.company.id } });
    if (!k) throw HttpError.notFound('Share class not found');
    const next = await tx.investeeShareClass.update({
      where: { id: k.id },
      data: {
        ...(body.voting !== undefined ? { voting: body.voting } : {}),
        ...(body.preferenceMultiple !== undefined ? { preferenceMultiple: new D(body.preferenceMultiple) } : {}),
        ...(body.participating !== undefined ? { participating: body.participating } : {}),
        ...(body.seniority !== undefined ? { seniority: body.seniority } : {}),
        ...(body.conversionRatio !== undefined ? { conversionRatio: new D(body.conversionRatio) } : {}),
      },
    });
    await writeAudit(tx, audit, { action: 'company.share_class.updated', objectType: 'investee_share_class', objectId: k.id, before: { multiple: k.preferenceMultiple.toString(), participating: k.participating }, after: body });
    return { id: next.id, name: next.name, voting: next.voting, preferenceMultiple: next.preferenceMultiple.toNumber(), participating: next.participating, seniority: next.seniority, conversionRatio: next.conversionRatio.toNumber() };
  });
}

export async function certificatesView(companyId: string) {
  const [rows, names] = await Promise.all([prisma.investeeCertificate.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 }), nameMap(companyId)]);
  return rows.map((r) => ({ id: r.certNo, holder: names.get(r.holderId) ?? '', className: names.get(r.classId) ?? '', shares: r.shares.toNumber(), issuedOn: isoDay(r.issuedOn), sha256: r.sha256, status: r.status }));
}

export async function certificateDownload(companyId: string, certNo: string) {
  const cert = await prisma.investeeCertificate.findFirst({ where: { companyId, certNo } });
  if (!cert?.fileId) throw HttpError.notFound('Certificate not found');
  return { url: signedDownloadUrl(cert.fileId), sha256: cert.sha256 };
}

/** Re-hashes the stored certificate and compares it with the hash recorded at issue. */
export async function certificateVerify(companyId: string, certNo: string) {
  const cert = await prisma.investeeCertificate.findFirst({ where: { companyId, certNo } });
  if (!cert?.fileId) throw HttpError.notFound('Certificate not found');
  const { data } = await readFileObject(cert.fileId);
  const actual = sha256(data);
  return { id: cert.certNo, recorded: cert.sha256, actual, valid: actual === cert.sha256 };
}

export async function waterfallView(c: InvesteeContext, body: z.infer<typeof waterfallSchema>) {
  const companyId = c.company.id;
  const [rows, classes, holders, txs] = await Promise.all([
    balances(prisma, companyId),
    prisma.investeeShareClass.findMany({ where: { companyId } }),
    prisma.investeeShareholder.findMany({ where: { companyId } }),
    prisma.investeeCapTx.findMany({ where: { companyId, status: 'APPROVED', kind: { in: ['ISSUANCE', 'CANCELLATION'] } }, select: { kind: true, classId: true, consideration: true } }),
  ]);
  if (!rows.length) throw HttpError.badRequest('Record the register before modelling an exit');
  const invested = new Map<string, number>();
  for (const t of txs) invested.set(t.classId, (invested.get(t.classId) ?? 0) + (t.kind === 'ISSUANCE' ? 1 : -1) * t.consideration.toNumber());
  const wf: WaterfallClass[] = [];
  for (const k of classes) {
    const shares = rows.filter((r) => r.classId === k.id).reduce((s, r) => s + r.shares, 0);
    if (shares <= 0) continue;
    wf.push({
      id: k.id,
      name: k.name,
      shares,
      invested: Math.max(0, body.invested?.[k.name] ?? invested.get(k.id) ?? 0),
      multiple: k.preferenceMultiple.toNumber(),
      participating: k.participating,
      seniority: k.seniority,
      ratio: k.conversionRatio.toNumber(),
    });
  }
  const result = computeWaterfall(wf, body.exitValue);
  const holderName = new Map(holders.map((h) => [h.id, h.name]));
  const classTotal = new Map(result.rows.map((r) => [r.classId, r]));
  const perHolder = rows.flatMap((r) => {
    const k = classTotal.get(r.classId);
    if (!k || k.shares <= 0) return [];
    return [{ holder: holderName.get(r.holderId) ?? '', className: k.name, shares: r.shares, payout: Math.round(((k.total * r.shares) / k.shares) * 100) / 100 }];
  });
  return { exitValue: body.exitValue, distributed: result.distributed, classes: result.rows, holders: perHolder.sort((a, b) => b.payout - a.payout) };
}
