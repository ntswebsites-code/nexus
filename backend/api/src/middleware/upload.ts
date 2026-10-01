import multer from 'multer';
import type { RequestHandler } from 'express';
import { config } from '../config';
import { HttpError } from '../lib/errors';

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxUploadBytes, files: 10 },
});

/** Parses multipart uploads into memory (`req.file` / `req.files`) and maps multer limits to 413. */
export function uploadFiles(field = 'file', maxCount = 1): RequestHandler {
  const handler = maxCount === 1 ? parser.single(field) : parser.array(field, maxCount);
  return (req, res, next) => {
    handler(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new HttpError(413, 'payload_too_large', 'File is larger than the upload limit'));
        }
        return next(HttpError.badRequest(err.message));
      }
      next(err);
    });
  };
}

export function uploadedFiles(req: Parameters<RequestHandler>[0]): Express.Multer.File[] {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  return [];
}
