import type { PortalId } from '@matanho/shared';
import { LoginForm } from './LoginForm';
import { AcceptInviteForm } from './AcceptInviteForm';
import { ResetPasswordForm } from './ResetPasswordForm';

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4100';

/** Server component for `/login`: resolves the API URL from env (build/start time). */
export function LoginPage({
  portal,
  enforcePortalAccess = true,
  turnAwayPortals,
}: {
  portal: PortalId;
  enforcePortalAccess?: boolean;
  turnAwayPortals?: PortalId[];
}) {
  return <LoginForm portal={portal} apiUrl={apiUrl()} enforcePortalAccess={enforcePortalAccess} turnAwayPortals={turnAwayPortals} />;
}

/** Server component for `/invite`. */
export function AcceptInvitePage({ portal }: { portal: PortalId }) {
  return <AcceptInviteForm portal={portal} apiUrl={apiUrl()} />;
}

/** Server component for `/reset-password`. */
export function ResetPasswordPage({ portal }: { portal: PortalId }) {
  return <ResetPasswordForm portal={portal} apiUrl={apiUrl()} />;
}
