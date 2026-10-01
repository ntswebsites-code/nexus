import { Router } from 'express';
import { health } from '../controllers/healthController';
import { identityRoutes } from '../modules/identity/identity.routes';
import { authRoutes } from './authRoutes';
import { v1Router } from './v1';

export const apiRouter = Router();

apiRouter.get('/health', health);
apiRouter.use('/auth', authRoutes);
// MFA, password reset and invitations (SRD 11.3 lists them under /api/auth).
apiRouter.use('/auth', identityRoutes);
// Domain routers. Each uses `requireAuth` + `requirePermission` (or a public/draft-token guard).
apiRouter.use('/v1', v1Router);
