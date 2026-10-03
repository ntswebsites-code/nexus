import { createHash } from 'node:crypto';

/**
 * SHA-256 hash chain for signatures. Pure (no config / database) so it can be unit tested offline.
 *   genesis = sha256("esign:v1:" + ref + ":" + originalSha256)
 *   link_i  = sha256(link_{i-1} + digest_i)
 * where digest_i is the hash of the canonical JSON of what the signer attested to. Changing the
 * document, a signer's identity, signing time, consent or signature value changes every later link.
 */
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

export const CONSENT_VERSION = 'ESIGN-CONSENT-v1';

export function consentText(signerName: string, requestRef: string, docSha256: string): string {
  return (
    `I, ${signerName}, agree to sign document ${requestRef} (SHA-256 ${docSha256}) electronically. ` +
    'I understand that my typed or drawn signature has the same legal effect as a handwritten signature, ' +
    'that my name, e-mail address, IP address and the time of signing are recorded in a tamper-evident ' +
    'audit trail, and that I may decline to sign instead.'
  );
}

export function genesisHash(ref: string, originalSha256: string): string {
  return sha256(`esign:v1:${ref}:${originalSha256}`);
}

export interface DigestInput {
  signerId: string;
  name: string;
  email: string;
  signedAt: Date;
  identityMethod: string;
  signatureMode: string;
  signatureHash: string;
  consentHash: string;
  docSha256: string;
  ip: string | null;
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

export function signatureDigest(d: DigestInput): string {
  // Fields are listed explicitly so extra properties on a signer row never leak into the digest.
  return sha256(
    canonicalJson({
      signerId: d.signerId,
      name: d.name,
      email: d.email,
      signedAt: d.signedAt.toISOString(),
      identityMethod: d.identityMethod,
      signatureMode: d.signatureMode,
      signatureHash: d.signatureHash,
      consentHash: d.consentHash,
      docSha256: d.docSha256,
      ip: d.ip,
    }),
  );
}

export function nextLink(previous: string, d: DigestInput): string {
  return sha256(previous + signatureDigest(d));
}

/** Hash of the signature artefact itself (typed text or PNG bytes). */
export function signatureValueHash(mode: 'TYPED' | 'DRAWN', text: string | null, png: Buffer | null): string {
  return mode === 'TYPED' ? sha256(`typed:${text ?? ''}`) : sha256(png ?? Buffer.alloc(0));
}

export function consentHash(text: string, name: string, email: string, ref: string, docSha256: string): string {
  return sha256(`${CONSENT_VERSION}|${text}|${name}|${email.toLowerCase()}|${ref}|${docSha256}`);
}

/** Walks the chain; returns the first signer whose stored link differs from the recomputed one. */
export function walkChain(
  ref: string,
  originalSha256: string,
  signers: (DigestInput & { chainHash: string })[],
): { head: string; brokenAt: number | null } {
  let link = genesisHash(ref, originalSha256);
  let brokenAt: number | null = null;
  signers.forEach((s, i) => {
    link = nextLink(link, s);
    if (brokenAt === null && link !== s.chainHash) brokenAt = i;
  });
  return { head: link, brokenAt };
}

/** 6-digit one-time code, stored only as an HMAC-able hash. */
export const otpDigest = (signerId: string, code: string, secret: string) => sha256(`otp:${secret}:${signerId}:${code}`);
