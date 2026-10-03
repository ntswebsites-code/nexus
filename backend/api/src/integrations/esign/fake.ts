import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { storeFile } from '../../lib/storage';
import type { EsignAdapter, EsignEnvelope, EsignRequest } from './types';

interface Stored extends EsignRequest {
  certificateFileId?: string;
}

/** Envelopes complete on the first status read; completion stores a certificate file. */
export class FakeEsign implements EsignAdapter {
  async createEnvelope(r: EsignRequest): Promise<EsignEnvelope> {
    const envelopeId = `ENV-${randomUUID()}`;
    await prisma.integrationInbox.create({ data: { adapter: 'esign', kind: 'esign_envelope', externalRef: envelopeId, status: 'PENDING', payload: { ...r } } });
    return { envelopeId, status: 'SENT', certificateFileId: null };
  }
  async getEnvelope({ envelopeId }: { envelopeId: string }): Promise<EsignEnvelope> {
    const row = await prisma.integrationInbox.findFirst({ where: { adapter: 'esign', kind: 'esign_envelope', externalRef: envelopeId } });
    if (!row) throw new Error(`Unknown envelope ${envelopeId}`);
    const p = row.payload as unknown as Stored;
    if (row.status === 'SETTLED') return { envelopeId, status: 'COMPLETED', certificateFileId: p.certificateFileId ?? null };
    const text = [
      'CERTIFICATE OF COMPLETION (SIMULATED - not legally binding)',
      `Envelope: ${envelopeId}`,
      `Document: ${p.documentName}`,
      `Document SHA-256: ${p.documentSha256}`,
      ...p.signers.map((s) => `Signed by: ${s.name} <${s.email}>`),
      `Completed at: ${new Date().toISOString()}`,
    ].join('\n');
    const file = await storeFile({ name: `${envelopeId}-certificate.txt`, mime: 'text/plain', data: Buffer.from(text, 'utf8') });
    await prisma.integrationInbox.update({ where: { id: row.id }, data: { status: 'SETTLED', processedAt: new Date(), payload: { ...p, certificateFileId: file.id } } });
    return { envelopeId, status: 'COMPLETED', certificateFileId: file.id };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter issuing text certificates' };
  }
}
