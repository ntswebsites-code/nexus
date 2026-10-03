import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { IntegrationMode, IntegrationName } from './names';
import { SimulatedFailureError, type AdapterBase } from './types';

const SECRET_KEY = /^(pass(word)?|secret|token|authorization|api_?key|text|body|content|data|message|code|payload|otp|xml|raw|answer)$/i;

/** Removes secrets, message bodies and file bytes from anything written to `integration_calls`. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { bytes: value.length };
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

const canonical = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (Buffer.isBuffer(x) || x instanceof Uint8Array ? `bytes:${x.length}` : typeof x === 'bigint' ? x.toString() : x));

export const hashRequest = (args: unknown[]) => createHash('sha256').update(canonical(args) ?? '').digest('hex');

const correlation = new AsyncLocalStorage<string>();
/** Runs `fn` so every adapter call inside it shares one correlation id (for example the request id). */
export const withCorrelation = <T>(id: string, fn: () => Promise<T>) => correlation.run(id.slice(0, 40), fn);

// ------------------------------------------------------------------ failure simulation (fake mode only)

const stateCache = new Map<string, { at: number; mode: string; remaining: number }>();
const STATE_TTL_MS = 2000;

export function clearStateCache(name?: IntegrationName) {
  if (name) stateCache.delete(name);
  else stateCache.clear();
}

async function assertNoSimulatedFailure(name: IntegrationName) {
  let entry = stateCache.get(name);
  if (!entry || Date.now() - entry.at > STATE_TTL_MS) {
    const row = await prisma.integrationState.findUnique({ where: { adapter: name } }).catch(() => null);
    entry = { at: Date.now(), mode: row?.failureMode ?? 'none', remaining: row?.failuresRemaining ?? 0 };
    stateCache.set(name, entry);
  }
  if (entry.mode !== 'error') return;
  // remaining 0 = fail until cleared; N > 0 = fail the next N calls, then recover.
  if (entry.remaining > 0) {
    const left = entry.remaining - 1;
    await prisma.integrationState
      .update({ where: { adapter: name }, data: left > 0 ? { failuresRemaining: left } : { failuresRemaining: 0, failureMode: 'none' } })
      .catch(() => undefined);
    stateCache.delete(name);
  }
  throw new SimulatedFailureError(name);
}

// ------------------------------------------------------------------ recording

export async function recordCall<R>(name: IntegrationName, mode: IntegrationMode, operation: string, args: unknown[], fn: () => Promise<R>): Promise<R> {
  const started = Date.now();
  const requestHash = hashRequest(args);
  const write = async (status: 'OK' | 'ERROR', result: unknown, error?: string) => {
    try {
      await prisma.integrationCall.create({
        data: {
          adapter: name,
          mode,
          operation,
          requestHash,
          status,
          durationMs: Date.now() - started,
          request: redact(args.length <= 1 ? args[0] : args) as Prisma.InputJsonValue,
          result: result === undefined ? undefined : (redact(result) as Prisma.InputJsonValue),
          error: error?.slice(0, 500) ?? null,
          correlationId: correlation.getStore() ?? randomBytes(6).toString('hex'),
        },
      });
    } catch (e) {
      // The call log must never break the business operation it observes.
      console.error(`[integrations] could not log ${name}.${operation}:`, e instanceof Error ? e.message : e);
    }
  };
  try {
    if (mode === 'fake') await assertNoSimulatedFailure(name);
    const result = await fn();
    await write('OK', result);
    return result;
  } catch (error) {
    await write('ERROR', undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Wraps an adapter so every operation (except `health`) is timed, logged and subject to failure simulation. */
export function instrument<T extends AdapterBase>(name: IntegrationName, mode: IntegrationMode, impl: T): T {
  return new Proxy(impl, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || typeof value !== 'function' || prop === 'health' || prop === 'then') return value;
      return (...args: unknown[]) => recordCall(name, mode, prop, args, () => value.apply(target, args));
    },
  });
}
