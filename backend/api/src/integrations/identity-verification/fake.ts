import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { IdentityVerificationAdapter, IdentityVerificationRequest, IdentityVerificationResult } from './types';

/** Deterministic: a document number containing FAIL is rejected, REFER goes to manual review, anything else verifies. */
export class FakeIdentityVerification implements IdentityVerificationAdapter {
  async verify(r: IdentityVerificationRequest): Promise<IdentityVerificationResult> {
    const num = r.documentNumber.toUpperCase();
    const status = num.includes('FAIL') ? 'FAILED' : num.includes('REFER') ? 'REFER' : 'VERIFIED';
    const reference = `IDV-${createHash('sha256').update(`${r.subjectName}|${r.documentType}|${r.documentNumber}`).digest('hex').slice(0, 10).toUpperCase()}`;
    const checks = [
      { name: 'document_authentic', passed: status !== 'FAILED' },
      { name: 'name_matches', passed: status === 'VERIFIED' },
      { name: 'not_expired', passed: true },
    ];
    await prisma.integrationInbox.create({ data: { adapter: 'identity-verification', kind: 'idv_result', externalRef: reference, status: 'PROCESSED', processedAt: new Date(), payload: { subject: r.subjectName, documentType: r.documentType, country: r.country, status, checks } } });
    return { reference, status, checks };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter (document numbers containing FAIL or REFER simulate those outcomes)' };
  }
}
