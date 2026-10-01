import type { Metadata } from 'next';
import { AccessDeniedPage } from '@matanho/portal-kit';

export const metadata: Metadata = { title: 'Access denied | Matanho Investee Portal' };

export default function AccessDenied() {
  return (
    <AccessDeniedPage
      portal="company"
      message="You are signed in with an investor account. The Investee portal is for investee accounts: sign out, then sign in with your investee account."
    />
  );
}
