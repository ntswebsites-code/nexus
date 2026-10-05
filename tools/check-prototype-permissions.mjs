#!/usr/bin/env node
/**
 * W0: verify every coarse view permission the prototype gates pages with exists in role-catalog.json.
 * Additive only — reports missing codes and exits 1 if any are absent.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'backend/api/prisma/seed/role-catalog.json'), 'utf8'));
const inline = readFileSync(path.join(root, 'portals/admin-web/public/legacy/js/01-inline.js'), 'utf8');

const PAGE_PERMS = [
  'dashboard.view',
  'portfolio.view',
  'orders.view',
  'research.view',
  'risk.view',
  'reports.view',
  'clients.view',
  'onboarding.view',
  'cash.view',
  'documents.view',
  'operations.view',
  'valuation.view',
  'admin.rbac',
  'admin.settings',
  'audit.view',
];

const sidebar = readFileSync(path.join(root, 'portals/admin-web/src/legacy/markup/03-sidebar.html'), 'utf8');
const sidebarPerms = [...sidebar.matchAll(/data-permission="([^"]+)"/g)].map((m) => m[1]);
const needed = [...new Set([...PAGE_PERMS, ...sidebarPerms])];

const allCodes = new Set();
for (const role of catalog.roles) for (const p of role.permissions) allCodes.add(p);

const missing = needed.filter((c) => !allCodes.has(c));
if (missing.length) {
  console.error('Missing permission codes in role-catalog.json:', missing.join(', '));
  process.exit(1);
}
console.log('prototype view permissions OK:', needed.length, 'codes present in catalogue');
