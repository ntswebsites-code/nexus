import type { PortalId } from '@matanho/shared';
import { LoginForm } from './LoginForm';

/** Server component for `/login`: resolves the API URL from env (build/start time). */
export function LoginPage({
  portal,
  enforcePortalAccess = true,
}: {
  portal: PortalId;
  enforcePortalAccess?: boolean;
}) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';
  return <LoginForm portal={portal} apiUrl={apiUrl} enforcePortalAccess={enforcePortalAccess} />;
}
