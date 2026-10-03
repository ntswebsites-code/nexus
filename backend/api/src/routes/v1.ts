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
import { platformRoutes } from '../modules/platform/platform.routes';
import { lpPortalRoutes } from '../modules/lp-portal/lp.routes';
import { investeePortalRoutes } from '../modules/investee-portal/investee.routes';
import { opsRoutes } from '../modules/ops/ops.routes';
import { custodianRoutes } from '../modules/custodian/custodian.routes';
import { portfolioRoutes } from '../modules/portfolio/portfolio.routes';
import { ordersRoutes } from '../modules/orders';
import { riskRoutes } from '../modules/risk/risk.routes';
import { navRoutes } from '../modules/nav';
import { accountingRoutes } from '../modules/accounting';
import { corporateActionsRoutes } from '../modules/corporate-actions';
import { cashRoutes } from '../modules/cash';
import { reconRoutes } from '../modules/recon/recon.routes';
import { reportsRoutes } from '../modules/reports';
import { regulatoryRoutes } from '../modules/regulatory';
import { dataRoutes } from '../modules/data-fabric';
import { modelRoutes } from '../modules/model-governance';

/** `/api/v1` - SRD section 11 domain API. */
export const v1Router = Router();

v1Router.use('/platform', platformRoutes);
v1Router.use('/lp-portal', lpPortalRoutes);
v1Router.use('/investee-portal', investeePortalRoutes);
v1Router.use('/ops', opsRoutes);
v1Router.use('/custodian', custodianRoutes);
// Staff portfolio foundation: /portfolios, /securities, /ibor/positions, /brokers (auth applied per route).
v1Router.use('/', portfolioRoutes);
// Orders (OMS): /orders (auth applied per route).
v1Router.use('/orders', ordersRoutes);
// Risk & Compliance: /risk/* (limits, breaches, scenarios, runs, cases, monitor).
v1Router.use('/risk', riskRoutes);
// NAV & Valuation: /nav/runs (calculate, exceptions, maker review, release).
v1Router.use('/nav', navRoutes);
// Accounting & Close: /accounting/* (chart of accounts, journals, trial balance, ledger, periods and close).
v1Router.use('/accounting', accountingRoutes);
// Corporate Actions: /corporate-actions/* (events, entitlements, elections, processing).
v1Router.use('/corporate-actions', corporateActionsRoutes);
// Cash & Ledgers: /cash/* (balances, journals, reservations, expectations, statement imports, period closes).
v1Router.use('/cash', cashRoutes);
// Reconciliations: /recon/* (runs, breaks, sources, signoffs, account-map).
v1Router.use('/recon', reconRoutes);
// Reports & BI, Regulatory Reporting, Data Fabric & Studio, Model Governance.
v1Router.use('/reports', reportsRoutes);
v1Router.use('/regulatory', regulatoryRoutes);
v1Router.use('/data', dataRoutes);
v1Router.use('/model-governance', modelRoutes);
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
