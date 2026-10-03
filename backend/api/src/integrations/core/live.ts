import { NotConfiguredError, type AdapterBase, type AdapterMeta } from './types';

/**
 * Builds the `live` implementation for an adapter that has no vendor client yet. Every operation throws a
 * NotConfiguredError that names the missing environment variables, or, once they are set, the vendor call to build.
 * `health` never throws: it reports the same message.
 */
export function liveStub<T extends AdapterBase>(meta: Pick<AdapterMeta, 'name' | 'requiredEnv' | 'vendorCalls'>): T {
  const missing = () => meta.requiredEnv.filter((k) => !process.env[k]);
  const failure = (op: string) =>
    missing().length
      ? new NotConfiguredError(meta.name, missing())
      : new NotConfiguredError(
          meta.name,
          meta.requiredEnv,
          `Integration '${meta.name}' is live but this build has no vendor client. Operation '${op}' should call: ${meta.vendorCalls[op] ?? 'vendor API'}`,
        );
  return new Proxy({} as T, {
    get(_t, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === 'health') return async () => ({ ok: false, detail: failure('health').message });
      return async () => {
        throw failure(prop);
      };
    },
  });
}
