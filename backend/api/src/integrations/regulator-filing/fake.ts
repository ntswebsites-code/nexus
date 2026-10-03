import { prisma } from '../../lib/prisma';
import type { FilingReceipt, FilingSubmission, RegulatorFilingAdapter } from './types';

export class FakeRegulatorFiling implements RegulatorFilingAdapter {
  async submit(s: FilingSubmission): Promise<FilingReceipt> {
    const receiptRef = `FAKE-${s.regulator.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${s.payloadSha256.slice(0, 8).toUpperCase()}`;
    const receivedAt = new Date().toISOString();
    await prisma.integrationInbox.create({ data: { adapter: 'regulator-filing', kind: 'filing_receipt', externalRef: receiptRef, status: 'PROCESSED', processedAt: new Date(), payload: { ...s, receivedAt } } });
    return { receiptRef, status: 'ACKNOWLEDGED', receivedAt };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter acknowledging every filing' };
  }
}
