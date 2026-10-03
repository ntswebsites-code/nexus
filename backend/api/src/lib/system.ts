import type { AuditContext } from './audit';

/**
 * The system actor: maker of automatically generated journals so maker-checker is preserved (a human must still post them).
 * It is not a user row; no foreign key points at it. Views show it as "System".
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000';
export const SYSTEM_NAME = 'System';
export const systemCtx = (): AuditContext => ({ actorId: SYSTEM_ACTOR_ID, actorRole: 'System', portal: 'system', ip: null, requestId: null });
