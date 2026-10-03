import type { AdapterBase, AdapterMeta } from '../core/types';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailReceipt {
  messageId: string;
  transport: 'smtp' | 'console';
}

export interface EmailAdapter extends AdapterBase {
  send(message: EmailMessage): Promise<EmailReceipt>;
}

export const meta: AdapterMeta = {
  name: 'email',
  label: 'Email',
  gap: 'GAP-A01',
  description: 'Transactional email (invites, resets, notifications, scheduled reports).',
  requiredEnv: ['SMTP_HOST'],
  vendorCalls: { send: 'SMTP relay submission, or SES v2 SendEmail / SendGrid v3 mail/send (delivery status and bounces via webhook)' },
  productionSafeFake: (env) => !!env.SMTP_HOST,
};
