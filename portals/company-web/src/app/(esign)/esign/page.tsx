import { EsignInbox } from '@matanho/portal-kit';

/** Documents awaiting the signed-in investee authorised signatory (native e-signature). */
export default function EsignPage() {
  return (
    <>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '16px 16px 0', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
        <a href="/" style={{ color: '#1f4fa3' }}>
          Back to the investee portal
        </a>
      </div>
      <EsignInbox heading="Documents to sign" />
    </>
  );
}
