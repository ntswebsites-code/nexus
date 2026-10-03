import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/**
 * Filesystem store. The `documents` bucket keeps the original layout (`<dir>/<key[0..2]>/<key>`)
 * so files written before the object-store abstraction stay readable; other buckets live under
 * `<dir>/_buckets/<bucket>/`.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly kind = 'local' as const;

  constructor(private readonly dir: string) {}

  private root(bucket: StorageBucket = 'documents') {
    return bucket === 'documents' ? path.resolve(this.dir) : path.resolve(this.dir, '_buckets', bucket);
  }

  /** Path of an object; rejects keys that would escape the bucket directory. */
  locate(key: string, bucket: StorageBucket = 'documents'): string {
    const root = this.root(bucket);
    const shard = key.split('/').pop()!.slice(0, 2) || '__';
    const target = path.resolve(root, key.includes('/') ? path.dirname(key) : '', shard, path.basename(key));
    if (!target.startsWith(root + path.sep)) throw new Error('Invalid object key');
    return target;
  }

  async put(key: string, data: Buffer, opts: PutOptions = {}): Promise<PutResult> {
    const bucket = opts.bucket ?? 'documents';
    const target = this.locate(key, bucket);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return { key, bucket, size: data.length, storedSha256: createHash('sha256').update(data).digest('hex') };
  }

  async get(key: string, opts: BucketOptions = {}): Promise<Buffer> {
    try {
      return await readFile(this.locate(key, opts.bucket));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async stream(key: string, opts: BucketOptions = {}) {
    const file = this.locate(key, opts.bucket);
    await stat(file).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'ENOENT' ? new ObjectNotFoundError(key) : err;
    });
    return createReadStream(file);
  }

  async delete(key: string, opts: BucketOptions = {}) {
    await unlink(this.locate(key, opts.bucket)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async exists(key: string, opts: BucketOptions = {}) {
    return (await this.head(key, opts)) !== null;
  }

  async presign(): Promise<string> {
    throw new PresignUnsupportedError('local');
  }

  async list(prefix = '', opts: BucketOptions = {}): Promise<ListedObject[]> {
    const root = this.root(opts.bucket);
    const out: ListedObject[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (rel === '' && e.name === '_buckets') continue;
        if (e.isDirectory()) {
          await walk(path.join(dir, e.name), rel);
        } else {
          const st = await stat(path.join(dir, e.name));
          out.push({ key: e.name, size: st.size, lastModified: st.mtime });
        }
      }
    };
    await walk(root, '');
    return out.filter((o) => o.key.startsWith(prefix));
  }

  async head(key: string, opts: BucketOptions = {}): Promise<ObjectHead | null> {
    try {
      const st = await stat(this.locate(key, opts.bucket));
      return { key, size: st.size, lastModified: st.mtime, metadata: {} };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async ping() {
    try {
      await mkdir(this.root(), { recursive: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
