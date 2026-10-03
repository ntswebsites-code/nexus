import { defineConfig } from '@playwright/test';

/**
 * Browser smoke for the two legacy-HTML portals (GAP-019). Point it at a RUNNING stack:
 *
 *   ONBOARDING_URL=http://localhost:3102 CUSTODIAN_URL=http://localhost:3104 \
 *   E2E_CUSTODIAN_EMAIL=... E2E_CUSTODIAN_PASSWORD=... npx playwright test
 *
 * Journeys that need live data (API flag on, a custodian user) skip themselves with a reason when it is missing,
 * so the same suite runs in demo mode (rail validation, ribbon) and against UAT (full submit / amend / cancel).
 * Credentials come from the environment only; nothing is stored in the repository.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
