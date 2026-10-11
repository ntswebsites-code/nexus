import type { AdapterBase, AdapterMeta } from '../core/types';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** R4-8: files sent with the message (reports). Never written to logs: `integration_calls` redacts bytes. */
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface EmailReceipt {
  messageId: string;
  transport: 'smtp' | 'console';
}

export interface EmailAdapter extends AdapterBase {
  send(message: EmailMessage, serviceName?: string): Promise<EmailReceipt>;
}

export const meta: AdapterMeta = {
  name: 'email',
  label: 'Email',
  gap: 'GAP-A01',
  description: 'Transactional email (invites, resets, notifications, scheduled reports).',
  requiredEnv: [],
  vendorCalls: { send: 'SMTP relay submission, or SES v2 SendEmail / SendGrid v3 mail/send (delivery status and bounces via webhook)' },
  productionSafeFake: () => true,
};
