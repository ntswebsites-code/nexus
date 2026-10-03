import { EsignPublicSigner } from '@matanho/portal-kit';

/** External signer landing page for the one-time e-mail link (/sign/<token>). */
export default async function SignTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EsignPublicSigner token={token} />;
}
