export interface NavItem {
  href: string;
  label: string;
  perms: string[];
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Fund operations',
    items: [
      { href: '/ops', label: 'Overview', perms: [] },
      { href: '/ops/command', label: 'Today', perms: ['dashboard.view'] },
      { href: '/ops/funds', label: 'Funds & commitments', perms: ['funds.view'] },
      { href: '/ops/capital-calls', label: 'Capital calls', perms: ['capital.view'] },
      { href: '/ops/distributions', label: 'Distributions', perms: ['capital.view', 'distributions.create', 'distributions.approve', 'distributions.settle'] },
      { href: '/ops/notices', label: 'LP notices', perms: ['notices.view'] },
      { href: '/ops/bank-instructions', label: 'Bank instructions', perms: ['clients.view'] },
    ],
  },
  {
    section: 'Portfolio',
    items: [
      { href: '/ops/portfolios', label: 'Portfolios', perms: ['portfolio.view'] },
      { href: '/ops/securities', label: 'Securities & prices', perms: ['portfolio.view', 'research.view', 'orders.view'] },
      { href: '/ops/ibor', label: 'IBOR & Positions', perms: ['portfolio.view'] },
      { href: '/ops/performance', label: 'Performance & Attribution', perms: ['reports.view'] },
      { href: '/ops/portfolio-lab', label: 'Portfolio construction', perms: ['portfolio.view'] },
      { href: '/ops/private-markets', label: 'Private markets', perms: ['portfolio.view'] },
    ],
  },
  {
    section: 'Research',
    items: [{ href: '/ops/research', label: 'Research & IC', perms: ['research.view'] }],
  },
  {
    section: 'Trading',
    items: [{ href: '/ops/orders', label: 'Orders', perms: ['orders.view'] }],
  },
  {
    section: 'Trade feeds',
    items: [{ href: '/ops/trading-feeds', label: 'Trading feeds', perms: ['orders.view'] }],
  },
  {
    section: 'Valuation',
    items: [{ href: '/ops/nav', label: 'NAV & valuation', perms: ['valuation.view'] }],
  },
  {
    section: 'Accounting',
    items: [{ href: '/ops/accounting', label: 'Accounting & Close', perms: ['valuation.view'] }],
  },
  {
    section: 'Clients',
    items: [
      { href: '/ops/clients', label: 'Clients & Accounts', perms: ['clients.view'] },
      { href: '/ops/investor-services', label: 'Investor Services', perms: ['clients.view'] },
      { href: '/ops/onboarding', label: 'Onboarding & KYC', perms: ['onboarding.view'] },
      { href: '/ops/vault', label: 'Document Vault', perms: ['documents.view'] },
    ],
  },
  {
    section: 'Cash',
    items: [{ href: '/ops/cash', label: 'Cash & Ledgers', perms: ['cash.view'] }],
  },
  {
    section: 'Risk & compliance',
    items: [
      { href: '/ops/risk', label: 'Risk & compliance', perms: ['risk.view', 'risk.manage'] },
      { href: '/ops/financing', label: 'Collateral & financing', perms: ['risk.view'] },
      { href: '/ops/model-governance', label: 'Model governance', perms: ['risk.view'] },
    ],
  },
  {
    section: 'Reporting & data',
    items: [
      { href: '/ops/reports', label: 'Reports & BI', perms: ['reports.view'] },
      { href: '/ops/regulatory', label: 'Regulatory reporting', perms: ['reports.view'] },
      { href: '/ops/data', label: 'Data Fabric & Studio', perms: ['operations.view'] },
    ],
  },
  {
    section: 'Operations',
    items: [
      { href: '/ops/operations', label: 'Operations control', perms: ['operations.view'] },
      { href: '/ops/reconciliation', label: 'Reconciliations', perms: ['operations.view'] },
      { href: '/ops/corporate-actions', label: 'Corporate actions', perms: ['operations.view'] },
    ],
  },
  {
    section: 'Dealing & deals',
    items: [
      { href: '/ops/dealing', label: 'Dealing queue', perms: ['dealing.view'] },
      { href: '/ops/term-sheets', label: 'Term sheets', perms: ['term_sheets.view'] },
      { href: '/ops/investee-requests', label: 'Investee requests', perms: ['research.edit'] },
      { href: '/ops/reporting', label: 'Reporting packs', perms: ['portfolio.view', 'research.edit'] },
      { href: '/ops/esign', label: 'E-signatures', perms: ['esign.view'] },
    ],
  },
  {
    section: 'Counterparties',
    items: [{ href: '/ops/custodian', label: 'Custodian submissions', perms: ['custodian.view'] }],
  },
  {
    section: 'Administration',
    items: [
      { href: '/ops/rbac', label: 'RBAC & Controls', perms: ['admin.rbac'] },
      { href: '/ops/settings', label: 'Settings', perms: ['admin.settings'] },
      { href: '/ops/security', label: 'Security controls', perms: ['admin.rbac', 'admin.settings'] },
      { href: '/ops/integrations', label: 'Integrations', perms: ['admin.settings'] },
      { href: '/ops/audit', label: 'Audit Trail', perms: ['audit.view'] },
      { href: '/ops/copilot', label: 'Investment Copilot', perms: ['dashboard.view'] },
    ],
  },
];
