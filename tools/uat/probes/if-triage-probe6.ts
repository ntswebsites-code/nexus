import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // IF-07: compare downloaded bytes hash with the recorded version hash for Investor A's first doc
  const client = await prisma.client.findUnique({ where: { ref: 'CL-00418' } });
  const dvA = await prisma.documentVersion.findFirst({
    where: { document: { name: 'Q2 2026 Investor Report', clientId: client!.id } },
    orderBy: { version: 'desc' },
    include: { document: { select: { name: true } } },
  });
  console.log('IF-07 A-doc:', JSON.stringify(dvA ? {
    doc: dvA.document.name, version: dvA.version, recordedSha256: dvA.sha256,
    downloadedSha256: '3eccdbb69c3fd7a9bcfe238880678e395ab3296c94ebed9fc583d8b2f1d5b2e3',
    match: dvA.sha256 === '3eccdbb69c3fd7a9bcfe238880678e395ab3296c94ebed9fc583d8b2f1d5b2e3',
  } : null));

  // IF-12: regulatory submissions with provider refs
  const subs = await prisma.regFilingSubmission.findMany({ take: 3 });
  console.log('IF-12 submissions:', JSON.stringify(subs.map((s) => ({
    id: s.id, status: s.status, providerRef: s.providerRef ?? null, submittedAt: s.submittedAt ?? null, response: s.response ?? null,
  }))));

  // IF-11: model versions
  const models = await prisma.govModel.findMany({ include: { _count: { select: { versions: true } } } });
  console.log('IF-11 models:', JSON.stringify(models.map((m) => ({ ref: m.ref, versions: m._count.versions }))));

  // IF-05: recon ingestion inputs
  console.log('IF-05 inputs:', JSON.stringify({
    cashStatementImports: await prisma.cashStatementImport.count(),
    tradeFeedFiles: await prisma.tradeFeedFile.count(),
    reconCounterpartImports: await prisma.reconCounterpartImport.count(),
  }));

  // IF-01: audit events prove server-side actions (not client-only)
  console.log('IF-01 audit sample:', JSON.stringify((await prisma.auditEvent.findMany({ take: 3, orderBy: { at: 'desc' } })).map((a) => ({ action: a.action, objectType: a.objectType, actor: a.actorId }))));
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
