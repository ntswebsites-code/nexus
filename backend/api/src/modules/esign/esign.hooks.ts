import type { EsignRequest, Prisma } from '@prisma/client';

/**
 * Business effects of a completed signature request, keyed by `subjectType`. Hooks run inside the
 * completion transaction (after the seal is stored), so a failing hook rolls the whole completion back.
 */
export interface SignedBy {
  userId: string | null;
  name: string;
  signedAt: Date | null;
}

export type CompletionHook = (tx: Prisma.TransactionClient, request: EsignRequest, signers: SignedBy[]) => Promise<void>;

const hooks = new Map<string, CompletionHook>();

export function registerCompletionHook(subjectType: string, hook: CompletionHook) {
  hooks.set(subjectType, hook);
}

export async function runCompletionHooks(tx: Prisma.TransactionClient, request: EsignRequest, signers: SignedBy[]) {
  const hook = request.subjectType ? hooks.get(request.subjectType) : undefined;
  if (hook) await hook(tx, request, signers);
}
