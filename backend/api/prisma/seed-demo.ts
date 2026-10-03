/**
 * Demo data transcribed from the V56 prototypes, so the live portals open on the
 * same figures the prototype showed. Runs only with SEED_DEMO=1 and is skipped
 * when the demo client / company already exist, so it never overwrites real edits.
 *
 *   SEED_DEMO_INVESTOR_EMAIL  investor-portal user linked to the demo client
 *   SEED_DEMO_COMPANY_EMAIL   company-portal user linked to the demo company
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { storeFile } from '../src/lib/storage';
import { createSnapshot, publishSnapshot, type SnapshotInput } from '../src/modules/investor/staff.routes';
import { openPeriod } from '../src/modules/company/company.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(path.join(here, 'seed', name), 'utf8'));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CAT_OFFSET_H = 2;

/**
 * Parses prototype stamps: "28 Aug 2026", "28 Aug", "28 Aug · 09:14 CAT",
 * "Today · 08:58", "Yesterday · 16:21" and bare "09:14" (on `base`'s day).
 */
function stamp(s: string, base = new Date()): Date {
  const time = /(\d{1,2}):(\d{2})/.exec(s);
  const [h, m] = time ? [Number(time[1]), Number(time[2])] : [12, 0];
  let y = base.getUTCFullYear();
  let mo = base.getUTCMonth();
  let d = base.getUTCDate();
  const day = /(\d{1,2}) ([A-Z][a-z]{2})(?: (\d{4}))?/.exec(s);
  if (day) {
    d = Number(day[1]);
    mo = MONTHS.indexOf(day[2]!);
    y = day[3] ? Number(day[3]) : 2026;
  } else if (/^Yesterday/i.test(s)) {
    d -= 1;
  }
  return new Date(Date.UTC(y, mo, d, h - CAT_OFFSET_H, m));
}

/** A small, valid one-page PDF so demo downloads open in any viewer. */
function placeholderPdf(title: string, lines: string[]) {
  const esc = (t: string) => t.replace(/[^\x20-\x7e]/g, '-').replace(/([()\\])/g, '\\$1');
  const text = [
    'BT /F1 18 Tf 56 770 Td (' + esc(title) + ') Tj ET',
    ...lines.map((l, i) => `BT /F1 11 Tf 56 ${736 - i * 18} Td (${esc(l)}) Tj ET`),
  ].join('\n');
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

const DEMO_NOTE = 'Matanho Nexus demo document - placeholder content.';

async function userByEmail(envName: string, fallback: string) {
  const email = (process.env[envName] ?? fallback).trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) console.log(`[seed:demo] ${email} not found - demo data created without a portal user link`);
  return user;
}

// ---------------------------------------------------------------- investor

async function seedInvestor() {
  const demo = load('demo-investor.json');
  if (await prisma.client.findUnique({ where: { ref: demo.client.ref } })) {
    console.log(`[seed:demo] ${demo.client.ref} exists - investor demo skipped`);
    return;
  }
  const user = await userByEmail('SEED_DEMO_INVESTOR_EMAIL', 'investor.admin@nexus.matanho.com');
  // Other seeded investor-portal users join the demo client under their own role.
  const members = await prisma.userRole.findMany({
    where: { role: { portal: 'investor' }, user: { clientLinks: { none: {} }, ...(user ? { id: { not: user.id } } : {}) } },
    include: { role: true },
  });
  const now = new Date();

  await prisma.$transaction(
    async (tx) => {
      const client = await tx.client.create({
        data: { ...demo.client, portalEnabled: true, nextReviewDate: new Date(Date.UTC(2027, 7, 14)) },
      });
      if (user) await tx.clientUser.create({ data: { clientId: client.id, userId: user.id, investorRole: 'admin' } });
      await tx.clientUser.createMany({
        data: members.map((m) => ({ clientId: client.id, userId: m.userId, investorRole: m.role.key })),
        skipDuplicates: true,
      });

      await tx.bankInstruction.create({
        data: { clientId: client.id, bank: 'CBZ Bank', accountName: demo.client.name, masked: '•••• 1448', verifiedAt: now },
      });

      const s = demo.snapshot;
      const input = {
        ...s,
        clientId: client.ref,
        valuationDate: new Date(`${s.valuationDate}T00:00:00Z`),
        transactions: s.transactions.map((t: { date: string }) => ({ ...t, date: stamp(t.date) })),
        allocation: s.allocation ?? [],
      } as SnapshotInput;
      const snap = await createSnapshot(tx, client.id, input, null);
      await publishSnapshot(tx, snap.id, client.id, null);

      for (const c of demo.capitalActivity) {
        await tx.capitalEvent.create({
          data: {
            ref: c.id,
            clientId: client.id,
            investmentName: c.investment,
            type: c.type,
            amount: new Prisma.Decimal(c.amount),
            dueDate: c.due && c.due !== '—' ? stamp(c.due) : null,
            status: c.status,
            purpose: c.purpose || null,
            breakdown: c.breakdown ?? Prisma.JsonNull,
            bankText: c.bank || null,
            evidenceName: c.evidence && c.evidence !== 'Not uploaded' ? c.evidence : null,
            approvedAt: stamp(c.date),
            publishedAt: stamp(c.date),
          },
        });
      }

      for (const d of demo.documents) {
        const published = stamp(d.date);
        const file = await storeFile(
          {
            name: `${d.title}.pdf`,
            mime: 'application/pdf',
            data: placeholderPdf(d.title, [demo.client.name, `${d.label} · ${d.investment}`, `Dated ${d.date}`, '', DEMO_NOTE]),
          },
          tx,
        );
        const doc = await tx.document.create({
          data: {
            ref: d.id,
            name: d.title,
            type: d.type,
            label: d.label,
            classification: 'Client',
            status: 'Published',
            relatedLabel: d.investment,
            clientId: client.id,
            year: Number(d.year),
            documentDate: published,
            requiresSignature: !!d.signature,
            approvedAt: published,
            versions: { create: { version: 1, fileId: file.id, sha256: file.sha256 } },
            publications: { create: { clientId: client.id, publishedAt: published } },
          },
        });
        if (d.signature) {
          await tx.signatureRequest.create({
            data: { documentId: doc.id, clientId: client.id, status: 'Pending', dueDate: new Date(Date.UTC(2026, 8, 15)) },
          });
        }
        if (user && !d.unread) await tx.documentRead.create({ data: { documentId: doc.id, userId: user.id, readAt: published } });
      }

      for (const r of demo.requests) {
        const opened = stamp(r.opened, now);
        await tx.serviceRequest.create({
          data: {
            ref: r.id,
            clientId: client.id,
            type: r.type,
            title: r.title,
            detail: r.detail,
            status: r.status,
            ownerName: r.owner,
            progress: r.progress,
            openedById: user?.id ?? null,
            createdAt: opened,
            events: {
              create: (r.timeline as [string, string, string][]).map(([at, title, detail]) => ({ at: stamp(at, opened), title, detail })),
            },
          },
        });
      }

      for (const t of demo.threads) {
        let prev = now;
        const messages = (t.messages as { who: string; text: string; time: string }[]).map((m) => {
          prev = stamp(m.time, /^\d/.test(m.time) && !/[A-Z]/.test(m.time) ? prev : now);
          return {
            authorName: m.who === 'me' ? (user?.name ?? demo.client.name) : t.owner,
            authorId: m.who === 'me' ? (user?.id ?? null) : null,
            fromClient: m.who === 'me',
            body: m.text,
            createdAt: prev,
          };
        });
        const thread = await tx.messageThread.create({
          data: {
            clientId: client.id,
            title: t.title,
            ownerName: t.owner,
            ownerRole: t.role,
            createdAt: messages[0]?.createdAt ?? now,
            messages: { create: messages },
          },
        });
        if (user) {
          const incoming = messages.filter((m) => !m.fromClient);
          const unread = Number(t.unread ?? 0);
          const readAt = unread === 0 ? now : incoming[incoming.length - unread - 1]?.createdAt;
          if (readAt) await tx.messageRead.create({ data: { threadId: thread.id, userId: user.id, readAt } });
        }
      }
    },
    { timeout: 120_000 },
  );
  console.log(`[seed:demo] investor demo ${demo.client.ref} created`);
}

// ---------------------------------------------------------------- company

const HISTORY_FILES: Record<string, { name: (label: string) => string; mime: string }> = {
  accounts: { name: (l) => `Management accounts ${l}.pdf`, mime: 'application/pdf' },
  kpis: { name: (l) => `KPI workbook ${l}.csv`, mime: 'text/csv' },
  debt: { name: (l) => `Debt and cash schedule ${l}.pdf`, mime: 'application/pdf' },
  board: { name: (l) => `Board pack ${l}.pdf`, mime: 'application/pdf' },
  compliance: { name: (l) => `Compliance certificates ${l}.pdf`, mime: 'application/pdf' },
};

async function seedCompany() {
  const demo = load('demo-company.json');
  const ref = 'PC-100';
  if (await prisma.portfolioCompany.findUnique({ where: { ref } })) {
    console.log(`[seed:demo] ${ref} exists - company demo skipped`);
    return;
  }
  const user = await userByEmail('SEED_DEMO_COMPANY_EMAIL', 'company@nexus.matanho.com');
  const c = demo.company;

  await prisma.$transaction(
    async (tx) => {
      const company = await tx.portfolioCompany.create({
        data: {
          ref,
          name: c.name,
          legalName: c.legalName,
          ticker: c.ticker,
          sector: c.sector,
          country: c.country,
          founded: c.founded,
          employees: c.employees,
          website: c.website,
          address: c.address,
          relationship: c.relationship,
          contacts: c.contacts,
          cashRunway: demo.cashRunway,
          volumeSeries: demo.volumeSeries,
        },
      });
      if (user) await tx.companyUser.create({ data: { companyId: company.id, userId: user.id } });

      await tx.companyKpi.createMany({
        data: demo.kpiDefs.map((k: { id: string; label: string; unit: string; invert: boolean; prev: number; budget: number; series: number[] }, sort: number) => ({
          companyId: company.id,
          key: k.id,
          label: k.label,
          unit: k.unit,
          invert: !!k.invert,
          prev: new Prisma.Decimal(k.prev),
          budget: new Prisma.Decimal(k.budget),
          series: k.series,
          sort,
        })),
      });

      await tx.covenant.createMany({
        data: demo.covenants.map(
          (v: { id: string; name: string; threshold: string; actual: number; limit: number; unit: string; headroom: number; evidence: string; note?: string }, sort: number) => ({
            companyId: company.id,
            key: v.id,
            name: v.name,
            threshold: v.threshold,
            actual: new Prisma.Decimal(v.actual),
            limit: new Prisma.Decimal(v.limit),
            unit: v.unit,
            headroom: String(v.headroom),
            evidence: v.evidence,
            note: v.note ?? null,
            sort,
          }),
        ),
      });

      const periodIds = new Map<string, string>();
      for (const p of demo.periods as { id: string; due: string; status: string }[]) {
        const row = await openPeriod(tx, company.id, p.id, new Date(`${p.due}T00:00:00Z`));
        periodIds.set(p.id, row.id);
        const h = (demo.history as { id: string; submitted: string; status: string; reviewer: string; note: string }[]).find((x) => x.id === p.id);
        if (!h) continue;
        const submittedAt = stamp(h.submitted);
        const kpiValues = Object.fromEntries(
          demo.kpiDefs.map((k: { id: string; series: number[] }) => {
            const back = demo.periods.findIndex((x: { id: string }) => x.id === p.id);
            return [k.id, k.series[k.series.length - back] ?? k.series.at(-1)];
          }),
        );
        await tx.reportingPeriod.update({
          where: { id: row.id },
          data: {
            status: h.status,
            kpiValues,
            submittedAt,
            reviewerName: h.reviewer,
            reviewedAt: new Date(submittedAt.getTime() + 2 * 86_400_000),
            reviewNote: h.note,
          },
        });
        const items = await tx.reportingItem.findMany({ where: { periodId: row.id } });
        const label = h.submitted.split(' ').slice(1, 3).join(' ');
        for (const item of items) {
          const spec = HISTORY_FILES[item.key];
          if (!spec) continue;
          const name = spec.name(label);
          const data =
            spec.mime === 'text/csv'
              ? Buffer.from(`kpi,value\n${Object.entries(kpiValues).map(([k, v]) => `${k},${v}`).join('\n')}\n`)
              : placeholderPdf(name.replace(/\.pdf$/, ''), [c.name, `Reporting period ${p.id}`, '', DEMO_NOTE]);
          const file = await storeFile({ name, mime: spec.mime, data }, tx);
          await tx.reportingItem.update({ where: { id: item.id }, data: { status: 'Complete' } });
          await tx.reportingSubmission.create({
            data: {
              itemId: item.id,
              fileId: file.id,
              name,
              size: file.size,
              status: h.status === 'accepted' ? 'Accepted' : 'Returned',
              createdAt: submittedAt,
            },
          });
        }
      }

      for (const q of demo.threads as {
        id: string;
        title: string;
        from: string;
        role: string;
        opened: string;
        status: string;
        messages: { who: string; name: string; at: string; text: string }[];
      }[]) {
        await tx.reportingQuestion.create({
          data: {
            ref: q.id,
            companyId: company.id,
            title: q.title,
            fromName: q.from,
            fromRole: q.role,
            status: q.status,
            createdAt: stamp(q.opened),
            messages: {
              create: q.messages.map((m) => ({
                authorName: m.who === 'me' ? (user?.name ?? m.name) : m.name,
                authorId: m.who === 'me' ? (user?.id ?? null) : null,
                fromCompany: m.who === 'me',
                body: m.text,
                createdAt: stamp(m.at),
              })),
            },
          },
        });
      }

      let n = 1;
      for (const d of demo.library as { kind: string; title: string; date: string }[]) {
        const date = stamp(d.date);
        const title = d.title.replace(/ \((xlsx)\)$/, '');
        const file = await storeFile(
          { name: `${title}.pdf`, mime: 'application/pdf', data: placeholderPdf(title, [c.name, `Dated ${d.date}`, '', DEMO_NOTE]) },
          tx,
        );
        await tx.document.create({
          data: {
            ref: `LIB-APH-${String(n++).padStart(2, '0')}`,
            name: d.title,
            type: d.kind === 'legal' ? 'legal' : 'company',
            label: d.kind,
            classification: 'Client',
            status: 'Published',
            companyId: company.id,
            relatedLabel: c.name,
            year: date.getUTCFullYear(),
            documentDate: date,
            approvedAt: date,
            versions: { create: { version: 1, fileId: file.id, sha256: file.sha256 } },
          },
        });
      }
    },
    { timeout: 120_000 },
  );
  console.log(`[seed:demo] company demo ${ref} (${c.name}) created`);
}

export async function seedDemo() {
  await seedInvestor();
  await seedCompany();
  await (await import('./seed-portfolio')).seedPortfolio();
  await (await import('./seed-orders')).seedOrders();
  await (await import('./seed-risk')).seedRisk();
  await (await import('./seed-nav')).seedNav();
  await (await import('./seed-accounting')).seedAccounting();
  await (await import('./seed-corporate-actions')).seedCorporateActions();
  await (await import('./seed-cash')).seedCash();
  await (await import('./seed-wiring')).seedWiring();
}
