import type { AdapterMeta } from '../core/types';

export const meta: AdapterMeta = {
  name: 'object-storage',
  label: 'Object storage (S3 / local)',
  gap: 'GAP-A11',
  description: 'Encrypted file storage. `local` is the AES-256-GCM filesystem store under STORAGE_DIR; `s3` targets S3 or MinIO.',
  requiredEnv: [],
  modeRequiredEnv: { s3: ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY'] },
  vendorCalls: { put: 'S3 PutObject after application-level encryption', get: 'S3 GetObject then decrypt' },
  productionSafeFake: () => true,
};
