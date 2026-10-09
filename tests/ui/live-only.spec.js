import { test, expect } from '@playwright/test';

test('starts live-only and ignores stored demo coins and balances across mobile and desktop', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('yn-coins', JSON.stringify([{ id: 'old-demo', name: 'Old simulated coin', ticker: 'FAKE' }]));
    localStorage.setItem('yn-balance', '999');
    localStorage.setItem('yn-watchlist', '["old-demo"]');
  });
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta', uploads: true } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.locator('.live-environment')).toHaveText('Solana mainnet');
  await expect(page.getByRole('button', { name: 'Demo', exact: true })).toHaveCount(0);
  await expect(page.locator('.coin')).toHaveCount(0);
  await expect(page.locator('.content')).not.toContainText('Old simulated coin');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const slogan = await page.locator('.market-slogan').boundingBox();
    const controls = await page.locator('.header-right').boundingBox();
    expect(slogan.x + slogan.width).toBeLessThanOrEqual(controls.x);
    expect(Math.abs(slogan.y + slogan.height / 2 - controls.y - controls.height / 2)).toBeLessThan(3);
    await page.screenshot({ path: `memepop-live-only-${width}.png` });
  }
  await page.locator('#wallet').click();
  await expect(page.locator('[data-wallet="Phantom"]')).toBeVisible();
  await expect(page.locator('#demo')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-launch]').first().click();
  await expect(page.getByRole('button', { name: 'Prepare live launch', exact: true })).toBeVisible();
  await expect(page.getByLabel('Initial buy (SOL)', { exact: true })).toBeVisible();
});
