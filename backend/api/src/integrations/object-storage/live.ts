import { liveStub } from '../core/live';
import { meta, type ObjectStorageAdapter } from './types';

/** Live object-storage adapter: not built yet. Every call throws NotConfiguredError naming the required env vars (see meta.requiredEnv). */
export const live: ObjectStorageAdapter = liveStub<ObjectStorageAdapter>(meta);
