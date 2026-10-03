import { AccessDeniedPage } from '@matanho/portal-kit';

export default function AccessDenied() {
  return (
    <AccessDeniedPage
      portal="custodian"
      message="This account does not hold a custodian portal role. Sign out and use the account your organisation invited, or ask your approver for access."
    />
  );
}
