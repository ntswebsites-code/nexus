import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config';
import type { EmailMessage } from './types';

let transporter: Transporter | null = null;

/** SMTP submission shared by the fake (when SMTP is configured, for Mailpit) and the live adapter. */
export async function smtpSend(m: EmailMessage): Promise<string> {
  if (!config.smtp) throw new Error('SMTP is not configured');
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  const info = await transporter.sendMail({ from: config.mailFrom, to: m.to, subject: m.subject, text: m.text });
  return String(info.messageId ?? '');
}
