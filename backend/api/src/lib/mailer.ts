import { getEmailAdapter } from '../integrations/email';

/**
 * Sends through the email adapter (INTEGRATION_EMAIL). Fake mode keeps the previous behaviour: SMTP when
 * configured, otherwise the console. Every send is logged to `integration_calls`.
 */
export async function sendMail(to: string, subject: string, text: string) {
  await getEmailAdapter().send({ to, subject, text });
}
