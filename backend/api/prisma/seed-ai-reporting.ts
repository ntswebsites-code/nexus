import { createHash } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import { ruleTriage } from '../src/integrations/llm/fake';

const log = (m: string) => console.log(`[seed:ai-reporting] ${m}`);

/**
 * R4-8 demo data (idempotent): the quarterly fact-sheet schedule mails its file as an attachment (LP-portal delivery is left OFF: it
 * needs a second person with reports.approve to switch it on), and one open onboarding case carries a stored advisory triage.
 */
export async function seedAiReporting() {
  const actor = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
  if (!actor) {
    log('no users yet: skipped');
    return;
  }
  const sched = await prisma.reportSchedule.findFirst({ where: { name: { startsWith: 'Quarterly fact sheet' } } });
  if (sched && !sched.emailAttach) {
    await prisma.reportSchedule.update({ where: { id: sched.id }, data: { emailAttach: true, recipients: sched.recipients ?? ['reports-demo@example.test'] } });
    log('fact-sheet schedule now mails the file as an attachment');
  }
  const kase = await prisma.kycCase.findFirst({ where: { stage: { in: ['Screening', 'ComplianceReview', 'EnhancedReview'] } }, include: { application: true }, orderBy: { createdAt: 'asc' } });
  if (kase && !(await prisma.onboardingTriage.findFirst({ where: { caseId: kase.id }, select: { id: true } }))) {
    const input = {
      caseRef: kase.ref,
      applicant: { name: kase.application.legalName ?? 'Applicant', type: kase.application.applicantType, country: kase.application.country, pep: kase.application.pep, sourceOfFunds: kase.application.sourceOfFunds, expectedInvestment: kase.application.expectedInvestment ? Number(kase.application.expectedInvestment) : null, owners: 0 },
      checks: [] as { kind: string; outcome: string | null }[],
      riskPreview: { score: 0, rating: kase.risk, factors: [] as string[] },
      openReferrals: [] as string[],
      missingEvidence: [] as string[],
      blockers: [] as string[],
    };
    const r = ruleTriage(input);
    await prisma.onboardingTriage.create({
      data: { caseId: kase.id, riskBand: r.riskBand, summary: r.summary, flags: r.flags, nextSteps: r.nextSteps, model: r.model, inputSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'), createdBy: actor },
    });
    log(`triage stored for ${kase.ref}`);
  }
}
