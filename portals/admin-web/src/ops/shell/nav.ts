export interface NavItem {
  href: string;
  label: string;
  perms: string[];
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Fund operations',
    items: [
      { href: '/ops-native', label: 'Overview', perms: [] },
      { href: '/ops-native/command', label: 'Today', perms: ['dashboard.view'] },
      { href: '/ops-native/funds', label: 'Funds & commitments', perms: ['funds.view'] },
      { href: '/ops-native/capital-calls', label: 'Capital calls', perms: ['capital.view'] },
      { href: '/ops-native/distributions', label: 'Distributions', perms: ['capital.view', 'distributions.create', 'distributions.approve', 'distributions.settle'] },
      { href: '/ops-native/notices', label: 'LP notices', perms: ['notices.view'] },
      { href: '/ops-native/bank-instructions', label: 'Bank instructions', perms: ['clients.view'] },
    ],
  },
  {
    section: 'Portfolio',
    items: [
      { href: '/ops-native/portfolios', label: 'Portfolios', perms: ['portfolio.view'] },
      { href: '/ops-native/securities', label: 'Securities & prices', perms: ['portfolio.view', 'research.view', 'orders.view'] },
      { href: '/ops-native/ibor', label: 'IBOR & Positions', perms: ['portfolio.view'] },
      { href: '/ops-native/performance', label: 'Performance & Attribution', perms: ['reports.view'] },
      { href: '/ops-native/portfolio-lab', label: 'Portfolio construction', perms: ['portfolio.view'] },
      { href: '/ops-native/private-markets', label: 'Private markets', perms: ['portfolio.view'] },
    ],
  },
  {
    section: 'Research',
    items: [{ href: '/ops-native/research', label: 'Research & IC', perms: ['research.view'] }],
  },
  {
    section: 'Trading',
    items: [{ href: '/ops-native/orders', label: 'Orders', perms: ['orders.view'] }],
  },
  {
    section: 'Trade feeds',
    items: [{ href: '/ops-native/trading-feeds', label: 'Trading feeds', perms: ['orders.view'] }],
  },
  {
    section: 'Valuation',
    items: [{ href: '/ops-native/nav', label: 'NAV & valuation', perms: ['valuation.view'] }],
  },
  {
    section: 'Accounting',
    items: [{ href: '/ops-native/accounting', label: 'Accounting & Close', perms: ['valuation.view'] }],
  },
  {
    section: 'Clients',
    items: [
      { href: '/ops-native/clients', label: 'Clients & Accounts', perms: ['clients.view'] },
      { href: '/ops-native/investor-services', label: 'Investor Services', perms: ['clients.view'] },
      { href: '/ops-native/onboarding', label: 'Onboarding & KYC', perms: ['onboarding.view'] },
      { href: '/ops-native/vault', label: 'Document Vault', perms: ['documents.view'] },
    ],
  },
  {
    section: 'Cash',
    items: [
      { href: '/ops-native/cash', label: 'Cash & Ledgers', perms: ['cash.view'] },
      { href: '/ops-native/ledger', label: 'Ledger & FX stamps', perms: ['ledger.view'] },
    ],
  },
  {
    section: 'Risk & compliance',
    items: [
      { href: '/ops-native/risk', label: 'Risk & compliance', perms: ['risk.view', 'risk.manage'] },
      { href: '/ops-native/financing', label: 'Collateral & financing', perms: ['risk.view'] },
      { href: '/ops-native/model-governance', label: 'Model governance', perms: ['risk.view'] },
    ],
  },
  {
    section: 'Reporting & data',
    items: [
      { href: '/ops-native/reports', label: 'Reports & BI', perms: ['reports.view'] },
      { href: '/ops-native/regulatory', label: 'Regulatory reporting', perms: ['reports.view'] },
      { href: '/ops-native/data', label: 'Data Fabric & Studio', perms: ['operations.view'] },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops-native/operations', label: 'Operations control', perms: ['operations.view'] },
      { href: '/ops-native/reconciliation', label: 'Reconciliations', perms: ['operations.view'] },
      { href: '/ops-native/imports', label: 'Data imports', perms: ['orders.create', 'risk.manage', 'financing.manage', 'portfolio.manage'] },
      { href: '/ops-native/payments-recon', label: 'Payments & close controls', perms: ['operations.view'] },
      { href: '/ops-native/corporate-actions', label: 'Corporate actions', perms: ['operations.view'] },
    ],
  },
  {
    section: 'Dealing & deals',
    items: [
      { href: '/ops-native/dealing', label: 'Dealing queue', perms: ['dealing.view'] },
      { href: '/ops-native/term-sheets', label: 'Term sheets', perms: ['term_sheets.view'] },
      { href: '/ops-native/investee-requests', label: 'Investee requests', perms: ['research.edit'] },
      { href: '/ops-native/investee-review', label: 'Investee data review', perms: ['research.view'] },
      { href: '/ops-native/reporting', label: 'Reporting packs', perms: ['portfolio.view', 'research.edit'] },
      { href: '/ops-native/esign', label: 'E-signatures', perms: [] }, // every signed-in staff member can be a signer; the page shows the inbox and gates the rest
    ],
  },
  {
    section: 'Counterparties',
    items: [{ href: '/ops-native/custodian', label: 'Custodian submissions', perms: ['custodian.view'] }],
  },
  {
    section: 'Administration',
    items: [
      { href: '/ops-native/rbac', label: 'RBAC & Controls', perms: ['admin.rbac'] },
      { href: '/ops-native/settings', label: 'Settings', perms: ['admin.settings'] },
      { href: '/ops-native/security', label: 'Security controls', perms: ['admin.rbac', 'admin.settings'] },
      { href: '/ops-native/integrations', label: 'Integrations', perms: ['admin.settings'] },
      { href: '/ops-native/health', label: 'Platform health', perms: ['admin.settings'] },
      { href: '/ops-native/portal-flags', label: 'Portal flags', perms: ['admin.settings'] },
      { href: '/ops-native/audit', label: 'Audit Trail', perms: ['audit.view'] },
      { href: '/ops-native/copilot', label: 'Investment Copilot', perms: ['dashboard.view'] },
    ],
  },
];
