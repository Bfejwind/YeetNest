import { test, expect } from '@playwright/test';

test('shared footer displays right-aligned Bitcoinex credit on desktop and mobile', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('footer .powered-by')).toHaveText('Powered by : Bitcoinex');
    expect(await page.locator('footer .powered-by').evaluate(element => getComputedStyle(element).textAlign)).toBe('right');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await expect(page.locator('footer .powered-by')).toHaveText('Powered by : Bitcoinex');
});
