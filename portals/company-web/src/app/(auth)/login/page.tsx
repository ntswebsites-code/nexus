import { LoginPage } from '@matanho/portal-kit';

export default function CompanyLogin() {
  // The company portal has no roles of its own yet; any shared account may sign in.
  return <LoginPage portal="company" enforcePortalAccess={false} turnAwayPortals={['investor', 'custodian']} />;
}
