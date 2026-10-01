import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

let transporter: Transporter | null = null;

/** Sends via SMTP when configured; otherwise logs the message (dev and pre-SMTP production). */
export async function sendMail(to: string, subject: string, text: string) {
  if (!config.smtp) {
    console.log(`[mail] (console transport) to=${to} subject=${JSON.stringify(subject)}\n${text}`);
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
