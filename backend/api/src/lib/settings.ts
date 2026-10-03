import { prisma } from './prisma';
import { policy } from './policy';
import { settingDef } from '../modules/admin-core/admin-core.engine';

/**
 * Platform setting reader (admin-core registry). Modules call `setting('retention.session_days')` instead of
 * reading `platform_settings` themselves, so a value saved on /ops/settings changes behaviour within `TTL_MS`.
 * Policy-backed keys (MFA, idle timeout ...) are read from the `policies` table, everything else from
 * `platform_settings`, falling back to the registry default.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { value: boolean | number | string; at: number }>();

export async function setting<T extends boolean | number | string = boolean | number | string>(key: string): Promise<T> {
  const def = settingDef(key);
  if (!def) throw new Error(`Unknown platform setting ${key}`);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  let value: boolean | number | string;
  if (def.policyKey) value = (await policy(def.policyKey)) as boolean | number;
  else {
    const row = await prisma.platformSetting.findUnique({ where: { key } });
    value = (row?.value as boolean | number | string | undefined) ?? def.default;
  }
  cache.set(key, { value, at: Date.now() });
  return value as T;
}

/** Drops cached values (called after a setting is saved in this process; other processes expire within TTL_MS). */
export function clearSettingCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
