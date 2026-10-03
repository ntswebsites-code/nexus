import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config';
import { decryptBuffer, encryptBuffer } from '../../lib/crypto';
import type { ObjectStorageAdapter } from './types';

const objectPath = (key: string) => path.resolve(config.storage.dir, key.slice(0, 2), key);

/** The former local store from `lib/storage.ts`: AES-256-GCM files under STORAGE_DIR. */
export class FakeObjectStorage implements ObjectStorageAdapter {
  async put(key: string, data: Buffer) {
    const target = objectPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, encryptBuffer(data));
  }
  async get(key: string) {
    return decryptBuffer(await readFile(objectPath(key)));
  }
  async health() {
    try {
      await mkdir(path.resolve(config.storage.dir), { recursive: true });
      return { ok: true, detail: `Local encrypted store at ${config.storage.dir}` };
    } catch (e) {
      return { ok: false, detail: `Cannot write to ${config.storage.dir}: ${e instanceof Error ? e.message : e}` };
    }
  }
}
