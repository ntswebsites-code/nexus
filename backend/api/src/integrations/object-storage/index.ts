import { config } from '../../config';
import { FakeObjectStorage } from './fake';
import { LocalObjectStorage } from './local';
import { S3ObjectStorage } from './s3';
import type { ObjectStorage, StorageBucket } from './types';

export * from './types';
export { FakeObjectStorage, LocalObjectStorage, S3ObjectStorage };

let instance: ObjectStorage | undefined;
let legacyLocal: LocalObjectStorage | undefined;

/** The active object store, chosen by INTEGRATION_OBJECT_STORAGE (local | s3 | fake). */
export function objectStorage(): ObjectStorage {
  if (!instance) {
    const { backend, dir, s3 } = config.storage;
    if (backend === 's3') {
      if (!s3.endpoint || !s3.accessKey || !s3.secretKey) {
        throw new Error('INTEGRATION_OBJECT_STORAGE=s3 needs STORAGE_S3_ENDPOINT, STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY');
      }
      instance = new S3ObjectStorage({ ...s3 });
    } else if (backend === 'fake') {
      instance = new FakeObjectStorage();
    } else {
      instance = new LocalObjectStorage(dir);
    }
  }
  return instance;
}

/** Filesystem store under STORAGE_DIR; the read fallback and migration source while moving to s3. */
export function legacyLocalStorage(): LocalObjectStorage {
  legacyLocal ??= new LocalObjectStorage(config.storage.dir);
  return legacyLocal;
}

/** Test hook. */
export function setObjectStorageForTests(next: ObjectStorage | undefined) {
  instance = next;
}

export interface StorageStatus {
  backend: 'local' | 's3' | 'fake';
  ok: boolean;
  detail?: string;
}

export async function storageStatus(): Promise<StorageStatus> {
  try {
    const store = objectStorage();
    return { backend: store.kind, ...(await store.ping()) };
  } catch (err) {
    return { backend: config.storage.backend, ok: false, detail: (err as Error).message };
  }
}

/** storageKey column -> adapter bucket + key. Non-document buckets are prefixed (`exports/<id>`). */
export function resolveStorageKey(storageKey: string): { bucket: StorageBucket; key: string } {
  for (const bucket of ['esign', 'exports'] as const) {
    if (storageKey.startsWith(`${bucket}/`)) return { bucket, key: storageKey.slice(bucket.length + 1) };
  }
  return { bucket: 'documents', key: storageKey };
}

export function makeStorageKey(bucket: StorageBucket, id: string): string {
  return bucket === 'documents' ? id : `${bucket}/${id}`;
}
