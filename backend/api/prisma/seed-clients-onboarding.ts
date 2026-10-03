/**
 * Clients, Investor Services, Onboarding & KYC and Document Vault demo wiring. Adds, on top of whatever clients, KYC
 * cases, documents and service requests the other seeds created:
 *   - SLA policies per request type and priority (the "*" row is the fallback);
 *   - assignees and SLA due dates for service requests that have none;
 *   - next-review dates for clients without one;
 *   - KYC checks and a PROPOSED risk assessment (awaiting a checker) for open onboarding cases;
 *   - one document change awaiting approval and one legal hold on an existing document.
 * Idempotent: each block only fills what is missing. Nothing is deleted.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-clients-onboarding.ts   (standalone; run the base seeds first)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { scoreRisk } from '../src/modules/clients-onboarding/co.engine';
import { ensureRiskFactors, SLA_TYPE_ALIASES } from '../src/modules/clients-onboarding/co.service';

const log = (m: string) => console.log(`[seed:clients-onboarding] ${m}`);

const SLA: [string, string, number][] = [
  ['*', 'Normal', 48],
  ['*', 'Time sensitive', 8],
  ['Query', 'Normal', 24],
  ['Statement request', 'Normal', 48],
  ['Transfer', 'Normal', 72],
  ['Transfer', 'Time sensitive', 24],
  ['Redemption', 'Normal', 72],
  ['Redemption', 'Time sensitive', 24],
  ['Account change', 'Normal', 96],
  ['Tax document', 'Normal', 120],
  ['Complaint', 'Normal', 24],
  ['Complaint', 'Time sensitive', 4],
  ['Capital Activity', 'Normal', 72],
  ['Capital Activity', 'Time sensitive', 24],
];

export async function seedClientsOnboarding() {
  const staff = await prisma.user.findMany({ where: { isActive: true, roles: { some: { role: { portal: 'admin' } } } }, select: { id: true, name: true, email: true }, orderBy: { createdAt: 'asc' }, take: 6 });
  const actor = staff[0]?.id ?? (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }

  await ensureRiskFactors();
  for (const [requestType, priority, targetHours] of SLA) {
    await prisma.serviceSlaPolicy.upsert({
      where: { requestType_priority: { requestType, priority } },
      update: {},
      create: { requestType, priority, targetHours, updatedBy: actor },
    });
  }

  // Service requests: assign and set due dates where missing.
  const reqs = await prisma.serviceRequest.findMany({ where: { OR: [{ assigneeId: null }, { slaDueAt: null }] }, orderBy: { createdAt: 'asc' }, take: 200 });
  let i = 0;
  for (const r of reqs) {
    const owner = staff.length ? staff[i++ % staff.length]! : null;
    const policyType = SLA_TYPE_ALIASES[r.type] ?? r.type;
    const hours = SLA.find((s) => s[0] === policyType && s[1] === r.priority)?.[2] ?? (r.priority === 'Normal' ? 48 : 8);
    await prisma.serviceRequest.update({
      where: { id: r.id },
      data: {
        ...(r.assigneeId || !owner || r.status === 'Closed' ? {} : { assigneeId: owner.id, ownerId: owner.id, ownerName: owner.name ?? owner.email }),
        ...(r.slaDueAt ? {} : { slaDueAt: new Date(r.createdAt.getTime() + hours * 3_600_000) }),
      },
    });
  }
  if (reqs.length) log(`${reqs.length} service request(s) assigned/dated`);

  // Client review schedule.
  const clients = await prisma.client.findMany({ where: { nextReviewDate: null, archivedAt: null }, select: { id: true, riskRating: true } });
  for (const c of clients) {
    const months = c.riskRating === 'High' ? 6 : c.riskRating === 'Medium' ? 12 : 24;
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() + months);
    await prisma.client.update({ where: { id: c.id }, data: { nextReviewDate: new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z') } });
  }
  if (clients.length) log(`${clients.length} client review date(s) set`);

  // Legacy seeded clients carry only a mandate label and no Mandate row. Lists and the 360 view now read rows,
  // so give exactly those clients (label set, zero rows) the row the label describes (ADB-013). Clients created
  // through the API always have rows, so they are never touched; the account counter is no longer read for display.
  const labelled = await prisma.client.findMany({
    where: { archivedAt: null, mandateLabel: { not: null }, mandates: { none: {} } },
    select: { id: true, mandateLabel: true },
  });
  let reconciled = 0;
  for (const c of labelled) {
    if (!c.mandateLabel || c.mandateLabel === 'Mandate shell') continue;
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'mandate');
      await tx.mandate.create({ data: { ref, clientId: c.id, name: c.mandateLabel!, type: 'discretionary', status: 'Active', createdBy: actor } });
    });
    reconciled++;
  }
  if (reconciled) log(`${reconciled} legacy client mandate label(s) given a mandate row`);

  // KYC checks and a proposed risk assessment on open cases that have none.
  const cases = await prisma.kycCase.findMany({
    where: { stage: { in: ['Screening', 'ComplianceReview', 'ClientAction', 'EnhancedReview'] } },
    include: { application: { include: { owners: true } }, screening: { orderBy: { receivedAt: 'desc' }, take: 6 } },
    take: 25,
  });
  const maker = staff[1]?.id ?? actor;
  for (const c of cases) {
    if (await prisma.kycCheck.count({ where: { caseId: c.id } })) continue;
    const kinds: [string, string, string | null][] = [
      ['SANCTIONS', c.screening.some((s) => s.type === 'sanctions' && s.outcome === 'Match') ? 'REFER' : 'PASS', null],
      ['PEP', /^y/i.test(c.application.pep ?? '') ? 'REFER' : 'PASS', null],
      ['ID_VERIFICATION', 'PASS', null],
    ];
    for (const [kind, outcome] of kinds) {
      await prisma.kycCheck.create({ data: { caseId: c.id, kind, outcome, provider: 'Demo screening', notes: outcome === 'PASS' ? null : 'Referred for compliance disposition', performedBy: maker } });
    }
    if (!(await prisma.kycRiskAssessment.count({ where: { caseId: c.id } }))) {
      const latest = c.screening[0];
      const run = latest ? c.screening.filter((s) => s.rawRef === latest.rawRef) : [];
      const sc = scoreRisk({
        country: c.application.country,
        bankJurisdiction: c.application.bankJurisdiction,
        pep: c.application.pep,
        applicantType: c.application.applicantType,
        expectedInvestment: c.application.expectedInvestment ? Number(c.application.expectedInvestment) : null,
        ownerPep: c.application.owners.some((o) => o.pep),
        screening: { sanctions: run.find((r) => r.type === 'sanctions')?.outcome, pep: run.find((r) => r.type === 'pep')?.outcome },
        checks: kinds.map(([kind, outcome]) => ({ kind, outcome })),
        missingSourceOfFunds: !c.application.sourceOfFunds?.trim(),
      });
      await prisma.kycRiskAssessment.create({ data: { caseId: c.id, score: sc.score, factors: sc.factors as unknown as Prisma.InputJsonValue, proposedRating: sc.rating, rationale: 'Computed from application, screening and checks', makerId: maker } });
    }
  }
  if (cases.length) log(`${cases.length} open case(s) checked`);

  // One pending classification change and one legal hold on existing documents.
  const docs = await prisma.document.findMany({ orderBy: { createdAt: 'asc' }, take: 4 });
  const [d1, d2] = docs;
  if (d1 && !(await prisma.documentChange.count())) {
    const to = d1.classification === 'Restricted' ? 'Internal' : 'Restricted';
    await prisma.documentChange.create({ data: { documentId: d1.id, kind: 'CLASSIFICATION', fromValue: d1.classification, toValue: to, reason: 'Contains personal data; reclassify per data-handling policy', makerId: maker } });
    log(`pending classification change on ${d1.ref}`);
  }
  if (d2 && !(await prisma.documentHold.count())) {
    await prisma.documentHold.create({ data: { documentId: d2.id, reason: 'Retained pending regulator query', placedBy: maker } });
    log(`legal hold on ${d2.ref}`);
  }
  // Wording clean-up on rows an earlier seed run created with a "(demo)" suffix (ADB-016d).
  for (const [model, field] of [['documentChange', 'reason'], ['documentHold', 'reason'], ['kycCheck', 'notes'], ['kycRiskAssessment', 'rationale']] as const) {
    const rows = await (prisma[model] as unknown as { findMany: (a: object) => Promise<{ id: string }[]> }).findMany({ where: { [field]: { endsWith: ' (demo)' } }, select: { id: true, [field]: true } });
    for (const r of rows) {
      const v = (r as unknown as Record<string, string>)[field]!;
      await (prisma[model] as unknown as { update: (a: object) => Promise<unknown> }).update({ where: { id: r.id }, data: { [field]: v.slice(0, -' (demo)'.length) } });
    }
  }
  log('done');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedClientsOnboarding()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
