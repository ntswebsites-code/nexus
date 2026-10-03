import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  ObjectNotFoundError,
  PresignUnsupportedError,
  type BucketOptions,
  type ListedObject,
  type ObjectHead,
  type ObjectStorage,
  type PutOptions,
  type PutResult,
  type StorageBucket,
} from './types';

interface Entry {
  data: Buffer;
  contentType?: string;
  metadata: Record<string, string>;
  lastModified: Date;
}

/** In-memory store for tests (INTEGRATION_OBJECT_STORAGE=fake). */
export class FakeObjectStorage implements ObjectStorage {
  readonly kind = 'fake' as const;
  private readonly objects = new Map<string, Entry>();

  private id(key: string, bucket: StorageBucket = 'documents') {
    return `${bucket}/${key}`;
  }

  async put(key: string, data: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    const bucket = opts.bucket ?? 'documents';
    const metadata: Record<string, string> = {};
    if (opts.sha256) metadata.sha256 = opts.sha256;
    this.objects.set(this.id(key, bucket), {
      data: Buffer.from(data),
      contentType: opts.contentType,
      metadata,
      lastModified: new Date(),
    });
    return { key, bucket, size: data.length, storedSha256: createHash('sha256').update(data).digest('hex') };
  }

  async get(key: string, opts: BucketOptions = {}): Promise<Buffer> {
    const e = this.objects.get(this.id(key, opts.bucket));
    if (!e) throw new ObjectNotFoundError(key);
    return Buffer.from(e.data);
  }

  async stream(key: string, opts: BucketOptions = {}) {
    return Readable.from([await this.get(key, opts)]);
  }

  async delete(key: string, opts: BucketOptions = {}) {
    this.objects.delete(this.id(key, opts.bucket));
  }

  async exists(key: string, opts: BucketOptions = {}) {
    return this.objects.has(this.id(key, opts.bucket));
  }

  async presign(): Promise<string> {
    throw new PresignUnsupportedError('fake');
  }

  async list(prefix = '', opts: BucketOptions = {}): Promise<ListedObject[]> {
    const base = `${opts.bucket ?? 'documents'}/`;
    return [...this.objects.entries()]
      .filter(([id]) => id.startsWith(base + prefix))
      .map(([id, e]) => ({ key: id.slice(base.length), size: e.data.length, lastModified: e.lastModified }));
  }

  async head(key: string, opts: BucketOptions = {}): Promise<ObjectHead | null> {
    const e = this.objects.get(this.id(key, opts.bucket));
    if (!e) return null;
    return { key, size: e.data.length, contentType: e.contentType, lastModified: e.lastModified, metadata: { ...e.metadata } };
  }

  async ping() {
    return { ok: true };
  }
}
