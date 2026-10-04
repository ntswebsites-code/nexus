import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = import.meta.dirname;
const r = (...p: string[]) => path.join(root, ...p);

const workspaceAliases = {
  '@matanho/portal-kit/proxy': r('packages/portal-kit/src/proxy.ts'),
  '@matanho/portal-kit/session': r('packages/portal-kit/src/session.ts'),
  '@matanho/portal-kit': r('packages/portal-kit/src/index.ts'),
  '@matanho/shared': r('packages/shared/src/index.ts'),
  '@matanho/legacy-runtime/server': r('packages/legacy-runtime/src/server.tsx'),
  '@matanho/legacy-runtime': r('packages/legacy-runtime/src/index.ts'),
};

const portals = ['admin-web', 'investor-web', 'onboarding-web', 'company-web', 'custodian-web'] as const;
const packages = ['portal-kit', 'shared'] as const;

function project(name: string, alias: Record<string, string>) {
  return {
    oxc: { jsx: { runtime: 'automatic' as const } },
    resolve: { alias },
    test: {
      name,
      environment: 'jsdom',
      setupFiles: [r('tests/frontend/setup.ts')],
      include: [`tests/frontend/${name}/**/*.test.{ts,tsx}`, ...(name === "admin-web" ? ["tests/frontend/admin/**/*.test.{ts,tsx}"] : [])],
      css: false,
      clearMocks: true,
    },
  };
}

export default defineConfig({
  test: {
    projects: [
      ...portals.map((p) => project(p, { '@': r(`portals/${p}/src`), ...workspaceAliases })),
      ...packages.map((p) => project(p, workspaceAliases)),
    ],
  },
});
