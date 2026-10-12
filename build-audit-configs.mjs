/* Build per-portal audit configs for the production audit. */
import { readFileSync, writeFileSync } from 'node:fs';

const creds = JSON.parse(readFileSync(process.env.TEMP + '/prod-uat-pw.json', 'utf8'));
const c = (persona) => creds[persona];

const adminNavs = ['command', 'portfolios', 'private-markets', 'portfolio-lab', 'orders', 'research', 'risk', 'performance', 'clients', 'investor-services', 'onboarding', 'reports', 'vault', 'ibor', 'financing', 'cash', 'operations', 'reconciliations', 'corporate-actions', 'valuation', 'accounting', 'regulatory', 'data', 'model-governance', 'copilot', 'rbac', 'settings', 'audit'];

const configs = {
  admin: {
    base: 'https://nexus.matanho.com',
    persona: c('sysadmin').email,
    email: c('sysadmin').email,
    password: c('sysadmin').password,
    portal: 'admin',
    workspace: 'admin',
    navs: adminNavs,
    out: 'admin-portal.json',
  },
  investor: {
    base: 'https://investor.nexus.matanho.com',
    persona: c('lp_a_manager').email,
    email: c('lp_a_manager').email,
    password: c('lp_a_manager').password,
    portal: 'investor',
    workspace: 'investor',
    pages: ['/lp-portal'],
    expects: {
      '/lp-portal': 'Commitment',
      '/lp-portal/documents': 'Documents',
      '/lp-portal/performance': 'Performance',
      '/lp-portal/capital-activity': 'Capital',
      '/lp-portal/notices': 'Notices',
      '/lp-portal/reports': 'Reports',
      '/lp-portal/signatures': 'Signatures',
      '/lp-portal/settings': 'Settings',
    },
    out: 'investor-portal.json',
  },
  company: {
    base: 'https://company.nexus.matanho.com',
    persona: c('investee_101_contributor').email,
    email: c('investee_101_contributor').email,
    password: c('investee_101_contributor').password,
    portal: 'company',
    pages: ['/'],
    out: 'company-portal.json',
  },
  custodian: {
    base: 'https://custodian.nexus.matanho.com',
    persona: c('custodian_submitter').email,
    email: c('custodian_submitter').email,
    password: c('custodian_submitter').password,
    portal: 'custodian',
    pages: ['/'],
    out: 'custodian-portal.json',
  },
  onboarding: {
    base: 'https://onboarding.nexus.matanho.com',
    persona: 'public',
    email: '',
    password: '',
    portal: 'onboarding',
    pages: ['/'],
    out: 'onboarding-portal.json',
  },
};

for (const [name, cfg] of Object.entries(configs)) {
  writeFileSync(`tools/uat/probes/prod-audit-${name}.json`, JSON.stringify(cfg, null, 1));
  console.log(`wrote tools/uat/probes/prod-audit-${name}.json`);
}
