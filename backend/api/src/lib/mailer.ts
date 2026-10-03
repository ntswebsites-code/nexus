import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

let transporter: Transporter | null = null;

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
 * Sends via SMTP when configured; otherwise records that a message was produced (dev and pre-SMTP production).
 * The console transport never prints the body: invite and password-reset emails carry one-time links.
 */
export async function sendMail(to: string, subject: string, text: string) {
  if (!config.smtp) {
    console.log(`[mail] (console transport, body withheld) to=${to} subject=${JSON.stringify(redactSecrets(subject))} bytes=${Buffer.byteLength(text)}`);
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  await transporter.sendMail({ from: config.mailFrom, to, subject, text });
}
