import { createHash } from 'node:crypto';
import { walkChain } from './chain';
import type { ChainCheck, ESignAdapter, SealInput, SealResult, SealSigner } from './types';

/**
 * Simulated sealing (INTEGRATION_ESIGN=fake): returns the original PDF unchanged as the "sealed" file and a plain-text
 * certificate. Hash chain verification is the real one. Not legally binding; never use in production.
 */
export const fakeESign: ESignAdapter = {
  mode: 'fake',
  async seal(input: SealInput): Promise<SealResult> {
    const certificate = [
      'CERTIFICATE OF COMPLETION (SIMULATED - not legally binding)',
      `Reference: ${input.ref}`,
      `Document SHA-256: ${input.originalSha256}`,
      ...input.signers.map((s) => `Signed by: ${s.name} <${s.email}>`),
      `Chain head: ${input.chainHead}`,
    ].join('\n');
    const sealedPdf = Buffer.from(input.originalPdf);
    return { sealedPdf, sealedSha256: createHash('sha256').update(sealedPdf).digest('hex'), certificatePdf: Buffer.from(certificate, 'utf8') };
  },
  verifyChain(ref: string, originalSha256: string, signers: SealSigner[], recordedHead: string | null): ChainCheck {
    const { head, brokenAt } = walkChain(ref, originalSha256, signers);
    return { ok: brokenAt === null && (recordedHead === null || head === recordedHead), expectedHead: head, brokenAt };
  },
};
