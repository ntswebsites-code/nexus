import { expect, test, type Page } from '@playwright/test';

const URL = process.env.CUSTODIAN_URL ?? 'http://localhost:3104';
const EMAIL = process.env.E2E_CUSTODIAN_EMAIL;
const PASSWORD = process.env.E2E_CUSTODIAN_PASSWORD;
const ACCOUNT = process.env.E2E_CUSTODIAN_ACCOUNT; // defaults to the first account of the counterparty
const run = Date.now().toString(36);

async function modeOf(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.mxMode !== undefined, undefined, { timeout: 15_000 }).catch(() => undefined);
  return page.evaluate(() => document.documentElement.dataset.mxMode ?? 'unknown');
}

async function signIn(page: Page) {
  await page.goto(URL);
  const mode = await modeOf(page);
  test.skip(mode !== 'live', 'CUSTODIAN_LIVE is off on this stack');
  test.skip(!EMAIL || !PASSWORD, 'set E2E_CUSTODIAN_EMAIL and E2E_CUSTODIAN_PASSWORD (UAT custodian submitter)');
  await page.locator('#mxEmail').fill(EMAIL!);
  await page.locator('#mxPassword').fill(PASSWORD!);
  await page.locator('#mxLogin button[type=submit]').click();
  await expect(page.locator('#mxSignOut')).toBeVisible({ timeout: 20_000 });
}

test.describe('custodian portal', () => {
  test('demo or error mode is announced; live mode asks for sign-in', async ({ page }) => {
    await page.goto(URL);
    const mode = await modeOf(page);
    expect(['live', 'demo', 'error']).toContain(mode);
    if (mode === 'live') await expect(page.locator('#mx-auth')).toBeVisible();
    else await expect(page.locator('#mx-ribbon')).toBeVisible();
  });

  test('submit an execution, amend it, see the history, cancel it', async ({ page }) => {
    await signIn(page);
    const tradeRef = `E2E-${run}`;
    if (ACCOUNT) await page.locator('#account').fill(ACCOUNT);
    await page.locator('#ref').fill(tradeRef);
    await page.locator('#ticker').fill('DLTA.ZW');
    await page.locator('#qty').fill('1000');
    await page.locator('#price').fill('0.25');
    await page.locator('#broker').fill('E2E Broker');
    await page.locator('#tradeForm button[type=submit]').click();
    const item = page.locator('#activity .item', { hasText: tradeRef });
    await expect(item).toBeVisible({ timeout: 20_000 });

    // Amend the price with a reason.
    await item.getByRole('button', { name: 'Amend' }).click();
    await page.locator('#mxAPrice').fill('0.26');
    await page.locator('#mxAReason').fill('E2E price correction');
    await page.locator('#mxAmend button[type=submit]').click();
    await expect(page.locator('#activity .item', { hasText: tradeRef })).toContainText('amended 1x', { timeout: 20_000 });

    // History shows the submission and the amendment.
    await page.locator('#activity .item', { hasText: tradeRef }).getByRole('button', { name: 'History' }).click();
    await expect(page.locator('#mxHist')).toContainText('amended');
    await expect(page.locator('#mxHist')).toContainText('E2E price correction');
    await page.locator('#mxHClose').click();

    // Cancel it.
    await page.locator('#activity .item', { hasText: tradeRef }).getByRole('button', { name: 'Cancel' }).click();
    await page.locator('#mxCReason').fill('E2E cleanup');
    await page.locator('#mxCancel button[type=submit]').click();
    await expect(page.locator('#activity .item', { hasText: tradeRef })).toContainText('Cancelled', { timeout: 20_000 });
  });

  test('bulk upload: an invalid row is reported with its row number and nothing is stored', async ({ page }) => {
    await signIn(page);
    await page.locator('[data-tab="bulk"]').click();
    const header = 'tradeRef,executionAt,accountRef,ticker,side,quantity,price,currency';
    const csv = `${header}\r\nBULK-${run},${new Date(Date.now() - 3_600_000).toISOString()},NOT-MY-ACCOUNT,DLTA.ZW,BUY,10,1,USD\r\n`;
    await page.locator('#mxBulkFile').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.locator('#mxBulkCheck').click();
    await expect(page.locator('#mxBulkResult')).toContainText('Row 2', { timeout: 20_000 });
    await expect(page.locator('#activity')).not.toContainText(`BULK-${run}`);
  });
});
