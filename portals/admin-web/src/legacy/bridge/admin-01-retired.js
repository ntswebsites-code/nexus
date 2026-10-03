/*
 * Legacy workspace retirement (GAP-021). `/` now lands on the native console at /ops; the prototype
 * workspace lives at /classic and keeps only the pages that still have a live bridge (clients,
 * investor services, onboarding and KYC, document vault, private markets, RBAC, audit). Every other
 * prototype page runs on demo data and is superseded by a native /ops page, so a link or bookmark
 * to one of them (for example /classic#reconciliation, or a notification link of the form /#orders)
 * is forwarded to its replacement. Runs first, before the prototype renders anything.
 */
(function () {
  'use strict';
  var RETIRED = {
    command: '/ops/command',
    portfolios: '/ops/portfolios',
    'portfolio-lab': '/ops/portfolio-lab',
    orders: '/ops/orders',
    research: '/ops/research',
    risk: '/ops/risk',
    performance: '/ops/performance',
    reports: '/ops/reports',
    ibor: '/ops/ibor',
    financing: '/ops/financing',
    cash: '/ops/cash',
    operations: '/ops/operations',
    reconciliations: '/ops/reconciliation',
    'corporate-actions': '/ops/corporate-actions',
    valuation: '/ops/nav',
    accounting: '/ops/accounting',
    regulatory: '/ops/regulatory',
    data: '/ops/data',
    'model-governance': '/ops/model-governance',
    copilot: '/ops/copilot',
    settings: '/ops/settings',
    reconciliation: '/ops/reconciliation',
    detail: '/ops'
  };
  var page = String(window.location.hash || '').replace(/^#/, '').split(/[/?]/)[0];
  var target = !page ? '/ops' : RETIRED[page];
  if (target) window.location.replace(target);
})();
