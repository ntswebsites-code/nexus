/**
 * Onboarding portal demo data (R4-6): one open draft and one submitted application waiting on the applicant
 * (admin "request more information" loop-back). Idempotent by contact email. Draft tokens are random and never
 * printed: use the portal's "email me a link" flow (the fake email adapter logs it) to open a seeded draft.
 *
 *   npx tsx --env-file-if-exists=../../.env prisma/seed-onboarding.ts   (standalone)
 *   also called by seed-demo.ts and seed-uat.ts
 */
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { nextRef } from '../src/lib/refs';
import { hashToken } from '../src/auth/session';
import { randomToken } from '../src/lib/crypto';
import { slaDue } from '../src/modules/kyc/constants';

const log = (m: string) => console.log(`[seed:onboarding] ${m}`);

const DRAFT_EMAIL = 'draft.applicant@onboarding.demo.test';
const ACTION_EMAIL = 'action.applicant@onboarding.demo.test';

export async function seedOnboarding() {
  let created = 0;
  if (!(await prisma.onboardingApplication.findFirst({ where: { email: DRAFT_EMAIL } }))) {
    await prisma.onboardingApplication.create({
      data: {
        email: DRAFT_EMAIL,
        applicantType: 'Trust / foundation',
        legalName: 'Kopje Family Trust (demo draft)',
        country: 'Zimbabwe',
        draftTokenHash: hashToken(randomToken()),
        draftTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        formData: {
          formVersion: 'v65',
          investorType: 'Trust / foundation',
          legalName: 'Kopje Family Trust (demo draft)',
          jurisdiction: 'Zimbabwe',
          primaryEmail: DRAFT_EMAIL,
          directors: [{ name: 'Rudo Kopje', role: 'Trustee', email: '' }],
        },
      },
    });
    created++;
  }

  if (!(await prisma.onboardingApplication.findFirst({ where: { email: ACTION_EMAIL } }))) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const ref = await nextRef(tx, 'onboarding');
      const caseRef = await nextRef(tx, 'kycCase');
      const app = await tx.onboardingApplication.create({
        data: {
          ref,
          email: ACTION_EMAIL,
          applicantType: 'Institutional investor',
          legalName: 'Msasa Pension Fund (demo, info requested)',
          country: 'Zimbabwe',
          registrationRef: 'PF-2291',
          status: 'Submitted',
          submittedAt: now,
          consentAt: now,
          draftTokenHash: hashToken(randomToken()),
          draftTokenExpiresAt: new Date(now.getTime() + 14 * 86_400_000),
          formData: {
            formVersion: 'v65',
            investorType: 'Institutional investor',
            legalName: 'Msasa Pension Fund (demo, info requested)',
            primaryEmail: ACTION_EMAIL,
            directors: [{ name: 'Tendai Msasa', role: 'Chair of trustees', email: '' }],
            signatories: [{ name: 'Tendai Msasa', role: 'Chair of trustees', email: ACTION_EMAIL }],
          },
        },
      });
      const c = await tx.kycCase.create({
        data: { ref: caseRef, applicationId: app.id, stage: 'ClientAction', slaState: 'Client action', slaDueAt: slaDue('ClientAction') },
      });
      await tx.kycEvidence.create({ data: { applicationId: app.id, caseId: c.id, slot: 'doc2', label: 'Address evidence', status: 'Missing' } });
      await tx.kycCaseEvent.createMany({
        data: [
          { caseId: c.id, title: 'Online application submitted', detail: 'Investor portal submission captured.', at: new Date(now.getTime() - 3 * 86_400_000) },
          { caseId: c.id, title: 'Evidence requested from applicant', detail: 'Address evidence. Please upload a utility bill or bank letter dated within three months.', at: new Date(now.getTime() - 86_400_000) },
        ],
      });
    });
    created++;
  }
  log(`${created} demo application(s) created`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedOnboarding()
    .catch((err) => {
      console.error('[seed:onboarding] FAILED:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
