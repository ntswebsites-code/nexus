import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { prisma } from '../../lib/prisma';
import type { EmailAdapter, EmailMessage } from './types';
import { smtpSend } from './smtp';

/**
 * Fake email: behaves like the previous mailer (SMTP when configured, console otherwise) and additionally keeps
 * the message in `integration_inbox` outside production so tests can read invite and reset links.
 */
export class FakeEmail implements EmailAdapter {
  async send(m: EmailMessage, serviceName?: string) {
    let transport: 'smtp' | 'console';
    let messageId = `fake-${randomUUID()}`;
    if (config.smtp) {
      messageId = (await smtpSend(m, serviceName)) || messageId;
      transport = 'smtp';
    } else {
      console.log(`[mail] (console transport) to=${m.to} subject=${JSON.stringify(m.subject)}\n${m.text}`);
      transport = 'console';
    }
    if (!config.isProduction) {
      await prisma.integrationInbox
        .create({ data: { adapter: 'email', kind: 'email', externalRef: messageId.slice(0, 80), status: 'NEW', payload: { to: m.to, subject: m.subject, text: m.text, transport, attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, bytes: a.content.length })) } } })
        .catch(() => undefined);
    }
    return { messageId, transport };
  }
  async health() {
    return { ok: true, detail: config.smtp ? `Fake adapter delivering through SMTP ${config.smtp.host}` : 'Fake adapter logging to the console and inbox' };
  }
}
