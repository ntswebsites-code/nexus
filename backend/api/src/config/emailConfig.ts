/**
 * Email branding identities. Transport and credentials always come from the environment
 * (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/MAIL_FROM) - never hardcoded here.
 */
export interface EmailServiceIdentity {
  fromName: string;
  fromEmail: string;
}

/** Per-service display names; the address is the environment's MAIL_FROM by default. */
export const SERVICE_IDENTITIES: Record<string, EmailServiceIdentity> = {
  EmailVerificationService: { fromName: 'Matanho Nexus', fromEmail: '' },
  StaffCredentialEmailService: { fromName: 'Matanho Nexus', fromEmail: '' },
  TwoFactorAuthService: { fromName: 'Matanho Nexus Security', fromEmail: '' },
  PasswordResetService: { fromName: 'Matanho Nexus Security', fromEmail: '' },
  EmailNotificationService: { fromName: 'Matanho Nexus', fromEmail: '' },
};

export function getServiceIdentity(serviceName: string): EmailServiceIdentity {
  return SERVICE_IDENTITIES[serviceName] ?? { fromName: 'Matanho Nexus', fromEmail: '' };
}
