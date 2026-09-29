import { LoginPage } from '@matanho/portal-kit';

export default function OnboardingLogin() {
  // The onboarding portal has no roles of its own; any shared account may sign in.
  return <LoginPage portal="onboarding" enforcePortalAccess={false} />;
}
