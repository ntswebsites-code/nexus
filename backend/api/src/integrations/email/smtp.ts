import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config';
import { getServiceIdentity } from '../../config/emailConfig';
import type { EmailMessage } from './types';

let transporter: Transporter | null = null;

/**
 * SMTP submission through the environment's relay (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD,
 * MAIL_FROM). The relay is whatever the environment configures: Mailpit in test, the production
 * relay in production - never a hardcoded vendor.
 */
export async function smtpSend(m: EmailMessage, serviceName?: string): Promise<string> {
  if (!config.smtp) throw new Error('SMTP is not configured');
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  const identity = serviceName ? getServiceIdentity(serviceName) : { fromName: 'Matanho Nexus', fromEmail: '' };
  const from = identity.fromEmail ? `"${identity.fromName}" <${identity.fromEmail}>` : config.mailFrom;
  const info = await transporter.sendMail({
    from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    attachments: m.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
  });
  return String(info.messageId ?? '');
}
