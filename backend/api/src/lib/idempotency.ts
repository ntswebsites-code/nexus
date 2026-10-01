import type { RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { HttpError } from './errors';
import { sha256Hex } from './crypto';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * `Idempotency-Key` handling (SRD 10.3.3 E, BR-173). Mount after auth and after any upload
 * middleware. The key is claimed atomically before the handler runs; only 2xx responses are
 * stored and replayed; a failed attempt releases the key so the client can retry.
 *
 * - same key, same payload, completed  -> the stored response is replayed
 * - same key, different payload        -> 409 idempotency_key_reused
 * - same key, still running            -> 409 idempotency_in_progress (retryable)
 */
export function idempotent(action: string, opts: { required?: boolean } = {}): RequestHandler {
  const required = opts.required ?? true;
  return async (req, res, next) => {
    const key = req.get('idempotency-key')?.trim();
    if (!key) {
      if (required) throw new HttpError(400, 'idempotency_key_required', 'Idempotency-Key header is required');
      return next();
    }
    if (key.length > 200) throw HttpError.badRequest('Idempotency-Key is too long');
    const userId = req.user?.id;
    if (!userId) throw HttpError.unauthorized();

    const files = (req.files as Express.Multer.File[] | undefined) ?? (req.file ? [req.file] : []);
    const requestHash = sha256Hex(
      JSON.stringify({
        body: req.body ?? null,
        files: (Array.isArray(files) ? files : []).map((f) => [f.originalname, f.size, sha256Hex(f.buffer ?? '')]),
      }),
    );
    const scope = `${action}:${req.method}:${req.originalUrl.split('?')[0]}`.slice(0, 255);

    try {
      await prisma.idempotencyKey.create({
        data: { userId, clientId: req.lp?.client.id ?? null, scope, idemKey: key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const existing = await prisma.idempotencyKey.findUnique({ where: { userId_scope_idemKey: { userId, scope, idemKey: key } } });
      if (!existing) throw new HttpError(409, 'idempotency_in_progress', 'This request is still being processed. Try again shortly.');
      if (existing.expiresAt < new Date()) {
        await prisma.idempotencyKey.delete({ where: { id: existing.id } });
        return idempotent(action, opts)(req, res, next);
      }
      if (existing.requestHash !== requestHash) {
        throw new HttpError(409, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
      }
      if (existing.state !== 'COMPLETED') {
        throw new HttpError(409, 'idempotency_in_progress', 'This request is still being processed. Try again shortly.');
      }
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200).type('application/json').send(existing.responseBody ?? '{}');
      return;
    }

    const release = () => prisma.idempotencyKey.deleteMany({ where: { userId, scope, idemKey: key, state: 'IN_PROGRESS' } }).catch(() => undefined);
    const originalJson = res.json.bind(res);
    let stored = false;
    res.json = (body: unknown) => {
      stored = true;
      const send = () => originalJson(body);
      // Mark the key COMPLETED before the body is sent, so an immediate replay is a replay
      // and not 409 idempotency_in_progress.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void prisma.idempotencyKey
          .update({
            where: { userId_scope_idemKey: { userId, scope, idemKey: key } },
            data: { state: 'COMPLETED', responseStatus: res.statusCode, responseBody: JSON.stringify(body) },
          })
          .catch(() => undefined)
          .finally(send);
      } else {
        void release().finally(send);
      }
      return res;
    };
    res.on('finish', () => {
      if (!stored) void release();
    });
    res.on('close', () => {
      if (!res.writableFinished && !stored) void release();
    });
    next();
  };
}
