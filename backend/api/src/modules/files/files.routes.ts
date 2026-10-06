import { Router } from 'express';
import { HttpError } from '../../lib/errors';
import { param } from '../../lib/http';
import { readFileObject, storeFile, verifyDownloadSignature } from '../../lib/storage';
import { requireAuth } from '../../middleware/requireAuth';
import { uploadFiles, uploadedFiles } from '../../middleware/upload';

export const filesRoutes = Router();

/** Authenticated upload; returns file ids that other endpoints attach to records. */
filesRoutes.post('/uploads', requireAuth, uploadFiles('file', 10), async (req, res) => {
  const files = uploadedFiles(req);
  if (!files.length) throw HttpError.badRequest('Attach at least one file');
  const stored = [];
  for (const f of files) {
    const row = await storeFile({ name: f.originalname, mime: f.mimetype, data: f.buffer, uploadedById: req.user!.id });
    stored.push({ id: row.id, name: row.name, size: row.size, mime: row.mime, sha256: row.sha256 });
  }
  res.status(201).json({ files: stored });
});

/** Signed, short-lived download. Authorisation happened when the URL was issued. */
filesRoutes.get('/files/:id/download', async (req, res) => {
  const id = param(req, 'id');
  const { exp, sig } = req.query as { exp?: string; sig?: string };
  if (!exp || !sig || !verifyDownloadSignature(id, exp, sig)) {
    throw HttpError.forbidden('This download link is invalid or has expired', 'invalid_signature');
  }
  const { file, data } = await readFileObject(id);
  const wantInline = req.query.inline === '1';
  const previewable = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/(plain|csv))/i.test(file.mime);
  const disposition = wantInline && previewable ? 'inline' : 'attachment';
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${disposition}; filename="${file.name.replace(/[^\w.\- ]+/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(data);
});
