import type { Readable } from 'node:stream';

/** Logical buckets. Mapped to real bucket names (S3) or sub-directories (local) by each adapter. */
export type StorageBucket = 'documents' | 'esign' | 'exports';

export const STORAGE_BUCKETS: readonly StorageBucket[] = ['documents', 'esign', 'exports'];

export interface PutOptions {
  bucket?: StorageBucket;
  /** Recorded as object metadata (the app stores AES-GCM ciphertext, so the wire type is opaque). */
  contentType?: string;
  /** Hex sha256 of the plaintext, recorded as metadata when supplied. */
  sha256?: string;
}

export interface BucketOptions {
  bucket?: StorageBucket;
}

export interface PutResult {
  key: string;
  bucket: StorageBucket;
  /** Bytes written to the store. */
  size: number;
  /** sha256 of the bytes written to the store. */
  storedSha256: string;
  etag?: string;
}

export interface ObjectHead {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  metadata: Record<string, string>;
}

export interface PresignOptions extends BucketOptions {
  expiresInSeconds?: number;
  method?: 'GET' | 'PUT';
  /** Forces a download filename (GET only). */
  filename?: string;
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified?: Date;
}

export interface ObjectStorage {
  readonly kind: 'local' | 's3' | 'fake';
  put(key: string, data: Buffer, opts?: PutOptions): Promise<PutResult>;
  /** Throws {@link ObjectNotFoundError} when the object does not exist. */
  get(key: string, opts?: BucketOptions): Promise<Buffer>;
  stream(key: string, opts?: BucketOptions): Promise<Readable>;
  delete(key: string, opts?: BucketOptions): Promise<void>;
  exists(key: string, opts?: BucketOptions): Promise<boolean>;
  /** Time-limited direct URL. Local/fake adapters throw {@link PresignUnsupportedError}. */
  presign(key: string, opts?: PresignOptions): Promise<string>;
  list(prefix?: string, opts?: BucketOptions): Promise<ListedObject[]>;
  head(key: string, opts?: BucketOptions): Promise<ObjectHead | null>;
  /** Cheap reachability probe for health endpoints. */
  ping(): Promise<{ ok: boolean; detail?: string }>;
}

export class ObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class PresignUnsupportedError extends Error {
  constructor(kind: string) {
    super(`Presigned URLs are not supported by the ${kind} object store`);
    this.name = 'PresignUnsupportedError';
  }
}
