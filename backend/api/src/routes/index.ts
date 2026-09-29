import { Router } from 'express';
import { health } from '../controllers/healthController';
import { authRoutes } from './authRoutes';

export const apiRouter = Router();

apiRouter.get('/health', health);
apiRouter.use('/auth', authRoutes);

// Domain routers (orders, clients, cash, KYC, ...) are mounted here as their
// workflows are specified. Each must use `requireAuth` + `requirePermission`.
