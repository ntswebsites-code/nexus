import type { AdapterBase, HealthResult } from './types';

/** Gives a real adapter the registry's `health()` probe without changing its own contract. */
export function withHealth<T extends object>(impl: T, probe: () => Promise<HealthResult> | HealthResult): T & AdapterBase {
  return new Proxy(impl, {
    get(target, prop) {
      if (prop === 'health') return async () => probe();
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T & AdapterBase;
}
