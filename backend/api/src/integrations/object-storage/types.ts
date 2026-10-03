import type { AdapterBase, AdapterMeta } from '../core/types';

export interface ObjectStorageAdapter extends AdapterBase {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export const meta: AdapterMeta = {
  name: 'object-storage',
  label: 'Object storage (S3)',
  gap: 'GAP-A11',
  description: 'Encrypted file storage. Fake mode is the local AES-256-GCM store under STORAGE_DIR.',
  requiredEnv: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'],
  vendorCalls: {
    put: 'S3 PutObject (bucket S3_BUCKET, SSE, key as given) after application-level encryption',
    get: 'S3 GetObject then decrypt',
  },
  productionSafeFake: () => true,
};
