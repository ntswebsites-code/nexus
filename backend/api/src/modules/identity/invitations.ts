import type { Prisma } from '@prisma/client';
import type { PortalId } from '@matanho/shared';
import { config } from '../../config';
import { hashToken } from '../../auth/session';
import { randomToken } from '../../lib/crypto';
import { enqueue } from '../../lib/outbox';

export interface InvitationInput {
  email: string;
  name?: string | null;
  portal: PortalId;
  roleKeys: string[];
  clientId?: string | null;
  companyId?: string | null;
  scope?: string | null;
  invitedById?: string | null;
  /** Human sentence used in the email, e.g. "Mokoena Family Office's investor portal". */
  context?: string;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Creates a single-use invitation and queues the email. Returns the raw token (for tests/logging only). */
export async function createInvitation(tx: Prisma.TransactionClient, input: InvitationInput) {
  const token = randomToken();
  const invitation = await tx.invitation.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name ?? null,
      portal: input.portal,
      roleKeys: input.roleKeys,
      clientId: input.clientId ?? null,
      companyId: input.companyId ?? null,
      scope: input.scope ?? null,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedById: input.invitedById ?? null,
    },
  });
  const link = `${config.portalUrls[input.portal]}/invite?token=${encodeURIComponent(token)}`;
  await enqueue(tx, 'email.send', {
    to: invitation.email,
    subject: 'You have been invited to Matanho Nexus',
    text:
      `Hello${input.name ? ` ${input.name}` : ''},\n\n` +
      `You have been invited to ${input.context ?? `the Matanho Nexus ${input.portal} portal`}.\n` +
      `Accept the invitation and set your password here (valid for 7 days):\n${link}\n\n` +
      `If you were not expecting this, you can ignore this email.`,
  });
  return { invitation, token, link };
}
