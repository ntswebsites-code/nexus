'use client';

import type { PortalId } from '@matanho/shared';
import { AuthCard } from './AuthCard';
import { signOut } from './session';

/** Shown to a signed-in user whose account may not open this portal, with a way to switch account. */
export function AccessDeniedPage({ portal, message }: { portal: PortalId; message: string }) {
  return (
    <AuthCard portal={portal} title="This account can't open this portal" foot={null}>
      <p className="mx-muted">{message}</p>
      <button type="button" className="mx-btn primary block" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthCard>
  );
}
