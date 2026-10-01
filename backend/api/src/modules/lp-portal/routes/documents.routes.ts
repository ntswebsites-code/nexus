import { Router } from 'express';
import { requireLp } from '../lp.context';
import { lpStubArray, lpStubList, lpStubNotLive } from '../lp.http';

/** Domain `documents`: documents and the vault (WS1). */
export const lpDocumentsRoutes = Router();

lpDocumentsRoutes.get('/documents', requireLp('lp.documents.view'), lpStubList);
lpDocumentsRoutes.get('/documents/summary', requireLp('lp.documents.view'), lpStubNotLive);
lpDocumentsRoutes.get('/documents/:id', requireLp('lp.documents.view'), lpStubNotLive);
lpDocumentsRoutes.get('/documents/:id/download', requireLp('lp.documents.download'), lpStubNotLive);
lpDocumentsRoutes.get('/documents/:id/preview', requireLp('lp.documents.view'), lpStubNotLive);
lpDocumentsRoutes.get('/vault', requireLp('lp.documents.view'), lpStubArray);
lpDocumentsRoutes.get('/vault/:documentId/download', requireLp('lp.documents.download'), lpStubNotLive);
lpDocumentsRoutes.get('/vault/:documentId/verify', requireLp('lp.documents.view'), lpStubNotLive);
