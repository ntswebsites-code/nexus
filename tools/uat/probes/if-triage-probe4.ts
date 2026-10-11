import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://localhost:4100';
const users: Array<{ persona: string; email: string; password: string; roles?: string[] }> = JSON.parse(readFileSync('secrets/uat-users.json', 'utf8'));
const byPersona = (p: string) => users.find((u) => u.persona === p)!;

async function session(persona: string, portal?: string) {
  const u = byPersona(persona);
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: u.email, password: u.password, ...(portal ? { portal } : {}) }),
  });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '', status: res.status };
}

async function main() {
  const admin = await session('sysadmin', 'admin');

  // IF-07: original bytes via correct download route
  const dv = await prisma.documentVersion.findFirst({ where: { document: { status: 'Published' } }, include: { document: true } });
  if (dv) {
    const file = await prisma.fileObject.findUnique({ where: { id: dv.fileId } });
    for (const path of ['/api/v1/files/' + dv.fileId + '/download']) {
      const f = await fetch(BASE + path, { headers: { cookie: admin.cookie } });
      const buf = Buffer.from(await f.arrayBuffer());
      const computed = createHash('sha256').update(buf).digest('hex');
      console.log('IF-07:', JSON.stringify({
        path, status: f.status, bytes: buf.length,
        recordedSha256: dv.sha256, computedSha256: computed, match: computed === dv.sha256,
        dbSize: file?.size ?? null, magic: buf.subarray(0, 5).toString('latin1'), doc: dv.document.name,
      }));
    }
  }

  // IF-10: research case -> linked order (real OMS draft IDs)
  const ic = await prisma.icDecision.findFirst({ include: { orders: { include: { order: true } } } });
  console.log('IF-10 IC link:', JSON.stringify(ic ? {
    icRef: ic.ref ?? ic.id, orders: ic.orders.map((l) => ({ orderId: l.orderId, ref: l.order?.ref, status: l.order?.status })),
  } : null));

  // IF-12: regulatory submission receipts
  const subs = await prisma.regFilingSubmission.findMany({ take: 3, include: { filing: true } });
  console.log('IF-12 submissions:', JSON.stringify(subs.map((s) => ({
    filing: s.filing?.ref, status: s.status, ack: s.providerRef ?? s.acknowledgedAt ?? null, at: s.submittedAt ?? s.createdAt,
  }))));

  // IF-05: recon inputs exist (statement imports, trade feeds) - real ingestion surface
  const imports = await prisma.cashStatementImport.count();
  const feeds = await prisma.tradeFeedFile.count();
  console.log('IF-05 inputs:', JSON.stringify({ cashStatementImports: imports, tradeFeedFiles: feeds }));

  // IF-11: model governance versions persisted
  const models = await prisma.govModel.findMany({ include: { versions: true } });
  console.log('IF-11 models:', JSON.stringify(models.map((m) => ({ ref: m.ref, versions: m.versions.length }))));

  // IF-01: asset references - any dead v33 reference in the new portals?
  const runs = await prisma.reconRun.count();
  console.log('IF-01 reconRuns:', runs);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); }).finally(() => prisma.$disconnect());
