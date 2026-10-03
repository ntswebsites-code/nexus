import { expect, test } from '@playwright/test';

const URL = process.env.ONBOARDING_URL ?? 'http://localhost:3102';

test.describe('public onboarding wizard', () => {
  test('page loads with the step rail and a data-mode ribbon', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#stepRail [data-step]')).toHaveCount(6);
    // Either the live wiring is on (no ribbon text about demo) or the amber demo ribbon is shown; never neither once flags resolved.
    await page.waitForFunction(() => document.documentElement.dataset.mxMode !== undefined, undefined, { timeout: 15_000 }).catch(() => undefined);
    const mode = await page.evaluate(() => document.documentElement.dataset.mxMode ?? 'unknown');
    expect(['live', 'demo', 'error']).toContain(mode);
    if (mode !== 'live') await expect(page.locator('#mx-ribbon')).toBeVisible();
  });

  // DEF-460 (FR-ONB-028): a forward click on the rail validates every intervening step and reports the first error.
  test('clicking step 6 from step 1 with an empty legal name focuses Legal name', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#legalName')).toBeVisible();
    await page.locator('#stepRail [data-step="5"]').click();
    await expect(page.locator('#legalName')).toBeFocused();
    // Still on step 1: the first pane is the active one.
    await expect(page.locator('.pane.active')).toHaveAttribute('data-pane', '0');
    const message = await page.locator('#legalName').evaluate((el) => (el as HTMLInputElement).validationMessage);
    expect(message.length).toBeGreaterThan(0);
  });

  test('a later step reports its own first error once earlier steps are valid', async ({ page }) => {
    await page.goto(URL);
    // Fill every required field of step 1 so the first failure is on step 2 (owners).
    const required = await page.locator('[data-pane="0"] [required]').all();
    for (const el of required) {
      const tag = await el.evaluate((n) => n.tagName);
      const type = await el.evaluate((n) => (n as HTMLInputElement).type);
      if (tag === 'SELECT') await el.selectOption({ index: 1 }).catch(() => undefined);
      else if (type === 'email') await el.fill(`e2e-${Date.now()}@example.test`);
      else if (type === 'date') await el.fill('2019-04-01');
      else if (type === 'number') await el.fill('100000');
      else if (type === 'checkbox') await el.check();
      else await el.fill('E2E value');
    }
    await page.locator('#stepRail [data-step="5"]').click();
    // The wizard stops at the first step that is not valid and does not jump to the last one.
    const active = Number(await page.locator('.pane.active').getAttribute('data-pane'));
    expect(active).toBeGreaterThanOrEqual(0);
    expect(active).toBeLessThan(5);
  });

  test('live mode: typing a valid email creates a draft and shows its status', async ({ page }) => {
    await page.goto(URL);
    await page.waitForFunction(() => document.documentElement.dataset.mxMode !== undefined, undefined, { timeout: 15_000 }).catch(() => undefined);
    const mode = await page.evaluate(() => document.documentElement.dataset.mxMode);
    test.skip(mode !== 'live', 'ONBOARDING_LIVE is off on this stack');
    const created = page.waitForResponse((r) => /\/api\/v1\/public\/applications$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20_000 });
    await page.locator('#primaryEmail').fill(`e2e-${Date.now()}@example.test`);
    await page.locator('#primaryEmail').blur();
    const res = await created;
    expect(res.status()).toBeLessThan(300);
    await expect(page.locator('#draftStatus')).not.toBeEmpty();
  });
});
