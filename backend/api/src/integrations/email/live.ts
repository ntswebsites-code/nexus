import { config } from '../../config';
import { liveStub } from '../core/live';
import { meta, type EmailAdapter } from './types';
import { smtpSend } from './smtp';

/**
 * Live email is a real SMTP relay submission (SMTP_HOST, SMTP_PORT, ...). Without SMTP_HOST every call
 * throws NotConfiguredError. SES/SendGrid HTTP clients would replace `send` (see meta.vendorCalls).
 */
export const live: EmailAdapter = config.smtp
  ? {
      async send(m, serviceName) {
        return { messageId: await smtpSend(m, serviceName), transport: 'smtp' as const };
      },
      async health() {
        return { ok: true, detail: `SMTP relay ${config.smtp!.host}:${config.smtp!.port} configured` };
      },
    }
  : liveStub<EmailAdapter>(meta);
