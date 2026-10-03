import { expect, test } from '@playwright/test';

// The custodian portal is native React since R4-7 (no injected scripts). The data flows are covered by
// backend/api/scripts/test-custodian-native.ts; this is the browser smoke: sign-in, navigation, a bulk-file validation.
const URL = process.env.CUSTODIAN_URL ?? 'http://localhost:3104';
const EMAIL = process.env.E2E_CUSTODIAN_EMAIL;
const PASSWORD = process.env.E2E_CUSTODIAN_PASSWORD;

test.describe('custodian portal', () => {
  test('the sign-in page is served', async ({ page }) => {
    await page.goto(`${URL}/login`);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('sign in, open each page, validate a CSV file', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'set E2E_CUSTODIAN_EMAIL and E2E_CUSTODIAN_PASSWORD (UAT custodian submitter)');
    await page.goto(`${URL}/login`);
    await page.locator('input[name=email]').fill(EMAIL!);
    await page.locator('input[name=password]').fill(PASSWORD!);
    await page.locator('form button[type=submit]').first().click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 });
    for (const [path, heading] of [
      ['/executions', 'Executions'],
      ['/executions/upload', 'Bulk upload'],
      ['/day-end', 'Day-end packages'],
      ['/statements', 'Statements and holdings'],
      ['/history', 'Status history'],
      ['/users', 'Users and roles'],
      ['/notifications', 'Notifications'],
    ] as const) {
      await page.goto(`${URL}${path}`);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
    await page.goto(`${URL}/executions/upload`);
    await page.locator('input[type=file]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('tradeRef,executionAt\nX1,not-a-date\n') });
    await page.getByRole('button', { name: 'Validate file' }).click();
    await expect(page.getByText('Validation result')).toBeVisible();
  });
});
