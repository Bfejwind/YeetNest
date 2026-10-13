import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('token window is wider, limits lists and keeps close visible while scrolling', async ({ page }) => {
  const mint = Keypair.generate().publicKey.toBase58();
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [{ id: mint, name: 'Window Test', symbol: 'WIN', decimals: 6, usdPrice: 1 }] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [] }));
  await page.route('**/api/market/*', route => route.fulfill({ json: { chartProvider: 'geckoterminal-embed', pair: { pairAddress: mint, dexId: 'meteora' } } }));
  await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Chart fixture' }));
  await page.route('**/api/trades/*', route => route.fulfill({ json: { trades: Array.from({ length: 20 }, (_, i) => ({ kind: 'buy', tx_hash: 'signature' + i })) } }));
  await page.route('**/api/holders/*', route => route.fulfill({ json: { accounts: Array.from({ length: 20 }, () => ({ address: mint, amount: '100', decimals: 6 })) } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await page.locator('.coin').first().click();
  await expect(page.locator('#recent-trades .health-check')).toHaveCount(5);
  await expect(page.locator('#largest-accounts .health-check')).toHaveCount(5);
  expect((await page.locator('.token-modal').boundingBox()).width).toBe(1040);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.token-modal').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const close = page.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeVisible();
    const box = await close.boundingBox();
    expect(box.y).toBeLessThanOrEqual(12);
    expect(box.x + box.width).toBeGreaterThanOrEqual(width - 12);
    await page.screenshot({ path: `memepop-token-window-${width}.png` });
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.overlay')).toHaveCount(0);
});
