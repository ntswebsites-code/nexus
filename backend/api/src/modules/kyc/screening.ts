import { prisma } from '../../lib/prisma';
import { writeAudit } from '../../lib/audit';
import { enqueue } from '../../lib/outbox';
import { HIGH_RISK_COUNTRIES, STUB_WATCHLIST, slaDue } from './constants';

const PROVIDER = 'stub-screening-v1';

/**
 * Screening provider stub (SRD 12: vendor not selected). Produces advisory
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
  const names = [app.legalName ?? '', ...app.owners.map((o) => o.fullName)].map((n) => n.toLowerCase());
  const sanctionsHit = names.some((n) => STUB_WATCHLIST.some((w) => n.includes(w)));
  const pep = (app.pep ?? '').toLowerCase().startsWith('yes') || app.owners.some((o) => o.pep);
  const country = `${app.country ?? ''} ${app.taxResidence ?? ''}`.toLowerCase();
  const highRiskCountry = HIGH_RISK_COUNTRIES.some((c) => country.includes(c));
  const amount = app.expectedInvestment?.toNumber() ?? 0;
  const docsPresent = kycCase.evidence.filter((e) => e.fileId).length;

  const results = [
    { type: 'sanctions', outcome: sanctionsHit ? 'Match' : 'Clear', score: sanctionsHit ? 92 : 0 },
    { type: 'pep', outcome: pep ? 'Review' : 'Clear', score: pep ? 70 : 0 },
    { type: 'adverse_media', outcome: highRiskCountry ? 'Review' : 'Clear', score: highRiskCountry ? 55 : 0 },
    { type: 'document', outcome: docsPresent >= 3 ? 'Clear' : 'Review', score: docsPresent >= 3 ? 0 : 40 },
  ];
  const risk = sanctionsHit || pep || highRiskCountry ? 'High' : amount >= 5_000_000 ? 'Medium' : 'Low';
  const rawRef = `SCR-${kycCase.ref.replace(/\D/g, '')}-${Date.now().toString().slice(-4)}`;
  const exceptions = results.filter((r) => r.outcome !== 'Clear').map((r) => r.type);

  await prisma.$transaction(async (tx) => {
    await tx.screeningResult.createMany({
      data: results.map((r) => ({ caseId, provider: PROVIDER, type: r.type, outcome: r.outcome, score: r.score, rawRef })),
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
          ? `Advisory exceptions: ${exceptions.join(', ')}. Risk rated ${risk}; human review required.`
          : `No advisory exceptions. Risk rated ${risk}; human review required.`,
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
