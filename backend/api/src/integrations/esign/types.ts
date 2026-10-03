/** E-signature adapter contract (GAP-A07). `native` is the in-house implementation; `live` is a vendor stub. */

export type SignatureMode = 'TYPED' | 'DRAWN';

export class NotConfiguredError extends Error {
  readonly code = 'integration_not_configured';
  constructor(adapter: string, hint: string) {
    super(`${adapter} integration is not configured: ${hint}`);
    this.name = 'NotConfiguredError';
  }
}

/** One collected signature as it enters the hash chain and the sealed PDF. */
export interface SealSigner {
  signerId: string;
  name: string;
  email: string;
  roleLabel: string | null;
  kind: string;
  identityMethod: string;
  signatureMode: SignatureMode;
  signatureText: string | null;
  /** Raw PNG bytes of a drawn signature. */
  signaturePng: Buffer | null;
  signatureHash: string;
  ip: string | null;
  userAgent: string | null;
  signedAt: Date;
  consentTextVersion: string;
  consentText: string;
  consentHash: string;
  docSha256: string;
  chainHash: string;
}

export interface SealInput {
  ref: string;
  title: string;
  subjectLabel: string | null;
  originalPdf: Buffer;
  originalSha256: string;
  createdAt: Date;
  completedAt: Date;
  chainHead: string;
  signers: SealSigner[];
  /** Condensed audit trail lines for the certificate. */
  events: { at: Date; type: string; who: string | null; ip: string | null }[];
  verifyUrl: string;
}

export interface SealResult {
  /** Original pages + signature page + certificate pages, with a seal footer on every page. */
  sealedPdf: Buffer;
  sealedSha256: string;
  /** Stand-alone copy of the certificate of completion. */
  certificatePdf: Buffer;
}

export interface ChainCheck {
  ok: boolean;
  expectedHead: string;
  /** Index of the first signer whose recorded link does not match, if any. */
  brokenAt: number | null;
}

export interface ESignAdapter {
  readonly mode: 'native' | 'live' | 'fake';
  /** Stamps signatures + audit block, appends the certificate and returns the sealed bytes. */
  seal(input: SealInput): Promise<SealResult>;
  /** Recomputes the signature hash chain from the recorded signers. */
  verifyChain(ref: string, originalSha256: string, signers: SealSigner[], recordedHead: string | null): ChainCheck;
}
