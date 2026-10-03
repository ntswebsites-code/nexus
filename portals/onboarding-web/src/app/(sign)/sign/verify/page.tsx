import { EsignVerifier } from '@matanho/portal-kit';

/** Public check of a signed PDF (upload) or its SHA-256 against the sealed record. */
export default function VerifyPage() {
  return <EsignVerifier />;
}
