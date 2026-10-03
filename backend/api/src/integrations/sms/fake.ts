import { randomInt, randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import type { SmsAdapter } from './types';

const OTP_TTL_MS = 10 * 60 * 1000;

export class FakeSms implements SmsAdapter {
  async send(input: { to: string; message: string }) {
    const messageId = `sms-${randomUUID()}`;
    await prisma.integrationInbox.create({ data: { adapter: 'sms', kind: 'sms', externalRef: messageId, status: 'NEW', payload: { to: input.to, message: input.message } } });
    return { messageId };
  }
  async sendOtp(input: { to: string; purpose: string }) {
    const messageId = `sms-${randomUUID()}`;
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await prisma.integrationInbox.create({
      data: { adapter: 'sms', kind: 'otp', externalRef: messageId, status: 'PENDING', payload: { to: input.to, purpose: input.purpose, code, expiresAt: expiresAt.toISOString() } },
    });
    return { messageId, expiresAt: expiresAt.toISOString() };
  }
  async verifyOtp(input: { to: string; code: string }) {
    const rows = await prisma.integrationInbox.findMany({ where: { adapter: 'sms', kind: 'otp', status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 50 });
    const hit = rows.find((r) => {
      const p = r.payload as { to?: string; code?: string; expiresAt?: string };
      return p.to === input.to && p.code === input.code && new Date(p.expiresAt ?? 0).getTime() > Date.now();
    });
    if (!hit) return { valid: false };
    await prisma.integrationInbox.update({ where: { id: hit.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
    return { valid: true };
  }
  async health() {
    return { ok: true, detail: 'Fake adapter; messages and codes are kept in integration_inbox' };
  }
}
