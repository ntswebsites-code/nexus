import { Router } from 'express';
import { requireAuth, requirePortalAccess } from '../../middleware/requireAuth';
import { coClientsRoutes } from './co.clients.routes';
import { coServicesRoutes } from './co.services.routes';
import { coOnboardingRoutes } from './co.onboarding.routes';
import { coVaultRoutes } from './co.vault.routes';
import { coChangeRoutes } from './co.changes';

/** Clients & Accounts, Investor Services, Onboarding & KYC and Document Vault admin APIs. Mounted at `/api/v1/client-ops`. */
export const clientOpsRoutes = Router();
clientOpsRoutes.use(requireAuth, requirePortalAccess('admin'));
clientOpsRoutes.use(coClientsRoutes);
clientOpsRoutes.use(coServicesRoutes);
clientOpsRoutes.use(coOnboardingRoutes);
clientOpsRoutes.use(coVaultRoutes);
clientOpsRoutes.use(coChangeRoutes);

export { scoreRisk, ratingFor, slaState, retentionState, documentChangeProblem } from './co.engine';
