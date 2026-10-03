import type { AdapterBase, AdapterMeta } from '../core/types';

export interface SmsReceipt {
  messageId: string;
}

export interface SmsAdapter extends AdapterBase {
  send(input: { to: string; message: string }): Promise<SmsReceipt>;
  /** Sends a one-time code. Fake mode keeps the code in `integration_inbox` so tests can read it. */
  sendOtp(input: { to: string; purpose: string }): Promise<SmsReceipt & { expiresAt: string }>;
  verifyOtp(input: { to: string; code: string }): Promise<{ valid: boolean }>;
}

export const meta: AdapterMeta = {
  name: 'sms',
  label: 'SMS / OTP',
  gap: 'GAP-A02',
  description: 'SMS delivery and one-time passcodes.',
  requiredEnv: ['SMS_API_KEY', 'SMS_SENDER_ID'],
  vendorCalls: {
    send: 'POST provider /messages {to, from: SMS_SENDER_ID, body}',
    sendOtp: 'POST provider /verify/start {to, channel: sms}',
    verifyOtp: 'POST provider /verify/check {to, code}',
  },
};
