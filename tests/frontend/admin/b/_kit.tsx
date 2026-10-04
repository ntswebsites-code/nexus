import { expect } from 'vitest';
import type { ReactElement } from 'react';
import { SessionProvider } from '@/ops/session';
import { loginAs, mockApi, ok, raw, renderWithProviders, screen, waitFor, type Routes, type Persona } from '../../_helpers';

/** Permission codes used across the admin-b screens. */
export const ALL_PERMS = [
  'portfolio.view', 'portfolio.manage', 'orders.create', 'recon.manage', 'reports.view', 'reports.create', 'reports.submit',
  'research.view', 'research.edit', 'research.ic.decide', 'financing.manage', 'private.mark.approve', 'clients.view', 'clients.manage',
  'onboarding.view', 'documents.view', 'operations.view', 'admin.rbac', 'admin.settings', 'audit.view', 'dashboard.view', 'esign.view', 'risk.view', 'financing.approve',
];

export interface MountOpts {
  perms?: string[];
  persona?: Persona;
  routes?: Routes;
  /** extra user overrides (name, roles...) */
  user?: Record<string, unknown>;
}

/** Mocks `/api/auth/me` (with `perms`) plus `routes`, renders `ui` inside SessionProvider, waits for the session. */
export async function mountPage(ui: ReactElement, { perms = ALL_PERMS, persona = 'admin', routes = {}, user = {} }: MountOpts = {}) {
  const api = mockApi({
    ...loginAs(persona, { user: { permissions: perms, ...user } }),
    'GET /api/v1/shell/me/role-focus': raw({ role: null, permissions: null, roles: [] }),
    'GET /api/v1/admin-core/integrations/banner': ok({ production: false, fakeAdapters: [], count: 0 }),
    ...routes,
  });
  const r = renderWithProviders(ui, { providers: [SessionProvider] });
  await waitFor(() => expect(screen.queryByText('LOADING OPERATIONS CONSOLE')).not.toBeInTheDocument());
  return { api, ...r };
}

/** An API list payload shaped as the backend sends it (`{success:true,data}` via ok()). */
export const list = <T,>(items: T[]) => ok(items);

export const idem = (k: string) => k;
