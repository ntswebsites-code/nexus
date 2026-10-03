/**
 * Offline checks for the object-storage adapters (no network, no database):
 *   DATABASE_URL=mysql://u:p@localhost:3306/x npx tsx scripts/test-object-storage.ts  (DATABASE_URL is only needed to load config)
 * Covers fake, local (tmp dir) and s3 (stubbed SDK client + real presigner), plus key resolution.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import {
  FakeObjectStorage,
  LocalObjectStorage,
  ObjectNotFoundError,
  PresignUnsupportedError,
  S3ObjectStorage,
  makeStorageKey,
  resolveStorageKey,
  type ObjectStorage,
} from '../src/integrations/object-storage';

let checks = 0;
const ok = (name: string) => {
  console.log(`  ok  ${name}`);
  checks++;
};

async function contract(store: ObjectStorage, label: string) {
  const data = Buffer.from('hello object store');
  const put = await store.put('abc123', data, { contentType: 'text/plain', sha256: 'ff'.repeat(32) });
  assert.equal(put.size, data.length);
  assert.equal(put.bucket, 'documents');
  assert.equal(put.storedSha256.length, 64);
  assert.deepEqual(await store.get('abc123'), data);
  const chunks: Buffer[] = [];
  for await (const c of await store.stream('abc123')) chunks.push(c as Buffer);
  assert.deepEqual(Buffer.concat(chunks), data);
  assert.equal(await store.exists('abc123'), true);
  assert.equal(await store.exists('abc123', { bucket: 'exports' }), false);
  assert.equal((await store.head('abc123'))?.size, data.length);
  assert.equal(await store.head('nope'), null);
  await store.put('rep001', Buffer.from('x'), { bucket: 'exports' });
  assert.deepEqual((await store.list('', { bucket: 'exports' })).map((o) => o.key), ['rep001']);
  assert.ok((await store.list('abc')).some((o) => o.key === 'abc123'));
  await assert.rejects(() => store.get('nope'), ObjectNotFoundError);
  await store.delete('abc123');
  await store.delete('abc123'); // deleting twice is fine
  assert.equal(await store.exists('abc123'), false);
  assert.equal((await store.ping()).ok, true);
  ok(`${label}: put/get/stream/exists/head/list/delete/ping`);
}

/** Minimal in-memory S3 behind the SDK client interface. */
function stubClient() {
  const objects = new Map<string, { body: Buffer; meta: Record<string, string>; type?: string }>();
  const id = (i: { Bucket?: string; Key?: string }) => `${i.Bucket}/${i.Key}`;
  const notFound = () => Object.assign(new Error('nf'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  const client = {
    async send(cmd: { constructor: { name: string }; input: any }) {
      const i = cmd.input;
      switch (cmd.constructor.name) {
        case 'PutObjectCommand':
          objects.set(id(i), { body: Buffer.from(i.Body), meta: i.Metadata ?? {}, type: i.ContentType });
          return { ETag: '"etag"' };
        case 'GetObjectCommand': {
          const o = objects.get(id(i));
          if (!o) throw Object.assign(new Error('nk'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
          const { Readable } = await import('node:stream');
          return { Body: Readable.from([o.body]) };
        }
        case 'HeadObjectCommand': {
          const o = objects.get(id(i));
          if (!o) throw notFound();
          return { ContentLength: o.body.length, ContentType: o.type, Metadata: o.meta, ETag: '"etag"' };
        }
        case 'DeleteObjectCommand':
          objects.delete(id(i));
          return {};
        case 'ListObjectsV2Command':
          return {
            Contents: [...objects.entries()]
              .filter(([k]) => k.startsWith(`${i.Bucket}/${i.Prefix ?? ''}`))
              .map(([k, v]) => ({ Key: k.slice(i.Bucket.length + 1), Size: v.body.length })),
            IsTruncated: false,
          };
        case 'HeadBucketCommand':
          return {};
        default:
          throw new Error(`unexpected ${cmd.constructor.name}`);
      }
    },
  };
  return { client: client as unknown as S3Client, objects };
}

async function main() {
  const buckets = { documents: 'nexus-documents', esign: 'nexus-esign', exports: 'nexus-exports' };

  await contract(new FakeObjectStorage(), 'fake');

  const dir = await mkdtemp(path.join(tmpdir(), 'nexus-store-'));
  try {
    const local = new LocalObjectStorage(dir);
    await contract(local, 'local');
    assert.ok(local.locate('abcdef').endsWith(path.join('ab', 'abcdef')));
    assert.throws(() => local.locate('../../etc/passwd'));
    await assert.rejects(() => local.presign(), PresignUnsupportedError);
    ok('local: legacy layout <dir>/<key[0..2]>/<key>, traversal rejected, presign unsupported');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const { client, objects } = stubClient();
  const s3 = new S3ObjectStorage({ region: 'us-east-1', buckets, client });
  await contract(s3, 's3 (stub client)');
  await s3.put('k1', Buffer.from('z'), { bucket: 'esign', contentType: 'application/pdf', sha256: 'aa'.repeat(32) });
  const stored = objects.get('nexus-esign/k1')!;
  assert.equal(stored.meta['content-type'], 'application/pdf');
  assert.equal(stored.meta.sha256, 'aa'.repeat(32));
  assert.equal((await s3.head('k1', { bucket: 'esign' }))?.contentType, 'application/pdf');
  ok('s3: bucket mapping and content-type / sha256 metadata');

  const real = new S3ObjectStorage({
    region: 'us-east-1',
    endpoint: 'http://minio:9000',
    accessKey: 'test-key',
    secretKey: 'test-secret',
    buckets,
  });
  const url = new URL(await real.presign('k1', { bucket: 'esign', expiresInSeconds: 60, filename: 'a b.pdf' }));
  assert.equal(url.origin, 'http://minio:9000');
  assert.equal(url.pathname, '/nexus-esign/k1'); // path-style
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  ok('s3: path-style presigned GET');

  assert.deepEqual(resolveStorageKey('deadbeef'), { bucket: 'documents', key: 'deadbeef' });
  assert.deepEqual(resolveStorageKey('exports/deadbeef'), { bucket: 'exports', key: 'deadbeef' });
  assert.equal(makeStorageKey('esign', 'x'), 'esign/x');
  assert.equal(makeStorageKey('documents', 'x'), 'x');
  ok('storage key <-> bucket mapping (legacy keys stay in documents)');

  console.log(`object-storage: ${checks} groups passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
