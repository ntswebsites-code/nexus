import { Router } from 'express';
import { identityRoutes } from '../modules/identity/identity.routes';
import { filesRoutes } from '../modules/files/files.routes';
import { notificationsRoutes } from '../modules/notifications/notifications.routes';
import { publicOnboardingRoutes } from '../modules/kyc/public.routes';
import { kycRoutes } from '../modules/kyc/kyc.routes';
import { clientsRoutes } from '../modules/clients/clients.routes';
import { investorRoutes } from '../modules/investor/investor.routes';
import { investorStaffRoutes } from '../modules/investor/staff.routes';
import { documentsRoutes } from '../modules/documents/documents.routes';
import { adminRoutes } from '../modules/admin/admin.routes';
import { companyRoutes } from '../modules/company/company.routes';
import { companyStaffRoutes } from '../modules/company/company.staff.routes';

/** `/api/v1` - SRD section 11 domain API. */
export const v1Router = Router();

v1Router.use('/auth', identityRoutes);
v1Router.use('/', filesRoutes);
v1Router.use('/notifications', notificationsRoutes);
v1Router.use('/public', publicOnboardingRoutes);
v1Router.use('/kyc', kycRoutes);
v1Router.use('/investor', investorRoutes);
v1Router.use('/documents', documentsRoutes);
v1Router.use('/admin', adminRoutes);
v1Router.use('/company', companyRoutes);
v1Router.use('/private-markets', companyStaffRoutes);
v1Router.use('/', clientsRoutes);
v1Router.use('/', investorStaffRoutes);
