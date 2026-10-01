import type { Prisma } from '@prisma/client';
import { sha256Hex } from '../../lib/crypto';

/** Setting key stored against the invitation id. Consumed once, on acceptance. */
export const INVITE_GRANT_KEY = 'invite.grant';

/** Same key the LP colleague middleware reads, so a grant applied at accept is not applied twice. */
export function lpInviteSettingKey(email: string): string {
  return `lp.invite:${sha256Hex(email.toLowerCase()).slice(0, 40)}`;
}

export type InviteGrant =
  | { kind: 'lp'; fundIds: string[] | null; lpRole: string; invitedById: string | null }
  | { kind: 'company'; profile: string; title: string | null; invitedById: string | null }
  | { kind: 'custodian'; counterpartyId: string; role: string; invitedById: string | null };

export async function saveInviteGrant(tx: Prisma.TransactionClient, invitationId: string, grant: InviteGrant) {
  await tx.setting.upsert({
    where: { ownerId_key: { ownerId: invitationId, key: INVITE_GRANT_KEY } },
    create: { ownerId: invitationId, key: INVITE_GRANT_KEY, value: grant },
    update: { value: grant },
  });
}

/** Reads and deletes the grant so acceptance is the only place membership scope is written. */
export async function takeInviteGrant(tx: Prisma.TransactionClient, invitationId: string): Promise<InviteGrant | null> {
  const row = await tx.setting.findUnique({ where: { ownerId_key: { ownerId: invitationId, key: INVITE_GRANT_KEY } } });
  if (!row) return null;
  await tx.setting.delete({ where: { ownerId_key: { ownerId: invitationId, key: INVITE_GRANT_KEY } } });
  const v = row.value;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'lp' || kind === 'company' || kind === 'custodian') return v as InviteGrant;
  return null;
}
