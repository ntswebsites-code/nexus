// Placeholder reporting content carried over from the original prototype.
// Replace with API data once the reporting workflow is specified.

export const reportingCompany = { name: 'AFRICA PAYMENTS HOLDINGS' };

export const statusSummary = [
  { label: 'Current period', value: 'Aug 2026', note: 'Due 05 Sep' },
  { label: 'Completion', value: '82%', note: '3 items remaining' },
  { label: 'Open questions', value: '2', note: 'Investment team' },
  { label: 'Covenants', value: '4 / 4', note: 'Evidence current' },
] as const;

export const attentionItems = [
  {
    title: 'Management accounts',
    detail: 'Income statement, balance sheet and cashflow',
    status: 'Due',
    tone: 'due',
  },
  {
    title: 'Operating KPIs',
    detail: 'Revenue, active customers, churn and transaction volume',
    status: 'Complete',
    tone: 'good',
  },
  {
    title: 'Debt & cash',
    detail: 'Bank balances, facilities and maturity schedule',
    status: 'Complete',
    tone: 'good',
  },
  { title: 'Board pack', detail: 'Latest approved board materials', status: 'Due', tone: 'due' },
  {
    title: 'Compliance certificates',
    detail: 'Tax, insurance and key licences',
    status: '1 expiring',
    tone: 'due',
  },
] as const;

export const uploadSlots = [
  { id: 'accounts', label: 'Management accounts' },
  { id: 'board', label: 'Board / supporting pack' },
  { id: 'compliance', label: 'Compliance evidence' },
] as const;
