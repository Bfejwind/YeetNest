import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

test('artwork editor closes without choosing or saving artwork on desktop and mobile', async ({ page }) => {
  const wallet = Keypair.generate().publicKey.toBase58(), mint = Keypair.generate().publicKey.toBase58();
  await page.addInitScript(address => {
    window.phantom = { solana: { connect: async () => ({ publicKey: { toString: () => address } }), on: () => {} } };
  }, wallet);
  await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
  await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
  await page.route('**/api/launches*', route => route.fulfill({ json: [{ id: mint, mint, poolId: mint, creator: wallet, name: 'Owned Coin', ticker: 'OWN', protocol: 'pump', source: 'MemePop', decimals: 6 }] }));
  await page.route('**/api/launches/indexed*', route => route.fulfill({ json: { launches: [], hasMore: false } }));
  await page.route('**/api/candles/*', route => route.fulfill({ json: { indexed: true, candles: [[1791900000, 1, 2, 0.5, 1.5, 10]] } }));
  await page.route('**/api/market/*', route => route.fulfill({ json: { pair: null, candles: [] } }));
  await page.route('**/api/trades/*', route => route.fulfill({ json: { trades: [] } }));
  await page.route('**/api/holders/*', route => route.fulfill({ json: { accounts: [] } }));
  await page.route('**/api/rpc', route => route.fulfill({ json: { jsonrpc: '2.0', id: route.request().postDataJSON().id, result: { context: { slot: 1 }, value: route.request().postDataJSON().method === 'getBalance' ? 1000000000 : [] } } }));
  await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Chart fixture' }));
  let saves = 0, choosers = 0;
  page.on('filechooser', () => { choosers++; });
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith('/image')) saves++; });
  await page.goto('/'); await page.locator('#wallet').click(); await page.locator('[data-wallet="Phantom"]').click();
  await expect(page.locator('#wallet')).toContainText(wallet.slice(0, 4));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const action of ['close', 'cancel', 'escape']) {
      await page.getByRole('article', { name: 'Open Owned Coin', exact: true }).click();
      await expect(page.locator('#token-chart canvas').first()).toBeVisible();
      await page.locator('#edit-art').click();
      await expect(page.locator('#image-form')).toBeVisible();
      await page.locator('.artwork-modal').evaluate(element => { element.scrollTop = element.scrollHeight; });
      if (action === 'close') await page.getByRole('button', { name: 'Close', exact: true }).click();
      if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (action === 'escape') await page.keyboard.press('Escape');
      await expect(page.locator('.overlay')).toHaveCount(0);
    }
  }
  expect(saves).toBe(0); expect(choosers).toBe(0);
});
