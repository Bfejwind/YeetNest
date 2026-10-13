import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

for (const protocol of ['pump', 'raydium']) for (const failed of [false, true]) {
  test(`${protocol} token automatically shows provider chart when local candles ${failed ? 'fail' : 'are empty'}`, async ({ page }) => {
    const mint = Keypair.generate().publicKey.toBase58();
    await page.route('**/api/status', route => route.fulfill({ json: { network: 'mainnet-beta' } }));
    await page.route('**/api/tokens*', route => route.fulfill({ json: [] }));
    await page.route('**/api/launches*', route => route.fulfill({ json: [{ id: mint, mint, poolId: mint, name: 'Created Token', ticker: 'CREATE', protocol, launchStatus: 'Trading', progress: 1, source: 'MemePop', decimals: 6 }] }));
    await page.route('**/api/curve/*', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Index unavailable' } : { candles: [] } }));
    await page.route('**/api/candles/*', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Index unavailable' } : { candles: [] } }));
    await page.route('**/api/market/*', route => route.fulfill({ json: { chartProvider: 'geckoterminal-embed', chartLookup: 'token', pair: { pairAddress: mint, dexId: 'Pump' } } }));
    await page.route('**/api/holders/*', route => route.fulfill({ json: { accounts: [] } }));
    await page.route('**/api/trades/*', route => route.fulfill({ json: { trades: [] } }));
    await page.route('https://www.geckoterminal.com/**', route => route.fulfill({ contentType: 'text/html', body: 'Chart fixture' }));
    await page.goto('/'); await page.locator('.coin').first().click();
    await expect(page.locator('.external-token-chart')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View provider chart' })).toHaveCount(0);
  });
}
