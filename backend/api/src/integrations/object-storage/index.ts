import { getAdapter } from '../core/registry';
import type { ObjectStorageAdapter } from './types';

export * from './types';

/** The configured object-storage adapter (INTEGRATION_OBJECT_STORAGE=fake|live). Every call is logged to integration_calls. */
export const getObjectStorageAdapter = (): ObjectStorageAdapter => getAdapter('object-storage');
