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
import { investeePublicRoutes } from '../modules/investee-portal/workspace/workspace.routes';
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
import { marketDataRoutes } from '../integrations/market-data/routes';
import { custodianFeedRoutes } from '../integrations/custodian-feed/routes';
import { opsctlRoutes } from '../modules/opsctl/opsctl.routes';
import { tradingFeedsRoutes } from '../modules/trading-feeds';
import { operationsRoutes, dashboardRoutes } from '../modules/wiring';
import { iborRoutes } from '../modules/ibor';
import { performanceRoutes } from '../modules/performance';
import { researchRoutes } from '../modules/research';
import { privateMarketsRoutes } from '../modules/private-markets';
import { portfolioLabRoutes } from '../modules/portfolio-lab';
import { financingRoutes } from '../modules/financing';
import { clientOpsRoutes } from '../modules/clients-onboarding';
import { reportsRoutes } from '../modules/reports';
import { regulatoryRoutes } from '../modules/regulatory';
import { dataRoutes } from '../modules/data-fabric';
import { modelRoutes } from '../modules/model-governance';
import { adminCoreRoutes } from '../modules/admin-core';
import { shellRoutes } from '../modules/search';
import { STAFF_LIST_PREFIXES, paginateData } from '../middleware/paginate';
import { integrationsPublicRoutes } from '../modules/admin-core/integrations.routes';
import { esignRoutes } from '../modules/esign';

/** `/api/v1` - SRD section 11 domain API. */
export const v1Router = Router();

// page/pageSize/total list envelope for staff endpoints (see middleware/paginate.ts).
for (const prefix of STAFF_LIST_PREFIXES) v1Router.use(prefix, paginateData);

v1Router.use('/platform', platformRoutes);
v1Router.use('/lp-portal', lpPortalRoutes);
v1Router.use('/investee-portal', investeePortalRoutes);
// Investee workspace public links (signer pages and 7-day share links; token-gated, no session).
v1Router.use('/investee-public', investeePublicRoutes);
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
// Integrations: market-data (public/fake/live) and custodian-feed (file-drop/fake/live).
v1Router.use('/market-data', marketDataRoutes);
v1Router.use('/custodian-feed', custodianFeedRoutes);
// Operations & finance controls (R4-2): close gates, payments reconciliation, settlement fails, custody position pull.
v1Router.use('/ops-controls', opsctlRoutes);
// Trading feeds (R4-10): broker contract notes, FIX fills, breaks, settlement instructions, corporate-action feed.
v1Router.use('/trading-feeds', tradingFeedsRoutes);
// Operations Control (runbook tasks, live status) and Command Centre (today KPIs).
v1Router.use('/operations', operationsRoutes);
v1Router.use('/dashboard', dashboardRoutes);
// IBOR & Positions: /ibor/* (overview, ledger, lots, settlement ladder, events, refresh, reconcile); after the portfolio foundation.
v1Router.use('/ibor', iborRoutes);
// Performance & Attribution: /performance/* (returns, attribution, benchmarks, periods and maker-checker lock).
v1Router.use('/performance', performanceRoutes);
// Research & IC: /research/* (cases, ratings, IC meetings, decisions, votes, linked orders).
v1Router.use('/research', researchRoutes);
// Private Markets book: /private-markets/{summary,funds,commitments,cashflows,marks}; mounted before the company-reporting hub below (paths do not overlap).
v1Router.use('/private-markets', privateMarketsRoutes);
// Portfolio Construction: /portfolio-lab/* (model portfolios, what-if and saved rebalances, draft orders).
v1Router.use('/portfolio-lab', portfolioLabRoutes);
// Collateral & Financing: /financing/* (facilities, pools, haircut rules, drawdowns, margin calls).
v1Router.use('/financing', financingRoutes);
// Clients, Investor Services, Onboarding & KYC, Document Vault: /client-ops/*.
v1Router.use('/client-ops', clientOpsRoutes);
// Reports & BI, Regulatory Reporting, Data Fabric & Studio, Model Governance.
v1Router.use('/reports', reportsRoutes);
v1Router.use('/regulatory', regulatoryRoutes);
v1Router.use('/data', dataRoutes);
v1Router.use('/model-governance', modelRoutes);
// Admin Core: /admin-core/* (RBAC change requests, access reviews, SoD, platform settings, audit facets, Copilot).
v1Router.use('/admin-core', adminCoreRoutes);
// Admin shell: /shell/* (global search, record detail, profile, password change, sessions, role focus).
v1Router.use('/shell', shellRoutes);
// Integrations (WP-8): development-only fake SSO identity provider page (404 in production). Ops API is under /admin-core/integrations.
v1Router.use('/integrations', integrationsPublicRoutes);
// Native e-signature: /esign/* (staff requests, signed-in signers at /me, external token signers + verifier at /public).
v1Router.use('/esign', esignRoutes);
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
