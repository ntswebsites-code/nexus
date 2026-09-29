import { loadConfig } from './env';

export type { AppConfig } from './env';
export { loadConfig };

/** Singleton config, validated once at start-up (fails fast on bad env). */
export const config = loadConfig();
