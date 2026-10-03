import { prisma } from '../../lib/prisma';
import type { FilingReceipt, FilingSubmission, RegulatorFilingAdapter } from './types';

export class FakeRegulatorFiling implements RegulatorFilingAdapter {
  async submit(s: FilingSubmission): Promise<FilingReceipt> {
    // Deterministic receipt per (regulator, form, payload): resubmitting the same filing yields the same receipt, which the caller stores once.
    const receiptRef = `FAKE-${s.regulator.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${s.payloadSha256.slice(0, 8).toUpperCase() || 'EMPTY'}`;
    const receivedAt = new Date().toISOString();
    // The fake regulator refuses a filing without a payload hash (nothing was locked at approval) so the rejection path can be exercised.
    const status = s.payloadSha256 ? 'ACKNOWLEDGED' : 'REJECTED';
    await prisma.integrationInbox.create({ data: { adapter: 'regulator-filing', kind: 'filing_receipt', externalRef: receiptRef, status: 'PROCESSED', processedAt: new Date(), payload: { ...s, receivedAt, status } } });
    return { receiptRef, status, receivedAt };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter acknowledging every filing' };
  }
}
