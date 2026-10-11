import { getEmailAdapter } from '../integrations/email';
import type { EmailAttachment } from '../integrations/email/types';

/**
 * Removes anything that works as a credential from text destined for logs: `token=` query values, URL fragments after
 * `/invite/`, `/accept/`, `/reset/` style paths, and any 32+ character base64url run (raw tokens).
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/([?&](?:token|code|key|secret|signature|sig)=)[^&\s"')]+/gi, '$1[redacted]')
    .replace(/(\/(?:invite|invitation|accept|reset|verify|download)\/)[A-Za-z0-9_\-.~%]{16,}/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}

/**
 * Sends through the email adapter (INTEGRATION_EMAIL). Fake mode keeps the previous behaviour: SMTP when configured, otherwise the console.
 * Every send is logged to `integration_calls`.
 */
export async function sendMail(to: string, subject: string, text: string, attachments?: EmailAttachment[], serviceName?: string) {
  await getEmailAdapter().send({ to, subject, text, ...(attachments?.length ? { attachments } : {}) }, serviceName);
}
