import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ObjectNotFoundError,
  type BucketOptions,
  type ListedObject,
  type ObjectHead,
  type ObjectStorage,
  type PresignOptions,
  type PutOptions,
  type PutResult,
  type StorageBucket,
} from './types';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  buckets: Record<StorageBucket, string>;
  /** Injected in tests. */
  client?: S3Client;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.Code === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** S3 / MinIO store (path-style addressing, so it works against `http://minio:9000`). */
export class S3ObjectStorage implements ObjectStorage {
  readonly kind = 's3' as const;
  private readonly client: S3Client;
  private readonly buckets: Record<StorageBucket, string>;

  constructor(opts: S3StorageOptions) {
    this.buckets = opts.buckets;
    this.client =
      opts.client ??
      new S3Client({
        region: opts.region,
        endpoint: opts.endpoint,
        forcePathStyle: true,
        credentials: opts.accessKey && opts.secretKey ? { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey } : undefined,
      });
  }

  private bucket(b: StorageBucket = 'documents') {
    return this.buckets[b];
  }

  async put(key: string, data: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    const bucket = opts.bucket ?? 'documents';
    const stored = createHash('sha256').update(data).digest('hex');
    const res = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        Body: data,
        ContentLength: data.length,
        ContentType: 'application/octet-stream',
        Metadata: {
          ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
          ...(opts.sha256 ? { sha256: opts.sha256 } : {}),
          'stored-sha256': stored,
        },
      }),
    );
    return { key, bucket, size: data.length, storedSha256: stored, etag: res.ETag };
  }

  async get(key: string, opts: BucketOptions = {}): Promise<Buffer> {
    const stream = await this.stream(key, opts);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }

  async stream(key: string, opts: BucketOptions = {}): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(opts.bucket), Key: key }));
      if (!res.Body) throw new ObjectNotFoundError(key);
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string, opts: BucketOptions = {}) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(opts.bucket), Key: key }));
  }

  async exists(key: string, opts: BucketOptions = {}) {
    return (await this.head(key, opts)) !== null;
  }

  async presign(key: string, opts: PresignOptions = {}): Promise<string> {
    const expiresIn = opts.expiresInSeconds ?? 300;
    const Bucket = this.bucket(opts.bucket);
    if (opts.method === 'PUT') return getSignedUrl(this.client, new PutObjectCommand({ Bucket, Key: key }), { expiresIn });
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: opts.filename ? `attachment; filename="${opts.filename.replace(/[^\w.\- ]+/g, '_')}"` : undefined,
      }),
      { expiresIn },
    );
  }

  async list(prefix = '', opts: BucketOptions = {}): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket(opts.bucket), Prefix: prefix || undefined, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) out.push({ key: o.Key!, size: o.Size ?? 0, lastModified: o.LastModified });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async head(key: string, opts: BucketOptions = {}): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(opts.bucket), Key: key }));
      const metadata = res.Metadata ?? {};
      return {
        key,
        size: res.ContentLength ?? 0,
        contentType: metadata['content-type'] ?? res.ContentType,
        etag: res.ETag,
        lastModified: res.LastModified,
        metadata,
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async ping() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket('documents') }));
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).name };
    }
  }
}
