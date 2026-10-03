import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { slaDue } from './constants';
import { getScreeningAdapter } from '../../integrations/screening';

/**
 * Screening through the screening adapter (INTEGRATION_SCREENING; fake = the former stub, SRD 12: vendor not selected). Produces advisory
 * sanctions / PEP / adverse-media / document results and a risk rating, then
 * hands the case to human compliance review. The result never decides a case.
 */
export async function runScreening(caseId: string) {
  const kycCase = await prisma.kycCase.findUnique({
    where: { id: caseId },
    include: { application: { include: { owners: true } }, evidence: true },
  });
  if (!kycCase) return;
  if (!['Submitted', 'Screening', 'ComplianceReview', 'ClientAction', 'EnhancedReview'].includes(kycCase.stage)) return;

  const app = kycCase.application;
  const formData = app.formData && typeof app.formData === 'object' && !Array.isArray(app.formData) ? (app.formData as Record<string, unknown>) : {};
  const declared = (key: string) => (typeof formData[key] === 'string' ? formData[key] : '').toLowerCase().startsWith('yes');
  const pep = (app.pep ?? '').toLowerCase().startsWith('yes') || app.owners.some((o) => o.pep);
  const { provider, rawRef, risk, results } = await getScreeningAdapter().screen({
    caseRef: kycCase.ref,
    legalName: app.legalName ?? '',
    ownerNames: app.owners.map((o) => o.fullName),
    pep,
    declaredSanctions: declared('sanctions'),
    declaredAdverseMedia: declared('adverseMedia'),
    country: app.country ?? '',
    taxResidence: app.taxResidence ?? '',
    expectedInvestment: app.expectedInvestment?.toNumber() ?? 0,
    documentsPresent: kycCase.evidence.filter((e) => e.fileId).length,
  });
  const exceptions: string[] = results.filter((r) => r.outcome !== 'Clear').map((r) => r.type);
  // Funding-account holder must be the applicant: a different holder is a third-party-funding exception for the reviewer.
  const norm = (v: unknown) => (typeof v === 'string' ? v : '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const holder = norm(formData['bankHolder']);
  const holderMismatch = holder.length > 0 && holder !== norm(app.legalName) && !app.owners.some((o) => norm(o.fullName) === holder);
  if (holderMismatch) exceptions.push('Bank account holder differs from applicant');

  await prisma.$transaction(async (tx) => {
    await tx.screeningResult.createMany({
      data: results.map((r) => ({ caseId, provider, type: r.type, outcome: r.outcome, score: r.score, rawRef })),
    });
    const toReview = kycCase.stage === 'Submitted' || kycCase.stage === 'Screening';
    await tx.kycCase.update({
      where: { id: caseId },
      data: {
        risk,
        ...(toReview
          ? { stage: 'ComplianceReview', slaState: 'Review open', slaDueAt: slaDue('ComplianceReview') }
          : {}),
        version: { increment: 1 },
      },
    });
    await tx.kycCaseEvent.create({
      data: {
        caseId,
        title: 'Automated pre-screen completed',
        detail: exceptions.length
          ? `Advisory exceptions: ${exceptions.join(', ')}. Indicative risk ${risk} (automated pre-screen only); human review required.`
          : `No advisory exceptions raised by the automated pre-screen. Indicative risk ${risk}; this is not a completed provider check and human review is required.`,
      },
    });
    await writeAudit(tx, { actorRole: 'System (screening worker)' }, {
      action: 'kyc.screening.completed',
      objectType: 'kyc_case',
      objectId: caseId,
      after: { risk, rawRef, results },
    });
    await enqueue(tx, 'notify.permission', {
      permission: 'onboarding.manage',
      type: 'kyc.review',
      title: `${app.legalName ?? 'Applicant'} is ready for compliance review`,
      body: `${kycCase.ref}: pre-screen complete, risk ${risk}.`,
      link: '/#onboarding',
    });
  });
}
